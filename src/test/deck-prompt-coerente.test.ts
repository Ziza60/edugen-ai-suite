import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// DUAS REGRAS CONTRÁRIAS NO MESMO PROMPT
//
// Em 20/11/2026 eu acrescentei ao prompt do planejador do deck a exceção das
// definições: quando o módulo DEFINE um termo, o corpo do cartão conserva a
// cláusula que o distingue, ainda que passe das 12 palavras. O teto mecânico
// que cortava a definição (MAX_CARD_BODY_CHARS: 90) foi levantado no mesmo
// dia, e o slide renderizado mostrou as quatro definições inteiras.
//
// MEDIDO no deck gerado em 21/11, com o conserto já publicado:
//
//   o curso define .... "grau de alcance das metas programadas em termos de
//                        produtos e resultados imediatos, INDEPENDENTEMENTE
//                        DOS CUSTOS IMPLICADOS"
//   o texto condensado  CONTINHA a cláusula — medido, não suposto
//   o teto do cartão ... 165 caracteres para quatro cartões
//   o slide trouxe ..... "Grau de alcance das metas e objetivos programados."
//                        48 caracteres. A cláusula sumiu com 117 de folga.
//
// Não foi corte: foi a regra contrária vencendo. Sessenta e quatro linhas
// abaixo da exceção, o mesmo prompt dizia "For cards, tiles, steps and table
// cells, enforce a MAXIMUM of ~12 words per text block. Be ruthless in your
// summarization" — nomeando "cards", que é justamente onde a exceção manda
// pôr a definição, e sem abrir exceção nenhuma.
//
// Escrever a exceção e deixar a contradição de pé embaixo dela é a mesma falha
// de sempre: uma régua que não olha o que mede.
//
// ─── O QUE ESTE TESTE GARANTE, E O QUE NÃO GARANTE ──────────────────────────
//
// Garante que nenhuma regra do prompt imponha o teto de 12 palavras sem que a
// exceção das definições esteja ali perto. NÃO garante que o modelo obedeça —
// a verificação real é o próximo deck, com o critério já escrito: a definição
// de eficácia tem de conter "independentemente dos custos".
// ═══════════════════════════════════════════════════════════════════════════

const PROMPT = readFileSync(
  resolve(process.cwd(), "supabase/functions/export-pptx-v7/deck-plan.ts"),
  "utf8",
);
const LINHAS = PROMPT.split("\n");

/** Toda linha que impõe o teto de 12 palavras, com o número da linha. */
function regrasDoTeto(): { n: number; texto: string }[] {
  return LINHAS.map((texto, i) => ({ n: i + 1, texto }))
    .filter((l) => /\b(?:≤\s*12|MAXIMUM of ~?12|max(?:imum)? of ~?12)\s*words\b/i.test(l.texto));
}

describe("o prompt do planejador não se contradiz sobre definições", () => {
  it("existe pelo menos uma regra de teto — se sumir, este teste perde o sentido", () => {
    expect(regrasDoTeto().length).toBeGreaterThan(0);
  });

  it("TODA regra de teto traz a exceção das definições a até 10 linhas", () => {
    const semExcecao = regrasDoTeto().filter(({ n }) => {
      const vizinhanca = LINHAS.slice(n - 1, n + 10).join("\n");
      return !/EXCEPTION|DEFINITIONS? ARE|a DEFINITION/i.test(vizinhanca);
    });
    expect(
      semExcecao.map((l) => `linha ${l.n}: ${l.texto.trim()}`),
      "regra de 12 palavras sem a exceção das definições por perto",
    ).toEqual([]);
  });

  it("AS DUAS regras carregam o caso medido, com a cláusula exata", () => {
    // Instrução abstrata sobre "preservar nuance" não diz o que fazer. Este é
    // o caso real, perdido em três decks seguidos — e precisa estar nas duas
    // pontas: na exceção e na regra de contenção que a cancelava. Quebra de
    // linha não conta como diferença, o prompt é texto corrido para o modelo.
    const corrido = PROMPT.replace(/\s*\n\s*/g, " ");
    expect(corrido).toContain("independentemente dos custos implicados");
    expect(
      corrido.match(/independentemente dos custos implicados/g)?.length,
      "a cláusula medida precisa aparecer na exceção E na regra de contenção",
    ).toBeGreaterThanOrEqual(2);
  });

  it("a exceção dá um número para o corpo da definição, não só 'mais longo'", () => {
    // "let the body run as long as the distinction needs" não dá ao modelo um
    // alvo. ~25 palavras é o que o cartão comporta (165 caracteres, medidos em
    // capacidadeDoCorpoDoCard), então o número é verdadeiro no layout.
    expect(PROMPT).toMatch(/up to ~?25 words/i);
  });

  it("a regra de contenção segue valendo para o que NÃO é definição", () => {
    // A exceção não pode virar licença para cartão com parágrafo.
    expect(PROMPT).toMatch(/ruthless[\s\S]{0,200}never[\s\S]{0,80}definition/i);
  });
});
