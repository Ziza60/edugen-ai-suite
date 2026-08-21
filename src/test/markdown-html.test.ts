import { describe, expect, it } from "vitest";
import { ESTILO_CONTEUDO, markdownParaHtml } from "../../supabase/functions/_shared/markdown-html";

// ═══════════════════════════════════════════════════════════════════════════
// O export-scorm e o export-moodle tinham o MESMO conversor, copiado de um para
// o outro, e nenhum dos dois entendia tabela. As seis tabelas do curso de
// orçamento chegavam ao aluno assim:
//
//   <p>| Poder | Limite | Apurado |</p>
//   <p>| --- | --- | --- |</p>
//
// Sopa de barras verticais. E a lista numerada virava marcador redondo,
// perdendo a ordem, que era justamente o ponto dela.
// ═══════════════════════════════════════════════════════════════════════════

const TABELA = [
  "| Poder | Limite | Apurado |",
  "| --- | --- | --- |",
  "| Executivo | 54% | 51,3% |",
  "| Legislativo | 6% | 4,2% |",
].join("\n");

describe("tabela", () => {
  const html = markdownParaHtml(TABELA);

  it("vira uma tabela de verdade", () => {
    expect(html).toContain("<table");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  it("a primeira linha é cabeçalho, não dado", () => {
    expect(html).toContain("<th>Poder</th>");
    expect(html).not.toContain("<td>Poder</td>");
  });

  it("os dados chegam nas células", () => {
    expect(html).toContain("<td>Executivo</td>");
    expect(html).toContain("<td>51,3%</td>");
  });

  it("a linha de separação não vira conteúdo", () => {
    expect(html).not.toContain("---");
  });

  it("nenhuma barra vertical sobra no texto", () => {
    expect(html).not.toContain("|");
  });

  it("linha com menos células que o cabeçalho não desalinha a coluna", () => {
    const h = markdownParaHtml("| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |");
    expect((h.match(/<td>/g) ?? [])).toHaveLength(3);
  });

  it("texto com barras que NÃO é tabela continua parágrafo", () => {
    // Sem a linha de separação não há tabela — é texto que por acaso tem barras.
    const h = markdownParaHtml("| isto | não é tabela |");
    expect(h).toContain("<p>");
    expect(h).not.toContain("<table");
  });
});

describe("lista numerada — a ordem é o conteúdo", () => {
  const html = markdownParaHtml("1. Previsão\n2. Lançamento\n3. Arrecadação");

  it("vira lista ORDENADA, não marcador redondo", () => {
    expect(html).toContain("<ol");
    expect(html).not.toContain("<ul>");
  });

  it("recebe a classe que desenha a numeração e o fio entre os passos", () => {
    expect(html).toContain('class="eg-passos"');
    expect(ESTILO_CONTEUDO).toContain(".eg-passos li::before");
  });

  it("os três passos estão lá, na ordem", () => {
    const itens = html.match(/<li>([^<]*)<\/li>/g) ?? [];
    expect(itens).toHaveLength(3);
    expect(itens[0]).toContain("Previsão");
    expect(itens[2]).toContain("Arrecadação");
  });

  it("lista com marcador continua sendo lista com marcador", () => {
    const h = markdownParaHtml("- um\n- dois");
    expect(h).toContain("<ul>");
    expect(h).not.toContain("<ol");
  });
});

describe("o resto do markdown", () => {
  it("títulos viram h1..h6 pelo número de cerquilhas", () => {
    expect(markdownParaHtml("## Módulo")).toContain("<h2>Módulo</h2>");
    expect(markdownParaHtml("#### Detalhe")).toContain("<h4>Detalhe</h4>");
  });

  it("citação vira nota destacada, não parágrafo solto", () => {
    const h = markdownParaHtml("> Atenção ao prazo legal.");
    expect(h).toContain('class="eg-nota"');
    expect(h).not.toContain("&gt; Atenção");
  });

  it("bloco de código é preservado sem interpretar o que há dentro", () => {
    const h = markdownParaHtml("```sql\nSELECT * FROM x;\n-- não é lista\n```");
    expect(h).toContain("<pre><code>");
    expect(h).toContain("SELECT * FROM x;");
    expect(h).not.toContain("<li>");
  });

  it("negrito, itálico, código e link funcionam dentro da linha", () => {
    const h = markdownParaHtml("O **PPA** é *anual* e usa `LOA`, veja [a lei](https://x.br).");
    expect(h).toContain("<strong>PPA</strong>");
    expect(h).toContain("<em>anual</em>");
    expect(h).toContain("<code>LOA</code>");
    expect(h).toContain('<a href="https://x.br">a lei</a>');
  });
});

describe("segurança e bordas", () => {
  it("HTML vindo do conteúdo é escapado, não executado", () => {
    const h = markdownParaHtml('<img src=x onerror="alert(1)">');
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img");
  });

  it("escapa também dentro de célula de tabela", () => {
    const h = markdownParaHtml("| A |\n| --- |\n| <script>x</script> |");
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });

  it("vazio devolve vazio", () => {
    expect(markdownParaHtml("")).toBe("");
    expect(markdownParaHtml(null as unknown as string)).toBe("");
  });

  it("toda lista aberta é fechada", () => {
    const h = markdownParaHtml("- a\n- b\n\nParágrafo.\n\n1. x\n2. y");
    expect((h.match(/<ul>/g) ?? []).length).toBe((h.match(/<\/ul>/g) ?? []).length);
    expect((h.match(/<ol/g) ?? []).length).toBe((h.match(/<\/ol>/g) ?? []).length);
  });

  it("tabela no fim do texto, sem linha em branco depois, é fechada", () => {
    const h = markdownParaHtml(TABELA);
    expect(h.trimEnd().endsWith("</table>")).toBe(true);
  });
});
