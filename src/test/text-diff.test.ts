import { describe, expect, it } from "vitest";
import {
  agruparEmTrechos,
  contarLinhasAlteradas,
  diffLinhas,
  diffPalavras,
  palavras,
  semelhanca,
} from "../lib/text-diff";

// ═══════════════════════════════════════════════════════════════════════════
// A tela de aprovação mostrava os dois textos lado a lado sem marcar nada: o
// painel da direita vinha com um fundo tingido inteiro, que se lia como
// destaque mas era só a cor do painel. Achar a alteração era trabalho do autor.
// E o contador de linhas alteradas comparava linha 1 com linha 1 — remover uma
// linha no começo fazia todo o resto entrar na conta.
// ═══════════════════════════════════════════════════════════════════════════

const juntarTexto = (ps: { texto: string }[]) => ps.map((p) => p.texto).join("");

describe("diffLinhas", () => {
  it("texto idêntico não tem nenhuma linha marcada", () => {
    const d = diffLinhas("um\ndois\ntrês", "um\ndois\ntrês");
    expect(d).toHaveLength(3);
    expect(d.every((l) => l.tipo === "igual")).toBe(true);
  });

  it("linha inserida no meio marca só ela", () => {
    const d = diffLinhas("um\ntrês", "um\ndois\ntrês");
    expect(d.map((l) => l.tipo)).toEqual(["igual", "adicionada", "igual"]);
    expect(d[1].depois).toBe("dois");
  });

  it("linha removida marca só ela", () => {
    const d = diffLinhas("um\ndois\ntrês", "um\ntrês");
    expect(d.map((l) => l.tipo)).toEqual(["igual", "removida", "igual"]);
    expect(d[1].antes).toBe("dois");
  });

  it("linha inserida no COMEÇO não faz o resto contar como alterado", () => {
    // Era exatamente o que o contador antigo fazia: comparava posição a posição
    // e dizia que tudo tinha mudado.
    const antes = "a\nb\nc\nd\ne";
    const depois = "novo\na\nb\nc\nd\ne";
    expect(contarLinhasAlteradas(antes, depois)).toBe(1);
    // Para efeito de comparação, a conta antiga daria 6.
    const conta = (x: string, y: string) => {
      const bx = x.split("\n"), by = y.split("\n");
      let n = 0;
      for (let i = 0; i < Math.max(bx.length, by.length); i++) {
        if ((bx[i] ?? "") !== (by[i] ?? "")) n++;
      }
      return n;
    };
    expect(conta(antes, depois)).toBe(6);
  });

  it("frase reescrita vira UMA linha alterada, com detalhe por palavra", () => {
    const d = diffLinhas(
      "Este curso premium é projetado para capacitar servidores municipais.",
      "Capacita servidores municipais.",
    );
    expect(d).toHaveLength(1);
    expect(d[0].tipo).toBe("alterada");
    expect(d[0].pedacosAntes).toBeTruthy();
    expect(d[0].pedacosDepois).toBeTruthy();
  });

  it("linhas sem nada em comum ficam como removida + adicionada", () => {
    const d = diffLinhas("gato preto no telhado", "equação diferencial linear");
    expect(d.map((l) => l.tipo)).toEqual(["removida", "adicionada"]);
  });

  it("os pedaços remontam exatamente o texto original", () => {
    // Se remontar diferente, a tela mostra uma coisa e o editor grava outra.
    const antes = "  - **OBJ01.** Identificar os princípios e o arcabouço legal.";
    const depois = "  - **OBJ01.** Identificar o arcabouço legal.";
    const d = diffLinhas(antes, depois);
    expect(d[0].tipo).toBe("alterada");
    expect(juntarTexto(d[0].pedacosAntes!)).toBe(antes);
    expect(juntarTexto(d[0].pedacosDepois!)).toBe(depois);
  });

  it("texto vazio de um lado marca tudo do outro", () => {
    expect(diffLinhas("", "a\nb").map((l) => l.tipo)).toEqual(["adicionada", "adicionada"]);
    expect(diffLinhas("a\nb", "").map((l) => l.tipo)).toEqual(["removida", "removida"]);
  });

  it("aguenta texto grande sem travar", () => {
    const antes = Array.from({ length: 3000 }, (_, i) => `linha ${i}`).join("\n");
    const depois = antes.replace("linha 1500", "linha 1500 editada");
    const inicio = Date.now();
    expect(contarLinhasAlteradas(antes, depois)).toBe(1);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});

describe("diffPalavras", () => {
  it("marca só as palavras que mudaram", () => {
    const [a, d] = diffPalavras("o gato preto dorme", "o gato branco dorme");
    expect(a.filter((p) => p.tipo === "removido").map((p) => p.texto)).toEqual(["preto"]);
    expect(d.filter((p) => p.tipo === "adicionado").map((p) => p.texto)).toEqual(["branco"]);
  });

  it("preserva a indentação, que em markdown muda o sentido da linha", () => {
    const antes = "    - item recuado";
    const [a] = diffPalavras(antes, "- item recuado");
    expect(juntarTexto(a)).toBe(antes);
  });

  it("funde pedaços vizinhos do mesmo tipo", () => {
    const [, d] = diffPalavras("a", "a b c d");
    const adicionados = d.filter((p) => p.tipo === "adicionado");
    expect(adicionados).toHaveLength(1);
    expect(adicionados[0].texto.trim()).toBe("b c d");
  });

  it("linha sem mudança não marca nada", () => {
    const [a, d] = diffPalavras("igual dos dois lados", "igual dos dois lados");
    expect(a.every((p) => p.tipo === "igual")).toBe(true);
    expect(d.every((p) => p.tipo === "igual")).toBe(true);
  });
});

describe("palavras", () => {
  it("guarda os espaços como itens próprios", () => {
    expect(palavras("a  b")).toEqual(["a", "  ", "b"]);
    expect(palavras("a  b").join("")).toBe("a  b");
  });

  it("string vazia devolve lista vazia", () => {
    expect(palavras("")).toEqual([]);
  });
});

describe("semelhanca", () => {
  it("frases iguais valem 1", () => {
    expect(semelhanca("mesma frase", "mesma frase")).toBe(1);
  });

  it("frases sem nada em comum valem 0", () => {
    expect(semelhanca("gato preto", "equação linear")).toBe(0);
  });

  it("reescrita parcial fica no meio", () => {
    const s = semelhanca(
      "Elaborar um plano de gestão adequado à realidade municipal",
      "Elaborar planos de gestão municipais",
    );
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(1);
  });
});

describe("agruparEmTrechos", () => {
  it("esconde os blocos longos sem alteração", () => {
    // O ponto da queixa: num módulo inteiro, o que mudou é uma fração pequena.
    const antes = Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n");
    const depois = antes.replace("linha 20", "linha 20 alterada");
    const trechos = agruparEmTrechos(diffLinhas(antes, depois));
    expect(trechos).toHaveLength(1);
    expect(trechos[0].linhas.length).toBeLessThanOrEqual(5); // 1 alterada + contexto
    expect(trechos[0].ocultasAntes).toBeGreaterThan(15);
  });

  it("mantém contexto dos dois lados da alteração", () => {
    const antes = "a\nb\nc\numa frase original aqui\ne\nf\ng";
    const depois = "a\nb\nc\numa frase reescrita aqui\ne\nf\ng";
    const [t] = agruparEmTrechos(diffLinhas(antes, depois), 2);
    expect(t.linhas.map((l) => l.tipo)).toEqual(["igual", "igual", "alterada", "igual", "igual"]);
  });

  it("alterações distantes viram trechos separados", () => {
    const linhas = Array.from({ length: 40 }, (_, i) => `l${i}`);
    const antes = linhas.join("\n");
    const depois = linhas.map((l, i) => (i === 3 || i === 30 ? `${l}!` : l)).join("\n");
    expect(agruparEmTrechos(diffLinhas(antes, depois))).toHaveLength(2);
  });

  it("sem alteração nenhuma não devolve trecho", () => {
    expect(agruparEmTrechos(diffLinhas("a\nb", "a\nb"))).toEqual([]);
  });

  it("alterações vizinhas ficam no mesmo trecho", () => {
    const antes = "a\nb\nc\nd\ne";
    const depois = "a\nB\nc\nD\ne";
    expect(agruparEmTrechos(diffLinhas(antes, depois))).toHaveLength(1);
  });
});

describe("bloco de linhas reescritas de uma vez", () => {
  // O alinhamento devolve TODAS as removidas e só então as adicionadas. Casando
  // apenas o par encostado, só uma das linhas ganhava marcação por palavra e o
  // resto do bloco aparecia sem destaque nenhum, com um buraco do outro lado.
  const antes = [
    "- **OBJ01.** Identificar os princípios e o arcabouço legal dos controles internos municipais.",
    "- **OBJ02.** Analisar os componentes de um sistema de controle interno eficaz, como o COSO.",
    "- **OBJ03.** Aplicar metodologias de mapeamento e avaliação de riscos na gestão municipal.",
  ].join("\n");
  const depois = [
    "- **OBJ01.** Identificar o arcabouço legal dos controles internos municipais.",
    "- **OBJ02.** Analisar componentes de sistemas de controle eficazes (ex: COSO).",
    "- **OBJ03.** Aplicar mapeamento e avaliação de riscos na gestão municipal.",
  ].join("\n");

  it("todas as linhas do bloco viram 'alterada'", () => {
    const d = diffLinhas(antes, depois);
    expect(d).toHaveLength(3);
    expect(d.every((l) => l.tipo === "alterada")).toBe(true);
  });

  it("todas ganham marcação por palavra — em pelo menos um dos lados", () => {
    // Não dá para exigir marca verde em toda linha: o OBJ03 aqui só PERDE
    // palavras ("metodologias de"), nada entra no lugar. A linha continua
    // marcada como alterada pela faixa lateral; o destaque por palavra aparece
    // do lado em que houve mexida.
    for (const l of diffLinhas(antes, depois)) {
      const marcou = l.pedacosAntes!.some((p) => p.tipo === "removido") ||
        l.pedacosDepois!.some((p) => p.tipo === "adicionado");
      expect(marcou, `linha: ${l.antes}`).toBe(true);
    }
  });

  it("linha que só perde palavras marca o lado esquerdo e deixa o direito limpo", () => {
    const d = diffLinhas(
      "- **OBJ03.** Aplicar metodologias de mapeamento e avaliação de riscos.",
      "- **OBJ03.** Aplicar mapeamento e avaliação de riscos.",
    );
    expect(d[0].tipo).toBe("alterada");
    expect(d[0].pedacosAntes!.filter((p) => p.tipo === "removido").map((p) => p.texto.trim()))
      .toEqual(["metodologias de"]);
    expect(d[0].pedacosDepois!.every((p) => p.tipo === "igual")).toBe(true);
  });

  it("cada linha casa com a sua par, não com a vizinha", () => {
    const d = diffLinhas(antes, depois);
    expect(d[0].antes).toContain("OBJ01");
    expect(d[0].depois).toContain("OBJ01");
    expect(d[2].antes).toContain("OBJ03");
    expect(d[2].depois).toContain("OBJ03");
  });

  it("bloco com mais removidas que adicionadas deixa a sobra como removida", () => {
    const d = diffLinhas("linha um aqui\nlinha dois aqui\nlinha três aqui", "linha um agora");
    expect(d.filter((l) => l.tipo === "alterada")).toHaveLength(1);
    expect(d.filter((l) => l.tipo === "removida")).toHaveLength(2);
  });

  it("linha do bloco que não se parece com a par não é forçada a casar", () => {
    const d = diffLinhas(
      "uma frase bem parecida aqui\noutra coisa completamente diferente",
      "uma frase bem parecida agora\nequação diferencial de segunda ordem",
    );
    expect(d.filter((l) => l.tipo === "alterada")).toHaveLength(1);
    expect(d.filter((l) => l.tipo === "removida")).toHaveLength(1);
    expect(d.filter((l) => l.tipo === "adicionada")).toHaveLength(1);
  });
});
