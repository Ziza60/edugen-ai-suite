import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

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

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
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

    // Check subscription
    const { data: sub } = await serviceClient
      .from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      // Check if dev
      const { data: profile } = await serviceClient
        .from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(JSON.stringify({ error: "PDF export is available only on Pro plan." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch course + modules
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    // Generate PDF with jsPDF
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 30;

    const addPage = () => { doc.addPage(); y = 20; };
    const checkPage = (needed: number) => { if (y + needed > 275) addPage(); };

    // Title page
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    const titleLines = doc.splitTextToSize(course.title, contentWidth);
    doc.text(titleLines, pageWidth / 2, 80, { align: "center" });

    if (course.description) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      const descLines = doc.splitTextToSize(course.description, contentWidth - 20);
      doc.text(descLines, pageWidth / 2, 100, { align: "center" });
    }

    doc.setFontSize(10);
    doc.text(`Idioma: ${course.language}`, pageWidth / 2, 130, { align: "center" });
    doc.text(new Date().toLocaleDateString("pt-BR"), pageWidth / 2, 136, { align: "center" });

    // Modules
    for (const mod of modules) {
      addPage();
      y = 25;

      // Module title
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      const modTitleLines = doc.splitTextToSize(mod.title, contentWidth);
      doc.text(modTitleLines, margin, y);
      y += modTitleLines.length * 8 + 5;

      // Content
      if (mod.content) {
        const lines = mod.content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { y += 3; continue; }

          const heading = getHeadingLevel(trimmed);
          if (heading > 0) {
            checkPage(12);
            const sizes: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 11, 6: 10 };
            doc.setFontSize(sizes[heading] || 12);
            doc.setFont("helvetica", "bold");
            const hText = trimmed.replace(/^#{1,6}\s*/, "");
            const hLines = doc.splitTextToSize(hText, contentWidth);
            doc.text(hLines, margin, y);
            y += hLines.length * (sizes[heading] / 2.5) + 4;
          } else if (trimmed.startsWith("> ")) {
            checkPage(10);
            doc.setFontSize(10);
            doc.setFont("helvetica", "italic");
            const qText = stripMarkdown(trimmed.replace(/^>\s*/, ""));
            const qLines = doc.splitTextToSize(qText, contentWidth - 10);
            // Draw left border
            doc.setDrawColor(100, 100, 200);
            doc.setLineWidth(0.5);
            doc.line(margin + 2, y - 3, margin + 2, y + qLines.length * 4 + 1);
            doc.text(qLines, margin + 6, y);
            y += qLines.length * 4 + 4;
          } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            checkPage(8);
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const bText = stripMarkdown(trimmed.replace(/^[-*]\s*/, ""));
            const bLines = doc.splitTextToSize(bText, contentWidth - 8);
            doc.text("•", margin + 2, y);
            doc.text(bLines, margin + 7, y);
            y += bLines.length * 4 + 2;
          } else if (trimmed === "---") {
            checkPage(6);
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.3);
            doc.line(margin, y, pageWidth - margin, y);
            y += 6;
          } else {
            checkPage(8);
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            const pText = stripMarkdown(trimmed);
            const pLines = doc.splitTextToSize(pText, contentWidth);
            doc.text(pLines, margin, y);
            y += pLines.length * 4 + 2;
          }
        }
      }
    }

    // Convert to bytes
    const pdfBytes = doc.output("arraybuffer");
    const fileName = `${userId}/${course_id}.pdf`;

    // Upload to storage
    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // Create signed URL (1 hour)
    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);

    if (signErr) throw signErr;

    // Log usage event
    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PDF",
      metadata: { course_id },
    });

    return new Response(
      JSON.stringify({ url: signedUrl.signedUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Export PDF error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
