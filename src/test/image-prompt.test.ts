import { describe, expect, it } from "vitest";
import { SEM_TEXTO, montarPromptDeImagem } from "../../supabase/functions/generate-module-image/image-prompt";

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
    expect(p).toMatch(/takes priority over the theme/i);
  });

  it("não desliga as regras de enquadramento da capa", () => {
    // O ponto da pergunta que originou isto: o autor descreve O QUE aparece,
    // o sistema decide COMO enquadrar. Uma coisa não pode apagar a outra.
    const p = capa("um disco dourado sozinho no centro");
    expect(p).toMatch(/Fill the frame edge to edge/i);
    expect(p).toMatch(/No border/i);
  });

  it("sem descrição, a capa é pedida pelo nome do curso", () => {
    expect(capa()).toMatch(/cover illustration for a course about Gest[ãa]o de Controles Internos/);
  });

  it("sem descrição, o módulo é pedido pelo nome do módulo", () => {
    expect(modulo()).toMatch(/module about Mapeamento de Riscos/);
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

// ═══════════════════════════════════════════════════════════════════════════
// ASPAS EM VOLTA DO TÍTULO SÃO UM PEDIDO DE ESCRITA
//
// As imagens de módulo vinham com palavras deformadas em português, e o prompt
// já terminava com a diretiva SEM_TEXTO — em inglês, e estrita. A contradição
// estava três linhas acima: o título do módulo e o do curso iam entre aspas.
//
// Delimitar texto com aspas é o idioma que modelos de imagem leem como
// "renderize isto" — é assim que se pede um letreiro. Entre uma instrução
// concreta e uma proibição genérica, o modelo segue a concreta, e erra a
// ortografia, porque desenhar letra não é escrever.
//
// Estes testes existem para a forma antiga não voltar sem que alguém perceba.
// ═══════════════════════════════════════════════════════════════════════════

describe("o título não pode parecer um letreiro a desenhar", () => {
  const entrada = {
    escopo: "module" as const,
    moduleTitle: 'Gestão "Ágil" e Experimentação',
    courseTitle: "Transformação Digital nas Empresas",
  };

  it("nenhum título vai entre aspas", () => {
    const p = montarPromptDeImagem(entrada);
    const depoisDaDiretiva = p.indexOf(SEM_TEXTO);
    const assunto = p.slice(0, depoisDaDiretiva);
    expect(assunto).not.toMatch(/["'‘’“”]/);
  });

  it("aspas vindas do próprio título são removidas, não repassadas", () => {
    // Um título que já contém aspas reintroduziria o idioma pela porta dos
    // fundos.
    const p = montarPromptDeImagem(entrada);
    expect(p).toContain("Gestão Ágil e Experimentação");
    expect(p).not.toContain('"Ágil"');
  });

  it("a descrição do autor também perde as aspas", () => {
    const p = montarPromptDeImagem({
      ...entrada,
      brief: 'uma "mesa" de reunião vista de cima',
    });
    expect(p).toContain("uma mesa de reunião vista de cima");
    expect(p).not.toContain('"mesa"');
  });

  it("a diretiva de não escrever continua sendo a última linha", () => {
    // Posição importa: a restrição final é a que o modelo pesa mais.
    expect(montarPromptDeImagem(entrada).trim().endsWith(SEM_TEXTO)).toBe(true);
  });
});
