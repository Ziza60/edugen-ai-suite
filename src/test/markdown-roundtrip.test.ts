// Prova que o conteúdo rico sobrevive ao ciclo editar → salvar → recarregar.
//
// O ciclo real do editor é: o markdown salvo vira HTML para o TipTap, o TipTap
// devolve HTML no onUpdate, e esse HTML vira markdown de volta para o banco.
// Se a ida e a volta não forem fiéis, abrir o editor e fechá-lo SEM DIGITAR
// NADA já corrompe o módulo — foi exatamente o que a medição encontrou antes
// desta correção: as tabelas ganhavam linha em branco entre as linhas e
// deixavam de ser tabela; "1. 2. 3." voltava como "- - -".

import { describe, it, expect } from "vitest";
import {
  markdownToHtml,
  htmlToMarkdown,
  extractProtectedBlocks,
  restoreProtectedBlocks,
  stripInternalBlocks,
} from "@/lib/markdown-roundtrip";

/** O ciclo completo, como o BlockEditor o executa. */
function roundTrip(md: string): string {
  const { html, protectedBlocks } = markdownToHtml(md);
  return htmlToMarkdown(html, protectedBlocks);
}

const TABELA = [
  "| Campo | Orientação | Seu caso |",
  "| --- | --- | --- |",
  "| Processo escolhido | Qual processo você vai mapear? | ________________ |",
  "| Risco identificado | Onde o processo pode falhar? | ________________ |",
].join("\n");

const CALLOUT = [
  "> **Objetivo da lição:** Explicar o conceito central e sua aplicação.",
  "> ",
  "> Segunda linha do callout, que precisa manter o marcador de citação.",
].join("\n");

