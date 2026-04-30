import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADAPTATION_PROMPTS: Record<string, string> = {
  literal: `Traduza de forma literal e precisa, mantendo exemplos e referências culturais originais. Apenas mude o idioma.`,
  adapted: `Traduza e adapte levemente os exemplos culturais para o público-alvo. Mantenha a essência mas ajuste referências que seriam confusas (ex: moeda, unidades de medida, nomes de empresas locais).`,
  localized: `Traduza com localização completa: substitua exemplos culturais por equivalentes do país-alvo. Ex: troque referências brasileiras por americanas se traduzindo para en-US, adapte contextos de negócios, educação e cotidiano. O conteúdo deve parecer ter sido escrito originalmente no idioma-alvo.`,
};

const BATCH_SIZE = 2; // modules per AI call to avoid timeouts

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Check PRO entitlement
    const { data: sub } = await userClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const { data: profile } = await userClient
      .from("profiles")
      .select("is_dev")
      .eq("user_id", userId)
      .single();

    const isPro = sub?.plan === "pro" || profile?.is_dev === true;
    if (!isPro) {
      return new Response(JSON.stringify({ error: "Feature exclusiva do plano Pro" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { course_id, target_language, adaptation = "adapted" } = await req.json();
    if (!course_id || !target_language) {
      return new Response(JSON.stringify({ error: "course_id and target_language required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adaptationPrompt = ADAPTATION_PROMPTS[adaptation] || ADAPTATION_PROMPTS.adapted;

    // Fetch course
    const { data: course, error: courseErr } = await userClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all modules
    const { data: modulesRaw } = await userClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // Fetch quizzes and flashcards
    const moduleIds = modules.map((m: any) => m.id);
    const { data: quizzesRaw } = await userClient
      .from("course_quiz_questions")
      .select("*")
      .in("module_id", moduleIds);
    const quizzes: any[] = quizzesRaw ?? [];

    const { data: flashcardsRaw } = await userClient
      .from("course_flashcards")
      .select("*")
      .in("module_id", moduleIds);
    const flashcards: any[] = flashcardsRaw ?? [];

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Create the new translated course
    const translatedTitle = await translateText(
      geminiKey,
      course.title,
      target_language,
      adaptationPrompt,
      "course title"
    );

    const translatedDesc = course.description
      ? await translateText(geminiKey, course.description, target_language, adaptationPrompt, "course description")
      : null;

    const { data: newCourse, error: newCourseErr } = await adminClient
      .from("courses")
      .insert({
        user_id: userId,
        title: translatedTitle,
        description: translatedDesc,
        language: target_language,
        tone: course.tone,
        target_audience: course.target_audience,
        theme: course.theme,
        include_quiz: course.include_quiz,
        include_flashcards: course.include_flashcards,
        include_images: false, // images not translated
        status: "draft",
      })
      .select()
      .single();

    if (newCourseErr || !newCourse) {
      throw new Error("Failed to create translated course: " + newCourseErr?.message);
    }

    // Translate modules in batches
    let translatedModulesCount = 0;
    for (let i = 0; i < modules.length; i += BATCH_SIZE) {
      const batch = modules.slice(i, i + BATCH_SIZE);
      const translationPromises = batch.map(async (mod: any) => {
        const translatedContent = await translateText(
          geminiKey,
          mod.content || "",
          target_language,
          adaptationPrompt,
          "educational module content in markdown format"
        );
        const translatedModTitle = await translateText(
          geminiKey,
          mod.title,
          target_language,
          adaptationPrompt,
          "module title"
        );

        // Insert translated module
        const { data: newModule } = await adminClient
          .from("course_modules")
          .insert({
            course_id: newCourse.id,
            title: translatedModTitle,
            content: translatedContent,
            order_index: mod.order_index,
          })
          .select()
          .single();

        if (!newModule) return;

        // Translate quizzes for this module
        const moduleQuizzes = quizzes.filter((q: any) => q.module_id === mod.id);
        for (const q of moduleQuizzes) {
          const tQuestion = await translateText(geminiKey, q.question, target_language, adaptationPrompt, "quiz question");
          const tOptions = [];
          for (const opt of (q.options as string[])) {
            tOptions.push(await translateText(geminiKey, opt, target_language, adaptationPrompt, "quiz option"));
          }
          const tExplanation = q.explanation
            ? await translateText(geminiKey, q.explanation, target_language, adaptationPrompt, "quiz explanation")
            : null;

          await adminClient.from("course_quiz_questions").insert({
            module_id: newModule.id,
            question: tQuestion,
            options: tOptions,
            correct_answer: q.correct_answer,
            explanation: tExplanation,
          });
        }

        // Translate flashcards for this module
        const moduleFlashcards = flashcards.filter((f: any) => f.module_id === mod.id);
        for (const fc of moduleFlashcards) {
          const tFront = await translateText(geminiKey, fc.front, target_language, adaptationPrompt, "flashcard front");
          const tBack = await translateText(geminiKey, fc.back, target_language, adaptationPrompt, "flashcard back");

          await adminClient.from("course_flashcards").insert({
            module_id: newModule.id,
            front: tFront,
            back: tBack,
          });
        }

        translatedModulesCount++;
      });

      await Promise.all(translationPromises);
    }

    // Log usage event
    await adminClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_TRANSLATED",
      metadata: {
        source_course_id: course_id,
        target_course_id: newCourse.id,
        target_language,
        adaptation,
        modules_translated: translatedModulesCount,
      },
    });

    return new Response(JSON.stringify({
      course_id: newCourse.id,
      title: translatedTitle,
      modules_translated: translatedModulesCount,
      quizzes_translated: quizzes.length,
      flashcards_translated: flashcards.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("translate-course error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function translateText(
  apiKey: string,
  text: string,
  targetLang: string,
  adaptationPrompt: string,
  contentType: string
): Promise<string> {
  if (!text || text.trim().length < 2) return text;

  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const model = "gemini-3-flash";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `Você é um tradutor pedagógico especialista. Traduza o conteúdo para ${targetLang}.

${adaptationPrompt}

Regras:
- Mantenha formatação markdown intacta (headers, bullets, bold, links, tabelas)
- Preserve termos técnicos universais quando apropriado
- Adapte unidades de medida, moedas e formatos de data conforme o idioma-alvo
- Responda APENAS com a tradução, sem explicações ou comentários
- O conteúdo é: ${contentType}`,
        },
        { role: "user", content: text },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("Rate limit exceeded");
    if (response.status === 402) throw new Error("AI credits exhausted");
    throw new Error(`AI translation failed: ${response.status}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || text;
}
