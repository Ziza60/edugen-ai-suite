import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  densidadeDeNumeros, juntarPalavrasQuebradas, normalizarTextoExtraido,
  pareceSumario, semSumario,
} from "../../supabase/functions/_shared/texto-extraido.ts";
import { promptDeAnalise } from "../../supabase/functions/_shared/analise-de-documento.ts";

// ═══════════════════════════════════════════════════════════════════════════
// MEDIDO CONTRA O `extracted_text` QUE O APP REALMENTE GRAVOU
//
// A amostra em `com-fontes/extracted-text-como-o-app-gravou.csv` saiu de um
// SELECT em `course_sources`, não de uma extração minha. Isso importa: eu quase
// escrevi o detector de sumário contra a minha extração com `pdftotext
// -layout`, que PRESERVA o alinhamento —
//
//   minha extração ... "6.6 DIVULGAÇÃO                    142"
//   o app ............ "6.6 DIVULGAÇÃO 142 7 MONITORAMENTO 144 7.1 FORMAS..."
//
// — e o detector, que dependia do vão, não casaria com nada em produção.
// Medir contra o artefato errado foi o erro que eu cometi hoje com o detector
// de placeholder; desta vez a amostra foi buscada antes de escrever a regra.
// ═══════════════════════════════════════════════════════════════════════════

const CSV = readFileSync(
  resolve(process.cwd(), "src/test/cursos-reais/com-fontes/extracted-text-como-o-app-gravou.csv"),
  "utf8",
);

/** Os campos `inicio` do CSV, que são o texto gravado de cada fonte. */
function amostras(): Array<{ filename: string; texto: string }> {
  const out: Array<{ filename: string; texto: string }> = [];
  // Cada registro: nome,char_count,"texto entre aspas, com aspas dobradas".
  const re = /(?:^|\n)([^,\n]+\.docx),(\d+),"((?:[^"]|"")*)"/g;
  for (const m of CSV.matchAll(re)) {
    out.push({ filename: m[1], texto: m[3].replace(/""/g, '"') });
  }
  return out;
}

const MANUAL = () => amostras().find((a) => a.filename.startsWith("Manual"))!;
const INTRO = () => amostras().find((a) => a.filename.startsWith("Introdu"))!;

describe("a amostra real está aqui e é o que eu afirmo", () => {
  it("as duas fontes do curso foram lidas do CSV", () => {
    // Sem este piso, tudo abaixo passaria com amostra vazia.
    const a = amostras();
    expect(a).toHaveLength(2);
    for (const { texto } of a) expect(texto.length).toBeGreaterThan(1500);
  });

  it("o texto gravado tem as palavras partidas que eu medi", () => {
    expect(MANUAL().texto).toContain("opor- tuna");
    expect(MANUAL().texto).toContain("orga- nização");
    expect(INTRO().texto).toContain("publica- ção");
  });

  it("o texto gravado tem o sumário do manual inteiro", () => {
    expect(INTRO().texto).toContain("6 RELATÓRIO E DIVULGAÇÃO 118");
    expect(INTRO().texto).toContain("7 MONITORAMENTO 144");
  });

  it("e o MANUAL não tem sumário — ele começa no capítulo 4", () => {
    expect(MANUAL().texto.slice(0, 40)).toContain("4 PLANEJAMENTO");
  });
});

describe("palavras partidas pela mudança de linha do PDF", () => {
  it("junta os casos reais do manual", () => {
    const t = juntarPalavrasQuebradas(MANUAL().texto);
    expect(t).toContain("oportuna");
    expect(t).toContain("organização");
    expect(t).toContain("gerenciadas");
    expect(t).not.toContain("opor- tuna");
    expect(t).not.toContain("orga- nização");
  });

  it("junta os casos reais da introdução", () => {
    const t = juntarPalavrasQuebradas(INTRO().texto);
    expect(t).toContain("publicação");
    expect(t).toContain("disponha");
    expect(t).toContain("possibilitem");
  });

  it("não toca palavra composta, que não tem espaço depois do hífen", () => {
    expect(juntarPalavrasQuebradas("custo-benefício e pré-textuais"))
      .toBe("custo-benefício e pré-textuais");
  });

  it("não toca hífen cercado de espaços, que é pontuação", () => {
    expect(juntarPalavrasQuebradas("a auditoria - a mais complexa - exige"))
      .toBe("a auditoria - a mais complexa - exige");
  });

  it("não junta quando o lado seguinte é maiúsculo — ali o hífen é outra coisa", () => {
    expect(juntarPalavrasQuebradas("item- Relatório")).toBe("item- Relatório");
  });

  it("não junta número com número", () => {
    expect(juntarPalavrasQuebradas("de 2023- 2024")).toBe("de 2023- 2024");
  });

  it("entrada vazia ou nula não quebra", () => {
    expect(juntarPalavrasQuebradas("")).toBe("");
    expect(juntarPalavrasQuebradas(undefined as any)).toBe("");
  });

  it("normalizarTextoExtraido junta ANTES de mexer nos espaços", () => {
    // A ordem importa: o padrão depende do espaço entre os dois pedaços, e a
    // normalização de espaços viria a colapsá-lo.
    const t = normalizarTextoExtraido("texto com palavra quebra-  da no fim");
    expect(t).toContain("quebrada");
  });

  it("normalizarTextoExtraido mantém o que sempre fazia", () => {
    expect(normalizarTextoExtraido("a\n\n\n\nb")).toBe("a\n\nb");
    expect(normalizarTextoExtraido("a    b")).toBe("a b");
    expect(normalizarTextoExtraido("x\n- 7 -\ny")).toBe("x\n\ny");
  });
});

