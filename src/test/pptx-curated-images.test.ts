import { describe, expect, it } from "vitest";
import {
  chaveDeTitulo,
  consultasPendentes,
  escolherImagemDoModulo,
  type FontesDeImagem,
} from "../../supabase/functions/export-pptx-v7/curated-images";

// ═══════════════════════════════════════════════════════════════════════════
// O PPTX buscava foto no Pexels e ignorava a imagem que o autor escolheu no
// app. O autor via uma imagem na tela e o slide trazia outra. Estes testes
// fixam a regra: a curada vence; a busca só entra quando não há curada.
// ═══════════════════════════════════════════════════════════════════════════

const CURADA_1 = "data:image/jpeg;base64,CURADA-MOD-1";
const CURADA_3 = "data:image/jpeg;base64,CURADA-MOD-3";
const BUSCADA = "data:image/jpeg;base64,BUSCADA";

const fontes = (over: Partial<FontesDeImagem> = {}): FontesDeImagem => ({
  curadasPorIndice: [],
  curadasPorTitulo: {},
  buscadas: {},
  ...over,
});

describe("chaveDeTitulo", () => {
  it("ignora caixa, espaços nas pontas e espaços repetidos", () => {
    expect(chaveDeTitulo("  Controles   Internos  ")).toBe("controles internos");
    expect(chaveDeTitulo("CONTROLES INTERNOS")).toBe(chaveDeTitulo("controles internos"));
  });

  it("não estoura com vazio", () => {
    expect(chaveDeTitulo("")).toBe("");
    expect(chaveDeTitulo(undefined as unknown as string)).toBe("");
  });
});

describe("escolherImagemDoModulo", () => {
  it("a imagem curada vence a buscada", () => {
    const r = escolherImagemDoModulo({
      indice: 0,
      titulo: "Fundamentos",
      consultaDeBusca: "internal controls",
      totalDeModulosNoDeck: 1,
      fontes: fontes({
        curadasPorIndice: [CURADA_1],
        buscadas: { "internal controls": BUSCADA },
      }),
    });
    expect(r).toBe(CURADA_1);
  });

  it("sem curada, usa a buscada — quem nunca escolheu imagem não perde nada", () => {
    const r = escolherImagemDoModulo({
      indice: 0,
      titulo: "Fundamentos",
      consultaDeBusca: "Internal Controls",
      totalDeModulosNoDeck: 1,
      fontes: fontes({ buscadas: { "internal controls": BUSCADA } }),
    });
    expect(r).toBe(BUSCADA);
  });

  it("sem nenhuma das duas, devolve indefinido em vez de inventar", () => {
    const r = escolherImagemDoModulo({
      indice: 0,
      titulo: "Fundamentos",
      consultaDeBusca: "nada",
      totalDeModulosNoDeck: 1,
      fontes: fontes(),
    });
    expect(r).toBeUndefined();
  });

  it("casa por índice quando o deck tem os mesmos módulos do curso", () => {
    const f = fontes({ curadasPorIndice: [CURADA_1, undefined, CURADA_3] });
    expect(escolherImagemDoModulo({ indice: 0, titulo: "A", consultaDeBusca: "a", totalDeModulosNoDeck: 3, fontes: f })).toBe(CURADA_1);
    expect(escolherImagemDoModulo({ indice: 1, titulo: "B", consultaDeBusca: "b", totalDeModulosNoDeck: 3, fontes: f })).toBeUndefined();
    expect(escolherImagemDoModulo({ indice: 2, titulo: "C", consultaDeBusca: "c", totalDeModulosNoDeck: 3, fontes: f })).toBe(CURADA_3);
  });

  it("se o planejador mudou a quantidade de módulos, o índice deixa de valer e o título assume", () => {
    // O deck tem 2 módulos e o curso tinha 3: o índice 1 do deck não é mais o
    // módulo 2 do curso. Usar índice aqui poria a imagem no módulo errado.
    const f = fontes({
      curadasPorIndice: [CURADA_1, undefined, CURADA_3],
      curadasPorTitulo: { "encerramento": CURADA_3 },
    });
    const r = escolherImagemDoModulo({
      indice: 1,
      titulo: "Encerramento",
      consultaDeBusca: "closing",
      totalDeModulosNoDeck: 2,
      fontes: f,
    });
    expect(r).toBe(CURADA_3);
  });

  it("o título casa mesmo com caixa e espaçamento diferentes", () => {
    const r = escolherImagemDoModulo({
      indice: 0,
      titulo: "  Gestão   de RISCOS ",
      consultaDeBusca: "risk",
      totalDeModulosNoDeck: 99,
      fontes: fontes({ curadasPorTitulo: { "gestão de riscos": CURADA_1 } }),
    });
    expect(r).toBe(CURADA_1);
  });
});

describe("consultasPendentes", () => {
  const modulos = [
    { titulo: "Fundamentos", consulta: "internal controls" },
    { titulo: "Riscos", consulta: "risk matrix" },
    { titulo: "Encerramento", consulta: "closing" },
  ];

  it("não busca foto para módulo que já tem imagem curada", () => {
    const r = consultasPendentes(modulos, {
      curadasPorIndice: [CURADA_1, undefined, CURADA_3],
      curadasPorTitulo: {},
    });
    expect(r).toEqual(["risk matrix"]);
  });

  it("sem nenhuma curada, busca para todos — comportamento de antes", () => {
    const r = consultasPendentes(modulos, { curadasPorIndice: [], curadasPorTitulo: {} });
    expect(r).toEqual(["internal controls", "risk matrix", "closing"]);
  });

  it("com todas curadas, não faz chamada nenhuma à API", () => {
    const r = consultasPendentes(modulos, {
      curadasPorIndice: [CURADA_1, CURADA_1, CURADA_3],
      curadasPorTitulo: {},
    });
    expect(r).toEqual([]);
  });

  it("reconhece a curada pelo título quando o índice não se alinha", () => {
    const r = consultasPendentes(modulos, {
      curadasPorIndice: [CURADA_1],
      curadasPorTitulo: { riscos: CURADA_3 },
    });
    expect(r).toEqual(["internal controls", "closing"]);
  });
});
