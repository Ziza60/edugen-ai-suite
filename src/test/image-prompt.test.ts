import { describe, expect, it } from "vitest";
import {
  montarPromptDeImagem,
  SEM_TEXTO,
} from "../../supabase/functions/generate-module-image/image-prompt";

// ═══════════════════════════════════════════════════════════════════════════
// A capa não é exibida inteira: no PDF ela é ampliada e recortada para caber
// numa faixa de 162 x 62 mm, e só a terça parte central da altura sobrevive.
// Quem sabe disso é o sistema, não quem escreve a descrição — mas o
// enquadramento não estava no código, e o autor tinha de adivinhá-lo a cada
// curso. Uma descrição pedindo "margem igual nos quatro lados" fez o modelo
// desenhar um quadro COM MOLDURA; cortado o topo e a base, ficaram duas
// listras verticais penduradas nas pontas.
//
// Pior: o estilo fixo pedia "generous negative space" para TODA imagem. Numa
// capa que vai ser cortada, pedir espaço vazio é pedir o defeito.
// ═══════════════════════════════════════════════════════════════════════════

const capa = (brief?: string) =>
  montarPromptDeImagem({
    escopo: "cover",
    moduleTitle: "Módulo 1",
    courseTitle: "Gestão de Controles Internos",
    brief,
  });

const modulo = (brief?: string) =>
  montarPromptDeImagem({
    escopo: "module",
    moduleTitle: "Mapeamento de Riscos",
    courseTitle: "Gestão de Controles Internos",
    brief,
  });

describe("regras de enquadramento da CAPA", () => {
  it("manda preencher o quadro de ponta a ponta", () => {
    expect(capa()).toMatch(/Fill the frame edge to edge/i);
  });

  it("proíbe moldura, borda e quadro dentro do quadro", () => {
    // Foi exatamente isso que gerou as listras verticais nas pontas.
    const p = capa();
    expect(p).toMatch(/No border/i);
    expect(p).toMatch(/no frame/i);
    expect(p).toMatch(/picture-within-a-picture/i);
  });

  it("avisa que a imagem será recortada, e o que sobra", () => {
    expect(capa()).toMatch(/CROPPED/);
    expect(capa()).toMatch(/middle third of its height/i);
  });

  it("manda espalhar o assunto por toda a largura", () => {
    expect(capa()).toMatch(/FULL width/i);
    expect(capa()).toMatch(/do not leave a large empty area/i);
  });

  it("NÃO pede espaço vazio generoso — era o estilo antigo, aplicado a tudo", () => {
    expect(capa()).not.toMatch(/generous negative space/i);
  });

  it("prefere arranjo lado a lado a arranjo empilhado", () => {
    expect(capa()).toMatch(/side-by-side/i);
  });
});

describe("imagem de MÓDULO continua como estava", () => {
  it("aparece inteira na apostila, então o respiro ajuda", () => {
    expect(modulo()).toMatch(/generous negative space/i);
  });

  it("não recebe as regras de recorte, que não valem para ela", () => {
    expect(modulo()).not.toMatch(/CROPPED/);
    expect(modulo()).not.toMatch(/Fill the frame edge to edge/i);
  });
});

describe("a proibição de texto vale para as duas", () => {
  it("está na capa e no módulo", () => {
    expect(capa()).toContain(SEM_TEXTO);
    expect(modulo()).toContain(SEM_TEXTO);
  });

  it("continua sendo a última instrução, onde pesa mais", () => {
    expect(capa().trimEnd().endsWith(SEM_TEXTO)).toBe(true);
    expect(modulo().trimEnd().endsWith(SEM_TEXTO)).toBe(true);
  });
});

describe("a descrição do autor", () => {
  it("entra como ASSUNTO e vence o título", () => {
    const p = capa("mesa de reunião vista de cima");
    expect(p).toContain("mesa de reunião vista de cima");
    expect(p).toMatch(/takes priority over the title/i);
  });

  it("não desliga as regras de enquadramento da capa", () => {
    // O ponto da pergunta que originou isto: o autor descreve O QUE aparece,
    // o sistema decide COMO enquadrar. Uma coisa não pode apagar a outra.
    const p = capa("um disco dourado sozinho no centro");
    expect(p).toMatch(/Fill the frame edge to edge/i);
    expect(p).toMatch(/No border/i);
  });

  it("sem descrição, a capa é pedida pelo nome do curso", () => {
    expect(capa()).toMatch(/cover illustration for the course "Gestão de Controles Internos"/);
  });

  it("sem descrição, o módulo é pedido pelo nome do módulo", () => {
    expect(modulo()).toMatch(/module "Mapeamento de Riscos"/);
  });

  it("curso sem título não quebra o texto", () => {
    const p = montarPromptDeImagem({
      escopo: "cover",
      moduleTitle: "Curso sem nome",
      courseTitle: null,
    });
    expect(p).toContain("Curso sem nome");
    expect(p).not.toContain('""');
  });
});
