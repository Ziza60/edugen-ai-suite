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

/** Parse caption XML into plain text */
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

/** Method 1: YouTube Timedtext list API — most reliable */
async function fetchViaTimedtextApi(videoId: string): Promise<{ transcript: string; lang: string } | null> {
  // Get list of available tracks
  const listUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
  try {
    const listRes = await fetch(listUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!listRes.ok) return null;
    const listXml = await listRes.text();

    // Parse track list — look for lang codes
    const trackMatches = [...listXml.matchAll(/lang_code="([^"]+)"[^/]*name="([^"]*)"/g)];
    if (trackMatches.length === 0) {
      // Try without name attribute
      const simpleTracks = [...listXml.matchAll(/lang_code="([^"]+)"/g)];
      if (simpleTracks.length === 0) return null;
      trackMatches.push(...simpleTracks.map((m) => [m[0], m[1], ""] as RegExpMatchArray));
    }

    // Priority: pt-BR, pt, en, es, then first available
    const langOrder = ["pt-BR", "pt", "en", "es", "fr", "de"];
    let chosenLang = "";
    let chosenName = "";
    for (const lang of langOrder) {
      const t = trackMatches.find((m) => m[1].startsWith(lang));
      if (t) { chosenLang = t[1]; chosenName = t[2]; break; }
    }
    if (!chosenLang && trackMatches.length > 0) {
      chosenLang = trackMatches[0][1];
      chosenName = trackMatches[0][2] || "";
    }
    if (!chosenLang) return null;

    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${chosenLang}&name=${encodeURIComponent(chosenName)}&fmt=srv1`;
    const transcriptRes = await fetch(transcriptUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!transcriptRes.ok) return null;
    const xml = await transcriptRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.length < 50) return null;
    return { transcript, lang: chosenLang };
  } catch {
    return null;
  }
}

/** Method 2: Directly try common languages via timedtext API */
async function fetchViaDirectTimedtext(videoId: string): Promise<{ transcript: string; lang: string } | null> {
  const langOrder = ["pt-BR", "pt", "en", "en-US", "es", "fr", "de", "it", "ja", "zh-CN"];
  for (const lang of langOrder) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<text")) continue;
      const transcript = parseCaptionXml(xml);
      if (transcript.length > 100) return { transcript, lang };
    } catch {
      continue;
    }
  }
  return null;
}

/** Method 3: YouTube page scraping — fallback */
async function fetchViaPageScraping(videoId: string): Promise<{ transcript: string; lang: string; videoTitle: string } | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "identity",
      },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    // Title
    let videoTitle = "Vídeo do YouTube";
    const t1 = html.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}/);
    const t2 = html.match(/<title>([^<]+)<\/title>/);
    if (t1) videoTitle = t1[1];
    else if (t2) videoTitle = t2[1].replace(/ - YouTube$/, "").trim();

    // Find captionTracks
    const patterns = [
      /"captionTracks":\s*(\[[\s\S]*?\])(?=,"audioT|,"translat)/,
      /"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/,
      /"captionTracks":\s*(\[[^\]]*?\])/,
    ];
    let captionTracks: any[] = [];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) {
        try { captionTracks = JSON.parse(m[1]); } catch { continue; }
        if (captionTracks.length > 0) break;
      }
    }

    // Fallback: scan for baseUrl + languageCode pairs
    if (captionTracks.length === 0) {
      const pairs = [...html.matchAll(/"baseUrl":"(https:\\\/\\\/www\.youtube\.com\\\/api\\\/timedtext[^"]+)"[^{]{0,200}"languageCode":"([^"]+)"/g)];
      captionTracks = pairs.map((m) => ({
        baseUrl: m[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&"),
        languageCode: m[2],
      }));
    }

    if (captionTracks.length === 0) return null;

    const langOrder = ["pt-BR", "pt", "en", "es", "fr", "de"];
    let chosen: any = null;
    for (const l of langOrder) {
      chosen = captionTracks.find((c: any) => c.languageCode?.startsWith(l));
      if (chosen) break;
    }
    if (!chosen) chosen = captionTracks[0];

    let captionUrl: string = chosen.baseUrl || "";
    captionUrl = captionUrl.replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\\//g, "/");
    if (!captionUrl) return null;

    const captionRes = await fetch(captionUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!captionRes.ok) return null;
    const xml = await captionRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.length < 100) return null;

    return { transcript, lang: chosen.languageCode || "pt-BR", videoTitle };
  } catch {
    return null;
  }
}

/** Try to get video title from oEmbed (always works) */
async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return data.title || "Vídeo do YouTube";
    }
  } catch { /* ignore */ }
  return "Vídeo do YouTube";
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
    const { data: userData, error: userError } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !userData.user) return ok({ error: "Sessão inválida. Faça login novamente." });
    userId = userData.user.id;
  } catch (e: any) {
    return ok({ error: "Erro de autenticação: " + (e.message || "desconhecido") });
  }

  let reqBody: any;
  try { reqBody = await req.json(); } catch {
    return ok({ error: "Corpo da requisição inválido." });
  }

  const { url, course_id } = reqBody;
  if (!url || !course_id) return ok({ error: "URL e course_id são obrigatórios." });

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return ok({ error: "URL do YouTube inválida. Use o formato youtube.com/watch?v=... ou youtu.be/..." });
  }

  // Try all three methods in order
  console.log(`[analyze-youtube] Attempting transcript for videoId=${videoId}`);

  let transcript = "";
  let detectedLang = "pt-BR";
  let videoTitle = await fetchVideoTitle(videoId);

  const method1 = await fetchViaTimedtextApi(videoId);
  if (method1) {
    transcript = method1.transcript;
    detectedLang = method1.lang;
    console.log(`[analyze-youtube] Method 1 (timedtext list) succeeded, lang=${detectedLang}, chars=${transcript.length}`);
  } else {
    const method2 = await fetchViaDirectTimedtext(videoId);
    if (method2) {
      transcript = method2.transcript;
      detectedLang = method2.lang;
      console.log(`[analyze-youtube] Method 2 (direct timedtext) succeeded, lang=${detectedLang}, chars=${transcript.length}`);
    } else {
      const method3 = await fetchViaPageScraping(videoId);
      if (method3) {
        transcript = method3.transcript;
        detectedLang = method3.lang;
        if (method3.videoTitle && method3.videoTitle !== "Vídeo do YouTube") videoTitle = method3.videoTitle;
        console.log(`[analyze-youtube] Method 3 (page scraping) succeeded, lang=${detectedLang}, chars=${transcript.length}`);
      }
    }
  }

  if (!transcript || transcript.length < 100) {
    console.warn(`[analyze-youtube] All methods failed for videoId=${videoId}`);
    return ok({
      error:
        "Não foi possível extrair a transcrição deste vídeo. Possíveis causas:\n• O vídeo não tem legendas automáticas ativadas\n• O vídeo é ao vivo ou premiero\n• Legendas desativadas pelo criador\n\nTente ativar legendas automáticas no YouTube e aguarde alguns minutos.",
    });
  }

  const normalized = transcript.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

  // Analyze with Gemini
  let suggestions = {
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
        headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Você é especialista em design instrucional. Analise a transcrição e sugira metadados para um curso.
Responda APENAS em JSON válido sem markdown:
{"title":"...","theme":"...","targetAudience":"...","suggestedModules":5,"detectedLanguage":"pt-BR"}
- title: máximo 65 caracteres
- theme: 2-3 frases sobre o que o curso ensina
- suggestedModules: entre 3 e 8
- detectedLanguage: idioma da transcrição (pt-BR, en, es, etc)`,
            },
            {
              role: "user",
              content: `Título: "${videoTitle}"\n\nTranscrição:\n${normalized.slice(0, 8000)}`,
            },
          ],
          stream: false,
        }),
      }
    );
    if (geminiRes.ok) {
      const gData = await geminiRes.json();
      const raw = gData.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      suggestions = {
        title: parsed.title || videoTitle,
        theme: parsed.theme || suggestions.theme,
        targetAudience: parsed.targetAudience || "",
        suggestedModules: Math.min(Math.max(Number(parsed.suggestedModules) || 5, 3), 8),
        detectedLanguage: parsed.detectedLanguage || detectedLang,
      };
    }
  } catch (e: any) {
    console.warn("[analyze-youtube] Gemini fallback:", e.message);
  }

  // Save transcript as course source
  try {
    const serviceClient = createClient(supabaseUrl, serviceKey);
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
    console.error("[analyze-youtube] Save error:", e.message);
    return ok({ error: "Transcrição extraída mas houve erro ao salvar. Tente novamente." });
  }
});
