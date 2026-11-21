import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  corpoDaVerificacao,
  deveDescartar,
  interpretarVeredito,
  paraBase64,
  PERGUNTA_DE_TEXTO,
  verificarTextoNaImagem,
} from "../../supabase/functions/_shared/imagem-sem-texto";

// ═══════════════════════════════════════════════════════════════════════════
// A REGRA EXISTIA DESDE 20/11 E NINGUÉM CONFERIA
//
// `imagem-sem-texto.test.ts` mede o PROMPT: ele parou de pedir diagrama e
// passou a proibir tipografia. Este arquivo mede a VERIFICAÇÃO do que voltou.
//
// MEDIDO no PPTX de 21/11/2026, abrindo image-5-1.jpeg do módulo 1 — gerado
// com o prompt velho, mas o ponto é outro: nada no caminho olhava a imagem.
//
//   ECONOMY · ECONOMY · EFFICIENCY · EFFICIENCY · EFFECTYNESS · EFICIACY
//   "CONTINIUOUS IMPROVEMENT & EPRFORMENCHT"
//
// Seis barras para quatro conceitos, dois duplicados, dois com grafia errada,
// tudo em inglês num curso brasileiro de auditoria. O slide se chama "As
// Quatro Dimensões de Desempenho (4 Es)" e seus quatro marcadores não nomeiam
// nenhuma das quatro — a imagem era o único lugar onde elas apareceriam.
//
// ─── O QUE ESTE TESTE GARANTE, E O QUE NÃO GARANTE ──────────────────────────
//
// Garante a DECISÃO, que é pura: o que conta como sim, o que conta como não, e
// que qualquer outra coisa deixa a imagem passar.
//
// NÃO garante a percepção: quem olha a imagem é um modelo de visão, e não há
// OCR dentro do runtime do Edge Function para substituí-lo. A pergunta é
// estreita — "há letras?" — que é muito mais confiável do que pedir obediência
// a uma regra de estilo durante o desenho, mas continua sendo um modelo.
//
// A assimetria é o que dá para travar aqui, e é ela que impede que um timeout
// vire módulo sem imagem.
// ═══════════════════════════════════════════════════════════════════════════

describe("a pergunta é estreita e não pede opinião", () => {
  it("pergunta por letras, não por qualidade", () => {
    expect(PERGUNTA_DE_TEXTO).toMatch(/readable letters/i);
    expect(PERGUNTA_DE_TEXTO).not.toMatch(/quality|beautiful|appropriate/i);
  });

  it("manda responder uma palavra só", () => {
    expect(PERGUNTA_DE_TEXTO).toMatch(/exactly one word/i);
  });

  it("cobre o caso medido: rótulo DENTRO de forma, e grafia errada", () => {
    // Os rótulos do diagrama ficam dentro das barras, e dois estão errados.
    // Uma pergunta que só falasse em legenda deixaria passar os dois.
    expect(PERGUNTA_DE_TEXTO).toMatch(/labels inside shapes/i);
    expect(PERGUNTA_DE_TEXTO).toMatch(/misspelled/i);
  });
});

describe("interpretarVeredito", () => {
  it("SIM em qualquer caixa, com ou sem pontuação", () => {
    for (const r of ["YES", "yes", " Yes.", "YES\n", "yes,", "Sim"]) {
      expect(interpretarVeredito(r), r).toBe("com-texto");
    }
  });

  it("NÃO em qualquer caixa", () => {
    for (const r of ["NO", "no", " No.", "no\n", "Não", "nao"]) {
      expect(interpretarVeredito(r), r).toBe("sem-texto");
    }
  });

  it("A PRIMEIRA PALAVRA MANDA", () => {
    // O modelo às vezes explica. Procurar "no" dentro da explicação de um "yes"
    // liberaria justamente a imagem errada.
    expect(interpretarVeredito("YES, the image contains no fewer than six labels"))
      .toBe("com-texto");
    expect(interpretarVeredito("No, there is no text of any kind")).toBe("sem-texto");
  });

  it("resposta confusa, vazia ou ausente NÃO descarta", () => {
    for (const r of ["", "   ", "maybe", "I cannot determine", "1", null, undefined]) {
      expect(interpretarVeredito(r as string), String(r)).toBe("nao-verificado");
    }
  });
});

