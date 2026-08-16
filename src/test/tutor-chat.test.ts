import { describe, expect, it } from "vitest";

// Import pure helpers directly. The Deno.serve() entry-point is skipped
// because we only test the exported utility functions.
import {
  sanitizeTutorAnswer,
  normalizeTutorCitation,
} from "../../supabase/functions/_shared/tutor-sanitize";

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeTutorAnswer
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeTutorAnswer", () => {
  it("removes opening <TRECHO fonte='...'> tags", () => {
    const input = `<TRECHO fonte="Módulo 1: Fundamentos — trecho 2">\nConteúdo do trecho.\n</TRECHO>`;
    const result = sanitizeTutorAnswer(input);
    expect(result).not.toMatch(/<TRECHO/i);
    expect(result).toContain("Conteúdo do trecho.");
  });

  it("removes closing </TRECHO> tags", () => {
    const input = `Resposta do tutor.\n</TRECHO>`;
    const result = sanitizeTutorAnswer(input);
    expect(result).not.toMatch(/<\/TRECHO>/i);
    expect(result).toContain("Resposta do tutor.");
  });

  it("removes stray fonte=\"...\" attribute fragments", () => {
    const input = `Resposta normal. fonte="Módulo 2: Título — trecho 3" Continua aqui.`;
    const result = sanitizeTutorAnswer(input);
    expect(result).not.toMatch(/fonte="/i);
    expect(result).toContain("Resposta normal.");
    expect(result).toContain("Continua aqui.");
  });

  it("removes 'Fontes usadas:' section when body contains internal tags", () => {
    const input = `Resposta principal aqui.\n\n**Fontes usadas:**\n<TRECHO fonte="Módulo 1: Fundamentos — trecho 2">\n<TRECHO fonte="Módulo 2: COSO — trecho 17">\n`;
    const result = sanitizeTutorAnswer(input);
    expect(result).not.toMatch(/Fontes usadas/i);
    expect(result).not.toMatch(/<TRECHO/i);
    expect(result).toContain("Resposta principal aqui.");
  });

  it("preserves main response content untouched", () => {
    const input = `Os principais conceitos são:\n- controles internos;\n- governança corporativa;\n- COSO.`;
    const result = sanitizeTutorAnswer(input);
    expect(result).toContain("Os principais conceitos são:");
    expect(result).toContain("- controles internos;");
    expect(result).toContain("- COSO.");
  });

  it("collapses excessive blank lines left by removal", () => {
    const input = `Resposta aqui.\n\n\n\n\nFim da resposta.`;
    const result = sanitizeTutorAnswer(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("Resposta aqui.");
    expect(result).toContain("Fim da resposta.");
  });

  it("handles answer with no internal tags unchanged (except trim)", () => {
    const input = `  Resposta limpa sem tags.  `;
    const result = sanitizeTutorAnswer(input);
    expect(result).toBe("Resposta limpa sem tags.");
  });

  it("cache-hit answer containing tags is sanitized before return", () => {
    // Simulates an answer stored before the fix that still has tags
    const cachedAnswer = `Boa pergunta!\n\n**Fontes usadas:**\n<TRECHO fonte="Módulo 1: Intro — trecho 1">\n<TRECHO fonte="Módulo 2: COSO — trecho 3">`;
    const result = sanitizeTutorAnswer(cachedAnswer);
    expect(result).not.toMatch(/<TRECHO/i);
    expect(result).not.toMatch(/fonte="/i);
    expect(result).toContain("Boa pergunta!");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeTutorCitation
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeTutorCitation", () => {
  it("returns plain citation string without any XML tags", () => {
    const raw = `Módulo 1: Fundamentos e Conceitos — trecho 2`;
    const result = normalizeTutorCitation(raw);
    expect(result).toBe("Módulo 1: Fundamentos e Conceitos — trecho 2");
    expect(result).not.toMatch(/<\/?TRECHO/i);
  });

  it("strips <TRECHO ...> wrapper if it appears in the citation string", () => {
    const raw = `<TRECHO fonte="Módulo 1: Fundamentos — trecho 2">`;
    const result = normalizeTutorCitation(raw);
    expect(result).not.toMatch(/<TRECHO/i);
    expect(result).not.toMatch(/fonte="/i);
  });

  it("strips fonte=\"...\" attribute from citation", () => {
    const raw = `fonte="Módulo 2: COSO — trecho 17"`;
    const result = normalizeTutorCitation(raw);
    expect(result).not.toMatch(/fonte="/i);
  });

  it("citations built by buildTutorSnippets are already clean and survive normalization unchanged", () => {
    const clean = `Módulo 3: Desenho e Implementação de Controles — trecho 16`;
    expect(normalizeTutorCitation(clean)).toBe(clean);
  });
});
