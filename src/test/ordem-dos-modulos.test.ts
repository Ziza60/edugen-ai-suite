import { describe, expect, it } from "vitest";
import {
  MODULOS_EM_SERIE, elegiveis, podeDespachar,
} from "../../supabase/functions/_shared/course-dispatch";

// ═══════════════════════════════════════════════════════════════════════════
// A ponte de valores lê o que os módulos anteriores JÁ GRAVARAM. Os oito eram
// despachados de uma vez — nos logs de 31/08, as oito chamadas de envelope
// saíram em MENOS DE UM SEGUNDO, e cada módulo só grava sua linha 80 a 116 s
// depois. Quando o módulo 8 começava, nenhum dos sete anteriores tinha escrito
// nada. A ponte estava desligada por construção.
// ═══════════════════════════════════════════════════════════════════════════

const fila = (...estados: string[]) =>
  estados.map((status, module_index) => ({ module_index, status }));

describe("a ordem dos dois primeiros", () => {
  it("no começo, só o módulo 1 sai", () => {
    const f = fila("pending", "pending", "pending", "pending");
    expect(elegiveis(f, f).map((j) => j.module_index)).toEqual([0]);
  });

  it("com o primeiro pronto, sai o segundo — e só ele", () => {
    const f = fila("done", "pending", "pending", "pending");
    expect(elegiveis(f.filter((j) => j.status === "pending"), f).map((j) => j.module_index))
      .toEqual([1]);
  });

  it("com os dois prontos, TODO o resto sai junto", () => {
    const f = fila("done", "done", "pending", "pending", "pending", "pending");
    expect(elegiveis(f.filter((j) => j.status === "pending"), f).map((j) => j.module_index))
      .toEqual([2, 3, 4, 5]);
  });

  it("o módulo 6 espera pelos dois primeiros, não pelo 5", () => {
    // Depois da barreira o paralelo volta inteiro: esperar em cadeia até o fim
    // custaria ~13 minutos para cobrir só o que a medição mostrou ser falso.
    const f = fila("done", "done", "running", "running", "running", "pending");
    expect(podeDespachar({ module_index: 5, status: "pending" }, f)).toBe(true);
  });

  it("o segundo não sai enquanto o primeiro está rodando", () => {
    const f = fila("running", "pending", "pending");
    expect(podeDespachar({ module_index: 1, status: "pending" }, f)).toBe(false);
  });
});

describe("o que não pode acontecer", () => {
  it("módulo que falhou de vez não trava os outros sete", () => {
    // O curso sai capenga, mas sai. Travar tudo transformaria um defeito de um
    // módulo em curso nenhum.
    const f = fila("failed", "pending", "pending", "pending");
    expect(elegiveis(f.filter((j) => j.status === "pending"), f).map((j) => j.module_index))
      .toEqual([1]);
    const g = fila("failed", "failed", "pending", "pending");
    expect(elegiveis(g.filter((j) => j.status === "pending"), g).map((j) => j.module_index))
      .toEqual([2, 3]);
  });

  it("uma cadeia interrompida é retomada pela varredura, sem código especial", () => {
    // A elegibilidade é função do ESTADO DA FILA, não de quem despacha. Se o
    // worker do módulo 1 morrer antes de despachar o 2, a varredura de jobs
    // parados chega à mesma conclusão sozinha.
    const f = fila("done", "pending", "pending");
    expect(elegiveis(f.filter((j) => j.status === "pending"), f).map((j) => j.module_index))
      .toEqual([1]);
  });

  it("curso de um módulo só não fica preso", () => {
    const f = fila("pending");
    expect(elegiveis(f, f).map((j) => j.module_index)).toEqual([0]);
  });

  it("fila vazia não quebra", () => {
    expect(elegiveis([], [])).toEqual([]);
    expect(podeDespachar({ module_index: 0, status: "pending" }, [])).toBe(true);
  });

  it("a barreira é de dois — se mudar, este teste avisa", () => {
    expect(MODULOS_EM_SERIE).toBe(2);
  });
});