describe("round-trip markdown ↔ html do editor", () => {
  it("preserva uma tabela inteira, incluindo o separador de cabeçalho", () => {
    const volta = roundTrip(TABELA);
    expect(volta).toContain("| Campo | Orientação | Seu caso |");
    expect(volta).toContain("| --- | --- | --- |");
    expect(volta).toContain("| Processo escolhido | Qual processo você vai mapear? | ________________ |");
    // O defeito que motivou a correção: linha em branco entre as linhas da
    // tabela faz o remark-gfm deixar de reconhecê-la.
    expect(volta).not.toMatch(/\|\n\n\|/);
  });

  it("preserva um callout de várias linhas com o marcador de citação", () => {
    const volta = roundTrip(CALLOUT);
    expect(volta).toContain("> **Objetivo da lição:**");
    // A continuação precisa continuar sendo citação, senão vira parágrafo solto.
    expect(volta).toContain("> Segunda linha do callout");
  });

  it("preserva a numeração de uma lista ordenada", () => {
    const volta = roundTrip("1. Primeiro passo\n2. Segundo passo\n3. Terceiro passo");
    expect(volta).toContain("1. Primeiro passo");
    expect(volta).toContain("2. Segundo passo");
    expect(volta).toContain("3. Terceiro passo");
    expect(volta).not.toContain("- Primeiro passo");
  });

  it("preserva a indentação de uma lista aninhada", () => {
    const volta = roundTrip("- Item pai\n  - Filho A\n  - Filho B");
    expect(volta).toContain("- Item pai");
    expect(volta).toMatch(/\n {2}- Filho A/);
  });

  it("sobrevive a dois ciclos seguidos sem acumular alteração", () => {
    const um = roundTrip(`${CALLOUT}\n\n${TABELA}`);
    const dois = roundTrip(um);
    expect(dois).toBe(um);
  });

  it("não confunde barras dentro de bloco de código com tabela", () => {
    const md = "```\n| isto | não | é tabela |\n```";
    const { blocks } = extractProtectedBlocks(md);
    expect(blocks).toHaveLength(0);
  });

  it("exige o separador de cabeçalho para tratar como tabela", () => {
    const { blocks } = extractProtectedBlocks("| a | b |\n| c | d |");
    expect(blocks).toHaveLength(0);
  });

  it("descarta o bloco quando o autor apaga o marcador, sem ressuscitá-lo", () => {
    const { blocks } = extractProtectedBlocks(TABELA);
    expect(blocks).toHaveLength(1);
    // O autor apagou o parágrafo do marcador: a tabela não volta, porque foi
    // uma escolha explícita e não uma perda nossa.
    const semMarcador = restoreProtectedBlocks("Texto sem o marcador.", blocks);
    expect(semMarcador).not.toContain("| Campo |");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Blocos internos de QA
//
// Este filtro existia só no workspace do Replit, dentro do BlockEditor. O
// refactor do editor quase o apagou: o repositório nunca o teve, então trocar o
// arquivo pela versão do repositório fazia a instrumentação de QA reaparecer
// dentro do editor do autor. Estes testes existem para que isso não volte a
// depender de qual cópia do arquivo sobrevive a um merge.
// ═══════════════════════════════════════════════════════════════════════════

describe("stripInternalBlocks", () => {
  it("remove o bloco de QA e para no próximo título de mesmo nível", () => {
    const md = [
      "## Conteúdo do módulo",
      "",
      "Texto que o aluno lê.",
      "",
      "## Nota de Qualidade EduGen",
      "",
      "- Score do módulo: 82",
      "- CRITICAL: falta atividade prática",
      "",
      "## Resumo",
      "",
      "Fecho do módulo.",
    ].join("\n");

    const out = stripInternalBlocks(md);
    expect(out).toContain("## Conteúdo do módulo");
    expect(out).toContain("Texto que o aluno lê.");
    expect(out).toContain("## Resumo");
    expect(out).toContain("Fecho do módulo.");
    expect(out).not.toContain("Nota de Qualidade");
    expect(out).not.toContain("Score do módulo");
    expect(out).not.toContain("CRITICAL");
  });

  it("a linha horizontal também fecha o bloco", () => {
    const md = [
      "### Matriz Objetivo x Conteúdo",
      "",
      "linha interna qualquer",
      "",
      "---",
      "",
      "Texto do aluno.",
    ].join("\n");

    const out = stripInternalBlocks(md);
    expect(out).not.toContain("Matriz Objetivo");
    expect(out).not.toContain("linha interna");
    expect(out).toContain("Texto do aluno.");
  });

  it("linhas soltas de instrumentação somem mesmo fora de bloco", () => {
    const md = [
      "Parágrafo normal.",
      "- WARNING: densidade baixa",
      "1. **Módulo 2** — Feedback: revisar exemplos",
      "- Item de verdade da lista.",
    ].join("\n");

    const out = stripInternalBlocks(md);
    expect(out).toContain("Parágrafo normal.");
    expect(out).toContain("- Item de verdade da lista.");
    expect(out).not.toContain("WARNING");
    expect(out).not.toContain("Feedback:");
  });

  it("não mexe em módulo sem bloco interno nenhum", () => {
    const md = "## Objetivos\n\nAprender a mapear riscos.\n\n- Um\n- Dois";
    expect(stripInternalBlocks(md)).toBe(md);
  });

  it("tabela dentro de bloco interno sai junto, sem virar marcador órfão", () => {
    const md = [
      "## Conteúdo",
      "",
      "Texto do aluno.",
      "",
      "## Nota de Qualidade EduGen",
      "",
      "| Critério | Nota |",
      "|---|---|",
      "| Clareza | 48 |",
      "",
      "## Resumo",
      "",
      "Fecho.",
    ].join("\n");

    const { html, protectedBlocks } = markdownToHtml(stripInternalBlocks(md));
    expect(protectedBlocks).toHaveLength(0);
    expect(html).not.toContain("⟦");
    expect(html).not.toContain("Clareza");
    expect(html).toContain("Texto do aluno.");
    expect(html).toContain("Fecho.");
  });
});
