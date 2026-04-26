import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
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
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
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
  module_id: string;
}

interface Flashcard {
  front: string;
  back: string;
  module_id: string;
}

function generateMoodleQuizXml(quizzes: QuizQuestion[], sectionId: number, activityId: number): string {
  if (quizzes.length === 0) return "";
  
  let questionsXml = "";
  quizzes.forEach((q, i) => {
    const qId = activityId * 100 + i + 1;
    let answersXml = "";
    (q.options || []).forEach((opt: string, j: number) => {
      const fraction = j === q.correct_answer ? 100 : 0;
      answersXml += `
            <answer fraction="${fraction}" format="html">
              <text><![CDATA[<p>${escapeXml(opt)}</p>]]></text>
              <feedback format="html"><text><![CDATA[${j === q.correct_answer ? "<p>Correto!</p>" : "<p>Incorreto.</p>"}]]></text></feedback>
            </answer>`;
    });

    questionsXml += `
          <question id="${qId}" type="multichoice">
            <name><text><![CDATA[${escapeXml(q.question).substring(0, 80)}]]></text></name>
            <questiontext format="html"><text><![CDATA[<p>${escapeXml(q.question)}</p>]]></text></questiontext>
            <generalfeedback format="html"><text><![CDATA[${q.explanation ? `<p>${escapeXml(q.explanation)}</p>` : ""}]]></text></generalfeedback>
            <defaultgrade>1</defaultgrade>
            <single>true</single>
            <shuffleanswers>1</shuffleanswers>${answersXml}
          </question>`;
  });

  return `
      <activity id="${activityId}" moduleid="${activityId}" modulename="quiz" contextid="${activityId + 5000}">
        <quiz id="${activityId}">
          <name><![CDATA[Quiz]]></name>
          <intro format="html"><text><![CDATA[<p>Quiz do módulo</p>]]></text></intro>
          <timeopen>0</timeopen>
          <timeclose>0</timeclose>
          <timelimit>0</timelimit>
          <attempts_number>0</attempts_number>
          <grademethod>1</grademethod>
          <grade>100</grade>
          <question_instances>${questionsXml}
          </question_instances>
        </quiz>
      </activity>`;
}

