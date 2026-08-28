import { describe, expect, it } from "vitest";
import {
  APARENCIA_DO_VEREDITO, oQueFalhou, type VerificacaoDoLaudo,
} from "@/lib/laudo-do-curso";

// ═══════════════════════════════════════════════════════════════════════════
// O portão grava um laudo completo a cada curso, e nada disso aparecia no
// produto: para lê-lo era preciso abrir o painel do Supabase e escrever SQL.
// Enquanto ele só bloqueava, dava para viver sem — o veredito rebaixava o
// status e isso já dizia algo. Depois que ele passou a AVISAR nos casos que não
// consegue decidir, um aviso que ninguém lê deixou de ser um aviso.
// ═══════════════════════════════════════════════════════════════════════════

const check = (o: Partial<VerificacaoDoLaudo>): VerificacaoDoLaudo => ({
  id: "x", label: "L", severity: "warning", passed: true, detail: "d", evidence: [], ...o,
});

describe("o que o painel mostra", () => {
  it("mostra só o que falhou — vinte 'ok' escondem os dois que importam", () => {
    const r = oQueFalhou([
      check({ id: "a", passed: true }),
      check({ id: "b", passed: false }),
      check({ id: "c", passed: true }),
    ]);
    expect(r.map((c) => c.id)).toEqual(["b"]);
  });

  it("bloqueador vem antes de aviso", () => {
    const r = oQueFalhou([
      check({ id: "aviso", passed: false, severity: "warning" }),
      check({ id: "bloq", passed: false, severity: "blocker" }),
      check({ id: "aviso2", passed: false, severity: "warning" }),
    ]);
    expect(r[0].id).toBe("bloq");
  });

  it("laudo sem falha nenhuma devolve lista vazia, e não quebra", () => {
    expect(oQueFalhou([check({ passed: true })])).toEqual([]);
    expect(oQueFalhou([])).toEqual([]);
    expect(oQueFalhou(undefined as any)).toEqual([]);
  });

  it("entrada nula no meio da lista não derruba o painel", () => {
    // `checks` vem de uma coluna JSON: o que está gravado hoje pode não ser o
    // que o código espera amanhã.
    expect(oQueFalhou([null as any, check({ id: "b", passed: false })]).map((c) => c.id))
      .toEqual(["b"]);
  });
});

describe("como o veredito é dito", () => {
  it("os três vereditos do portão têm aparência definida", () => {
    for (const v of ["ready", "ready_with_warnings", "needs_review"] as const) {
      expect(APARENCIA_DO_VEREDITO[v]?.texto).toBeTruthy();
    }
  });

  it("needs_review não é dito como reprovação", () => {
    // O portão conhece a estrutura do que chegou, não o mérito do conteúdo.
    const t = APARENCIA_DO_VEREDITO.needs_review.texto.toLowerCase();
    expect(t).toContain("revisar");
    expect(t).not.toMatch(/reprovad|falhou|inválid/);
  });
});
