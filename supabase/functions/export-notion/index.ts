import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generates a Notion-compatible Markdown file.
 * Structure:
 * - Main heading = Course title
 * - Each module as H2 with toggle/callout-friendly formatting
 * - Quizzes and flashcards as sub-sections
 */
function buildNotionMarkdown(
  course: any,
  modules: any[],
  quizzes: any[],
  flashcards: any[]
): string {
  const lines: string[] = [];

  // Course header
  lines.push(`# ${course.title}`);
  lines.push("");
  if (course.description) {
    lines.push(`> ${course.description}`);
    lines.push("");
  }
  lines.push(`**Idioma:** ${course.language}  `);
  lines.push(`**Gerado em:** ${new Date().toLocaleDateString("pt-BR")}  `);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Table of contents
  lines.push("## 📑 Sumário");
  lines.push("");
  modules.forEach((mod, i) => {
    lines.push(`${i + 1}. [${mod.title}](#${mod.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")})`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");

  // Modules
  modules.forEach((mod, i) => {
    lines.push(`## ${i + 1}. ${mod.title}`);
    lines.push("");
    if (mod.content) {
      lines.push(mod.content);
    }
    lines.push("");

    // Module quizzes
    const moduleQuizzes = quizzes.filter((q) => q.module_id === mod.id);
    if (moduleQuizzes.length > 0) {
      lines.push(`### 🧠 Quiz — ${mod.title}`);
      lines.push("");
      if (moduleQuizzes.length <= 15) {
        // Standard format
        moduleQuizzes.forEach((q, qi) => {
          lines.push(`**${qi + 1}. ${q.question}**`);
          lines.push("");
          (q.options || []).forEach((opt: string, j: number) => {
            const marker = j === q.correct_answer ? "✅" : "⬜";
            lines.push(`${marker} ${String.fromCharCode(65 + j)}) ${opt}`);
          });
          if (q.explanation) {
            lines.push("");
            lines.push(`> 💡 ${q.explanation}`);
          }
          lines.push("");
        });
      } else {
        // Compact list for large quiz sets
        moduleQuizzes.forEach((q, qi) => {
          const correctLetter = String.fromCharCode(65 + q.correct_answer);
          lines.push(`${qi + 1}. **${q.question}** → ${correctLetter}) ${(q.options || [])[q.correct_answer] || ""}`);
        });
        lines.push("");
      }
    }

    // Module flashcards
    const moduleFlashcards = flashcards.filter((f) => f.module_id === mod.id);
    if (moduleFlashcards.length > 0) {
      lines.push(`### 🃏 Flashcards — ${mod.title}`);
      lines.push("");
      if (moduleFlashcards.length <= 15) {
        // Table format for small sets
        lines.push("| Pergunta | Resposta |");
        lines.push("| --- | --- |");
        moduleFlashcards.forEach((f) => {
          const front = f.front.replace(/\|/g, "\\|").replace(/\n/g, " ");
          const back = f.back.replace(/\|/g, "\\|").replace(/\n/g, " ");
          lines.push(`| ${front} | ${back} |`);
        });
      } else {
        // List format fallback for large sets (avoids broken tables in Notion)
        moduleFlashcards.forEach((f, fi) => {
          lines.push(`**${fi + 1}. ${f.front.replace(/\n/g, " ")}**`);
          lines.push(`   → ${f.back.replace(/\n/g, " ")}`);
          lines.push("");
        });
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
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

    // Pro-only gate
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "Notion export requires a Pro plan.", feature: "export_notion" }),
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

    const { data: modulesRaw } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");
    const modules: any[] = modulesRaw ?? [];

    const moduleIds = modules.map((m: any) => m.id);
    let quizzes: any[] = [];
    let flashcards: any[] = [];
    if (moduleIds.length > 0) {
      const [quizRes, flashRes] = await Promise.all([
        serviceClient.from("course_quiz_questions").select("*").in("module_id", moduleIds),
        serviceClient.from("course_flashcards").select("*").in("module_id", moduleIds),
      ]);
      quizzes = quizRes.data || [];
      flashcards = flashRes.data || [];
    }

    const markdown = buildNotionMarkdown(course, modules, quizzes, flashcards);
    const encoder = new TextEncoder();
    const mdBytes = encoder.encode(markdown);

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - Notion - ${dateStr}.md`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, mdBytes, { contentType: "text/markdown", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_NOTION",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export Notion error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
