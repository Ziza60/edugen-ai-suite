import { describe, expect, it, vi } from "vitest";
import {
  gerarLicoesEmSerieQuandoCabe,
  textoDaLicao,
} from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O PÃO FRANCÊS COM DOIS CUSTOS
//
// Curso de precificação, 24/08. Página 27: pão francês, custo variável
// R$ 0,35, margem 56,25%. Página 30, mesmo módulo, mesmo pão, mesma padaria:
// custo variável R$ 0,55, margem 31,25%.
//
// As lições de um módulo rodavam todas em paralelo, cada uma cega para o que as
// irmãs estavam escrevendo. A ponte de valores só cobria de módulo para módulo.
//
// Os logs do mesmo dia deram os números para decidir: lição de 12,5 a 26,7 s,
// pós-lições de 10,0 a 49,2 s. Serializado, o pior módulo medido dá 111,4 s —
// não cabia nos 110 s de então, e cabe nos 125 s de agora.
// ═══════════════════════════════════════════════════════════════════════════

/** Relógio de mentira: cada lição consome o que o teste mandar. */
function relogio(inicial: number) {
  let restante = inicial;
  return {
    msLeft: () => restante,
    gastar: (ms: number) => {
      restante -= ms;
    },
  };
}

function planos(n: number) {
  return Array.from({ length: n }, (_, i) => ({ lesson_number: `1.${i + 1}` }));
}

describe("gerarLicoesEmSerieQuandoCabe", () => {
  it("com folga, roda tudo em série e na ordem", async () => {
    const r = relogio(125_000);
    const ordem: string[] = [];
    const vistos: string[][] = [];
    const acumulado: string[] = [];

    const out = await gerarLicoesEmSerieQuandoCabe(
      planos(3),
      async (p: any) => {
        vistos.push([...acumulado]);
        ordem.push(p.lesson_number);
        r.gastar(20_000);
        return { n: p.lesson_number };
      },
      r.msLeft,
      (res: any) => acumulado.push(res.n),
    );

    expect(ordem).toEqual(["1.1", "1.2", "1.3"]);
    expect(out).toHaveLength(3);
    // O ponto da serialização: cada lição vê o que as anteriores fixaram.
    expect(vistos).toEqual([[], ["1.1"], ["1.1", "1.2"]]);
  });

  it("sem folga e com duas ou mais pela frente, o resto vai em paralelo", async () => {
    // Sobra pouco: a primeira roda em série, e as duas seguintes já não cabem.
    const r = relogio(90_000);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const emSerie: string[] = [];

    const out = await gerarLicoesEmSerieQuandoCabe(
      planos(3),
      async (p: any) => {
        r.gastar(25_000);
        return { n: p.lesson_number };
      },
      r.msLeft,
      (res: any) => emSerie.push(res.n),
    );

    expect(out).toHaveLength(3);
    // Só a primeira alimentou o acumulado; as outras duas correram juntas.
    expect(emSerie).toEqual(["1.1"]);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("em paralelo");
    log.mockRestore();
  });

  it("com uma só pela frente, roda em série mesmo sem folga", async () => {
    // Paralelizar uma lição sozinha não economiza nada e ainda perde a
    // coerência. A guarda só dispara com duas ou mais restantes.
    const r = relogio(10_000);
    const acumulado: string[] = [];
    const out = await gerarLicoesEmSerieQuandoCabe(
      planos(1),
      async (p: any) => ({ n: p.lesson_number }),
      r.msLeft,
      (res: any) => acumulado.push(res.n),
    );
    expect(out).toHaveLength(1);
    expect(acumulado).toEqual(["1.1"]);
  });

  it("lição que volta nula não alimenta o acumulado", async () => {
    const r = relogio(125_000);
    const acumulado: unknown[] = [];
    const out = await gerarLicoesEmSerieQuandoCabe(
      planos(2),
      async () => null,
      r.msLeft,
      (res) => acumulado.push(res),
    );
    expect(out).toEqual([null, null]);
    expect(acumulado).toEqual([]);
  });

  it("lista vazia devolve lista vazia", async () => {
    const r = relogio(125_000);
    expect(
      await gerarLicoesEmSerieQuandoCabe([], async () => 1, r.msLeft, () => {}),
    ).toEqual([]);
  });

  it("preserva a ordem das lições mesmo com parte em paralelo", async () => {
    const r = relogio(88_000);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await gerarLicoesEmSerieQuandoCabe(
      planos(4),
      async (p: any) => {
        r.gastar(20_000);
        return p.lesson_number;
      },
      r.msLeft,
      () => {},
    );
    expect(out).toEqual(["1.1", "1.2", "1.3", "1.4"]);
    log.mockRestore();
  });
});

describe("textoDaLicao", () => {
  it("junta as strings do JSON aninhado com linha em branco", () => {
    const licao = {
      title: "Margem de Contribuição",
      blocks: [
        { type: "explanation", paragraphs: ["O Custo Variável é R$ 0,35."] },
        { type: "table", rows: [{ cells: ["Preço", "R$ 0,80"] }] },
      ],
    };
    const t = textoDaLicao(licao);
    expect(t).toContain("O Custo Variável é R$ 0,35.");
    expect(t).toContain("R$ 0,80");
    // Os parágrafos precisam ficar separados: a extração de valores procura o
    // número na MESMA frase do termo, parágrafo a parágrafo.
    expect(t).toContain("\n\n");
  });

  it("ignora números e booleanos, que não carregam frase", () => {
    expect(textoDaLicao({ a: 1, b: true, c: "texto" })).toBe("texto");
  });

  it("vazio e nulo não quebram", () => {
    expect(textoDaLicao(null)).toBe("");
    expect(textoDaLicao({})).toBe("");
    expect(textoDaLicao([])).toBe("");
  });
});
