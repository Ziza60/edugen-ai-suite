import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { condenseForPlanning } from "../../supabase/functions/export-pptx-v7/deck-plan.ts";

// ═══════════════════════════════════════════════════════════════════════════
// O PLANEJADOR NUNCA VIU A ÚLTIMA LIÇÃO DE NENHUM MÓDULO
//
// O deck de 20/11/2026 entregou 18 das 20 lições do curso. "WoG" aparecia 15
// vezes no curso e ZERO nos slides; "FSD", 20 e zero. Eu tinha atribuído isso a
// escolha do planejador sob o teto de slides.
//
// Era corte de cauda. `condenseForPlanning` terminava em
// `condensado.slice(0, maxChars)`, e o planejador só enxerga o que sai daqui.
//
// MEDIDO com o curso real e o orçamento real de 9.000 caracteres, ANTES:
//
//   módulo 1 ... 33.564 → 8.968 ... 2 de 3 lições
//   módulo 2 ... 38.668 → 8.889 ... 2 de 3
//   módulo 3 ... 37.016 → 8.835 ... 2 de 3
//   módulo 4 ... 39.640 → 8.935 ... 2 de 3
//   módulo 5 ... 38.226 → 8.884 ... 2 de 4
//   módulo 6 ... 34.411 → 8.794 ... 2 de 3
//
// Sete de dezenove, sempre as do fim — inclusive "6.3 Estudo de Caso", o fecho
// do curso. Não era escolha: era invisibilidade.
// ═══════════════════════════════════════════════════════════════════════════

const CURSO = readFileSync(
  resolve(process.cwd(), "src/test/cursos-reais/com-fontes/auditoria-definicoes-fieis.md"),
  "utf8",
);
const MODULOS = CURSO.split(/^# /m).slice(1).map((p) => "# " + p);
const licoesDe = (md: string) =>
  [...md.matchAll(/^### (\d+\.\d+ .+)$/gm)].map((m) => m[1]);

describe("o curso real está aqui", () => {
  it("seis módulos, com lições numeradas", () => {
    expect(MODULOS).toHaveLength(6);
    const total = MODULOS.reduce((n, m) => n + licoesDe(m).length, 0);
    expect(total).toBe(19);
    for (const m of MODULOS) expect(m.length).toBeGreaterThan(30_000);
  });
});

describe("nenhuma lição some na condensação", () => {
  it("TODAS as 19 lições sobrevivem ao orçamento real de 9.000", () => {
    const perdidas: string[] = [];
    for (const m of MODULOS) {
      const c = condenseForPlanning(m, 9000);
      for (const l of licoesDe(m)) if (!c.includes(l)) perdidas.push(l);
    }
    expect(perdidas, `lições invisíveis ao planejador:\n${perdidas.join("\n")}`)
      .toEqual([]);
  });

  it("sobrevivem até num orçamento apertado", () => {
    // Com 4.000 o texto fica raso, mas a lição não deixa de existir.
    for (const m of MODULOS) {
      const c = condenseForPlanning(m, 4000);
      for (const l of licoesDe(m)) expect(c, l).toContain(l);
    }
  });

  it("o resultado respeita o orçamento", () => {
    for (const m of MODULOS) {
      expect(condenseForPlanning(m, 9000).length).toBeLessThanOrEqual(9000);
    }
  });

  it("A ÚLTIMA lição de cada módulo sobrevive — era sempre ela que sumia", () => {
    for (const m of MODULOS) {
      const ls = licoesDe(m);
      expect(condenseForPlanning(m, 9000), ls[ls.length - 1])
        .toContain(ls[ls.length - 1]);
    }
  });
});

describe("o que a repartição não pode quebrar", () => {
  it("texto curto passa intacto", () => {
    const curto = "# Módulo\n\n### 1.1 Uma lição\n\nUm parágrafo curto.";
    expect(condenseForPlanning(curto, 9000)).toBe(curto);
  });

  it("texto sem lição nenhuma ainda é cortado, em fronteira de linha", () => {
    const semLicoes = Array.from({ length: 400 }, (_, i) => `linha ${i} com algum texto de preenchimento para passar do teto`).join("\n");
    const c = condenseForPlanning(semLicoes, 2000);
    expect(c.length).toBeLessThanOrEqual(2000);
    expect(c.length).toBeGreaterThan(500);
  });

  it("preâmbulo do módulo não é descartado", () => {
    const m = MODULOS[0];
    const preambulo = m.split("\n")[0];
    expect(condenseForPlanning(m, 9000)).toContain(preambulo);
  });

  it("entrada vazia não quebra", () => {
    expect(condenseForPlanning("", 9000)).toBe("");
  });
});
