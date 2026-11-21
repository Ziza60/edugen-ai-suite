// ═══════════════════════════════════════════════════════════════════════════
// A REGRA DIZIA "NO WORDS" E NINGUÉM CONFERIA
//
// MEDIDO na imagem do módulo 1 do curso de 20/11/2026, aberta do PPTX:
//
//   seis barras para QUATRO conceitos
//   "ECONOMY" duas vezes, "EFFICIENCY" duas vezes
//   "EFFECTYNESS" e "EFICIACY" .......... grafados errado
//   "CONTINIUOUS IMPROVEMENT & EPRFORMENCHT" ... dois erros em três palavras
//   tudo em INGLÊS, num curso em português
//
// Nenhum dos quatro termos em português aparece. O slide se chama "As Quatro
// Dimensões de Desempenho (4 Es)", os marcadores não nomeiam nenhuma das
// quatro, e a imagem — o único lugar do slide onde elas apareceriam — erra
// duas e repete duas.
//
// O prompt de imagem já manda, em maiúsculas, THE IMAGE CARRIES NO WORDS. A
// regra existe desde 20/11 e nunca foi verificada: o que o modelo devolve é
// gravado como veio.
//
// ─── O QUE ESTE ARQUIVO É, E O QUE NÃO É ────────────────────────────────────
//
// É uma segunda pergunta ao modelo, estreita e perceptiva: "esta imagem tem
// letras legíveis?". Isso é muito mais confiável do que pedir a ele que siga
// uma regra de estilo enquanto desenha — mas NÃO é determinístico, e eu não
// tenho OCR dentro do runtime do Edge Function para que seja.
//
// Por isso a decisão é assimétrica:
//
//   resposta "tem texto" .... descarta a imagem
//   resposta "não tem" ...... publica
//   não deu para perguntar .. publica (timeout, erro de rede, chave ausente)
//
// Falha aberta de propósito: a verificação é uma rede a mais, nunca um novo
// jeito de o módulo ficar sem imagem por causa de um 503.
//
// E descartar é melhor que publicar: um diagrama com "EFICIACY" e "ECONOMY"
// num curso brasileiro de auditoria não é enfeite imperfeito — é erro de
// conteúdo na tela, na frente de auditores.
// ═══════════════════════════════════════════════════════════════════════════

export type VereditoDeTexto = "com-texto" | "sem-texto" | "nao-verificado";

/**
 * A pergunta. Estreita de propósito: não pede avaliação de qualidade, nem se a
 * imagem "está boa" — só se há letras. Quanto mais estreita, mais confiável a
 * resposta.
 */
export const PERGUNTA_DE_TEXTO =
  "Look at this image. Does it contain ANY readable letters, words, numbers or " +
  "labels rendered as text — including labels inside shapes, captions, legends, " +
  "axis labels, watermarks or logos with words?\n\n" +
  "Answer with exactly one word: YES or NO.\n" +
  "YES if there is any text at all, even a single short word, even if blurry or " +
  "misspelled.\n" +
  "NO only if the image is purely visual: shapes, people, objects, scenery, " +
  "textures, abstract forms, with no characters anywhere.";

/**
 * Lê a resposta do modelo. Só aceita um SIM ou NÃO claro; qualquer outra coisa
 * é "não verificado", e aí a imagem passa.
 */
export function interpretarVeredito(bruto: string | null | undefined): VereditoDeTexto {
  const t = (bruto ?? "").trim().toLowerCase();
  if (!t) return "nao-verificado";
  // A primeira palavra manda: o modelo às vezes responde "YES, the image
  // contains the words ...". Um "no" dentro de uma explicação que começa com
  // "yes" não pode virar liberação.
  const primeira = t.replace(/[^a-zà-ú\s]/g, " ").trim().split(/\s+/)[0];
  if (primeira === "yes" || primeira === "sim") return "com-texto";
  if (primeira === "no" || primeira === "nao" || primeira === "não") return "sem-texto";
  return "nao-verificado";
}

/** A imagem vai para o lixo? Só com um SIM explícito. */
export function deveDescartar(veredito: VereditoDeTexto): boolean {
  return veredito === "com-texto";
}

/** Uint8Array → base64, em blocos para não estourar a pilha com imagem grande. */
export function paraBase64(bytes: Uint8Array): string {
  let bin = "";
  const BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(bin);
}

/** O corpo da requisição de verificação, separado para poder ser medido. */
export function corpoDaVerificacao(base64: string, mimeType: string) {
  return {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: PERGUNTA_DE_TEXTO },
        ],
      },
    ],
    generationConfig: {
      // Resposta de uma palavra: sem orçamento de raciocínio e com teto baixo,
      // a chamada custa ~1s e não ameaça o prazo do módulo.
      temperature: 0,
      maxOutputTokens: 8,
    },
  };
}

export interface OpcoesDeVerificacao {
  bytes: Uint8Array;
  mimeType: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Injetável para teste; o padrão é o fetch global. */
  fetchImpl?: typeof fetch;
  /** Para o log dizer de onde veio. */
  origem?: string;
}

/**
 * Pergunta ao modelo de visão se a imagem tem texto.
 *
 * Nunca lança: qualquer falha vira "nao-verificado", e quem chama publica a
 * imagem como publicava antes.
 */
export async function verificarTextoNaImagem(
  opcoes: OpcoesDeVerificacao,
): Promise<VereditoDeTexto> {
  const {
    bytes,
    mimeType,
    apiKey,
    model = "gemini-2.5-flash",
    timeoutMs = 20000,
    fetchImpl = fetch,
    origem = "imagem",
  } = opcoes;
  if (!apiKey || !bytes?.length) return "nao-verificado";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resposta = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(corpoDaVerificacao(paraBase64(bytes), mimeType)),
        signal: controller.signal,
      },
    );
    if (!resposta.ok) {
      console.warn(`[imagem-sem-texto] ${origem}: verificação falhou ${resposta.status}`);
      return "nao-verificado";
    }
    const dados = await resposta.json();
    const texto = dados?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p?.text ?? "")
      .join(" ");
    const veredito = interpretarVeredito(texto);
    console.log(`[imagem-sem-texto] ${origem}: ${veredito} (resposta: ${String(texto).trim().slice(0, 40)})`);
    return veredito;
  } catch (erro: unknown) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    console.warn(`[imagem-sem-texto] ${origem}: ${msg}`);
    return "nao-verificado";
  } finally {
    clearTimeout(timer);
  }
}
