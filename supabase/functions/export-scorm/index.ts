import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/>\s*/g, "")
    .replace(/---/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Wrap remaining lines in <p>
  const lines = html.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("<h") || trimmed.startsWith("<ul") || trimmed.startsWith("<li") || trimmed.startsWith("</")) {
      result.push(trimmed);
    } else {
      result.push(`<p>${trimmed}</p>`);
    }
  }
  return result.join("\n");
}

interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
}

function generateQuizHtml(quizzes: QuizQuestion[]): string {
  if (quizzes.length === 0) return "";
  let html = `<hr><h2>Quiz</h2>`;
  quizzes.forEach((q, i) => {
    html += `<p><strong>${i + 1}. ${escapeHtml(q.question)}</strong></p><ul>`;
    (q.options || []).forEach((opt: string, j: number) => {
      const marker = j === q.correct_answer ? " ✓" : "";
      html += `<li>${String.fromCharCode(65 + j)}) ${escapeHtml(opt)}${marker}</li>`;
    });
    html += `</ul>`;
    if (q.explanation) {
      html += `<p><em>${escapeHtml(q.explanation)}</em></p>`;
    }
  });
  return html;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Business-only gate (currently no business plan exists, so always 403)
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    // SCORM is Business-only. Since business plan doesn't exist yet, check is_dev for testing
    if (plan !== "business") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "SCORM export requires a Business plan.", feature: "export_scorm" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch course
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    // Fetch quizzes for all modules
    const moduleIds = modules.map((m: any) => m.id);
    let allQuizzes: any[] = [];
    if (moduleIds.length > 0) {
      const { data: quizData } = await serviceClient
        .from("course_quiz_questions").select("*").in("module_id", moduleIds);
      allQuizzes = quizData || [];
    }

    // Build SCORM 1.2 package
    const zip = new JSZip();
    const courseTitle = escapeXml(course.title);

    // Generate HTML pages for each module
    const scoItems: string[] = [];
    const scoResources: string[] = [];

    modules.forEach((mod: any, i: number) => {
      const filename = `module_${i + 1}.html`;
      const moduleQuizzes = allQuizzes.filter((q: any) => q.module_id === mod.id);
      const quizHtml = generateQuizHtml(moduleQuizzes);

      const htmlContent = `<!DOCTYPE html>
<html lang="${course.language || "pt-BR"}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(mod.title)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 8px; }
    h2 { color: #16213e; margin-top: 24px; }
    h3 { color: #0f3460; }
    ul { padding-left: 20px; }
    li { margin-bottom: 4px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
    .nav { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; }
    .nav a { color: #0f3460; text-decoration: none; padding: 8px 16px; border: 1px solid #0f3460; border-radius: 4px; }
    .nav a:hover { background: #0f3460; color: white; }
  </style>
</head>
<body>
  <h1>${escapeHtml(mod.title)}</h1>
  ${markdownToHtml(mod.content || "")}
  ${quizHtml}
  <div class="nav">
    ${i > 0 ? `<a href="module_${i}.html">← Anterior</a>` : "<span></span>"}
    ${i < modules.length - 1 ? `<a href="module_${i + 2}.html">Próximo →</a>` : "<span></span>"}
  </div>
  <script>
    // SCORM 1.2 API wrapper
    var API = null;
    function findAPI(win) {
      try {
        while (win && !win.API) { win = win.parent; if (win === win.parent) break; }
        return win ? win.API : null;
      } catch(e) { return null; }
    }
    API = findAPI(window);
    if (API) {
      API.LMSInitialize("");
      API.LMSSetValue("cmi.core.lesson_status", "completed");
      API.LMSCommit("");
    }
  </script>
</body>
</html>`;

      zip.file(filename, htmlContent);

      scoItems.push(`
        <item identifier="ITEM_${i + 1}" identifierref="RES_${i + 1}">
          <title>${escapeXml(mod.title)}</title>
        </item>`);

      scoResources.push(`
        <resource identifier="RES_${i + 1}" type="webcontent" adlcp:scormtype="sco" href="${filename}">
          <file href="${filename}"/>
        </resource>`);
    });

    // imsmanifest.xml (SCORM 1.2)
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="COURSE_${course_id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
    http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
    http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_1">
    <organization identifier="ORG_1">
      <title>${courseTitle}</title>
      ${scoItems.join("")}
    </organization>
  </organizations>
  <resources>
    ${scoResources.join("")}
  </resources>
</manifest>`;

    zip.file("imsmanifest.xml", manifest);

    // Generate zip
    const zipBlob = await zip.generateAsync({ type: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - SCORM - ${dateStr}.zip`;

    // Upload to storage
    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, zipBlob, { contentType: "application/zip", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    // Log usage
    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_SCORM",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export SCORM error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
