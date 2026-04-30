import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_TOTAL_CHARS = 150_000;
const MAX_SOURCES_PRO = 20;

function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
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

// Fetch YouTube transcript using a public transcript API
async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  // Try fetching transcript via YouTube's timedtext API
  const langCodes = ["pt", "pt-BR", "en", "es", "fr", "de"];
  
  for (const lang of langCodes) {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; EduGenBot/1.0)" },
      });
      
      if (!pageRes.ok) continue;
      const html = await pageRes.text();
      
      // Extract captions URL from page source
      const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (!captionMatch) continue;
      
      let captions;
      try {
        captions = JSON.parse(captionMatch[1]);
      } catch {
        continue;
      }
      
      if (!captions || captions.length === 0) continue;
      
      // Find best caption track
      let captionUrl = captions.find((c: any) => c.languageCode === lang)?.baseUrl;
      if (!captionUrl) captionUrl = captions[0]?.baseUrl;
      if (!captionUrl) continue;
      
      // Fetch the caption XML
      const captionRes = await fetch(captionUrl);
      if (!captionRes.ok) continue;
      const xml = await captionRes.text();
      
      // Parse XML captions to plain text
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
      
      if (textParts.length > 0) {
        return textParts.join(" ");
      }
    } catch {
      continue;
    }
  }
  
  throw new Error("Não foi possível extrair a transcrição deste vídeo. Verifique se o vídeo possui legendas/captions habilitadas.");
}

// Fetch and extract text from a web article
async function fetchWebArticle(url: string, apiKey: string): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EduGenBot/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  
  if (!res.ok) {
    throw new Error(`Não foi possível acessar a URL (HTTP ${res.status})`);
  }
  
  const html = await res.text();
  
  if (html.length < 200) {
    throw new Error("A página não contém conteúdo suficiente.");
  }
  
  // Use AI to extract clean text from HTML
  const urlAI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const aiRes = await fetch(urlAI, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemini-3-flash-lite-preview-02-05",
      messages: [
        {
          role: "system",
          content: `Extract the main article content from this HTML page. Return ONLY:
1. First line: the article title
2. Then a blank line
3. Then the full article text in clean markdown format

Remove navigation, ads, footers, sidebars. Keep headings, paragraphs, lists, and code blocks.
Do NOT add commentary. Return ONLY the extracted content.`,
        },
        {
          role: "user",
          content: html.slice(0, 100000), // Limit HTML size
        },
      ],
      stream: false,
    }),
  });
  
  if (!aiRes.ok) {
    if (aiRes.status === 429) throw new Error("Rate limit exceeded");
    if (aiRes.status === 402) throw new Error("AI credits exhausted");
    throw new Error("Failed to extract article content");
  }
  
  const aiData = await aiRes.json();
  const content = aiData.choices?.[0]?.message?.content || "";
  
  // Split title from content
  const lines = content.split("\n");
  const title = lines[0]?.replace(/^#\s*/, "").trim() || "Artigo importado";
  const text = lines.slice(1).join("\n").trim();
  
  return { text, title };
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

    // Check Pro
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_dev")
      .eq("user_id", userId)
      .single();

    const isPro = sub?.plan === "pro" || profile?.is_dev === true;
    if (!isPro) {
      return new Response(JSON.stringify({ error: "Importação de URL é exclusiva do plano Pro." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url, course_id } = await req.json();
    if (!url || !course_id) {
      return new Response(JSON.stringify({ error: "url and course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check existing sources count
    const { count: existingCount } = await serviceClient
      .from("course_sources")
      .select("*", { count: "exact", head: true })
      .eq("course_id", course_id)
      .eq("user_id", userId);

    if ((existingCount ?? 0) >= MAX_SOURCES_PRO) {
      return new Response(JSON.stringify({ error: `Limite de ${MAX_SOURCES_PRO} fontes por curso atingido.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada nos Secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let extractedText: string;
    let filename: string;
    let contentType: string;

    if (isYouTubeUrl(url)) {
      const videoId = extractYouTubeVideoId(url);
      if (!videoId) {
        return new Response(JSON.stringify({ error: "URL do YouTube inválida." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      extractedText = await fetchYouTubeTranscript(videoId);
      filename = `youtube-${videoId}.txt`;
      contentType = "text/plain";
    } else {
      // Web article
      const article = await fetchWebArticle(url, geminiKey);
      extractedText = article.text;
      filename = `web-${new URL(url).hostname}.md`;
      contentType = "text/markdown";
    }

    // Normalize
    extractedText = extractedText.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

    if (extractedText.length < 100) {
      return new Response(JSON.stringify({ error: "O conteúdo extraído é muito curto (mínimo 100 caracteres)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check total chars
    const { data: existingSources } = await serviceClient
      .from("course_sources")
      .select("char_count")
      .eq("course_id", course_id)
      .eq("user_id", userId);

    const currentTotal = (existingSources || []).reduce((sum: number, s: any) => sum + s.char_count, 0);
    if (currentTotal + extractedText.length > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({
        error: `Limite de ${MAX_TOTAL_CHARS.toLocaleString()} caracteres totais excedido.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save source
    const { data: source, error: sourceError } = await serviceClient
      .from("course_sources")
      .insert({
        course_id,
        user_id: userId,
        filename,
        file_path: `url-import/${userId}/${course_id}/${filename}`,
        content_type: contentType,
        char_count: extractedText.length,
        extracted_text: extractedText,
      })
      .select()
      .single();

    if (sourceError) throw sourceError;

    return new Response(JSON.stringify({
      id: source.id,
      filename: source.filename,
      char_count: source.char_count,
      source_type: isYouTubeUrl(url) ? "youtube" : "web",
      message: "URL importada com sucesso.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("import-url-source error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
