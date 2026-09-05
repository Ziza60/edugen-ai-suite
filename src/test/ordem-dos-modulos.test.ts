import { describe, expect, it } from "vitest";
import {
  MODULOS_DA_PONTE, elegiveis, podeDespachar,
} from "../../supabase/functions/_shared/course-dispatch";

// ═══════════════════════════════════════════════════════════════════════════
// A ponte de valores lê o que os módulos anteriores JÁ GRAVARAM. Os oito eram
// despachados de uma vez — nos logs de 31/08, as oito chamadas de envelope
// saíram em MENOS DE UM SEGUNDO, e cada módulo só grava sua linha 80 a 116 s
// depois. Quando o módulo 8 começava, nenhum dos sete anteriores tinha escrito
// nada. A ponte estava desligada por construção.
//
// A primeira correção fez uma RAMPA: o módulo 2 esperava o 1, e o resto
// esperava os dois. Três ondas. A do meio custava 73,5 s no curso 5ef3f2c1 e
// não pagava: medido nos sete cursos da bancada, o que a ponte extrai do módulo
// 1 sozinho — tudo o que o módulo 2 chega a receber — são 3 valores somados nos
// sete, e ZERO em cinco deles. Os números do caso nascem no módulo 2.
//
// Agora a barreira é fixa: os dois primeiros saem juntos, o resto espera os
// dois. Os módulos 3+ recebem exatamente o mesmo que antes.
// ═══════════════════════════════════════════════════════════════════════════

const fila = (...estados: string[]) =>
  estados.map((status, module_index) => ({ module_index, status }));
const pendentes = (f: ReturnType<typeof fila>) =>
  elegiveis(f.filter((j) => j.status === "pending"), f).map((j) => j.module_index);

describe("a barreira dos dois primeiros", () => {
  it("no começo, os DOIS primeiros saem juntos", () => {
    // Era aqui que a rampa cobrava: só o módulo 1 saía, e o 2 esperava 73,5 s
    // por valores que, em cinco dos sete cursos medidos, não existem.
    const f = fila("pending", "pending", "pending", "pending");
    expect(elegiveis(f, f).map((j) => j.module_index)).toEqual([0, 1]);
  });

  it("o segundo NÃO espera o primeiro", () => {
    const f = fila("running", "pending", "pending");
    expect(podeDespachar({ module_index: 1, status: "pending" }, f)).toBe(true);
  });

  it("com só um dos dois pronto, o resto continua barrado", () => {
    // A ponte lê TODOS os `order_index < meu`. Soltar o módulo 3 com o módulo 2
    // ainda rodando o faria ler metade do que existe.
    const f = fila("done", "running", "pending", "pending");
    expect(pendentes(f)).toEqual([]);
  });

  it("com os dois prontos, TODO o resto sai junto", () => {
    const f = fila("done", "done", "pending", "pending", "pending", "pending");
    expect(pendentes(f)).toEqual([2, 3, 4, 5]);
  });

  it("o módulo 6 espera pelos dois primeiros, não pelo 5", () => {
    // Depois da barreira o paralelo volta inteiro: esperar em cadeia até o fim
    // custaria ~13 minutos para cobrir só o que a medição mostrou ser falso.
    const f = fila("done", "done", "running", "running", "running", "pending");
    expect(podeDespachar({ module_index: 5, status: "pending" }, f)).toBe(true);
  });
});

describe("o que não pode acontecer", () => {
  it("módulo que falhou de vez não trava os outros", () => {
    // O curso sai capenga, mas sai. Travar tudo transformaria um defeito de um
    // módulo em curso nenhum. `failed` é terminal como `done`.
    const f = fila("failed", "done", "pending", "pending");
    expect(pendentes(f)).toEqual([2, 3]);
    const g = fila("failed", "failed", "pending", "pending");
    expect(pendentes(g)).toEqual([2, 3]);
  });

  it("um dos dois falhado e o outro rodando ainda barra o resto", () => {
    const f = fila("failed", "running", "pending", "pending");
    expect(pendentes(f)).toEqual([]);
  });

  it("uma cadeia interrompida é retomada pela varredura, sem código especial", () => {
    // A elegibilidade é função do ESTADO DA FILA, não de quem despacha. Se o
    // worker do módulo 2 morrer antes de despachar o resto, a varredura de jobs
    // parados chega à mesma conclusão sozinha — ela consulta a fila inteira.
    const f = fila("done", "done", "pending", "pending", "pending");
    expect(pendentes(f)).toEqual([2, 3, 4]);
  });

  it("curso de um módulo só não fica preso", () => {
    const f = fila("pending");
    expect(elegiveis(f, f).map((j) => j.module_index)).toEqual([0]);
  });

  it("curso de dois módulos sai inteiro de uma vez", () => {
    const f = fila("pending", "pending");
    expect(elegiveis(f, f).map((j) => j.module_index)).toEqual([0, 1]);
  });

  it("fila vazia não quebra", () => {
    expect(elegiveis([], [])).toEqual([]);
    expect(podeDespachar({ module_index: 0, status: "pending" }, [])).toBe(true);
  });

  it("a barreira é de dois — se mudar, este teste avisa", () => {
    expect(MODULOS_DA_PONTE).toBe(2);
  });
});
