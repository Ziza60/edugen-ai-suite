// ═══════════════════════════════════════════════════════════════════════════
// AS GUARDAS: O QUE O PRÓPRIO TEXTO DECLARA NÃO-COMPARÁVEL
//
// Medido na bancada em 12/11/2026, lendo os 29 achados de coerência um a um:
// 8 contradições verdadeiras, 20 falsos positivos, 1 artefato de gêmeo —
// precisão de 28%. Os falsos positivos não são aleatórios: caem em classes, e
// em nove delas o texto DIZ que o valor não deve ser comparado.
//
// Uma guarda só entra aqui quando a exclusão está escrita na própria oração.
// "Derivado de uma conta" foi testada e REJEITADA como guarda: nos dois casos
// medidos (estoque de segurança 8 ≠ 55; MCU 4,11 ≠ 22,40) o que separava era o
// objeto, não a derivação — e a contradição verdadeira do 'Pão Quente' tem o
// valor derivado `R$ 610,00 / 4 = R$ 152,50` de um lado. Uma guarda de
// derivação apagaria a melhor evidência do acervo.
//
// A previsão falsificável destas guardas, registrada antes de medir:
//   remove 9 dos 20 falsos positivos
//   remove 0 das 8 contradições verdadeiras
//
// MEDIDO depois, nos 13 cursos: remove 10 falsos e 0 verdadeiras. A previsão
// errou por um, para baixo. E a leitura que a medição forçou reclassificou um
// achado meu de falso para VERDADEIRO (os custos fixos do Finanças), o que
// levou as verdadeiras de 8 para 9.
// ═══════════════════════════════════════════════════════════════════════════

import type { Grandeza } from "./valores-do-caso.ts";

