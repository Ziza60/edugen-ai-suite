import { describe, expect, it } from "vitest";
import { descricaoDoTom, TONS_CONHECIDOS } from "../../supabase/functions/_shared/course-tone";

// ═══════════════════════════════════════════════════════════════════════════
// A pergunta "Que tom você prefere?" mandava ao modelo uma palavra solta:
// "- Tom: didatico". Sem acento, sem explicação e sem nenhuma regra depois que
// a sustentasse. Pior: o rótulo do botão não batia com o valor — "Prático"
// enviava "didatico" e "Conversacional" enviava "direto".
//
// E a ironia: quem NÃO escolhia tom nenhum recebia o padrão "profissional,
// claro e acessível", uma frase inteira. Escolher entregava ao modelo menos
// informação do que não escolher.
// ═══════════════════════════════════════════════════════════════════════════

describe("descricaoDoTom — a etiqueta vira instrução", () => {
  it("todo tom conhecido devolve instrução, não a palavra de volta", () => {
    for (const slug of TONS_CONHECIDOS) {
      const d = descricaoDoTom(slug);
      expect(d, slug).not.toBe(slug);
      expect(d.length, slug).toBeGreaterThan(40);
    }
  });

  it("os dois rótulos que estavam trocados agora existem por si", () => {
    expect(descricaoDoTom("pratico")).toMatch(/exemplo/i);
    expect(descricaoDoTom("conversacional")).toMatch(/você/i);
  });

  it("prático e didático não dizem a mesma coisa — era esse o engano", () => {
    expect(descricaoDoTom("pratico")).not.toBe(descricaoDoTom("didatico"));
  });

  it("conversacional e direto não dizem a mesma coisa", () => {
    expect(descricaoDoTom("conversacional")).not.toBe(descricaoDoTom("direto"));
  });
});

describe("descricaoDoTom — compatibilidade com o que já está gravado", () => {
  it("cursos antigos guardaram 'didatico' e 'direto'; continuam valendo", () => {
    expect(descricaoDoTom("didatico")).toMatch(/didático/i);
    expect(descricaoDoTom("direto")).toMatch(/direto/i);
  });

  it("aceita o valor acentuado e a caixa alta", () => {
    expect(descricaoDoTom("Didático")).toBe(descricaoDoTom("didatico"));
    expect(descricaoDoTom("ACADEMICO")).toBe(descricaoDoTom("academico"));
  });
});

describe("descricaoDoTom — bordas", () => {
  it("vazio cai no profissional, como antes", () => {
    expect(descricaoDoTom("")).toBe(descricaoDoTom("profissional"));
    expect(descricaoDoTom(null)).toBe(descricaoDoTom("profissional"));
    expect(descricaoDoTom(undefined)).toBe(descricaoDoTom("profissional"));
  });

  it("descrição própria do autor passa intacta — vale mais que a lista", () => {
    const meu = "tom de mentor sênior conversando com um estagiário";
    expect(descricaoDoTom(meu)).toBe(meu);
  });

  it("o padrão antigo, que era frase, continua passando", () => {
    const antigo = "profissional, claro e acessível";
    expect(descricaoDoTom(antigo)).toBe(antigo);
  });
});
