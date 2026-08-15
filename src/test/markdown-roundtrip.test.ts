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
