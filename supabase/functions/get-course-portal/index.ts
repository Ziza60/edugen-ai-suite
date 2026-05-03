import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // POST — issue certificate for portal student
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { courseId, studentName } = body;

    if (!courseId || !studentName?.trim()) {
      return json({ error: "courseId and studentName required" }, 400);
    }

    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("user_id, title")
      .eq("id", courseId)
      .single();

    if (courseErr || !course) return json({ error: "Course not found" }, 404);

    const token =
      crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);

    const { data: cert, error: certErr } = await supabase
      .from("certificates")
      .insert({
        course_id: courseId,
        user_id: course.user_id,
        student_name: studentName.trim(),
        token,
        template: "professional",
        issued_at: new Date().toISOString(),
      })
      .select("token")
      .single();

    if (certErr) return json({ error: "Failed to issue certificate" }, 500);
    return json({ token: cert.token });
  }

  // GET — fetch all portal data by slug
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return json({ error: "slug required" }, 400);

  const { data: landing, error: landingErr } = await (supabase
    .from("course_landings") as any)
    .select("*, courses(id, title, description, status)")
    .eq("slug", slug)
    .single();

  if (landingErr || !landing) return json({ error: "Portal not found" }, 404);

  const courseId = landing.course_id;
  const course = landing.courses as any;

  const { data: modules = [] } = await supabase
    .from("course_modules")
    .select("id, title, content, order_index")
    .eq("course_id", courseId)
    .order("order_index");

  const moduleIds = (modules as any[]).map((m) => m.id);

  const [quizRes, flashRes] = await Promise.all([
    moduleIds.length
      ? supabase
          .from("course_quiz_questions")
          .select("id, module_id, question, options, correct_answer, explanation")
          .in("module_id", moduleIds)
      : Promise.resolve({ data: [] }),
    moduleIds.length
      ? supabase
          .from("course_flashcards")
          .select("id, module_id, front, back")
          .in("module_id", moduleIds)
      : Promise.resolve({ data: [] }),
  ]);

  const quizMap: Record<string, any[]> = {};
  const flashMap: Record<string, any[]> = {};

  for (const q of quizRes.data || []) {
    (quizMap[q.module_id] ??= []).push(q);
  }
  for (const f of flashRes.data || []) {
    (flashMap[f.module_id] ??= []).push(f);
  }

  const enriched = (modules as any[]).map((m) => ({
    ...m,
    quizQuestions: quizMap[m.id] || [],
    flashcards: flashMap[m.id] || [],
  }));

  const colors = (landing.custom_colors as any) || {};

  return json({
    courseId,
    courseTitle: course?.title || landing.headline || "Curso",
    description: course?.description || landing.summary || "",
    instructorName: landing.instructor_name || null,
    primaryColor: colors.primary || "#7c3aed",
    logoUrl: landing.logo_url || null,
    modules: enriched,
  });
});
