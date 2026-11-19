import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REGRA_DE_DEFINICAO } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// A CLÁUSULA QUE DISTINGUE O CONCEITO É PARTE DA DEFINIÇÃO
//
// APONTADO por quem usou — auditor — em 19/11/2026, lendo as definições dos
// quatro critérios de auditoria num curso gerado das normas do TCU. Perguntei
// se a perda importava para um auditor: "sim, importa muito".
//
// MEDIDO em DOIS cursos seguidos, comparando cada definição do curso com o
// parágrafo da fonte que define o mesmo termo:
//
//   a fonte diz                                    o curso escreveu
//   ───────────────────────────────────────────────────────────────────────
//   eficácia: "grau de alcance das metas em        sem "independentemente dos
//   determinado período, INDEPENDENTEMENTE DOS      custos" — nos dois cursos
//   CUSTOS IMPLICADOS"
//
//   eficiência: "relação entre produtos e custos   sem "mantidos os padrões
//   dos insumos, MANTIDOS OS PADRÕES DE            de qualidade" — nos dois
//   QUALIDADE"                                      cursos
//
// A cláusula cortada é a que separa o conceito do vizinho: "independentemente
// dos custos" distingue eficácia de eficiência, e "mantidos os padrões de
// qualidade" distingue eficiência de simplesmente cortar custo. Sem elas a
// definição parece certa e não serve — um auditor que avalia eficácia pesando
// custo está avaliando outra coisa.
//
// ─── O QUE ESTE TESTE GARANTE, E O QUE NÃO GARANTE ──────────────────────────
//
// Garante que a regra EXISTE, que diz o que precisa dizer, e que está nos TRÊS
// prompts que escrevem conteúdo de lição — inclusive nos dois de reparo, porque
// um reparo que reescreve a lição pode cortar a cláusula de volta.
//
// NÃO garante que o modelo obedeça. Não existe teste determinístico para "este
// resumo preservou as cláusulas distintivas": eu teria de identificar sozinho
// qual parágrafo da fonte define qual termo e qual das suas orações é a
// distintiva. Diferente de "planejamento estratégico", onde o defeito era
// checável — o par existe no corpus ou não existe.
//
// A verificação real é o próximo curso: a definição de eficácia tem de conter
// "independentemente dos custos", e a de eficiência, "mantidos os padrões de
// qualidade".
// ═══════════════════════════════════════════════════════════════════════════

const FONTE = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/course-pipeline.ts"),
  "utf8",
);

describe("a regra diz o que precisa dizer", () => {
  it("manda conservar as cláusulas que distinguem o termo dos vizinhos", () => {
    expect(REGRA_DE_DEFINICAO).toMatch(/cláusulas que o\s+distinguem dos termos vizinhos/);
  });

  it("prefere as palavras da própria fonte a reescrevê-las", () => {
    expect(REGRA_DE_DEFINICAO).toContain("palavras da própria");
  });

  it("nomeia as quatro formas de limitação que viu cortar", () => {
    for (const limite of ["tempo", "custo", "qualidade", "causalidade"]) {
      expect(REGRA_DE_DEFINICAO, limite).toContain(limite);
    }
  });

  it("CARREGA OS DOIS CASOS MEDIDOS, com a cláusula exata", () => {
    // Instrução abstrata sobre "preservar nuance" não diz o que fazer. Os dois
    // exemplos são os que foram realmente perdidos, duas vezes cada.
    expect(REGRA_DE_DEFINICAO).toContain("independentemente dos custos implicados");
    expect(REGRA_DE_DEFINICAO).toContain("mantidos os padrões de qualidade");
    expect(REGRA_DE_DEFINICAO).toContain("eficácia");
    expect(REGRA_DE_DEFINICAO).toContain("eficiência");
  });

  it("diz que a limitação não é detalhe", () => {
    expect(REGRA_DE_DEFINICAO).toMatch(/FAZ PARTE da definição/);
  });
});

describe("a regra está em todos os prompts que escrevem lição", () => {
  /** O corpo de uma função do arquivo, do cabeçalho até a próxima declaração. */
  function corpoDaFuncao(nome: string): string {
    const i = FONTE.indexOf(`function ${nome}(`);
    expect(i, `função ${nome} não encontrada`).toBeGreaterThan(-1);
    const resto = FONTE.slice(i + 10);
    const fim = resto.search(/\n(?:async )?function [a-zA-Z]/);
    return fim > 0 ? resto.slice(0, fim) : resto;
  }

  // Os três que produzem o texto que o aluno lê. O reparo de envelope mexe em
  // ponte, checkpoint e pontos-chave — não escreve definição —, mas carrega a
  // regra do mesmo jeito porque os pontos-chave resumem conceito.
  for (const fn of ["buildModulePrompt", "buildModuleRepairPrompt", "repairLesson"]) {
    it(`${fn} interpola a regra`, () => {
      expect(corpoDaFuncao(fn)).toContain("${REGRA_DE_DEFINICAO}");
    });
  }

  it("são exatamente três usos, e nenhum se perdeu numa refatoração", () => {
    const usos = (FONTE.match(/\$\{REGRA_DE_DEFINICAO\}/g) || []).length;
    expect(usos).toBe(3);
  });

  it("o reparo de lição é avisado de que não pode CORTAR a cláusula", () => {
    // Um reparo recebe a lição pronta e devolve outra. Sem esta linha, ele
    // poderia remover a cláusula que a geração acertou — e os logs mostram
    // reparos recusados por "não melhorou", ou seja, eles mexem de verdade.
    expect(corpoDaFuncao("repairLesson")).toContain("não pode CORTAR uma cláusula");
  });
});
