import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildLedgerDeValores,
  valoresDoCasoCondutor,
} from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O NÚMERO VIAJA COM A FRASE DE ONDE SAIU
//
// O ledger levava só `caso — grandeza: valor`, e o rótulo não diz A QUE o
// número se refere. Dois cursos seguidos mostraram o estrago:
//
//   TechInov (05/09): "previsão de demanda = 93 unidades" saiu de uma
//   resposta-modelo que não nomeia produto. Reapareceu como previsão do
//   'Smartphone Z' (m3) e do 'Smartphone X' (m8), este último citando "no
//   Módulo 2" — procedência que confere com o marcador do rótulo injetado e
//   não com o texto do módulo 2.
//
//   Sabores da Vovó (06/09): "perda direta = R$ 150,00" é, no módulo 2, margem
//   perdida por FALTA DE FARINHA. O módulo 5 reusou o número em contexto de
//   produtos vencidos e o módulo 7 escreveu "R$ 150,00 de perda direta POR
//   AVARIA" — que é o caso do módulo 1, onde a perda é R$120.
//
// Não foi preciso regra nova de extração: a `Grandeza` já carregava a oração,
// e nos 25 valores dos oito cursos da bancada é ela que nomeia o objeto.
// ═══════════════════════════════════════════════════════════════════════════

const CURSOS = [
  "preco-financas-inteligentes.md",
  "estoques-delicias-da-vovo.md",
  "estoques-pao-quente.md",
  "estoques-sabor-da-vovo.md",
  "estoques-doces-da-vovo-encadeado.md",
  "estoques-sabor-caseiro.md",
  "estoques-techinov.md",
  "transformacao-digital.md",
];

function doisPrimeiros(arquivo: string) {
  const linhas = readFileSync(
    resolve(process.cwd(), "src/test/cursos-reais", arquivo), "utf8",
  ).split("\n");
  const ini: number[] = [];
  linhas.forEach((l, i) => { if (l.startsWith("# ")) ini.push(i); });
  return [0, 1].map((k) => ({
    texto: linhas.slice(ini[k] + 1, ini[k + 1] ?? linhas.length).join("\n"),
    modulo: k + 1,
  }));
}

describe("todo valor injetado carrega a frase de origem", () => {
  for (const arquivo of CURSOS) {
    it(arquivo, () => {
      const valores = valoresDoCasoCondutor(doisPrimeiros(arquivo));
      for (const v of valores) {
        expect(v.trecho?.trim(), `${arquivo}: ${v.termo} sem trecho`).toBeTruthy();
        // A frase tem de conter o número: é o que prova que ela é a origem, e
        // não uma oração vizinha.
        expect(v.trecho, `${arquivo}: ${v.termo}`).toContain(v.valor);
      }
    });
  }
});

describe("o ledger mostra a frase, e não estoura de tamanho", () => {
  it("Sabor Caseiro: o objeto aparece junto do número", () => {
    // "perdas por produtos" sozinho não diz de quê. A frase diz: estragados,
    // no último trimestre.
    const led = buildLedgerDeValores(valoresDoCasoCondutor(doisPrimeiros("estoques-sabor-caseiro.md")));
    expect(led).toContain("perdas por produtos: R$ 450,00");
    expect(led).toContain('no texto: "As perdas por produtos estragados no último trimestre');
  });

  it("TechInov: a frase salva um rótulo que sozinho não diz nada", () => {
    // "média móvel = 3 meses" é ininteligível fora de contexto; a frase nomeia
    // o fornecedor e o Lead Time de onde ela sai.
    const led = buildLedgerDeValores(valoresDoCasoCondutor(doisPrimeiros("estoques-techinov.md")));
    expect(led).toMatch(/no texto: "O Lead Time médio dos fornecedores da TechInov/);
  });

  it("nenhum curso da bancada passa de 2 KB de ledger", () => {
    // Medido: de 901 a 1.994 caracteres, com 2 a 8 valores. O bloco entra no
    // prompt de cada módulo, então crescer sem limite sairia caro.
    for (const arquivo of CURSOS) {
      const led = buildLedgerDeValores(valoresDoCasoCondutor(doisPrimeiros(arquivo)));
      expect(led.length, arquivo).toBeLessThan(2048);
    }
  });

  it("frase longa é cortada em palavra inteira", () => {
    const longa = `A previsão ${"palavra ".repeat(60)}chega a R$ 100,00.`;
    const led = buildLedgerDeValores([
      { termo: "Caso — grandeza", valor: "R$ 100,00", modulo: 2, trecho: longa },
    ]);
    const linha = led.split("\n").find((l) => l.includes("no texto:"))!;
    expect(linha.length).toBeLessThan(280);
    expect(linha).toContain("…");
    expect(linha).not.toMatch(/pala…/); // não corta no meio da palavra
  });

  it("valor sem frase ainda entra, só que sem a linha extra", () => {
    const led = buildLedgerDeValores([
      { termo: "Caso — grandeza", valor: "R$ 10,00", modulo: 1, trecho: "" },
    ]);
    expect(led).toContain("Caso — grandeza: R$ 10,00");
    expect(led).not.toContain("no texto:");
  });

  it("curso sem valores não injeta bloco nenhum", () => {
    expect(buildLedgerDeValores([])).toBe("");
  });
});
