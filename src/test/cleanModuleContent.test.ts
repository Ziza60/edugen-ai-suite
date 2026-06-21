import { describe, it, expect } from "vitest";
import { cleanModuleContent } from "@/lib/utils";

describe("cleanModuleContent", () => {
  const title = "Módulo 1: Introdução à Cibersegurança no Contexto Educacional";

  it("strips a stray ```markdown fence and the duplicate leading title heading", () => {
    const stored =
      "```markdown\n## Módulo 1: Introdução à Cibersegurança no Contexto Educacional\n\n" +
      "### 🎯 Objetivo do Módulo\n- Compreender o conceito.";
    const out = cleanModuleContent(stored, title);
    expect(out.startsWith("### 🎯 Objetivo")).toBe(true);
    expect(out).not.toContain("```");
    expect(out).not.toMatch(/^## Módulo 1:/m);
  });

  it("matches the title heading regardless of the 'Módulo N:' prefix on either side", () => {
    const stored = "## Módulo 1: Introdução à Cibersegurança no Contexto Educacional\n\ncorpo";
    const out = cleanModuleContent(stored, "Introdução à Cibersegurança no Contexto Educacional");
    expect(out).toBe("corpo");
  });

  it("is idempotent and leaves already-clean content untouched", () => {
    const clean = "### 🧠 Fundamentos\n\nTexto do módulo.";
    expect(cleanModuleContent(clean, title)).toBe(clean);
    expect(cleanModuleContent(cleanModuleContent(clean, title), title)).toBe(clean);
  });

  it("does NOT remove a leading heading that is a real section (not the title)", () => {
    const stored = "### 🎯 Objetivo do Módulo\n- ponto";
    expect(cleanModuleContent(stored, title)).toBe(stored);
  });
});
