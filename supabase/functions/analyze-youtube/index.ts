import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

async function fetchYouTubeTranscript(videoId: string): Promise<{ transcript: string; videoTitle: string; detectedLang: string }> {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const pageRes = await fetch(pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Não foi possível acessar o vídeo (HTTP ${pageRes.status}). Verifique se a URL está correta.`);
  }

  const html = await pageRes.text();

  if (html.includes("consent.youtube.com") || html.includes("Before you continue")) {
    throw new Error("YouTube está exigindo verificação de cookies. Tente novamente em alguns instantes.");
  }

  // Extract video title
  let videoTitle = "Vídeo do YouTube";
  const titleMatch = html.match(/"title":\s*\{"runs":\[\{"text":"([^"]+)"\}/);
  if (!titleMatch) {
    const altTitle = html.match(/<title>([^<]+)<\/title>/);
    if (altTitle) videoTitle = altTitle[1].replace(/ - YouTube$/, "").trim();
  } else {
    videoTitle = titleMatch[1];
  }

  // Extract captionTracks — try multiple patterns since YouTube's format can vary
  let captionTracks: any[] = [];

  // Pattern 1: "captionTracks":[...] with multiline support
  const patterns = [
    /"captionTracks":\s*(\[[\s\S]*?\])(?=,"audioT|,"translat|,"default)/,
    /"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/,
    /"captionTracks":\s*(\[[^\]]*\])/,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m) {
      try {
        captionTracks = JSON.parse(m[1]);
        if (captionTracks.length > 0) break;
      } catch {
        // try next pattern
      }
    }
  }

  // Fallback: scan for individual baseUrl+languageCode pairs
  if (captionTracks.length === 0) {
    const urlMatches = [...html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"[^}]*"languageCode":"([^"]+)"/g)];
    if (urlMatches.length > 0) {
      captionTracks = urlMatches.map((m) => ({
        baseUrl: m[1].replace(/\\u0026/g, "&"),
        languageCode: m[2],
      }));
    }
  }

  if (captionTracks.length === 0) {
    throw new Error(
      "Não encontramos legendas neste vídeo. Certifique-se de que o vídeo possui legendas automáticas ou manuais ativadas no YouTube."
    );
  }

  // Choose best caption track: prefer pt/pt-BR, then en, then anything
  const langOrder = ["pt-BR", "pt", "en", "es", "fr", "de"];
  let chosen = null;
  for (const lang of langOrder) {
    chosen = captionTracks.find((c: any) => c.languageCode?.startsWith(lang));
    if (chosen) break;
  }
  if (!chosen) chosen = captionTracks[0];

  let captionUrl: string = chosen.baseUrl;
  // Unescape unicode escapes like \u0026 → &
  captionUrl = captionUrl.replace(/\\u0026/g, "&").replace(/\\u003d/g, "=");

  const captionRes = await fetch(captionUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!captionRes.ok) {
    throw new Error(`Não foi possível baixar as legendas do vídeo (HTTP ${captionRes.status}).`);
  }

  const xml = await captionRes.text();

  const textParts: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#\d+;/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) textParts.push(text);
  }

  if (textParts.length === 0) {
    throw new Error("Legendas encontradas mas sem texto extraível. O vídeo pode ter apenas legendas em imagem.");
  }

  return {
    transcript: textParts.join(" "),
    videoTitle,
    detectedLang: chosen.languageCode || "pt-BR",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return ok({ error: "Não autenticado. Faça login e tente novamente." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiKey) {
    return ok({ error: "Configuração do servidor incompleta (chave de IA ausente)." });
  }

  let userId: string;
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return ok({ error: "Sessão inválida. Faça login novamente." });
    }
    userId = userData.user.id;
  } catch (e: any) {
    return ok({ error: "Erro de autenticação: " + (e.message || "desconhecido") });
  }

  let reqBody: any;
  try {
    reqBody = await req.json();
  } catch {
    return ok({ error: "Corpo da requisição inválido." });
  }

  const { url, course_id } = reqBody;
  if (!url || !course_id) {
    return ok({ error: "URL e course_id são obrigatórios." });
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return ok({ error: "URL do YouTube inválida. Use o formato youtube.com/watch?v=... ou youtu.be/..." });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Step 1: Fetch transcript
  let transcriptData: { transcript: string; videoTitle: string; detectedLang: string };
  try {
    transcriptData = await fetchYouTubeTranscript(videoId);
  } catch (e: any) {
    console.error("Transcript fetch error:", e.message);
    return ok({ error: e.message || "Falha ao extrair transcrição do vídeo." });
  }

  const { transcript, videoTitle, detectedLang } = transcriptData;
  const normalized = transcript.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

  if (normalized.length < 200) {
    return ok({ error: "A transcrição do vídeo é muito curta para gerar um curso (mínimo 200 caracteres)." });
  }

  // Step 2: Analyze with Gemini
  let suggestions = {
    title: videoTitle,
    theme: `Curso baseado no vídeo: ${videoTitle}`,
    targetAudience: "",
    suggestedModules: 5,
    detectedLanguage: detectedLang,
  };

  try {
    const sampleTranscript = normalized.slice(0, 8000);
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
              content: `Você é um especialista em design instrucional. Analise a transcrição de um vídeo e sugira metadados para um curso educacional.

Responda APENAS em JSON válido, sem markdown, sem blocos de código:
{
  "title": "Título do curso (máximo 65 caracteres)",
  "theme": "Descrição detalhada em 2-3 frases do que será ensinado no curso",
  "targetAudience": "Público-alvo provável",
  "suggestedModules": 5,
  "detectedLanguage": "pt-BR"
}

suggestedModules: entre 3 e 8 baseado na profundidade do conteúdo.
detectedLanguage: idioma principal da transcrição (pt-BR, en, es, etc).`,
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

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawJson = geminiData.choices?.[0]?.message?.content || "";
      const cleaned = rawJson.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      suggestions = {
        title: parsed.title || videoTitle,
        theme: parsed.theme || suggestions.theme,
        targetAudience: parsed.targetAudience || "",
        suggestedModules: Math.min(Math.max(parsed.suggestedModules || 5, 3), 8),
        detectedLanguage: parsed.detectedLanguage || detectedLang,
      };
    }
  } catch (e: any) {
    console.warn("Gemini analysis failed, using fallback:", e.message);
    // Continue with fallback suggestions
  }

  // Step 3: Save transcript as course source
  try {
    const filename = `youtube-${videoId}.txt`;
    const { data: source, error: sourceError } = await serviceClient
      .from("course_sources")
      .insert({
        course_id,
        user_id: userId,
        filename,
        file_path: `url-import/${userId}/${course_id}/${filename}`,
        content_type: "text/plain",
        char_count: normalized.length,
        extracted_text: normalized,
      })
      .select()
      .single();

    if (sourceError) throw sourceError;

    return ok({
      source_id: source.id,
      filename: source.filename,
      char_count: source.char_count,
      video_id: videoId,
      video_title: videoTitle,
      title: suggestions.title,
      theme: suggestions.theme,
      targetAudience: suggestions.targetAudience,
      suggestedModules: suggestions.suggestedModules,
      detectedLanguage: suggestions.detectedLanguage,
    });
  } catch (e: any) {
    console.error("Source save error:", e.message);
    return ok({ error: "Transcrição extraída mas houve erro ao salvar. Tente novamente." });
  }
});