export interface Guarda {
  /** Nome curto, que vai no laudo quando alguém perguntar por que não acusou. */
  nome: string;
  /** O achado da bancada que a justifica. */
  origem: string;
  /** A oração exclui este valor da comparação? */
  exclui(trecho: string, valor: string): boolean;
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O valor aparece dentro de um parêntese que começa por "ex:" ou "exemplo"? */
function dentroDeExemplo(trecho: string, valor: string): boolean {
  const t = semAcento(trecho);
  const v = semAcento(valor);
  // Varre os parênteses da oração e pergunta se o valor está num deles.
  for (const m of t.matchAll(/\(([^()]*)\)/g)) {
    const dentro = m[1];
    if (!dentro.includes(v)) continue;
    if (/^\s*(ex|exemplo|p\.?\s*ex|por exemplo)\b/.test(dentro)) return true;
  }
  return false;
}

/** O valor é um dos operandos de uma soma cujo total está na mesma oração? */
function operandoDeSomaExibida(trecho: string, valor: string): boolean {
  // "Custo Variável Unitário Total: R$ 4,30 (Diretos) + R$ 0,41 (Impostos —
  //  4,5% de R$ 9,00) + R$ 0,18 (Taxa Cartão — 2% de R$ 9,00) = R$ 4,89"
  //
  // O R$ 9,00 dali é o PREÇO, e o extrator o entregou rotulado como "Custo
  // Variável" e como "Taxa Cartão" — as duas sub-classes de pareamento errado
  // medidas na Doceria. O operando de uma soma exibida não é o valor do rótulo
  // que está ao lado dele.
  //
  // CORREÇÃO DE UMA JUSTIFICATIVA MINHA: esta guarda nasceu citando o caso
  // "R$25.000 (salários) + R$3.000 (administrativos) = R$28.000" do Finanças
  // como parte-contra-total. Ao medir, a guarda NÃO disparou ali — e ao ler o
  // curso inteiro descobri por quê: aquele achado não é parte-contra-total, é
  // uma contradição VERDADEIRA que eu havia classificado como falsa. Os custos
  // fixos da InovaTech são afirmados como R$28.000 (m1), R$50.000 (m3) e
  // R$25.000 (m5), em frases assertivas. Ver EXPERIMENTO-DOSSIE.md.
  //
  // O mecanismo continua certo; a história que eu contei sobre ele estava
  // errada, e teria virado régua apoiada em leitura parcial.
  const partes = trecho.split("=");
  if (partes.length < 2) return false;
  const esquerda = partes[0];
  if (!/[+]/.test(esquerda)) return false;
  const v = semAcento(valor);
  const direita = partes.slice(1).join("=");
  return semAcento(esquerda).includes(v) && !semAcento(direita).includes(v);
}

/** A oração enuncia uma FAIXA — média e máximo, normal e atraso, "de X a Y". */
function faixaNaMesmaOracao(trecho: string): boolean {
  const t = semAcento(trecho);
  const temMedia = /\bm[ée]di[oa]\b|\bnormalmente\b|\bem m[ée]dia\b/.test(t);
  const temExtremo =
    /\bm[áa]xim[oa]\b|\bm[íi]nim[oa]\b|\bj[áa] houve\b|\bchegar a\b|\bestendendo-se\b|\bpode variar\b|\batras[oa]\b/
      .test(t);
  const deAte = /\bde \d[\d.,]*\s*(?:a|at[ée])\s*\d/.test(t);
  return (temMedia && temExtremo) || deAte;
}

export const GUARDAS: Guarda[] = [
  {
    nome: "valor-de-exemplo",
    origem:
      "Doceria m5 '(ex: R$ 3.200,00)' e clínica-1 m4 '(ex: R$ 10.000)' — valor ilustrativo de template de preenchimento",
    exclui: (t, v) => dentroDeExemplo(t, v),
  },
  {
    nome: "alternativa-de-quiz",
    origem:
      "Sabor da Vovó m3: nível de serviço 95% ≠ 100%, ambos em alternativa de quiz e na explicação do gabarito",
    exclui: (t) =>
      /^\s*[-*]\s*\[\s*[xX ]?\s*\]/.test(t) ||
      /^\s*\|?\s*[A-E]\s*[:.)]\s/.test(t) ||
      /\balternativa\s+[A-E]\b/i.test(t),
  },
  {
    nome: "declarado-hipotetico",
    origem:
      "clínica-1 m7: 'valores hipotéticos para fins deste exemplo' no Ativo Circulante de R$ 90.000",
    exclui: (t) => {
      const s = semAcento(t);
      return /\bhipot[ée]tic/.test(s) ||
        /\bpara fins (?:deste|desse|do) exemplo\b/.test(s) ||
        /\bsuponha\b|\bsupondo\b|\bimagine que\b/.test(s);
    },
  },
  {
    nome: "faixa-declarada",
    origem:
      "Padaria do Bairro m3: 'normalmente de 3 dias, mas já houve casos de atraso, estendendo-se para 5 dias' — média e máximo, usados como tal na fórmula",
    exclui: (t) => faixaNaMesmaOracao(t),
  },
  {
    nome: "operando-de-soma",
    origem:
      "Doceria m2: o R$ 9,00 de 'Impostos — 4,5% de R$ 9,00' entregue rotulado como 'Custo Variável' e como 'Taxa Cartão' — as duas sub-classes de pareamento errado",
    exclui: (t, v) => operandoDeSomaExibida(t, v),
  },
  {
    nome: "condicional-hipotetica",
    origem:
      "TechInov m2: 'Se o Lead Time for de 20 dias, e sua previsão for para o próximo mês…' — hipótese de procedimento, não dado do caso",
    exclui: (t) => /(?:^|[.;:]\s*|\b)se\s+[^.;:]{0,60}\bfor\b|^\s*se\b/i.test(t),
  },
  {
    nome: "peso-de-rubrica",
    origem:
      "clínica-3 m8: '| Análise de Viabilidade de Investimentos | 15% |' — peso de critério na rubrica de avaliação",
    exclui: (t, v) => {
      if (!/\|/.test(t)) return false;
      // A ORAÇÃO NÃO CARREGA O CABEÇALHO DA TABELA.
      //
      // A primeira versão exigia a palavra "rubrica", "critério" ou "peso" na
      // própria linha, e por isso disparou UMA vez na bancada inteira: numa
      // tabela de rubrica, essas palavras estão no cabeçalho, não nas linhas.
      // A guarda era quase inerte e eu quase a registrei como funcionando.
      //
      // O que é detectável na linha é a FORMA de uma linha de rubrica: um
      // percentual sozinho numa célula, entre células de prosa. Peso de
      // critério tem essa cara; dado de negócio em tabela não — ele vem com
      // rótulo e unidade na mesma célula.
      const celulas = t.split("|").map((c) => c.trim()).filter(Boolean);
      if (celulas.length < 3) return false;
      const soOValor = celulas.some((c) => c === v.trim() && /%$/.test(v.trim()));
      if (!soOValor) return false;
      return celulas.filter((c) => c.length > 20 && /\s/.test(c)).length >= 2;
    },
  },
  {
    nome: "periodo-projetado",
    origem:
      "clínica-1: Receita Bruta R$ 300.000 (DRE atual) ≠ R$ 350.000 (orçamento do PRÓXIMO ANO)",
    exclui: (t) => {
      const s = semAcento(t);
      // MEDIDO: a primeira versão aceitava `estima\w*` e `projet\w*` soltos, e
      // disparou 91 vezes na bancada — 43 só no curso com ficha, onde "estimar"
      // aparece em toda instrução de orçamento. Marcador de período tem de ser
      // explícito, senão a guarda come dado do caso.
      return /\bpr[óo]ximo (?:ano|exerc[íi]cio|semestre|trimestre)\b|\bano que vem\b|\bpara o pr[óo]ximo\b|\bno pr[óo]ximo ano\b/
        .test(s);
    },
  },
  {
    nome: "identificador",
    origem:
      "dívida anterior: 'Compra 2 x R$ 4,50' e 'Módulo 3' — o número é etiqueta, não grandeza",
    exclui: (t, v) => {
      const bruto = v.trim();
      // Só vale para número nu: dinheiro, percentual e unidade não são etiqueta.
      if (!/^\d{1,3}$/.test(bruto)) return false;
      const s = semAcento(t);
      const re = new RegExp(
        `\\b(compra|m[óo]dulo|li[çc][ãa]o|etapa|passo|item|op[çc][ãa]o|quest[ãa]o|fase|n[íi]vel|tabela|figura|anexo)\\s+${bruto}\\b`,
      );
      return re.test(s);
    },
  },
];

export interface OcorrenciaGuardada {
  grandeza: Grandeza;
  /** Nome da guarda que a excluiu, ou null se ela passa para a comparação. */
  guarda: string | null;
}

/**
 * Aplica as guardas a uma lista de grandezas.
 *
 * Devolve TODAS, marcadas — e não só as que passam — porque o laudo precisa
 * poder dizer quantas foram excluídas e por qual guarda. Uma guarda silenciosa
 * é a próxima régua que não olha o que mede.
 */
export function aplicarGuardas(grandezas: Grandeza[]): OcorrenciaGuardada[] {
  return grandezas.map((g) => {
    for (const guarda of GUARDAS) {
      if (guarda.exclui(g.trecho, g.valor)) return { grandeza: g, guarda: guarda.nome };
    }
    return { grandeza: g, guarda: null };
  });
}

/** Só as que passam, para quem não se interessa pelo motivo. */
export function semGuarda(grandezas: Grandeza[]): Grandeza[] {
  return aplicarGuardas(grandezas).filter((o) => !o.guarda).map((o) => o.grandeza);
}
