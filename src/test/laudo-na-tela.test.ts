import { describe, expect, it } from "vitest";
import {
  APARENCIA_DO_VEREDITO, contagemNaTela, oQueFalhou, type VerificacaoDoLaudo,
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

// ═══════════════════════════════════════════════════════════════════════════
// A COERÊNCIA ENTRE MÓDULOS SAIU DA TELA EM 18/11/2026
//
// MEDIDO nos 14 cursos da bancada, achado a achado, lido no texto: 25 achados,
// 9 verdadeiros, 16 falsos — precisão 36%. E nos dois cursos gerados depois de
// a ficha de valores existir: 14 avisos, TODOS falsos, zero contradição
// verdadeira.
//
// A causa é de desenho: o portão DETECTA números do caso se contradizendo entre
// módulos, e a ficha numerada IMPEDE que isso aconteça. Refinar o detector
// melhoraria um aparelho que já não tem o que detectar.
//
// Um aviso que erra duas em três vezes treina quem lê a ignorar o laudo
// inteiro, bloqueadores incluídos. Ela continua rodando e gravada em
// `course_quality_reports`, e continua alimentando `guardas-do-portao.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

describe("a coerência entre módulos não vai para a tela", () => {
  it("aviso de coerência é escondido", () => {
    const r = oQueFalhou([
      check({ id: "coerencia.valores_entre_modulos", passed: false }),
      check({ id: "coerencia.valores_entre_modulos_inferidos", passed: false }),
      check({ id: "estrutura.tabelas", passed: false }),
    ]);
    expect(r.map((c) => c.id)).toEqual(["estrutura.tabelas"]);
  });

  it("BLOQUEADOR de coerência continua aparecendo", () => {
    // A exclusão olha a severidade, e não o prefixo, exatamente para isto: se
    // um dia a coerência voltar a bloquear, ela volta à tela sem ninguém ter de
    // lembrar de desfazer esta mudança.
    const r = oQueFalhou([
      check({ id: "coerencia.valores_entre_modulos", passed: false, severity: "blocker" }),
    ]);
    expect(r.map((c) => c.id)).toEqual(["coerencia.valores_entre_modulos"]);
  });

  it("os números do cabeçalho contam o que a tela mostra", () => {
    // O portão contaria 3 avisos aqui. A tela mostra 1, e é 1 que ela diz.
    // "2 avisos" ao lado de uma lista com um item é a régua que não olha o que
    // afirma medir — o defeito assinado deste projeto.
    const checks = [
      check({ id: "coerencia.valores_entre_modulos", passed: false }),
      check({ id: "coerencia.valores_entre_modulos_inferidos", passed: false }),
      check({ id: "estrutura.tabelas", passed: false }),
      check({ id: "estrutura.vazamento", passed: false, severity: "blocker" }),
    ];
    expect(contagemNaTela(checks)).toEqual({ bloqueadores: 1, avisos: 1 });
  });

  it("laudo só de coerência aparece como laudo limpo", () => {
    const checks = [
      check({ id: "coerencia.valores_entre_modulos", passed: false }),
      check({ id: "coerencia.valores_entre_modulos_inferidos", passed: false }),
    ];
    expect(oQueFalhou(checks)).toEqual([]);
    expect(contagemNaTela(checks)).toEqual({ bloqueadores: 0, avisos: 0 });
  });

  it("contagemNaTela não quebra com lista vazia ou nula", () => {
    expect(contagemNaTela([])).toEqual({ bloqueadores: 0, avisos: 0 });
    expect(contagemNaTela(undefined as any)).toEqual({ bloqueadores: 0, avisos: 0 });
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
