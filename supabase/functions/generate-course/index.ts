import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_LIMITS = {
  free: { maxCourses: 1, maxModules: 5, images: false },
  pro: { maxCourses: 5, maxModules: 10, images: true },
};

// Call Lovable AI Gateway
async function callAI(model: string, prompt: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // User client (respects RLS)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseKey);

    // Get user
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      title,
      theme,
      target_audience,
      tone,
      language,
      num_modules,
      include_quiz,
      include_flashcards,
      include_images,
    } = body;

    // 1. Get subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", user.id)
      .single();

    const plan = (sub?.plan || "free") as "free" | "pro";
    const limits = PLAN_LIMITS[plan];

    // 2. Check monthly usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { count: usageCount } = await serviceClient
      .from("usage_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("event_type", "course_created")
      .gte("created_at", startOfMonth);

    if ((usageCount ?? 0) >= limits.maxCourses) {
      return new Response(
        JSON.stringify({ error: "Monthly course limit reached. Upgrade your plan." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce module limit
    const actualModules = Math.min(num_modules || 3, limits.maxModules);

    // 3. Generate course structure with Gemini Flash-Lite
    const structurePrompt = `You are an educational course designer. Create a detailed course structure in JSON format.

Course details:
- Title: ${title}
- Theme: ${theme}
- Target audience: ${target_audience || "general"}
- Tone: ${tone || "professional"}
- Language: ${language || "pt-BR"}
- Number of modules: ${actualModules}
${include_quiz ? "- Include 3 quiz questions per module" : ""}
${include_flashcards ? "- Include 5 flashcards per module" : ""}

Return ONLY valid JSON with this structure:
{
  "description": "course description",
  "modules": [
    {
      "title": "Module title",
      "summary": "brief summary for content generation"
      ${include_quiz ? ',"quiz": [{"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]' : ""}
      ${include_flashcards ? ',"flashcards": [{"front": "question", "back": "answer"}]' : ""}
    }
  ]
}`;

    const structureRaw = await callAI(
      "google/gemini-2.5-flash-lite",
      structurePrompt
    );

    // Parse JSON from response
    let structure;
    try {
      const jsonMatch = structureRaw.match(/\{[\s\S]*\}/);
      structure = JSON.parse(jsonMatch ? jsonMatch[0] : structureRaw);
    } catch {
      throw new Error("Failed to parse AI structure response");
    }

    // 4. Create course in DB
    const { data: course, error: courseError } = await serviceClient
      .from("courses")
      .insert({
        user_id: user.id,
        title,
        description: structure.description || "",
        theme,
        target_audience: target_audience || null,
        tone: tone || null,
        language: language || "pt-BR",
        include_quiz: !!include_quiz,
        include_flashcards: !!include_flashcards,
        include_images: !!include_images,
      })
      .select()
      .single();

    if (courseError) throw courseError;

    // 5. Generate content for each module with Gemini Flash
    for (let i = 0; i < structure.modules.length; i++) {
      const mod = structure.modules[i];

      const contentPrompt = `Write detailed educational content for this module in ${language || "pt-BR"}.

Course: ${title}
Module ${i + 1}: ${mod.title}
Summary: ${mod.summary || mod.title}
Target audience: ${target_audience || "general"}
Tone: ${tone || "professional"}

Write in Markdown format. Include:
- Clear introduction
- Main concepts with explanations
- Examples when relevant
- Key takeaways

Write 800-1200 words. Be thorough and educational.`;

      const content = await callAI(
        "google/gemini-2.5-flash",
        contentPrompt
      );

      // Insert module
      const { data: moduleData, error: moduleError } = await serviceClient
        .from("course_modules")
        .insert({
          course_id: course.id,
          title: mod.title,
          content: content,
          order_index: i,
        })
        .select()
        .single();

      if (moduleError) throw moduleError;

      // Insert quiz questions
      if (include_quiz && mod.quiz?.length > 0) {
        const quizInserts = mod.quiz.map((q: any) => ({
          module_id: moduleData.id,
          question: q.question,
          options: q.options,
          correct_answer: q.correct ?? 0,
          explanation: q.explanation || null,
        }));
        await serviceClient.from("course_quiz_questions").insert(quizInserts);
      }

      // Insert flashcards
      if (include_flashcards && mod.flashcards?.length > 0) {
        const fcInserts = mod.flashcards.map((fc: any) => ({
          module_id: moduleData.id,
          front: fc.front,
          back: fc.back,
        }));
        await serviceClient.from("course_flashcards").insert(fcInserts);
      }
    }

    // 6. Log usage event
    await serviceClient.from("usage_events").insert({
      user_id: user.id,
      event_type: "course_created",
      metadata: { course_id: course.id, plan },
    });

    return new Response(
      JSON.stringify({ course_id: course.id, message: "Course generated successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Generate course error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
