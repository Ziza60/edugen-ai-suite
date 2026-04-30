import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Fetch modules
    const { data: modules } = await userClient
      .from("course_modules")
      .select("title, content, order_index")
      .eq("course_id", course_id)
      .order("order_index");

    const modulesSummary = (modules || [])
      .map((m: any) => `## ${m.title}\n${(m.content || "").slice(0, 2000)}`)
      .join("\n\n");

    const language = course.language || "pt-BR";

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const model = "gemini-2.0-flash-lite-preview-02-05"; 

    // Call AI with tool calling for structured output
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `Você é um copywriter educacional especialista em landing pages de venda de cursos online. 
Gere copy persuasivo e profissional baseado EXCLUSIVAMENTE no conteúdo dos módulos fornecidos.
Idioma: ${language}.`,
          },
          {
            role: "user",
            content: `Título do curso: ${course.title}
Descrição: ${course.description || "N/A"}
Público-alvo: ${course.target_audience || "Geral"}
Tom: ${course.tone || "Profissional"}
Número de módulos: ${(modules || []).length}

Conteúdo dos módulos:
${modulesSummary.slice(0, 80000)}

Gere a landing page de vendas para este curso.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_landing_copy",
              description: "Generate all landing page copy elements for a course sales page.",
              parameters: {
                type: "object",
                properties: {
                  headline: {
                    type: "string",
                    description: "Frase de impacto focada na transformação do aluno (max 80 chars)",
                  },
                  subtitle: {
                    type: "string",
                    description: "1 frase complementando a headline com o público-alvo (max 150 chars)",
                  },
                  benefits: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 bullet points no formato 'Você vai aprender a...' ou 'Ao final, você será capaz de...'",
                  },
                  summary: {
                    type: "string",
                    description: "Parágrafo de 3-4 frases resumindo o que o curso cobre e por que é valioso",
                  },
                  testimonial_name: {
                    type: "string",
                    description: "Nome fictício de exemplo para depoimento (ex: 'Maria S.')",
                  },
                  testimonial_text: {
                    type: "string",
                    description: "Depoimento fictício de exemplo (2-3 frases, editável pelo criador)",
                  },
                },
                required: ["headline", "subtitle", "benefits", "summary", "testimonial_name", "testimonial_text"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_landing_copy" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not return structured output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const copy = JSON.parse(toolCall.function.arguments);

    // Generate slug from course title
    const slug = course.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) + "-" + course_id.slice(0, 6);

    // Upsert landing page using service role to bypass RLS for upsert
    const adminClient = createClient(supabaseUrl, serviceKey);
    
    // Check if landing exists
    const { data: existing } = await adminClient
      .from("course_landings")
      .select("id")
      .eq("course_id", course_id)
      .single();

    let landing;
    if (existing) {
      const { data, error } = await adminClient
        .from("course_landings")
        .update({
          headline: copy.headline,
          subtitle: copy.subtitle,
          benefits: copy.benefits,
          summary: copy.summary,
          testimonial_name: copy.testimonial_name,
          testimonial_text: copy.testimonial_text,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      landing = data;
    } else {
      const { data, error } = await adminClient
        .from("course_landings")
        .insert({
          course_id,
          user_id: userId,
          slug,
          headline: copy.headline,
          subtitle: copy.subtitle,
          benefits: copy.benefits,
          summary: copy.summary,
          testimonial_name: copy.testimonial_name,
          testimonial_text: copy.testimonial_text,
          is_published: true,
        })
        .select()
        .single();
      if (error) throw error;
      landing = data;
    }

    return new Response(JSON.stringify({ landing }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("generate-landing error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