describe("densidade de números separa sumário de prosa", () => {
  it("OS NÚMEROS MEDIDOS nas amostras reais", () => {
    const paras = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const sumario = paras(INTRO().texto)[0];
    const prosaIntro = paras(INTRO().texto).find((p) => p.includes("1 INTRODUÇÃO"))!;
    const prosaManual = paras(MANUAL().texto)[0];

    expect(densidadeDeNumeros(sumario)).toBeGreaterThan(0.3);
    expect(densidadeDeNumeros(prosaIntro)).toBeLessThan(0.08);
    expect(densidadeDeNumeros(prosaManual)).toBeLessThan(0.08);
    // Uma ordem de magnitude de distância entre os dois.
    expect(densidadeDeNumeros(sumario))
      .toBeGreaterThan(densidadeDeNumeros(prosaManual) * 5);
  });

  it("o sumário real é reconhecido", () => {
    expect(pareceSumario(INTRO().texto.split(/\n\s*\n/)[0])).toBe(true);
  });

  it("a prosa real NÃO é reconhecida como sumário", () => {
    for (const p of MANUAL().texto.split(/\n\s*\n/)) {
      if (p.trim()) expect(pareceSumario(p), p.slice(0, 50)).toBe(false);
    }
  });

  it("número de página solto é sumário", () => {
    expect(pareceSumario("10")).toBe(true);
    expect(pareceSumario("117 118")).toBe(true);
  });

  it("parágrafo curto não é julgado por densidade", () => {
    // Com poucas palavras a densidade não significa nada, e um título curto com
    // um número não pode ser confundido com índice.
    expect(pareceSumario("Capítulo 4 trata do planejamento")).toBe(false);
  });

  it("frase de prosa com vários números não é sumário", () => {
    expect(pareceSumario(
      "Em 2010 foram aprovadas as normas, e em 2015 o IRB publicou a NBASP 3000 " +
      "com base na ISSAI 3000, mantendo os números dos parágrafos originais.",
    )).toBe(false);
  });
});

describe("semSumario", () => {
  it("tira o sumário da introdução e mantém a prosa", () => {
    const limpo = semSumario(INTRO().texto);
    expect(limpo).not.toContain("7 MONITORAMENTO 144");
    expect(limpo).not.toContain("6 RELATÓRIO E DIVULGAÇÃO 118");
    expect(limpo).toContain("1 INTRODUÇÃO");
    expect(limpo).toContain("Normas Internacionais das Entidades Fiscalizadoras");
  });

  it("não mexe no manual, que não tem sumário", () => {
    expect(semSumario(MANUAL().texto)).toBe(MANUAL().texto.trim());
  });

  it("documento que é quase todo tabela volta inteiro", () => {
    // Melhor escopo errado que escopo nenhum: devolver string vazia faria a
    // análise acontecer sobre nada.
    const tabela = "Receita 45000 Custo 32000 Lucro 13000 Margem 29 Meta 35 Real 29";
    expect(semSumario(tabela)).toBe(tabela);
  });

  it("entrada vazia não quebra", () => {
    expect(semSumario("")).toBe("");
  });
});

describe("o prompt da análise não recebe mais o sumário", () => {
  it("o sumário real não chega ao prompt", () => {
    const p = promptDeAnalise(INTRO().texto, "Introdução.docx");
    expect(p).not.toContain("7 MONITORAMENTO 144");
    expect(p).not.toContain("6.6 DIVULGAÇÃO 142");
  });

  it("e a prosa real chega", () => {
    const p = promptDeAnalise(INTRO().texto, "Introdução.docx");
    expect(p).toContain("1 INTRODUÇÃO");
  });

  it("o prompt do manual segue com o conteúdo dele", () => {
    const p = promptDeAnalise(MANUAL().texto, "Manual.docx");
    expect(p).toContain("4 PLANEJAMENTO");
    expect(p).toContain("ISSAI 3000/96");
  });
});
