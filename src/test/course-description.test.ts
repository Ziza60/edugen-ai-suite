import { describe, expect, it } from "vitest";
import { limparAutoelogio } from "../../supabase/functions/_shared/course-description";

// ═══════════════════════════════════════════════════════════════════════════
// A descrição saía como "Este curso premium é projetado para...". A correção
// anterior tirou a palavra do prompt de arquitetura e escreveu a regra "sem
// adjetivo de autoelogio".
//
// Esta camada nasceu de uma suposição errada minha: interpretei um novo relato
// de "premium" como a regra tendo falhado, quando o relato era de um curso
// ANTIGO, com a descrição já gravada. A regra de prompt segue sem teste real.
//
// A camada fica porque se justifica por si: regra de prompt é tendência, não
// garantia, e esta frase é a vitrine que o comprador lê.
//
// O risco do caminho determinístico é apagar a palavra quando ela é o ASSUNTO
// do curso, e não elogio a ele. Metade destes testes existe por isso.
// ═══════════════════════════════════════════════════════════════════════════

describe("limparAutoelogio — o caso relatado", () => {
  it("tira o premium que qualifica o curso", () => {
    expect(limparAutoelogio(
      "Este curso premium é projetado para capacitar servidores e gestores públicos municipais.",
    )).toBe(
      "Este curso é projetado para capacitar servidores e gestores públicos municipais.",
    );
  });

  it("não deixa espaço dobrado onde a palavra estava", () => {
    expect(limparAutoelogio("Um curso premium para gestores.")).toBe("Um curso para gestores.");
    expect(limparAutoelogio("Este curso premium é bom.")).not.toMatch(/ {2}/);
  });
});

describe("outros adjetivos de vitrine", () => {
  it("pega os que o modelo usaria no lugar de premium", () => {
    expect(limparAutoelogio("Este curso completo ensina...")).toBe("Este curso ensina...");
    expect(limparAutoelogio("Um programa abrangente de gestão."))
      .toBe("Um programa de gestão.");
    expect(limparAutoelogio("Treinamento excepcional para equipes."))
      .toBe("Treinamento para equipes.");
    expect(limparAutoelogio("Material exclusivo sobre riscos."))
      .toBe("Material sobre riscos.");
  });

  it("pega a flexão de gênero e número", () => {
    expect(limparAutoelogio("Uma formação completa em auditoria."))
      .toBe("Uma formação em auditoria.");
    expect(limparAutoelogio("Cursos completos para o setor público."))
      .toBe("Cursos para o setor público.");
    expect(limparAutoelogio("Uma capacitação inovadora."))
      .toBe("Uma capacitação.");
  });

  it("pega o elogio ANTES do substantivo", () => {
    expect(limparAutoelogio("Um completo programa de controles internos."))
      .toBe("Um programa de controles internos.");
  });

  it("pega mais de um na mesma frase", () => {
    expect(limparAutoelogio("Curso premium e material exclusivo."))
      .toBe("Curso e material.");
  });

  it("ignora a caixa das letras", () => {
    expect(limparAutoelogio("Este CURSO PREMIUM é para você.")).toBe("Este CURSO é para você.");
  });
});

describe("não pode destruir curso cujo ASSUNTO é a palavra", () => {
  it("preserva 'premium' quando é o tema, não elogio ao curso", () => {
    // O risco do caminho determinístico: apagar a palavra em qualquer posição
    // arruinaria a descrição de um curso sobre esse mercado.
    const t = "Aprenda a posicionar marcas premium no varejo de luxo.";
    expect(limparAutoelogio(t)).toBe(t);
  });

  it("preserva 'segmento premium' e 'produto premium'", () => {
    for (const t of [
      "Estratégias para o segmento premium do mercado.",
      "Como precificar um produto premium sem perder margem.",
      "Planos premium exigem outra abordagem de venda.",
    ]) {
      expect(limparAutoelogio(t), t).toBe(t);
    }
  });

  it("preserva 'completo' quando qualifica outra coisa", () => {
    const t = "Elabore um diagnóstico completo dos processos da prefeitura.";
    expect(limparAutoelogio(t)).toBe(t);
  });

  it("preserva 'exclusivo' fora do contexto do material", () => {
    const t = "Entenda o regime de dedicação exclusiva no serviço público.";
    expect(limparAutoelogio(t)).toBe(t);
  });
});

describe("bordas", () => {
  it("descrição vazia ou ausente devolve string vazia", () => {
    expect(limparAutoelogio("")).toBe("");
    expect(limparAutoelogio(null)).toBe("");
    expect(limparAutoelogio(undefined)).toBe("");
  });

  it("descrição sem elogio nenhum passa intacta", () => {
    const t = "Ao final, o participante será capaz de elaborar um plano de controles internos.";
    expect(limparAutoelogio(t)).toBe(t);
  });

  it("não deixa espaço antes da pontuação", () => {
    expect(limparAutoelogio("Um curso premium, feito para gestores."))
      .toBe("Um curso, feito para gestores.");
  });

  it("preserva as quebras de linha do texto", () => {
    expect(limparAutoelogio("Curso premium.\n\nSegundo parágrafo."))
      .toBe("Curso.\n\nSegundo parágrafo.");
  });
});
