import { describe, expect, it } from "vitest";
import {
  getPlanLimits as limitesFront,
  PLAN_LIMITS as LIMITES_FRONT,
} from "../lib/plans";
import {
  getPlanLimits as limitesServidor,
  PLAN_LIMITS as LIMITES_SERVIDOR,
} from "../../supabase/functions/_shared/plans";

// ═══════════════════════════════════════════════════════════════════════════
// Os limites de plano existem em duas cópias — src/lib/plans.ts para o app e
// supabase/functions/_shared/plans.ts para as edge functions — com um "keep in
// sync" no cabeçalho das duas e nada verificando isso.
//
// A divergência que apareceu não foi nos limites, foi no PADRÃO: o app assumia
// "pro" quando não achava assinatura e o servidor assumia "free". Numa conta
// paga cujo carregamento falhasse, a interface liberava recurso de Pro e o
// servidor recusava com o limite do free — "Você usou 3/3 gerações de imagem".
// ═══════════════════════════════════════════════════════════════════════════

describe("as duas cópias dos limites de plano", () => {
  it("cobrem os mesmos planos", () => {
    expect(Object.keys(LIMITES_FRONT).sort())
      .toEqual(Object.keys(LIMITES_SERVIDOR).sort());
  });

  it("declaram exatamente os mesmos limites, com os mesmos valores", () => {
    for (const plano of Object.keys(LIMITES_FRONT)) {
      expect(LIMITES_FRONT[plano as keyof typeof LIMITES_FRONT], `plano ${plano}`)
        .toEqual(LIMITES_SERVIDOR[plano as keyof typeof LIMITES_SERVIDOR]);
    }
  });

  it("nenhum plano ganha campo que o outro lado não conhece", () => {
    for (const plano of Object.keys(LIMITES_FRONT)) {
      const f = LIMITES_FRONT[plano as keyof typeof LIMITES_FRONT];
      const s = LIMITES_SERVIDOR[plano as keyof typeof LIMITES_SERVIDOR];
      expect(Object.keys(f).sort(), `campos de ${plano}`).toEqual(Object.keys(s).sort());
    }
  });
});

describe("o padrão dos dois lados é free", () => {
  it("plano ausente vale free no app e no servidor", () => {
    for (const ausente of [null, undefined]) {
      expect(limitesFront(ausente)).toEqual(LIMITES_FRONT.free);
      expect(limitesServidor(ausente)).toEqual(LIMITES_SERVIDOR.free);
    }
  });

  it("plano desconhecido vale free dos dois lados", () => {
    expect(limitesFront("enterprise")).toEqual(LIMITES_FRONT.free);
    expect(limitesServidor("enterprise")).toEqual(LIMITES_SERVIDOR.free);
  });

  it("o padrão NÃO é pro — era essa a origem do 3/3 numa conta paga", () => {
    expect(limitesFront(null)).not.toEqual(LIMITES_FRONT.pro);
    expect(limitesFront(null).maxImagesPerCourse)
      .toBeLessThan(LIMITES_FRONT.pro.maxImagesPerCourse);
  });

  it("free é mais restrito que pro em pelo menos um recurso pago", () => {
    // Guarda contra alguém "consertar" o padrão igualando free a pro.
    expect(LIMITES_FRONT.free.hasScorm).toBe(false);
    expect(LIMITES_FRONT.pro.hasScorm).toBe(true);
  });
});
