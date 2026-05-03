import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchYouTubeTranscript(videoId: string): Promise<{ transcript: string; videoTitle: string }> {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageRes = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EduGenBot/1.0)" },
  });

  if (!pageRes.ok) {
    throw new Error(`Não foi possível acessar o vídeo (HTTP ${pageRes.status})`);
  }

  const html = await pageRes.text();

  // Extract video title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  let videoTitle = titleMatch?.[1]?.replace(" - YouTube", "").trim() || "Vídeo do YouTube";

  // Extract caption tracks
  const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!captionMatch) {
    throw new Error("Este vídeo não possui legendas/transcrição disponível. Verifique se o vídeo tem captions habilitadas.");
  }

  let captions;
  try {
    captions = JSON.parse(captionMatch[1]);
  } catch {
    throw new Error("Erro ao processar legendas do vídeo.");
  }

  if (!captions || captions.length === 0) {
    throw new Error("Este vídeo não possui legendas disponíveis.");
  }

  // Prefer pt-BR, pt, en, then fallback to first available
  const langOrder = ["pt-BR", "pt", "en", "es", "fr", "de"];
  let captionUrl: string | undefined;
  for (const lang of langOrder) {
    captionUrl = captions.find((c: any) => c.languageCode === lang)?.baseUrl;
    if (captionUrl) break;
  }
  if (!captionUrl) captionUrl = captions[0]?.baseUrl;
  if (!captionUrl) throw new Error("Nenhuma URL de legenda encontrada.");

  const captionRes = await fetch(captionUrl);
  if (!captionRes.ok) throw new Error("Não foi possível baixar as legendas do vídeo.");

  const xml = await captionRes.text();
  const textParts: string[] = [];
  const regex = /<text[^>]*>(.*?)<\/text>/gs;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) textParts.push(text);
  }

  if (textParts.length === 0) {
    throw new Error("Não foi possível extrair texto das legendas do vídeo.");
  }

  return { transcript: textParts.join(" "), videoTitle };
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const { url, course_id } = await req.json();

    if (!url || !course_id) {
      return new Response(JSON.stringify({ error: "url e course_id são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return new Response(JSON.stringify({ error: "URL do YouTube inválida. Cole uma URL no formato youtube.com/watch?v=... ou youtu.be/..." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Fetch transcript
    const { transcript, videoTitle } = await fetchYouTubeTranscript(videoId);

    const normalizedTranscript = transcript.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

    if (normalizedTranscript.length < 200) {
      return new Response(JSON.stringify({ error: "A transcrição do vídeo é muito curta para gerar um curso." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Analyze with Gemini to extract course metadata
    const sampleTranscript = normalizedTranscript.slice(0, 8000);
    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Você é um especialista em design instrucional. Analise a transcrição de um vídeo do YouTube e sugira metadados para um curso educacional baseado nesse conteúdo.

Responda APENAS em JSON válido, sem markdown:
{
  "title": "Título do curso (máximo 65 caracteres, direto e descritivo)",
  "theme": "Descrição detalhada do conteúdo do curso em 2-3 frases. Descreva o que será ensinado.",
  "targetAudience": "Público-alvo provável (ex: 'Profissionais de marketing digital iniciantes')",
  "suggestedModules": 5,
  "detectedLanguage": "pt-BR"
}

Para suggestedModules: use entre 3 e 8, baseado na profundidade e quantidade de conteúdo da transcrição.
Para detectedLanguage: detecte o idioma da transcrição (pt-BR, en, es, etc).`,
            },
            {
              role: "user",
              content: `Título do vídeo: "${videoTitle}"\n\nTranscrição:\n${sampleTranscript}`,
            },
          ],
          stream: false,
        }),
      }
    );

    if (!geminiRes.ok) {
      throw new Error("Erro ao analisar o conteúdo do vídeo com IA.");
    }

    const geminiData = await geminiRes.json();
    const rawJson = geminiData.choices?.[0]?.message?.content || "{}";

    let suggestions: {
      title: string;
      theme: string;
      targetAudience: string;
      suggestedModules: number;
      detectedLanguage: string;
    };

    try {
      const cleaned = rawJson.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      suggestions = {
        title: videoTitle,
        theme: `Curso baseado no vídeo: ${videoTitle}`,
        targetAudience: "",
        suggestedModules: 5,
        detectedLanguage: "pt-BR",
      };
    }

    // Step 3: Save transcript as course source
    const filename = `youtube-${videoId}.txt`;
    const { data: source, error: sourceError } = await serviceClient
      .from("course_sources")
      .insert({
        course_id,
        user_id: userId,
        filename,
        file_path: `url-import/${userId}/${course_id}/${filename}`,
        content_type: "text/plain",
        char_count: normalizedTranscript.length,
        extracted_text: normalizedTranscript,
      })
      .select()
      .single();

    if (sourceError) throw sourceError;

    return new Response(
      JSON.stringify({
        source_id: source.id,
        filename: source.filename,
        char_count: source.char_count,
        video_id: videoId,
        video_title: videoTitle,
        title: suggestions.title || videoTitle,
        theme: suggestions.theme || "",
        targetAudience: suggestions.targetAudience || "",
        suggestedModules: Math.min(Math.max(suggestions.suggestedModules || 5, 3), 8),
        detectedLanguage: suggestions.detectedLanguage || "pt-BR",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("analyze-youtube error:", error);
    return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