function generateFlashcardsPageXml(flashcards: Flashcard[], activityId: number): string {
  if (flashcards.length === 0) return "";
  
  let tableRows = flashcards.map(fc =>
    `<tr><td>${escapeXml(fc.front)}</td><td>${escapeXml(fc.back)}</td></tr>`
  ).join("\n");

  const htmlContent = `<h3>Flashcards</h3>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
<thead><tr><th style="background:#f0f0f0">Frente</th><th style="background:#f0f0f0">Verso</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>`;

  return `
      <activity id="${activityId}" moduleid="${activityId}" modulename="page" contextid="${activityId + 5000}">
        <page id="${activityId}">
          <name><![CDATA[Flashcards]]></name>
          <intro format="html"><text><![CDATA[<p>Flashcards para revisão</p>]]></text></intro>
          <content format="html"><text><![CDATA[${htmlContent}]]></text></content>
          <contentformat>1</contentformat>
          <legacyfiles>0</legacyfiles>
          <legacyfileslast>$@NULL@$</legacyfileslast>
          <display>5</display>
          <displayoptions>a:1:{s:10:"printintro";i:0;}</displayoptions>
          <revision>1</revision>
          <timemodified>${Math.floor(Date.now() / 1000)}</timemodified>
        </page>
      </activity>`;
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

    // Pro plan gate
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro" && plan !== "business") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "Moodle export requires a Pro plan.", feature: "export_moodle" }),
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
    let allQuizzes: QuizQuestion[] = [];
    let allFlashcards: Flashcard[] = [];
    if (moduleIds.length > 0) {
      const { data: quizData } = await serviceClient
        .from("course_quiz_questions").select("*").in("module_id", moduleIds);
      allQuizzes = (quizData || []) as QuizQuestion[];
      
      const { data: flashData } = await serviceClient
        .from("course_flashcards").select("*").in("module_id", moduleIds);
      allFlashcards = (flashData || []) as Flashcard[];
    }

    // Build Moodle backup XML
    const zip = new JSZip();
    zip.folder("files"); // empty files folder

    const timestamp = Math.floor(Date.now() / 1000);
    const courseTitle = escapeXml(course.title);
    const courseSummary = escapeXml(course.description || course.title);
    
    let sectionsXml = "";
    let activityCounter = 1;

    modules.forEach((mod: any, i: number) => {
      const sectionId = i + 1;
      const contentHtml = markdownToHtml(mod.content || "");
      
      // Main page activity
      const pageActivityId = activityCounter++;
      let activitiesXml = `
      <activity id="${pageActivityId}" moduleid="${pageActivityId}" modulename="page" contextid="${pageActivityId + 5000}">
        <page id="${pageActivityId}">
          <name><![CDATA[${escapeXml(mod.title)}]]></name>
          <intro format="html"><text><![CDATA[<p>${escapeXml(mod.title)}</p>]]></text></intro>
          <content format="html"><text><![CDATA[${contentHtml}]]></text></content>
          <contentformat>1</contentformat>
          <legacyfiles>0</legacyfiles>
          <legacyfileslast>$@NULL@$</legacyfileslast>
          <display>5</display>
          <displayoptions>a:1:{s:10:"printintro";i:0;}</displayoptions>
          <revision>1</revision>
          <timemodified>${timestamp}</timemodified>
        </page>
      </activity>`;

      // Quiz activity if module has quiz questions
      const moduleQuizzes = allQuizzes.filter((q: any) => q.module_id === mod.id);
      if (moduleQuizzes.length > 0) {
        const quizActivityId = activityCounter++;
        activitiesXml += generateMoodleQuizXml(moduleQuizzes, sectionId, quizActivityId);
      }

      // Flashcards as page if module has flashcards
      const moduleFlashcards = allFlashcards.filter((fc: any) => fc.module_id === mod.id);
      if (moduleFlashcards.length > 0) {
        const flashActivityId = activityCounter++;
        activitiesXml += generateFlashcardsPageXml(moduleFlashcards, flashActivityId);
      }

      sectionsXml += `
    <section id="${sectionId}">
      <number>${sectionId}</number>
      <name><![CDATA[${escapeXml(mod.title)}]]></name>
      <summary format="html"><text><![CDATA[<p>${escapeXml(mod.title)}</p>]]></text></summary>
      <visible>1</visible>
      <activities>${activitiesXml}
      </activities>
    </section>`;
    });

    const moodleBackupXml = `<?xml version="1.0" encoding="UTF-8"?>
<moodle_backup>
  <information>
    <name><![CDATA[${courseTitle}]]></name>
    <moodle_version>2024042200</moodle_version>
    <moodle_release>4.4</moodle_release>
    <backup_version>2024042200</backup_version>
    <backup_release>4.4</backup_release>
    <backup_date>${timestamp}</backup_date>
    <mnet_remoteusers>0</mnet_remoteusers>
    <include_files>0</include_files>
    <include_file_references_to_external_content>0</include_file_references_to_external_content>
    <original_wwwroot>https://edugen.ai</original_wwwroot>
    <original_site_identifier_hash>edugenai</original_site_identifier_hash>
    <original_course_id>1</original_course_id>
    <original_course_fullname><![CDATA[${courseTitle}]]></original_course_fullname>
    <original_course_shortname><![CDATA[${courseTitle}]]></original_course_shortname>
    <original_course_startdate>${timestamp}</original_course_startdate>
    <original_system_contextid>1</original_system_contextid>
  </information>
  <course id="1">
    <shortname><![CDATA[${courseTitle}]]></shortname>
    <fullname><![CDATA[${courseTitle}]]></fullname>
    <summary format="html"><text><![CDATA[<p>${courseSummary}</p>]]></text></summary>
    <format>topics</format>
    <startdate>${timestamp}</startdate>
    <visible>1</visible>
    <lang>${course.language === "pt-BR" ? "pt_br" : (course.language || "pt_br").replace("-", "_").toLowerCase()}</lang>
    <sections>${sectionsXml}
    </sections>
  </course>
</moodle_backup>`;

    zip.file("moodle_backup.xml", moodleBackupXml);

    // Generate zip
    const zipBlob = await zip.generateAsync({ type: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - Moodle - ${dateStr}.zip`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, zipBlob, { contentType: "application/zip", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_MOODLE",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export Moodle error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
