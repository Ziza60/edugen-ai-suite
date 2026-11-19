import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import {
  irmaosRecebidos, promptDeAnalise, type DocumentoIrmao,
} from "../_shared/analise-de-documento.ts";
import {
  avisoDeVocabulario, expressoesForaDasFontes,
} from "../_shared/vocabulario-das-fontes.ts";
import { normalizarTextoExtraido } from "../_shared/texto-extraido.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const RATE_LIMITS: Record<string, number> = {
  free:    3,
  starter: 15,
  pro:     50,
};



// Chunked base64 — avoids call-stack overflow for large files
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

/**
 * ─── POR QUE A ANÁLISE PRECISA SABER DOS OUTROS DOCUMENTOS ──────────────────
 *
 * Esta função analisava SEMPRE um documento sozinho, com o prompt "analyze this
 * document and suggest a course structure" — isto é, desenhe um curso inteiro a
 * partir dele. Com um arquivo só, correto. Com dois, estruturalmente errado: o
 * escopo do curso é a UNIÃO dos documentos, e nenhuma das chamadas sabia que a
 * outra existia.
 *
 * RELATADO por quem usou, em 19/11/2026: anexou o capítulo de conceitos gerais
 * de auditoria junto com o de planejamento da auditoria operacional. O título
 * veio abrangente, como se o curso cobrisse todas as fases, e o tema afirmou
 * que o curso iria ALÉM do planejamento — uma promessa que as fontes não
 * sustentam. Teve de corrigir os dois à mão.
 *
 * A causa do lado do app foi minha: o formulário era preenchido com
 * `analises[0]`, o PRIMEIRO documento escolhido, e nesse caso o primeiro era o
 * geral. Mas trocar o índice não resolveria — nenhuma das análises conhecia o
 * conjunto.
 *
 * O peso em caracteres vai no prompt de propósito: é o único sinal objetivo de
 * onde está a massa de conteúdo. No caso relatado, planejamento tinha 93.537
 * caracteres contra 38.605 dos conceitos gerais.
 */
async function analyzeContent(
  text: string,
  filename: string,
  apiKey: string,
  irmaos: DocumentoIrmao[] = [],
) {
  // O prompt vive em `_shared/analise-de-documento.ts` para poder ser medido:
  // a regra que conserta o escopo abrangente é uma frase de prompt, e uma frase
  // de prompt dentro de `Deno.serve` não tem como ser verificada por teste.
  const prompt = promptDeAnalise(text, filename, irmaos);

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
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey      = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY não configurada" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Token inválido" }, 401);
    const userId = claimsData.claims.sub as string;

    // ── Rate limiting ──────────────────────────────────────────────────────────
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [planResult, usageResult] = await Promise.all([
      serviceClient.from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
      serviceClient.from("course_sources").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("created_at", oneHourAgo),
    ]);

    const plan: string = planResult.data?.plan ?? "free";
    const maxPerHour   = RATE_LIMITS[plan] ?? RATE_LIMITS.free;
    const usedThisHour = usageResult.count ?? 0;

    console.log(`[analyze-pdf-source] user=${userId} plan=${plan} used=${usedThisHour}/${maxPerHour}`);

    if (usedThisHour >= maxPerHour) {
      return json({ error: `Limite de ${maxPerHour} análises/hora atingido (plano ${plan}).`, rateLimited: true }, 429);
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Parse multipart form data
    const formData  = await req.formData();
    const file      = formData.get("file") as File;
    const courseId  = formData.get("course_id") as string;
    if (!file || !courseId) return json({ error: "file e course_id são obrigatórios" }, 400);

    // Os documentos do mesmo conjunto já analisados. Metadado só; entrada
    // quebrada devolve lista vazia e a análise segue sozinha, em vez de o
    // upload inteiro falhar.
    const irmaos: DocumentoIrmao[] = irmaosRecebidos(formData.get("outros_documentos"));

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) {
      return json({ error: "Apenas arquivos PDF e DOCX são suportados." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    console.log(`[analyze-pdf-source] Processing ${file.name} (${bytes.length} bytes)`);

    let rawText: string;
    if (ext === "pdf") {
      rawText = await extractPdfText(bytes, apiKey);
    } else {
      rawText = extractDocxText(bytes);
    }

    const extractedText = normalizarTextoExtraido(rawText);
    if (extractedText.length < 100) {
      return json({ error: "O documento não contém texto suficiente para gerar um curso." }, 400);
    }

    console.log(`[analyze-pdf-source] Extracted ${extractedText.length} chars, analyzing…`);

    console.log(
      `[analyze-pdf-source] ${file.name}: ${extractedText.length} chars, ` +
      `${irmaos.length} documento(s) irmão(s) no conjunto`,
    );
    const analysis = await analyzeContent(extractedText, file.name, apiKey, irmaos);

    // Store file in Storage (with service key — no RLS restriction)
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

    const titulo = analysis.title || file.name.replace(/\.[^.]+$/, "");

    // ─── O TÍTULO USA O VOCABULÁRIO DOS DOCUMENTOS? ─────────────────────────
    //
    // O corpus é o texto deste documento mais o dos outros do mesmo curso. Com
    // um documento só, não há consulta: o próprio texto basta — e o caso de
    // 18/11, "Planejamento Estratégico e Operacional de Auditorias", nasceu
    // justamente de um documento só.
    //
    // A consulta é melhor esforço: se falhar, o aviso deixa de existir e a
    // análise segue. Um aviso ausente é pior que um aviso presente, e muito
    // melhor que um upload que falha por causa de um aviso.
    let corpus = extractedText;
    if (irmaos.length) {
      const { data: outras, error: erroCorpus } = await serviceClient
        .from("course_sources")
        .select("extracted_text")
        .eq("course_id", courseId)
        .neq("id", source.id)
        .limit(20);
      if (erroCorpus) {
        console.warn("[analyze-pdf-source] corpus das outras fontes indisponível:", erroCorpus.message);
      } else {
        corpus += "\n" + (outras || []).map((o) => o.extracted_text || "").join("\n");
      }
    }

    const foraDasFontes = expressoesForaDasFontes(titulo, corpus);
    if (foraDasFontes.length) {
      console.log(
        `[analyze-pdf-source] título com expressão fora das fontes: ${foraDasFontes.join(" · ")}`,
      );
    }

    return json({
      source_id:       source.id,
      filename:        file.name,
      char_count:      extractedText.length,
      termos_fora_das_fontes: foraDasFontes,
      aviso_vocabulario:      avisoDeVocabulario(foraDasFontes, corpus),
      title:           titulo,
      theme:           analysis.theme           || "",
      targetAudience:  analysis.targetAudience  || "",
      suggestedModules: Number(analysis.suggestedModules) || 6,
      detectedLanguage: analysis.language       || "pt-BR",
      summary:         analysis.summary         || "",
    });
  } catch (err: any) {
    console.error("[analyze-pdf-source] Error:", err);
    return json({ error: err.message || "Erro interno do servidor" }, 500);
  }
});
