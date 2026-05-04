import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Max PDF/DOCX analyses per hour per plan — keep in sync with supabase/functions/_shared/plans.ts
const RATE_LIMITS: Record<string, number> = {
  free:    3,
  starter: 15,
  pro:     50,
};

function normalizeText(raw: string): string {
  return raw
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^(Page \d+ of \d+|[-–—]\s*\d+\s*[-–—])\s*$/gm, "")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractPdfText(bytes: Uint8Array, apiKey: string): Promise<string> {
  const base64 = uint8ToBase64(bytes);
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract ALL text from this PDF. Return ONLY the raw text preserving headings, paragraphs and lists. No commentary or summaries." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
          ],
        }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Falha na extração do PDF: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function extractDocxText(bytes: Uint8Array): string {
  const unzipped = unzipSync(bytes);
  const docXmlBytes = unzipped["word/document.xml"];
  if (!docXmlBytes) throw new Error("Arquivo DOCX inválido ou corrompido.");
  const docXml = new TextDecoder().decode(docXmlBytes);
  return docXml
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function analyzeContent(text: string, filename: string, apiKey: string) {
  const truncated = text.slice(0, 40_000);
  const prompt = `You are an expert instructional designer. Analyze this document and suggest a course structure.

Document name: "${filename}"

Content:
${truncated}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "title": "a clear, engaging course title (in the document's language)",
  "theme": "main subject description in 1-2 sentences (in the document's language)",
  "targetAudience": "who this course is for (in the document's language)",
  "suggestedModules": <integer between 3 and 12 based on content depth>,
  "language": "<BCP-47 code: pt-BR, en, es, fr, de>",
  "summary": "2-3 sentence description of what students will learn (in the document's language)"
}`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    },
  );
  if (!res.ok) throw new Error("Falha na análise do conteúdo com IA");
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || "{}").trim();
  const jsonStr = raw.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
  return JSON.parse(jsonStr);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY não configurada" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Token inválido" }, 401);
    const userId = claimsData.claims.sub as string;

    // ── Rate limiting ─────────────────────────────────────────────────────────
    // Fetch plan and last-hour usage in parallel
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [planResult, usageResult] = await Promise.all([
      serviceClient
        .from("subscriptions")
        .select("plan")
        .eq("user_id", userId)
        .maybeSingle(),
      serviceClient
        .from("course_sources")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", oneHourAgo),
    ]);

    const plan: string = planResult.data?.plan ?? "free";
    const maxPerHour = RATE_LIMITS[plan] ?? RATE_LIMITS.free;
    const usedThisHour = usageResult.count ?? 0;

    console.log(`[analyze-pdf-source] User ${userId} plan=${plan} used=${usedThisHour}/${maxPerHour} this hour`);

    if (usedThisHour >= maxPerHour) {
      return json(
        {
          error: `Limite de ${maxPerHour} análises por hora atingido para o plano ${plan}. Tente novamente mais tarde.`,
          rateLimited: true,
          limit: maxPerHour,
          plan,
        },
        429,
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const courseId = formData.get("course_id") as string;
    if (!file || !courseId) return json({ error: "file e course_id são obrigatórios" }, 400);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) {
      return json({ error: "Apenas arquivos PDF e DOCX são suportados." }, 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      return json({ error: "Arquivo muito grande. Limite: 5 MB." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    console.log(`[analyze-pdf-source] Processing ${file.name} (${ext}, ${bytes.length} bytes)`);

    let rawText: string;
    if (ext === "pdf") {
      rawText = await extractPdfText(bytes, apiKey);
    } else {
      rawText = extractDocxText(bytes);
    }

    const extractedText = normalizeText(rawText);
    if (extractedText.length < 100) {
      return json({ error: "O documento não contém texto suficiente para gerar um curso." }, 400);
    }

    console.log(`[analyze-pdf-source] Extracted ${extractedText.length} chars, analyzing…`);

    const analysis = await analyzeContent(extractedText, file.name, apiKey);

    const filePath = `${userId}/${courseId}/${Date.now()}-${file.name}`;
    await serviceClient.storage.from("course-sources").upload(filePath, bytes, {
      contentType: file.type || "application/octet-stream",
    }).catch((e: any) => console.warn("Storage upload skipped:", e.message));

    const { data: source, error: sourceErr } = await serviceClient
      .from("course_sources")
      .insert({
        course_id: courseId,
        user_id: userId,
        filename: file.name,
        file_path: filePath,
        content_type: file.type || "application/octet-stream",
        char_count: extractedText.length,
        extracted_text: extractedText.slice(0, 500_000),
      })
      .select("id")
      .single();

    if (sourceErr) throw sourceErr;

    console.log(`[analyze-pdf-source] Done — source_id: ${source.id}`);

    return json({
      source_id: source.id,
      filename: file.name,
      char_count: extractedText.length,
      title: analysis.title || file.name.replace(/\.[^.]+$/, ""),
      theme: analysis.theme || "",
      targetAudience: analysis.targetAudience || "",
      suggestedModules: Number(analysis.suggestedModules) || 6,
      detectedLanguage: analysis.language || "pt-BR",
      summary: analysis.summary || "",
    });
  } catch (err: any) {
    console.error("[analyze-pdf-source] Error:", err);
    return json({ error: err.message || "Erro interno do servidor" }, 500);
  }
});
