import { describe, expect, it } from "vitest";
import {
  ehSequencia,
  proporcaoInformativa,
} from "../../supabase/functions/export-pptx-v7/layout-fit";

// ═══════════════════════════════════════════════════════════════════════════
// Três slides seguidos do curso de Controles Internos saíram como rosca com
// fatias idênticas, e um slide de "duas características + três exemplos" saiu
// como um processo de cinco etapas. Nos dois casos o desenho afirmava uma
// estrutura que o conteúdo não tem. Estes testes fixam a regra que passou a
// decidir quem pode usar cada forma — com o conteúdo real dos slides.
// ═══════════════════════════════════════════════════════════════════════════

// Conteúdo verbatim dos slides que motivaram a correção.
const DETECTIVOS = [
  "Conciliação bancária periódica",
  "Auditorias internas ou externas",
  "Revisões de desempenho orçamentário",
  "Inventário físico regular de bens",
  "Conferência de documentos fiscais",
];
const PREVENTIVOS = [
  "Agem antes da materialização do risco",
  "Estabelecem barreiras de segurança",
  "Ex: Segregação de funções",
  "Ex: Autorizações e aprovações formais",
  "Ex: Políticas de segurança da informação",
];
const CORRETIVOS = [
  "Implementados após a detecção de um evento",
  "Minimizam o impacto de riscos materializados",
  "Foco em reverter danos ou restaurar a situação",
  "Sequência lógica após a falha preventiva/detectiva",
];

describe("ehSequencia — os slides que estavam errados", () => {
  it("lista de exemplos não é sequência", () => {
    expect(ehSequencia("Controles Detectivos: Identificando Desvios", DETECTIVOS))
      .toBe(false);
  });

  it("características + exemplos não é sequência", () => {
    expect(ehSequencia("Controles Preventivos: Evitando Riscos", PREVENTIVOS))
      .toBe(false);
  });

  it("a palavra 'Sequência' DENTRO de um item não basta", () => {
    // "Sequência lógica após a falha preventiva/detectiva" é uma das quatro
    // características, não um marcador de ordem. Um item só não faz processo.
    expect(ehSequencia("Controles Corretivos: Sanando e Restaurando", CORRETIVOS))
      .toBe(false);
  });
});

describe("ehSequencia — sinal no título", () => {
  it("reconhece 'etapas'", () => {
    expect(ehSequencia("As etapas do processo de contratação", ["A", "B", "C"]))
      .toBe(true);
  });

  it("reconhece 'ciclo', 'fases', 'fluxo' e 'linha do tempo'", () => {
    for (const t of ["O ciclo PDCA", "Fases da auditoria", "Fluxo de aprovação", "Linha do tempo da reforma"]) {
      expect(ehSequencia(t, ["A", "B", "C"])).toBe(true);
    }
  });

  it("reconhece títulos em inglês e espanhol", () => {
    expect(ehSequencia("The five steps of the audit", ["A", "B", "C"])).toBe(true);
    expect(ehSequencia("Fases del control interno", ["A", "B", "C"])).toBe(true);
  });

  it("não confunde 'processo' solto, que é comum no assunto", () => {
    // "Pastas de processo", "processo licitatório", "processo administrativo":
    // um falso positivo aqui devolve as setas falsas.
    expect(ehSequencia("Documentos do processo licitatório", DETECTIVOS)).toBe(false);
  });

  it("não casa palavra dentro de outra", () => {
    expect(ehSequencia("Ciclovias e mobilidade urbana", ["A", "B", "C"])).toBe(false);
    expect(ehSequencia("Passivos contingentes", ["A", "B", "C"])).toBe(false);
  });
});

describe("ehSequencia — sinal nos itens", () => {
  it("aceita quando TODOS os itens vêm numerados", () => {
    expect(ehSequencia("Como fazer", ["1. Levantar", "2. Analisar", "3. Reportar"]))
      .toBe(true);
    expect(ehSequencia("Como fazer", ["1) Levantar", "2) Analisar", "3) Reportar"]))
      .toBe(true);
  });

  it("aceita rótulos 'Passo N' / 'Etapa N' / 'Step N'", () => {
    expect(ehSequencia("Roteiro", ["Passo 1 — mapear", "Passo 2 — testar", "Passo 3 — corrigir"]))
      .toBe(true);
    expect(ehSequencia("Guide", ["Step 1 map", "Step 2 test"])).toBe(true);
  });

  it("recusa quando só UM item começa com número", () => {
    // Uma data, um valor ou um artigo de lei no meio de uma lista comum.
    expect(ehSequencia("Marcos legais", [
      "1988 trouxe o marco constitucional",
      "Transparência é dever do gestor",
      "Controle social complementa o interno",
    ])).toBe(false);
  });

  it("aceita dois ou mais conectivos de ordem abrindo os itens", () => {
    expect(ehSequencia("Como conduzir", [
      "Primeiro, delimite o escopo",
      "Em seguida, colete as evidências",
      "Por fim, emita o relatório",
    ])).toBe(true);
  });

  it("recusa com um conectivo só", () => {
    expect(ehSequencia("Boas práticas", [
      "Primeiro, delimite o escopo",
      "Evidências devem ser rastreáveis",
      "Relatórios precisam de conclusão",
    ])).toBe(false);
  });

  it("precisa de pelo menos dois itens", () => {
    expect(ehSequencia("Etapas", ["1. Só uma"])).toBe(false);
    expect(ehSequencia("Etapas", [])).toBe(false);
  });

  it("ignora itens em branco", () => {
    expect(ehSequencia("Lista", ["  ", ""])).toBe(false);
  });
});

describe("proporcaoInformativa", () => {
  it("recusa fatias todas iguais — o defeito relatado", () => {
    expect(proporcaoInformativa([20, 20, 20, 20, 20])).toBe(false);
    expect(proporcaoInformativa([1, 1])).toBe(false);
  });

  it("recusa diferença dentro do arredondamento", () => {
    expect(proporcaoInformativa([33.3, 33.3, 33.4])).toBe(false);
  });

  it("aceita proporções de verdade", () => {
    expect(proporcaoInformativa([50, 30, 20])).toBe(true);
    expect(proporcaoInformativa([100, 97])).toBe(true);
  });

  it("recusa dados degenerados", () => {
    expect(proporcaoInformativa([0, 0, 0])).toBe(false);
    expect(proporcaoInformativa([42])).toBe(false);
    expect(proporcaoInformativa([])).toBe(false);
  });

  it("ignora valores inválidos", () => {
    expect(proporcaoInformativa([NaN, Infinity, -5])).toBe(false);
  });
});
