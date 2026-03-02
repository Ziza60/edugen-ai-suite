import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

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

function extractBullets(content: string): string[] {
  const lines = content.split("\n");
  const bullets: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Skip headings
    if (trimmed.startsWith("#")) continue;
    
    // Bullet items
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      const text = stripMarkdown(trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
      if (text.length > 0 && text.length < 200) {
        bullets.push(text);
      }
    } else {
      // Regular paragraph - extract key sentences
      const clean = stripMarkdown(trimmed);
      if (clean.length > 20 && clean.length < 200) {
        bullets.push(clean);
      }
    }
    
    // Limit bullets per slide
    if (bullets.length >= 8) break;
  }
  
  return bullets.slice(0, 8);
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
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
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

    // Build PPTX
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // Define master slide colors
    const PRIMARY = "16213E";
    const PRIMARY_LIGHT = "1A237E";
    const TEXT_WHITE = "FFFFFF";
    const TEXT_DARK = "1E1E23";
    const ACCENT = "5C6BC0";

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: PRIMARY };
    titleSlide.addText(course.title, {
      x: 0.8, y: 1.5, w: 8.4, h: 2,
      fontSize: 36, fontFace: "Arial",
      color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });
    if (course.description) {
      titleSlide.addText(course.description, {
        x: 1.5, y: 3.8, w: 7, h: 1,
        fontSize: 16, fontFace: "Arial",
        color: "B0BEC5", align: "center",
      });
    }
    titleSlide.addText(new Date().toLocaleDateString("pt-BR"), {
      x: 0, y: 5, w: 10, h: 0.5,
      fontSize: 10, fontFace: "Arial",
      color: "78909C", align: "center",
    });

    // Module slides
    modules.forEach((mod: any, i: number) => {
      const slide = pptx.addSlide();

      // Header bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 10, h: 1.2,
        fill: { color: PRIMARY },
      });

      // Module number
      slide.addText(`MÓDULO ${i + 1}`, {
        x: 0.5, y: 0.15, w: 2, h: 0.35,
        fontSize: 10, fontFace: "Arial",
        color: ACCENT, bold: true,
      });

      // Module title
      slide.addText(stripMarkdown(mod.title), {
        x: 0.5, y: 0.45, w: 9, h: 0.6,
        fontSize: 22, fontFace: "Arial",
        color: TEXT_WHITE, bold: true,
      });

      // Accent line
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: 1.35, w: 1.5, h: 0.04,
        fill: { color: ACCENT },
      });

      // Content bullets
      const bullets = extractBullets(mod.content || "");
      if (bullets.length > 0) {
        const bulletObjs = bullets.map((b) => ({
          text: b,
          options: {
            fontSize: 14,
            fontFace: "Arial",
            color: TEXT_DARK,
            bullet: { type: "bullet" as const, color: ACCENT },
            paraSpaceAfter: 8,
          },
        }));

        slide.addText(bulletObjs, {
          x: 0.8, y: 1.7, w: 8.4, h: 3.5,
          valign: "top",
        });
      }

      // Footer
      slide.addText(`${i + 1} / ${modules.length}`, {
        x: 4, y: 5.2, w: 2, h: 0.3,
        fontSize: 9, fontFace: "Arial",
        color: "999999", align: "center",
      });
    });

    // Thank you slide
    const endSlide = pptx.addSlide();
    endSlide.background = { color: PRIMARY };
    endSlide.addText("Obrigado!", {
      x: 0, y: 2, w: 10, h: 2,
      fontSize: 40, fontFace: "Arial",
      color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // Generate file
    const pptxData = await pptx.write({ outputType: "uint8array" });
    const fileName = `${userId}/${course_id}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PPTX error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