describe("deveDescartar é assimétrico de propósito", () => {
  it("só um SIM explícito descarta", () => {
    expect(deveDescartar("com-texto")).toBe(true);
    expect(deveDescartar("sem-texto")).toBe(false);
    expect(deveDescartar("nao-verificado")).toBe(false);
  });
});

describe("o corpo da requisição", () => {
  it("manda a imagem e a pergunta, nessa ordem", () => {
    const c = corpoDaVerificacao("QUJD", "image/jpeg");
    const partes = c.contents[0].parts as Array<Record<string, unknown>>;
    expect(partes[0]).toHaveProperty("inline_data");
    expect(partes[1]).toHaveProperty("text");
  });

  it("temperatura zero e teto baixo — a resposta é uma palavra", () => {
    const c = corpoDaVerificacao("QUJD", "image/jpeg");
    expect(c.generationConfig.temperature).toBe(0);
    expect(c.generationConfig.maxOutputTokens).toBeLessThanOrEqual(16);
  });

  it("paraBase64 aguenta imagem grande sem estourar a pilha", () => {
    // 700 KB é o tamanho real das imagens do deck: image-13-1.png tinha
    // 722.275 bytes. String.fromCharCode(...array) de uma vez estoura aí.
    const grande = new Uint8Array(700_000).fill(65);
    const b64 = paraBase64(grande);
    expect(b64.length).toBeGreaterThan(900_000);
    expect(b64.startsWith("QUFB")).toBe(true);
  });
});

describe("verificarTextoNaImagem nunca derruba a geração", () => {
  const base = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/jpeg", apiKey: "k" };

  function respostaDe(texto: string) {
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
    } as unknown as Response;
  }

  it("lê a resposta do modelo", async () => {
    const fetchImpl = vi.fn(async () => respostaDe("YES"));
    expect(await verificarTextoNaImagem({ ...base, fetchImpl: fetchImpl as never }))
      .toBe("com-texto");
  });

  it("erro HTTP não descarta", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 } as Response));
    expect(await verificarTextoNaImagem({ ...base, fetchImpl: fetchImpl as never }))
      .toBe("nao-verificado");
  });

  it("exceção de rede não descarta", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await verificarTextoNaImagem({ ...base, fetchImpl: fetchImpl as never }))
      .toBe("nao-verificado");
  });

  it("sem chave não chega a chamar", async () => {
    const fetchImpl = vi.fn(async () => respostaDe("YES"));
    expect(
      await verificarTextoNaImagem({ ...base, apiKey: "", fetchImpl: fetchImpl as never }),
    ).toBe("nao-verificado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("imagem vazia não chega a chamar", async () => {
    const fetchImpl = vi.fn(async () => respostaDe("YES"));
    expect(
      await verificarTextoNaImagem({
        ...base,
        bytes: new Uint8Array(0),
        fetchImpl: fetchImpl as never,
      }),
    ).toBe("nao-verificado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resposta sem candidatos não descarta", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response));
    expect(await verificarTextoNaImagem({ ...base, fetchImpl: fetchImpl as never }))
      .toBe("nao-verificado");
  });
});

describe("os dois caminhos de geração chamam a verificação", () => {
  const fonte = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("a geração automática descarta e o módulo segue sem imagem", () => {
    const s = fonte("supabase/functions/_shared/course-pipeline.ts");
    expect(s).toContain("verificarTextoNaImagem(");
    expect(s).toMatch(/deveDescartar\(veredito\)[\s\S]{0,400}return null/);
  });

  it("a geração manual devolve erro, porque tem alguém esperando", () => {
    const s = fonte("supabase/functions/generate-module-image/index.ts");
    expect(s).toContain("verificarTextoNaImagem(");
    expect(s).toContain("imagem-com-texto");
    expect(s).toMatch(/status: 422/);
  });

  it("A VERIFICAÇÃO OLHA OS BYTES QUE SERÃO GRAVADOS", () => {
    // Verificar o PNG cru e gravar o JPEG convertido seria medir uma coisa e
    // publicar outra — o defeito que mais se repete neste projeto.
    const s = fonte("supabase/functions/_shared/course-pipeline.ts");
    const iConv = s.indexOf('paraJpeg(binary, "generate-course")');
    const iVer = s.indexOf("verificarTextoNaImagem({", iConv);
    expect(iConv).toBeGreaterThan(-1);
    expect(iVer).toBeGreaterThan(iConv);
    expect(s.slice(iVer, iVer + 220)).toContain("convertida.bytes");
  });
});
