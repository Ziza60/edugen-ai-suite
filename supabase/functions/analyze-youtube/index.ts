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

function parseCaptionXml(xml: string): string {
  const parts: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const t = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#\d+;/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

const LANG_PRIORITY = ["pt-BR", "pt", "en", "en-US", "es", "fr", "de", "it"];

function chooseBestTrack(tracks: any[]): any {
  for (const lang of LANG_PRIORITY) {
    const t = tracks.find(
      (c: any) =>
        c.languageCode === lang ||
        c.languageCode?.startsWith(lang.split("-")[0])
    );
    if (t) return t;
  }
  return tracks[0];
}

async function fetchOEmbedTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      return data.title || "Vídeo do YouTube";
    }
  } catch { /* ignore */ }
  return "Vídeo do YouTube";
}

/**
 * Method 1 (PRIMARY): Gemini 2.5 Flash native API with YouTube URL as fileData.
 * Gemini processes the video directly — bypasses all YouTube transcript restrictions.
 * Returns transcript + course metadata in a single call.
 */
async function analyzeViaGeminiNative(
  videoId: string,
  videoUrl: string,
  geminiKey: string
): Promise<{
  transcript: string;
  title: string;
  theme: string;
  targetAudience: string;
  suggestedModules: number;
  detectedLanguage: string;
} | null> {
  try {
    const prompt = `Você é especialista em design instrucional. Analise este vídeo do YouTube e responda APENAS com JSON válido (sem markdown), no seguinte formato:

{
  "transcript": "transcrição completa ou resumo detalhado do conteúdo falado no vídeo (mínimo 500 palavras)",
  "title": "título sugerido para um curso baseado neste vídeo (máx 65 caracteres)",
  "theme": "2 a 3 frases descrevendo o que o curso ensina e o valor que entrega",
  "targetAudience": "descrição do público-alvo ideal para este curso",
  "suggestedModules": 5,
  "detectedLanguage": "idioma do vídeo (pt-BR, en, es, fr, etc)"
}

Regras:
- "suggestedModules" deve ser um número entre 3 e 8
- "detectedLanguage" deve usar o código BCP-47 do idioma principal do áudio
- Responda no mesmo idioma do vídeo
- NÃO inclua markdown, apenas JSON puro`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  fileData: {
                    fileUri: `https://www.youtube.com/watch?v=${videoId}`,
                    mimeType: "video/mp4",
                  },
                },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.log(`[gemini-native] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const raw: string =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!raw) {
      console.log("[gemini-native] empty response");
      return null;
    }

    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.transcript || parsed.transcript.length < 100) {
      console.log("[gemini-native] transcript too short");
      return null;
    }

    return {
      transcript: parsed.transcript,
      title: parsed.title || "Vídeo do YouTube",
      theme: parsed.theme || "",
      targetAudience: parsed.targetAudience || "",
      suggestedModules: Math.min(Math.max(Number(parsed.suggestedModules) || 5, 3), 8),
      detectedLanguage: parsed.detectedLanguage || "pt-BR",
    };
  } catch (e: any) {
    console.log(`[gemini-native] error: ${e.message}`);
    return null;
  }
}

/**
 * Method 2: Extract captions from ytInitialPlayerResponse in page HTML.
 */
async function fetchViaPageExtraction(
  videoId: string
): Promise<{ transcript: string; lang: string } | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const captionsSection = html.match(
      /"captionTracks":\s*(\[[\s\S]{10,3000}?\])\s*,\s*"(?:audioT|translat|default)/
    );
    if (!captionsSection) return null;

    let captionTracks: any[] = [];
    try {
      captionTracks = JSON.parse(captionsSection[1]);
    } catch {
      return null;
    }

    if (!captionTracks.length) return null;

    const chosen = chooseBestTrack(captionTracks);
    const rawUrl: string = chosen.baseUrl || "";
    const captionUrl = rawUrl
      .replace(/\\u0026/g, "&")
      .replace(/\\u003d/g, "=");
    if (!captionUrl) return null;

    const captionRes = await fetch(captionUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!captionRes.ok) return null;

    const xml = await captionRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.length < 100) return null;

    return { transcript, lang: chosen.languageCode || "pt-BR" };
  } catch (e: any) {
    console.log(`[page-extract] error: ${e.message}`);
    return null;
  }
}

/**
 * Method 3: Direct timedtext API.
 */
async function fetchViaTimedtext(
  videoId: string
): Promise<{ transcript: string; lang: string } | null> {
  try {
    const listRes = await fetch(
      `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (listRes.ok) {
      const listXml = await listRes.text();
      const tracks = [
        ...listXml.matchAll(/lang_code="([^"]+)"(?:[^/]*name="([^"]*)")?/g),
      ];
      if (tracks.length > 0) {
        const langCodes = tracks.map((t) => ({
          lang: t[1],
          name: t[2] || "",
        }));
        const chosen =
          langCodes.find((l) =>
            LANG_PRIORITY.some((p) => l.lang.startsWith(p.split("-")[0]))
          ) || langCodes[0];
        const tRes = await fetch(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${chosen.lang}&name=${encodeURIComponent(chosen.name)}`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (tRes.ok) {
          const xml = await tRes.text();
          const transcript = parseCaptionXml(xml);
          if (transcript.length > 100)
            return { transcript, lang: chosen.lang };
        }
      }
    }
  } catch { /* continue */ }

  for (const lang of LANG_PRIORITY) {
    try {
      const res = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<text")) continue;
      const transcript = parseCaptionXml(xml);
      if (transcript.length > 100) return { transcript, lang };
    } catch { continue; }
  }
  return null;
}

/**
 * If we got a transcript from method 2/3, analyze it with Gemini (OpenAI compat endpoint).
 */
async function analyzeTranscriptWithGemini(
  transcript: string,
  videoTitle: string,
  detectedLang: string,
  geminiKey: string
): Promise<{
  title: string;
  theme: string;
  targetAudience: string;
  suggestedModules: number;
  detectedLanguage: string;
}> {
  const defaults = {
    title: videoTitle,
    theme: `Curso baseado no vídeo: ${videoTitle}`,
    targetAudience: "",
    suggestedModules: 5,
    detectedLanguage: detectedLang,
  };

  try {
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
              content: `Especialista em design instrucional. Analise a transcrição e responda APENAS em JSON válido (sem markdown):
{"title":"...","theme":"...","targetAudience":"...","suggestedModules":5,"detectedLanguage":"pt-BR"}
- title: máx 65 caracteres
- theme: 2-3 frases sobre o que o curso ensina
- suggestedModules: entre 3 e 8
- detectedLanguage: idioma BCP-47`,
            },
            {
              role: "user",
              content: `Título: "${videoTitle}"\n\nTranscrição:\n${transcript.slice(0, 8000)}`,
            },
          ],
          stream: false,
        }),
      }
    );

    if (!geminiRes.ok) return defaults;

    const gd = await geminiRes.json();
    const raw = gd.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(
      raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    );

    return {
      title: parsed.title || videoTitle,
      theme: parsed.theme || defaults.theme,
      targetAudience: parsed.targetAudience || "",
      suggestedModules: Math.min(Math.max(Number(parsed.suggestedModules) || 5, 3), 8),
      detectedLanguage: parsed.detectedLanguage || detectedLang,
    };
  } catch (e: any) {
    console.warn("[gemini-compat] fallback:", e.message);
    return defaults;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader)
    return ok({ error: "Não autenticado. Faça login e tente novamente." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiKey) return ok({ error: "Configuração do servidor incompleta." });

  let userId: string;
  try {
    const uc = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await uc.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (error || !data.user)
      return ok({ error: "Sessão inválida. Faça login novamente." });
    userId = data.user.id;
  } catch (e: any) {
    return ok({ error: "Erro de autenticação: " + e.message });
  }

  let reqBody: any;
  try {
    reqBody = await req.json();
  } catch {
    return ok({ error: "Corpo da requisição inválido." });
  }

  const { url, course_id } = reqBody;
  if (!url || !course_id)
    return ok({ error: "URL e course_id são obrigatórios." });

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return ok({
      error:
        "URL do YouTube inválida. Use youtube.com/watch?v=... ou youtu.be/...",
    });
  }

  console.log(`[analyze-youtube] videoId=${videoId}`);

  let transcript = "";
  let detectedLang = "pt-BR";
  let videoTitle = "Vídeo do YouTube";
  let metaSuggestions: {
    title: string;
    theme: string;
    targetAudience: string;
    suggestedModules: number;
    detectedLanguage: string;
  } | null = null;

  // Method 1: Gemini native API — processes YouTube URL directly (no bot detection issues)
  console.log("[analyze-youtube] trying M1: Gemini native API...");
  const m1 = await analyzeViaGeminiNative(videoId, url, geminiKey);
  if (m1) {
    transcript = m1.transcript;
    detectedLang = m1.detectedLanguage;
    videoTitle = m1.title;
    metaSuggestions = m1;
    console.log(
      `[analyze-youtube] M1 success: ${transcript.length} chars, lang=${detectedLang}`
    );
  }

  // Method 2: Page extraction (ytInitialPlayerResponse)
  if (!transcript) {
    console.log("[analyze-youtube] trying M2: page extraction...");
    const m2 = await fetchViaPageExtraction(videoId);
    if (m2 && m2.transcript.length > 100) {
      transcript = m2.transcript;
      detectedLang = m2.lang;
      videoTitle = await fetchOEmbedTitle(videoId);
      console.log(
        `[analyze-youtube] M2 success: ${transcript.length} chars, lang=${detectedLang}`
      );
    }
  }

  // Method 3: timedtext API
  if (!transcript) {
    console.log("[analyze-youtube] trying M3: timedtext...");
    const m3 = await fetchViaTimedtext(videoId);
    if (m3 && m3.transcript.length > 100) {
      transcript = m3.transcript;
      detectedLang = m3.lang;
      videoTitle = await fetchOEmbedTitle(videoId);
      console.log(
        `[analyze-youtube] M3 success: ${transcript.length} chars, lang=${detectedLang}`
      );
    }
  }

  if (!transcript || transcript.length < 100) {
    console.warn(`[analyze-youtube] All methods failed for ${videoId}`);
    return ok({
      error:
        "Não foi possível extrair o conteúdo deste vídeo. " +
        "Isso pode acontecer quando o vídeo não está disponível publicamente, " +
        "tem restrições de região, ou não possui legendas. " +
        "Tente outro vídeo ou verifique se ele é acessível sem login.",
    });
  }

  // If metadata wasn't generated by M1, analyze transcript with Gemini compat endpoint
  if (!metaSuggestions) {
    metaSuggestions = await analyzeTranscriptWithGemini(
      transcript,
      videoTitle,
      detectedLang,
      geminiKey
    );
  }

  const normalized = transcript
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // Save as course source
  try {
    const sc = createClient(supabaseUrl, serviceKey);
    const filename = `youtube-${videoId}.txt`;
    const { data: source, error: srcErr } = await sc
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

    if (srcErr) throw srcErr;

    return ok({
      source_id: source.id,
      filename: source.filename,
      char_count: source.char_count,
      video_id: videoId,
      video_title: metaSuggestions!.title,
      title: metaSuggestions!.title,
      theme: metaSuggestions!.theme,
      targetAudience: metaSuggestions!.targetAudience,
      suggestedModules: metaSuggestions!.suggestedModules,
      detectedLanguage: metaSuggestions!.detectedLanguage,
    });
  } catch (e: any) {
    console.error("[analyze-youtube] DB save error:", e.message);
    return ok({
      error: "Conteúdo extraído mas erro ao salvar. Tente novamente.",
    });
  }
});
