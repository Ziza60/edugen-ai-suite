import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILES_FREE = 3;
const MAX_FILES_PRO = 20;
const ALLOWED_TYPES = ["application/pdf", "text/plain", "text/markdown"];
const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];

// Simple text normalizer: collapse whitespace, remove repeated headers/footers
function normalizeText(raw: string): string {
  // Collapse multiple newlines to max 2
  let text = raw.replace(/\n{3,}/g, "\n\n");
  // Collapse multiple spaces/tabs to single space
  text = text.replace(/[ \t]{2,}/g, " ");
  // Remove common PDF artifacts (page numbers like "Page 1 of 10", "- 1 -")
  text = text.replace(/^(Page \d+ of \d+|[-–—]\s*\d+\s*[-–—])\s*$/gm, "");
  // Trim each line
  text = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  return text.trim();
}

// Extract text from PDF using pdf-parse
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Use Gemini to extract text from PDF (multimodal)
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const base64 = btoa(String.fromCharCode(...bytes));

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text content from this PDF document. Return ONLY the raw text, preserving the structure (headings, paragraphs, lists). Do NOT add any commentary, summaries, or formatting beyond what exists in the document.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDF extraction failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseKey);

    // Validate token
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // Check Pro plan
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const plan = sub?.plan || "free";

    // Check dev bypass
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_dev")
      .eq("user_id", userId)
      .maybeSingle();
    const isDev = profile?.is_dev === true;

    if (plan !== "pro" && !isDev) {
      return new Response(
        JSON.stringify({ error: "Fontes próprias estão disponíveis apenas no plano Pro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const courseId = formData.get("course_id") as string;
    const file = formData.get("file") as File;

    if (!file || !courseId) {
      return new Response(
        JSON.stringify({ error: "Arquivo e course_id são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate file type
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return new Response(
        JSON.stringify({ error: `Tipo de arquivo não suportado. Aceitos: ${ALLOWED_EXTENSIONS.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check existing sources count for this course
    const { count: existingCount } = await serviceClient
      .from("course_sources")
      .select("*", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("user_id", userId);

    if ((existingCount ?? 0) >= MAX_FILES) {
      return new Response(
        JSON.stringify({ error: `Limite de ${MAX_FILES} arquivos por curso atingido.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract text
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extractedText: string;

    if (ext === ".pdf") {
      extractedText = await extractPdfText(bytes);
    } else {
      // TXT or MD — just decode
      extractedText = new TextDecoder().decode(bytes);
    }

    extractedText = normalizeText(extractedText);

    if (extractedText.length < 100) {
      return new Response(
        JSON.stringify({ error: "O documento não contém texto suficiente para gerar um curso (mínimo 100 caracteres)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check total chars across all sources for this course
    const { data: existingSources } = await serviceClient
      .from("course_sources")
      .select("char_count")
      .eq("course_id", courseId)
      .eq("user_id", userId);

    const currentTotalChars = (existingSources || []).reduce((sum: number, s: any) => sum + s.char_count, 0);
    if (currentTotalChars + extractedText.length > MAX_TOTAL_CHARS) {
      return new Response(
        JSON.stringify({
          error: `Limite de ${MAX_TOTAL_CHARS.toLocaleString()} caracteres totais excedido. Atual: ${currentTotalChars.toLocaleString()}, novo arquivo: ${extractedText.length.toLocaleString()}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload file to storage
    const filePath = `${userId}/${courseId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await serviceClient.storage
      .from("course-sources")
      .upload(filePath, bytes, { contentType: file.type || "application/octet-stream" });

    if (uploadError) throw uploadError;

    // Save source metadata + extracted text
    const { data: source, error: sourceError } = await serviceClient
      .from("course_sources")
      .insert({
        course_id: courseId,
        user_id: userId,
        filename: file.name,
        file_path: filePath,
        content_type: file.type || "text/plain",
        char_count: extractedText.length,
        extracted_text: extractedText,
      })
      .select()
      .single();

    if (sourceError) throw sourceError;

    return new Response(
      JSON.stringify({
        id: source.id,
        filename: source.filename,
        char_count: source.char_count,
        message: "Arquivo processado com sucesso.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Upload source error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
