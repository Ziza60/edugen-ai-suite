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

const LANG_PRIORITY = ["pt-BR", "pt", "en", "en-US", "es", "fr", "de", "it", "ja"];

function chooseBestTrack(tracks: any[]): any {
  for (const lang of LANG_PRIORITY) {
    const t = tracks.find((c: any) =>
      c.languageCode === lang || c.languageCode?.startsWith(lang.split("-")[0])
    );
    if (t) return t;
  }
  return tracks[0];
}

/** Method 1: YouTube InnerTube player API — most reliable, used by the YouTube web player itself */
async function fetchViaInnerTube(videoId: string): Promise<{ transcript: string; lang: string; videoTitle: string } | null> {
  try {
    const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
    const playerRes = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": "2.20240726.00.00",
          "Origin": "https://www.youtube.com",
          "Referer": `https://www.youtube.com/watch?v=${videoId}`,
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240726.00.00",
              hl: "pt",
              gl: "BR",
              userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          },
        }),
      }
    );

    if (!playerRes.ok) {
      console.log(`[innertube] player API returned ${playerRes.status}`);
      return null;
    }

    const playerData = await playerRes.json();
    const videoTitle: string =
      playerData?.videoDetails?.title || "Vídeo do YouTube";
    const captionTracks: any[] =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    console.log(`[innertube] found ${captionTracks.length} caption tracks`);

    if (captionTracks.length === 0) return null;

    const chosen = chooseBestTrack(captionTracks);
    const captionUrl: string = chosen.baseUrl;
    if (!captionUrl) return null;

    const captionRes = await fetch(captionUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!captionRes.ok) {
      console.log(`[innertube] caption fetch returned ${captionRes.status}`);
      return null;
    }

    const xml = await captionRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.length < 50) return null;

    return { transcript, lang: chosen.languageCode || "pt-BR", videoTitle };
  } catch (e: any) {
    console.log(`[innertube] error: ${e.message}`);
    return null;
  }
}

/** Method 2: YouTube InnerTube get_transcript API (newer endpoint) */
async function fetchViaInnerTubeTranscript(videoId: string): Promise<{ transcript: string; lang: string } | null> {
  try {
    // First get the page to extract continuation token
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
      },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    // Extract serializedShareEntity or engagementPanel for transcript
    // Try to find captionTracks in ytInitialPlayerResponse
    const iprMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.{100,}?\});(?:\s*var|\s*const|\s*let|\s*window|\s*if)/s);
    if (!iprMatch) {
      console.log("[innertube2] ytInitialPlayerResponse not found");
      return null;
    }

    // Try to extract just the captions part without parsing the full huge JSON
    const captionsSection = iprMatch[1].match(/"captionTracks":\s*(\[[\s\S]{10,3000}?\])\s*,\s*"(?:audioT|translat|default)/);
    if (!captionsSection) {
      console.log("[innertube2] captionTracks not found in ytInitialPlayerResponse");
      return null;
    }

    let captionTracks: any[] = [];
    try {
      captionTracks = JSON.parse(captionsSection[1]);
    } catch {
      console.log("[innertube2] failed to parse captionTracks JSON");
      return null;
    }

    if (captionTracks.length === 0) return null;
    console.log(`[innertube2] found ${captionTracks.length} tracks in ytInitialPlayerResponse`);

    const chosen = chooseBestTrack(captionTracks);
    const rawUrl: string = chosen.baseUrl || "";
    const captionUrl = rawUrl.replace(/\\u0026/g, "&").replace(/\\u003d/g, "=");
    if (!captionUrl) return null;

    const captionRes = await fetch(captionUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!captionRes.ok) return null;
    const xml = await captionRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.length < 50) return null;

    return { transcript, lang: chosen.languageCode || "pt-BR" };
  } catch (e: any) {
    console.log(`[innertube2] error: ${e.message}`);
    return null;
  }
}

