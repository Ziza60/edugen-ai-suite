import { describe, expect, it } from "vitest";
import {
  sanitizePdfInlineText,
  sanitizePdfBlockText,
  sanitizePdfTableCell,
  sanitizePdfHeading,
  normalizeCourseTitle,
  detectFormulaBlock,
  truncateCellLines,
  decodeHtmlEntities,
  normalizeBoldLabels,
  stripHtml,
  stripMarkdown,
} from "../../supabase/functions/_shared/pdf-sanitize";

describe("sanitizePdfTableCell", () => {
  it("removes <br> HTML tag", () => {
    const result = sanitizePdfTableCell("<br>texto");
    expect(result).not.toContain("<br>");
    expect(result).not.toContain("<");
    expect(result).toContain("texto");
  });

  it("removes self-closing <br/> tag", () => {
    const result = sanitizePdfTableCell("linha1<br/>linha2");
    expect(result).not.toContain("<br/>");
    expect(result).not.toContain("<");
  });

  it("replaces pipe characters with slash", () => {
    const result = sanitizePdfTableCell("A | B | C");
    expect(result).not.toContain("|");
    expect(result).toContain("/");
  });

  it("collapses to single line", () => {
    const result = sanitizePdfTableCell("linha1\nlinha2");
    expect(result).not.toContain("\n");
  });
});

describe("sanitizePdfBlockText", () => {
  it("removes Formula residue with asterisks", () => {
    const result = sanitizePdfBlockText("Formula *Fórmula: ROI = (G - C) / C**");
    expect(result).not.toContain("**");
    expect(result).not.toContain("Formula *");
    expect(result).not.toContain("Fórmula:");
  });

  it("removes **bold** markdown but preserves text", () => {
    const result = sanitizePdfBlockText("**Resultado:** operação concluída com sucesso");
    expect(result).not.toContain("**");
    expect(result).toContain("Resultado:");
    expect(result).toContain("operação concluída");
  });

  it("converts <br> to newline preserving line breaks", () => {
    const result = sanitizePdfBlockText("linha1<br>linha2");
    expect(result).not.toContain("<br>");
    expect(result).toContain("linha1");
    expect(result).toContain("linha2");
  });

  it("preserves Solução: and Resultado: as clean text labels", () => {
    const result = sanitizePdfBlockText("**Solução:** aplicar a fórmula corretamente.");
    expect(result).not.toContain("**");
    expect(result).toContain("Solução:");
  });
});

describe("sanitizePdfInlineText", () => {
  it("collapses multi-line text to a single line", () => {
    const result = sanitizePdfInlineText("texto\n\nmais texto");
    expect(result).not.toContain("\n");
    expect(result).toContain("texto");
    expect(result).toContain("mais texto");
  });

  it("decodes HTML entities", () => {
    const result = sanitizePdfInlineText("Tom&amp;Jerry &lt;protagonistas&gt;");
    expect(result).toContain("Tom&Jerry");
    expect(result).not.toContain("&amp;");
  });
});

describe("sanitizePdfHeading", () => {
  it("strips leading numbering like '1. '", () => {
    const result = sanitizePdfHeading("1. Introdução ao tema");
    expect(result).not.toMatch(/^\d+\./);
    expect(result).toContain("Introdução");
  });

  it("strips leading numbering like '2) '", () => {
    const result = sanitizePdfHeading("2) Conceitos Avançados");
    expect(result).not.toMatch(/^\d+\)/);
    expect(result).toContain("Conceitos");
  });

  it("capitalizes first letter", () => {
    const result = sanitizePdfHeading("fundamentos de python");
    expect(result[0]).toBe(result[0].toUpperCase());
  });
});

describe("normalizeCourseTitle", () => {
  it("removes prompt prefix 'Crie um curso sobre'", () => {
    const result = normalizeCourseTitle("Crie um curso sobre Python");
    expect(result).not.toMatch(/\bCrie\b/i);
    expect(result).toContain("Python");
  });

  it("removes prompt prefix 'Gere um treinamento de'", () => {
    const result = normalizeCourseTitle("Gere um treinamento de Excel");
    expect(result).not.toMatch(/\bGere\b/i);
    expect(result).toContain("Excel");
  });

  it("removes surrounding quotes", () => {
    const result = normalizeCourseTitle('"Python para iniciantes"');
    expect(result).not.toContain('"');
    expect(result).toContain("Python");
  });

  it("falls back to theme when title is empty", () => {
    const result = normalizeCourseTitle("", "Controles Internos");
    expect(result).toBe("Controles Internos");
  });

  it("returns 'Curso sem título' when both are empty", () => {
    const result = normalizeCourseTitle("");
    expect(result).toBe("Curso sem título");
  });

  it("truncates titles longer than 90 chars", () => {
    const longTitle = "A".repeat(95);
    const result = normalizeCourseTitle(longTitle);
    expect(result.length).toBeLessThanOrEqual(90);
  });
});

describe("detectFormulaBlock", () => {
  it("detects '**Fórmula:** ROI = (G - C) / C' and returns clean expression", () => {
    const result = detectFormulaBlock("**Fórmula:** ROI = (G - C) / C");
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Fórmula");
    expect(result!.expression).not.toContain("**");
    expect(result!.expression).toContain("ROI");
    expect(result!.expression).toContain("=");
  });

  it("detects 'Formula: VPL = Soma(Fluxo / (1+i)^t)'", () => {
    const result = detectFormulaBlock("Formula: VPL = Soma(Fluxo / (1+i)^t)");
    expect(result).not.toBeNull();
    expect(result!.expression).toContain("VPL");
  });

  it("returns null for normal text without formula pattern", () => {
    expect(detectFormulaBlock("texto normal sem fórmula")).toBeNull();
  });

  it("returns null for formula label with no expression containing operator", () => {
    expect(detectFormulaBlock("Fórmula: simples")).toBeNull();
  });
});

describe("truncateCellLines", () => {
  it("returns original lines when under limit", () => {
    const lines = ["a", "b", "c"];
    expect(truncateCellLines(lines, 5)).toEqual(lines);
  });

  it("truncates and adds ellipsis when over limit", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const result = truncateCellLines(lines, 8);
    expect(result.length).toBe(8);
    expect(result[result.length - 1]).toContain("…");
  });
});

describe("normalizeBoldLabels", () => {
  it("converts **Solução:** to Solução:", () => {
    const result = normalizeBoldLabels("**Solução:** aplicar o conceito");
    expect(result).not.toContain("**");
    expect(result).toContain("Solução:");
  });

  it("converts **Resultado:** to Resultado:", () => {
    const result = normalizeBoldLabels("**Resultado:** operação bem-sucedida");
    expect(result).toContain("Resultado:");
    expect(result).not.toContain("**");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes &amp; &lt; &gt; &nbsp;", () => {
    const result = decodeHtmlEntities("A &amp; B &lt;test&gt; C&nbsp;D");
    expect(result).toContain("A & B <test> C D");
  });

  it("decodes numeric entities &#169; → ©", () => {
    const result = decodeHtmlEntities("&#169; 2024");
    expect(result).toContain("© 2024");
  });
});

describe("stripHtml", () => {
  it("converts <br> to newline", () => {
    const result = stripHtml("linha1<br>linha2");
    expect(result).toContain("\n");
    expect(result).not.toContain("<br>");
  });

  it("removes arbitrary HTML tags", () => {
    const result = stripHtml("<strong>negrito</strong> e <em>itálico</em>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("negrito");
    expect(result).toContain("itálico");
  });
});
