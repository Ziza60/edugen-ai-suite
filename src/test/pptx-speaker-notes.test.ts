import { describe, expect, it } from "vitest";
import {
  attachSpeakerNotes,
  type DeckModule,
  type ModuleInput,
} from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// O relato: no slide "Benefícios do Planejamento Orçamentário" a nota do orador
// era a atividade da LOA; no "Estágios da Receita Pública", os pontos-chave do
// módulo inteiro.
//
// A hipótese de quem relatou era que o texto-fonte fosse fatiado em sequência.
// Não é — cada slide procura mesmo o trecho que mais o explica. O defeito estava
// em COMO: a varredura era gulosa NA ORDEM DOS SLIDES. Um slide que casa
// razoavelmente com um trecho chega antes e o consome; o slide que casaria
// perfeitamente com aquele mesmo trecho chega depois e o encontra ocupado.
//
// O cenário abaixo é essa armadilha, e foi tirado do deck real: o slide
// "Da Teoria à Prática" abre o módulo citando previsão, arrecadação e
// recolhimento — as mesmas palavras do trecho que pertence, de direito, ao
// slide dedicado aos estágios, que vem depois.
//
// Um teste que passasse com os dois algoritmos não provaria nada. Este falha
// com o antigo: lá, "Da Teoria à Prática" leva o trecho dos estágios embora.
// ═══════════════════════════════════════════════════════════════════════════

const FONTE = `## Execução Orçamentária

### Panorama do módulo
Este módulo mostra como o planejamento vira ato administrativo no dia a dia da
prefeitura. Depois de aprovada a peça, a máquina pública precisa executar aquilo
que prometeu, e é aí que a teoria encontra a realidade do caixa. O percurso
passa por rotinas contábeis, prazos legais e responsabilidades bem definidas
entre secretarias.

### Estágios da receita
A receita pública percorre quatro estágios sucessivos até entrar no caixa do
município: previsão, lançamento, arrecadação e recolhimento. A previsão estima
quanto se espera arrecadar no exercício. O lançamento identifica o devedor e
apura o valor devido. A arrecadação é o pagamento feito pelo contribuinte ao
agente credenciado. O recolhimento transfere esse valor ao Tesouro municipal.`;

const modulo = (): DeckModule[] => [{
  title: "Execução Orçamentária",
  slides: [
    // A armadilha: chega primeiro e usa o vocabulário do trecho seguinte.
    {
      kind: "bullets",
      title: "Da Teoria à Prática",
      bullets: [
        "Previsão e arrecadação viram rotina diária",
        "O recolhimento fecha o percurso da receita",
      ],
    },
    // O dono legítimo daquele trecho.
    {
      kind: "steps",
      title: "Estágios da Receita Pública",
      steps: [
        { heading: "Previsão", body: "Estima quanto se espera arrecadar no exercício." },
        { heading: "Lançamento", body: "Identifica o devedor e apura o valor devido." },
        { heading: "Arrecadação", body: "Pagamento feito pelo contribuinte ao agente." },
        { heading: "Recolhimento", body: "Transfere o valor ao Tesouro municipal." },
      ],
    },
  ],
}];

const entrada: ModuleInput[] = [{ title: "Execução Orçamentária", content: FONTE }];

const notaDe = (m: DeckModule[], pedaco: string) =>
  m[0].slides.find((s) => s.title?.includes(pedaco))?.notes ?? "";

describe("attachSpeakerNotes — a armadilha da ordem de chegada", () => {
  it("o trecho dos estágios vai para o slide DOS ESTÁGIOS, não para quem chegou antes", () => {
    const m = modulo();
    attachSpeakerNotes(m, entrada);
    expect(notaDe(m, "Estágios")).toMatch(/quatro estágios sucessivos/i);
  });

  it("o slide que chegou antes não leva embora o trecho alheio", () => {
    const m = modulo();
    attachSpeakerNotes(m, entrada);
    expect(notaDe(m, "Teoria")).not.toMatch(/quatro estágios sucessivos/i);
  });

  it("e ele fica com o trecho que é dele", () => {
    const m = modulo();
    attachSpeakerNotes(m, entrada);
    expect(notaDe(m, "Teoria")).toMatch(/planejamento vira ato administrativo/i);
  });

  it("nenhuma narração se repete entre slides", () => {
    const m = modulo();
    attachSpeakerNotes(m, entrada);
    const notas = m[0].slides.map((s) => s.notes).filter(Boolean);
    expect(new Set(notas).size).toBe(notas.length);
  });
});

