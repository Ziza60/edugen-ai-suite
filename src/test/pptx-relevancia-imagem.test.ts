import { describe, expect, it } from "vitest";
import {
  consultaUtil,
  escolherFoto,
  fotoCombina,
  palavrasDeConteudo,
} from "../../supabase/functions/export-pptx-v7/image-relevance";

// ═══════════════════════════════════════════════════════════════════════════
// A FOTO QUE NÃO FALAVA DO SLIDE
//
// A busca pedia `per_page=1` e usava a primeira foto que voltasse. O Pexels não
// erra quando a consulta é ruim: devolve uma foto qualquer. E dois pontos do
// planejador caem para o TÍTULO DO MÓDULO em português quando ele não escreve
// imageQuery — "Diagnóstico de Estoque: Entendendo o Mix com a Curva ABC".
// Buscar isso devolve o que calhar, e o que calhar ia para o slide.
//
// Duas coisas estavam sendo jogadas fora: o `alt` do Pexels (e as `tags` do
// Pixabay), que dizem o que a foto mostra, e a chance de simplesmente não
// buscar. Melhor slide sem foto do que slide com foto errada — uma foto
// decorativa que não fala do assunto não é neutra, ela desmente o slide.
// ═══════════════════════════════════════════════════════════════════════════

describe("consultaUtil — o que nem vale buscar", () => {
  it("aceita a cena concreta em inglês que o planejador deveria escrever", () => {
    for (const q of [
      "warehouse inventory shelves",
      "person reviewing documents",
      "team meeting whiteboard",
      "city infrastructure inspection",
      "small grocery store owner",
    ]) {
      expect(consultaUtil(q)).toBe(true);
    }
  });

  it("recusa o título do módulo em português — o caso que gerou isto", () => {
    for (const q of [
      "diagnóstico de estoque: entendendo o mix com a curva abc",
      "otimização de compras: lote econômico e ponto de pedido",
      "gestão de estoque e compras para o pequeno varejo",
    ]) {
      expect(consultaUtil(q)).toBe(false);
    }
  });

  it("recusa pontuação de título mesmo sem acento", () => {
    expect(consultaUtil("inventory control: the basics")).toBe(false);
    expect(consultaUtil("stock analysis (advanced)")).toBe(false);
  });

  it("recusa palavra solta e frase longa", () => {
    expect(consultaUtil("communication")).toBe(false);
    expect(consultaUtil("quality")).toBe(false);
    expect(consultaUtil("a very long sentence describing an entire scene in detail"))
      .toBe(false);
  });

  it("recusa vazio e nulo", () => {
    expect(consultaUtil("")).toBe(false);
    expect(consultaUtil("   ")).toBe(false);
    expect(consultaUtil(null as unknown as string)).toBe(false);
  });

  it("não confunde palavra inglesa com portuguesa", () => {
    // "a", "o", "as" e "no" existem nos dois idiomas. Rejeitá-las tiraria
    // consultas legítimas.
    expect(consultaUtil("person at a desk")).toBe(true);
    expect(consultaUtil("no entry sign")).toBe(true);
  });
});

describe("fotoCombina — a descrição que o acervo devolve", () => {
  it("aceita quando a foto fala do que foi pedido", () => {
    expect(fotoCombina("warehouse inventory shelves", "Boxes on shelves in a warehouse"))
      .toBe(true);
    expect(fotoCombina("person reviewing documents", "A woman reviewing a document at her desk"))
      .toBe(true);
  });

  it("recusa a foto sem relação nenhuma", () => {
    expect(fotoCombina("warehouse inventory shelves", "Sunset over a tropical beach"))
      .toBe(false);
    expect(fotoCombina("team meeting whiteboard", "Close up of a yellow flower"))
      .toBe(false);
  });

  it("plural e singular contam como a mesma palavra", () => {
    expect(fotoCombina("warehouse shelves", "Empty shelf in a storage room")).toBe(true);
  });

  it("ignora acento na descrição", () => {
    expect(fotoCombina("inventory control", "Controle de invéntory num armazém")).toBe(true);
  });

  it("aceita quando o acervo não descreveu — não dá para julgar", () => {
    // Recusar por falta de metadado tiraria imagem boa. Só o Pixabay às vezes
    // devolve hit sem tags.
    expect(fotoCombina("warehouse shelves", "")).toBe(true);
    expect(fotoCombina("warehouse shelves", null as unknown as string)).toBe(true);
  });
});

describe("escolherFoto", () => {
  it("pula as primeiras sem relação e fica com a que fala do assunto", () => {
    const url = escolherFoto("warehouse inventory shelves", [
      { url: "beach.jpg", descricao: "Sunset over a tropical beach" },
      { url: "flower.jpg", descricao: "Close up of a yellow flower" },
      { url: "certo.jpg", descricao: "Cardboard boxes on warehouse shelves" },
    ]);
    expect(url).toBe("certo.jpg");
  });

  it("devolve null quando nenhuma serve — o slide sai sem imagem", () => {
    expect(
      escolherFoto("warehouse inventory shelves", [
        { url: "beach.jpg", descricao: "Sunset over a tropical beach" },
        { url: "flower.jpg", descricao: "Close up of a yellow flower" },
      ]),
    ).toBeNull();
  });

  it("lista vazia devolve null", () => {
    expect(escolherFoto("warehouse shelves", [])).toBeNull();
  });

  it("ignora candidata sem url", () => {
    expect(
      escolherFoto("warehouse shelves", [
        { url: "", descricao: "Cardboard boxes on warehouse shelves" },
        { url: "ok.jpg", descricao: "A shelf in a storage room" },
      ]),
    ).toBe("ok.jpg");
  });
});

describe("palavrasDeConteudo", () => {
  it("tira as palavras que não carregam assunto", () => {
    expect(palavrasDeConteudo("a photo of the warehouse")).toEqual(["warehouse"]);
  });

  it("tira acento e pontuação", () => {
    expect(palavrasDeConteudo("Armazém, estoque!")).toEqual(["armazem", "estoque"]);
  });
});