/** Method 3: Direct timedtext API with language probing */
async function fetchViaTimedtext(videoId: string): Promise<{ transcript: string; lang: string } | null> {
  // Try list first
  try {
    const listRes = await fetch(
      `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (listRes.ok) {
      const listXml = await listRes.text();
      const tracks = [...listXml.matchAll(/lang_code="([^"]+)"(?:[^/]*name="([^"]*)")?/g)];
      if (tracks.length > 0) {
        const langCodes = tracks.map((t) => ({ lang: t[1], name: t[2] || "" }));
        const chosen = langCodes.find((l) => LANG_PRIORITY.some((p) => l.lang.startsWith(p.split("-")[0]))) || langCodes[0];
        const tUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${chosen.lang}&name=${encodeURIComponent(chosen.name)}`;
        const tRes = await fetch(tUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (tRes.ok) {
          const xml = await tRes.text();
          const transcript = parseCaptionXml(xml);
          if (transcript.length > 100) return { transcript, lang: chosen.lang };
        }
      }
    }
  } catch { /* continue */ }

  // Probe common languages directly
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

/** Get video title via oEmbed (works even when transcript fails) */
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return ok({ error: "Não autenticado. Faça login e tente novamente." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiKey) return ok({ error: "Configuração do servidor incompleta." });

  let userId: string;
  try {
    const uc = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data, error } = await uc.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !data.user) return ok({ error: "Sessão inválida. Faça login novamente." });
    userId = data.user.id;
  } catch (e: any) {
    return ok({ error: "Erro de autenticação: " + e.message });
  }

  let reqBody: any;
  try { reqBody = await req.json(); } catch {
    return ok({ error: "Corpo da requisição inválido." });
  }

  const { url, course_id } = reqBody;
  if (!url || !course_id) return ok({ error: "URL e course_id são obrigatórios." });

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return ok({ error: "URL do YouTube inválida. Use youtube.com/watch?v=... ou youtu.be/..." });
  }

  console.log(`[analyze-youtube] videoId=${videoId}`);

  let transcript = "";
  let detectedLang = "pt-BR";
  let videoTitle = "Vídeo do YouTube";

  // Method 1: InnerTube player API
  const m1 = await fetchViaInnerTube(videoId);
  if (m1 && m1.transcript.length > 100) {
    transcript = m1.transcript;
    detectedLang = m1.lang;
    videoTitle = m1.videoTitle;
    console.log(`[analyze-youtube] M1 success: ${transcript.length} chars, lang=${detectedLang}`);
  }

  // Method 2: ytInitialPlayerResponse extraction
  if (!transcript) {
    const m2 = await fetchViaInnerTubeTranscript(videoId);
    if (m2 && m2.transcript.length > 100) {
      transcript = m2.transcript;
      detectedLang = m2.lang;
      videoTitle = await fetchOEmbedTitle(videoId);
      console.log(`[analyze-youtube] M2 success: ${transcript.length} chars, lang=${detectedLang}`);
    }
  }

  // Method 3: timedtext API
  if (!transcript) {
    const m3 = await fetchViaTimedtext(videoId);
    if (m3 && m3.transcript.length > 100) {
      transcript = m3.transcript;
      detectedLang = m3.lang;
      videoTitle = await fetchOEmbedTitle(videoId);
      console.log(`[analyze-youtube] M3 success: ${transcript.length} chars, lang=${detectedLang}`);
    }
  }

  if (!transcript || transcript.length < 100) {
    console.warn(`[analyze-youtube] All methods failed for ${videoId}`);
    return ok({
      error:
        "Não foi possível extrair a transcrição deste vídeo. " +
        "Isso pode acontecer quando: o vídeo não tem legendas automáticas, " +
        "as legendas foram desativadas pelo criador, ou o vídeo é muito recente " +
        "(legendas automáticas levam alguns minutos para ficar disponíveis). " +
        "Tente outro vídeo ou verifique se há legendas disponíveis no player do YouTube.",
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
              content: `Você é especialista em design instrucional. Analise a transcrição e responda APENAS em JSON válido (sem markdown):
{"title":"...","theme":"...","targetAudience":"...","suggestedModules":5,"detectedLanguage":"pt-BR"}
- title: máximo 65 caracteres
- theme: 2-3 frases sobre o que o curso ensina
- suggestedModules: entre 3 e 8
- detectedLanguage: idioma da transcrição (pt-BR, en, es, etc)`,
            },
            {
              role: "user",
              content: `Título do vídeo: "${videoTitle}"\n\nTranscrição:\n${normalized.slice(0, 8000)}`,
            },
          ],
          stream: false,
        }),
      }
    );
    if (geminiRes.ok) {
      const gd = await geminiRes.json();
      const raw = gd.choices?.[0]?.message?.content || "";
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
      video_title: videoTitle,
      title: suggestions.title,
      theme: suggestions.theme,
      targetAudience: suggestions.targetAudience,
      suggestedModules: suggestions.suggestedModules,
      detectedLanguage: suggestions.detectedLanguage,
    });
  } catch (e: any) {
    return ok({ error: "Transcrição extraída mas erro ao salvar. Tente novamente." });
  }
});