describe("attachSpeakerNotes — o que ele NÃO deve fazer", () => {
  it("capa, divisória e sumário não recebem nota nem entram na contagem", () => {
    const m: DeckModule[] = [{
      title: "M",
      slides: [
        { kind: "cover", title: "Curso" },
        { kind: "section", title: "Módulo 1" },
        { kind: "toc", title: "Agenda" },
      ],
    }];
    const r = attachSpeakerNotes(m, entrada);
    expect(r.total).toBe(0);
    expect(m[0].slides.every((s) => !s.notes)).toBe(true);
  });

  it("sem trecho que sustente, o slide fica sem nota — errada é pior que nenhuma", () => {
    const m: DeckModule[] = [{
      title: "M",
      slides: [{
        kind: "bullets",
        title: "Fotossíntese em plantas aquáticas",
        bullets: ["Cloroplastos capturam energia luminosa"],
      }],
    }];
    attachSpeakerNotes(m, entrada);
    expect(m[0].slides[0].notes).toBeUndefined();
  });

  it("proximidade de posição não fabrica par que o texto não sustenta", () => {
    const m: DeckModule[] = [{
      title: "M",
      slides: [
        { kind: "bullets", title: "Cloroplastos", bullets: ["Energia luminosa"] },
        { kind: "bullets", title: "Estômatos", bullets: ["Trocas gasosas foliares"] },
      ],
    }];
    expect(attachSpeakerNotes(m, entrada).withNotes).toBe(0);
  });

  it("módulo sem conteúdo-fonte não quebra", () => {
    const m = modulo();
    const r = attachSpeakerNotes(m, [{ title: "x", content: "" }]);
    expect(r.withNotes).toBe(0);
    expect(r.total).toBe(2);
  });

  it("é determinístico — duas execuções dão o mesmo resultado", () => {
    const a = modulo(); attachSpeakerNotes(a, entrada);
    const b = modulo(); attachSpeakerNotes(b, entrada);
    expect(a[0].slides.map((s) => s.notes)).toEqual(b[0].slides.map((s) => s.notes));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O RECAPITULATIVO NÃO PRECISA DE NARRAÇÃO
//
// O texto que dá origem ao slide de recapitulação — os pontos-chave do módulo —
// é excluído de propósito das passagens de origem: como narração de OUTRO
// slide, ele resume em vez de explicar. Só que o recapitulativo continuava na
// fila pedindo nota. Sem par natural, ele atraía a passagem que estivesse
// sobrando.
//
// Medido no deck de 21/08: das três notas claramente fora de lugar, as três
// estavam em "Principais Aprendizados" — o slide 10 recebeu uma narração sobre
// PPA/LDO/LOA com 4% de vocabulário em comum com o que estava na tela.
//
// Ele não precisa de nota: os próprios itens JÁ são o resumo que o professor lê.
// ═══════════════════════════════════════════════════════════════════════════

describe("attachSpeakerNotes — slides de recapitulação", () => {
  const comRecap = (titulo: string): DeckModule[] => [{
    title: "Execução Orçamentária",
    slides: [
      {
        kind: "steps",
        title: "Estágios da Receita Pública",
        steps: [
          { heading: "Previsão", body: "Estima quanto se espera arrecadar no exercício." },
          { heading: "Lançamento", body: "Identifica o devedor e apura o valor devido." },
        ],
      },
      { kind: "bullets", title: titulo, bullets: ["A receita tem quatro estágios.", "A execução segue a LRF."] },
    ],
  }];

  for (
    const titulo of [
      "Principais Aprendizados",
      "Principais Pontos do Módulo",
      "Principais Conclusões do Módulo",
      "Pontos-chave",
      "Key Takeaways",
    ]
  ) {
    it(`"${titulo}" não recebe narração de outro assunto`, () => {
      const m = comRecap(titulo);
      attachSpeakerNotes(m, entrada);
      expect(m[0].slides[1].notes ?? "").toBe("");
    });
  }

  it("o slide de conteúdo ao lado continua recebendo a sua", () => {
    const m = comRecap("Principais Aprendizados");
    attachSpeakerNotes(m, entrada);
    expect(m[0].slides[0].notes ?? "").toMatch(/estágios/i);
  });

  it("o fechamento do módulo também fica de fora", () => {
    const m: DeckModule[] = [{
      title: "Execução Orçamentária",
      slides: [{ kind: "closing", title: "Recapitulando", bullets: ["A receita tem quatro estágios."] }],
    }];
    const r = attachSpeakerNotes(m, entrada);
    expect(r.total).toBe(0);
    expect(m[0].slides[0].notes ?? "").toBe("");
  });
});
