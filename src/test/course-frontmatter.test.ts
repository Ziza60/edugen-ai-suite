import { describe, expect, it } from "vitest";
import { splitCourseOverview } from "../../supabase/functions/_shared/course-frontmatter";

// ═══════════════════════════════════════════════════════════════════════════
// Reproduzido em dois PDFs de cursos diferentes: sob o divisor "MÓDULO 1" vinha
// a apresentação do curso inteiro — visão geral, competência final, os seis
// objetivos, habilidades, pré-requisitos e o mapa de termos — e só cinco páginas
// depois começava a lição 1.1. Módulos 2 a 5 corretos nos dois.
// ═══════════════════════════════════════════════════════════════════════════

const MODULO_1 = [
  "## Visão geral do curso",
  "",
  "Este curso capacita profissionais da administração pública.",
  "",
  "### Competência final",
  "",
  "Liderar a implementação de controles internos.",
  "",
  "### Objetivos do curso",
  "",
  "- **CO01.** Analisar os fundamentos.",
  "- **CO02.** Avaliar a adequação.",
  "",
  "### Mapa de termos essenciais",
  "",
  "| Termo | Definição | Primeiro módulo |",
  "| --- | --- | --- |",
  "| Controles Internos | Processo efetuado pela alta administração. | 1 |",
  "",
  "## Compreendendo os Fundamentos dos Controles Internos",
  "",
  "Neste módulo você vai entender o arcabouço legal.",
  "",
  "### 1.1 O que são controles internos",
  "",
  "> **Objetivo da lição:** Definir controles internos.",
].join("\n");

const MODULO_2 = [
  "## Mapeamento e Avaliação de Riscos",
  "",
  "No Módulo 1, exploramos os fundamentos.",
  "",
  "### 2.1 Identificando riscos",
].join("\n");

describe("splitCourseOverview", () => {
  it("separa a apresentação do conteúdo do Módulo 1", () => {
    const { apresentacao, modulo } = splitCourseOverview(MODULO_1);

    expect(apresentacao).not.toBeNull();
    expect(apresentacao).toContain("## Visão geral do curso");
    expect(apresentacao).toContain("### Competência final");
    expect(apresentacao).toContain("**CO01.**");
    expect(apresentacao).toContain("### Mapa de termos essenciais");
    expect(apresentacao).toContain("| Controles Internos |");

    // E nada do módulo vaza para a apresentação.
    expect(apresentacao).not.toContain("Compreendendo os Fundamentos");
    expect(apresentacao).not.toContain("1.1");
  });

  it("o módulo começa no próprio título, sem a apresentação", () => {
    const { modulo } = splitCourseOverview(MODULO_1);

    expect(modulo.startsWith("## Compreendendo os Fundamentos")).toBe(true);
    expect(modulo).toContain("### 1.1 O que são controles internos");
    expect(modulo).not.toContain("Visão geral do curso");
    expect(modulo).not.toContain("CO01");
    expect(modulo).not.toContain("Mapa de termos");
  });

  it("a tabela do mapa de termos vai inteira para a apresentação", () => {
    const { apresentacao } = splitCourseOverview(MODULO_1);
    const linhasTabela = (apresentacao ?? "").split("\n").filter((l) => l.trim().startsWith("|"));
    expect(linhasTabela).toHaveLength(3); // cabeçalho + separador + uma linha
  });

  it("módulo sem apresentação passa intacto", () => {
    const { apresentacao, modulo } = splitCourseOverview(MODULO_2);
    expect(apresentacao).toBeNull();
    expect(modulo).toBe(MODULO_2);
  });

  it("apresentação no meio do texto não é tocada — é escolha do autor", () => {
    const md = [
      "## Introdução do módulo",
      "",
      "Texto.",
      "",
      "## Visão geral do curso",
      "",
      "O autor colou isto aqui de propósito.",
    ].join("\n");
    const { apresentacao, modulo } = splitCourseOverview(md);
    expect(apresentacao).toBeNull();
    expect(modulo).toBe(md);
  });

  it("sem um segundo título de nível 2, nada é separado", () => {
    // Separar deixaria o módulo vazio, e página em branco é pior que ordem errada.
    const md = "## Visão geral do curso\n\nSó a apresentação, sem módulo.";
    const { apresentacao, modulo } = splitCourseOverview(md);
    expect(apresentacao).toBeNull();
    expect(modulo).toBe(md);
  });

  it("aguenta linhas em branco no começo e CRLF", () => {
    const { apresentacao, modulo } = splitCourseOverview(
      "\n\n" + MODULO_1.replace(/\n/g, "\r\n"),
    );
    expect(apresentacao).toContain("## Visão geral do curso");
    expect(modulo.startsWith("## Compreendendo")).toBe(true);
  });

  it("conteúdo vazio ou nulo não estoura", () => {
    expect(splitCourseOverview("")).toEqual({ apresentacao: null, modulo: "" });
    expect(splitCourseOverview(undefined as unknown as string).apresentacao).toBeNull();
  });

  it("nada se perde: apresentação + módulo cobrem o texto original", () => {
    const { apresentacao, modulo } = splitCourseOverview(MODULO_1);
    const semEspacos = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(semEspacos(`${apresentacao}\n${modulo}`)).toBe(semEspacos(MODULO_1));
  });
});
