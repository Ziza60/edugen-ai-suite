import { describe, expect, it } from "vitest";
import { ACOES_IA, MODO_PADRAO, ROTULOS_IA } from "../lib/ai-actions";
import {
  ACOES_IA as ACOES_SERVIDOR,
  ACOES_QUE_INSEREM,
  promptDaAcao,
  promptPersonalizado,
  TRAVAS,
} from "../../supabase/functions/enhance-paragraph/actions";

// ═══════════════════════════════════════════════════════════════════════════
// O menu do editor oferecia dez ações e o servidor tinha instrução para quatro.
// As outras seis caíam num `|| improve`: clicar em "Encurtar" devolvia o texto
// MELHORADO — às vezes maior — e o aviso na tela dizia "Texto encurtado ✨".
// Nas três que inserem conteúdo era pior: o retorno era o módulo reescrito e o
// cliente o anexava, duplicando o módulo dentro dele mesmo.
//
// Nada no código ligava as duas listas, então a divergência não tinha como
// aparecer. É esse elo que estes testes passam a ser.
// ═══════════════════════════════════════════════════════════════════════════

describe("as duas listas de ações não podem divergir", () => {
  it("front e servidor conhecem exatamente as mesmas ações", () => {
    expect([...ACOES_IA].sort()).toEqual([...ACOES_SERVIDOR].sort());
  });

  it("toda ação do menu tem instrução no servidor, nos dois modos", () => {
    for (const acao of ACOES_IA) {
      expect(promptDaAcao(acao, "replace"), `${acao} em replace`).toBeTruthy();
      expect(promptDaAcao(acao, "append"), `${acao} em append`).toBeTruthy();
    }
  });

  it("toda ação tem rótulo para o aviso na tela", () => {
    for (const acao of ACOES_IA) {
      expect(ROTULOS_IA[acao], `rótulo de ${acao}`).toBeTruthy();
    }
  });

  it("nenhum rótulo sobra para ação que não existe", () => {
    expect(Object.keys(ROTULOS_IA).sort()).toEqual([...ACOES_IA].sort());
  });

  it("o modo padrão só é declarado para ações conhecidas", () => {
    for (const acao of Object.keys(MODO_PADRAO)) {
      expect(ACOES_IA).toContain(acao);
    }
  });
});

describe("promptDaAcao", () => {
  it("recusa ação desconhecida em vez de servir outra no lugar", () => {
    // O defeito original: `|| systemPrompts.improve` transformava qualquer
    // ação não prevista numa melhoria de texto, calada.
    expect(promptDaAcao("encurtarr", "replace")).toBeNull();
    expect(promptDaAcao("", "replace")).toBeNull();
    expect(promptDaAcao("custom", "replace")).toBeNull(); // tem caminho próprio
  });

  it("cada ação recebe uma instrução diferente das outras", () => {
    const vistos = new Map<string, string>();
    for (const acao of ACOES_IA) {
      const p = promptDaAcao(acao, "replace")!;
      const anterior = [...vistos.entries()].find(([, texto]) => texto === p);
      expect(anterior, `${acao} repete a instrução de ${anterior?.[0]}`).toBeUndefined();
      vistos.set(acao, p);
    }
  });

  it("as travas de formato acompanham toda instrução", () => {
    for (const acao of ACOES_IA) {
      expect(promptDaAcao(acao, "replace")).toContain(TRAVAS);
    }
    expect(promptPersonalizado("deixe mais formal")).toContain(TRAVAS);
  });

  it("encurtar manda encurtar, e não melhorar", () => {
    const p = promptDaAcao("shorten", "replace")!;
    expect(p).toMatch(/reduza|mais curto/i);
    expect(p).not.toBe(promptDaAcao("improve", "replace"));
  });

  it("aprofundar manda explicar mecanismo, não só alongar", () => {
    expect(promptDaAcao("deepen", "replace")).toMatch(/mecanismo/i);
  });
});

describe("o modo muda o que a IA deve devolver", () => {
  it("as três que inserem pedem SÓ o trecho novo quando anexam", () => {
    for (const acao of ACOES_QUE_INSEREM) {
      const p = promptDaAcao(acao, "append")!;
      expect(p, acao).toMatch(/SOMENTE/);
      expect(p, acao).toMatch(/NÃO repita/i);
    }
  });

  it("as mesmas pedem o texto inteiro quando substituem", () => {
    for (const acao of ACOES_QUE_INSEREM) {
      const p = promptDaAcao(acao, "replace")!;
      expect(p, acao).toMatch(/texto inteiro|por inteiro/i);
      expect(p, acao).not.toMatch(/SOMENTE/);
    }
  });

  it("anexar e substituir dão instruções diferentes nas que inserem", () => {
    for (const acao of ACOES_QUE_INSEREM) {
      expect(promptDaAcao(acao, "append"), acao)
        .not.toBe(promptDaAcao(acao, "replace"));
    }
  });

  it("as demais ações não mudam com o modo — elas sempre reescrevem", () => {
    const demais = ACOES_IA.filter((a) => !ACOES_QUE_INSEREM.includes(a));
    for (const acao of demais) {
      expect(promptDaAcao(acao, "append"), acao)
        .toBe(promptDaAcao(acao, "replace"));
    }
  });

  it("o modo padrão das que inserem é anexar", () => {
    for (const acao of ACOES_QUE_INSEREM) {
      expect(MODO_PADRAO[acao], acao).toBe("append");
    }
  });
});

describe("promptPersonalizado", () => {
  it("carrega a instrução do autor", () => {
    expect(promptPersonalizado("troque os exemplos por casos municipais"))
      .toContain("troque os exemplos por casos municipais");
  });
});
