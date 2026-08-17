// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o layout precisa caber no CONTEÚDO, não só na contagem de itens
//
// O defeito que isto corrige: o exportador escolhia o desenho de cada slide de
// lista por um contador em rodízio. As únicas entradas eram quantos itens havia
// e quão curtos eram. O objetivo era não repetir o mesmo visual — legítimo —
// mas o efeito colateral é que a forma passou a fazer AFIRMAÇÕES sobre o
// conteúdo que o conteúdo não sustenta:
//
//   • uma rosca dividida em partes iguais afirma "isto é um todo repartido, e
//     estas são as proporções". Cinco tópicos sem número nenhum viravam cinco
//     fatias de 20% — proporções inventadas. Foi o que apareceu em três slides
//     seguidos do curso de Controles Internos, todos com fatias idênticas.
//
//   • uma fila de setas afirma "isto acontece nesta ordem". Uma lista de duas
//     características e três exemplos virava um processo de cinco etapas.
//
// Nenhuma das duas é questão de gosto: são leituras erradas induzidas pelo
// desenho. A regra que este módulo implementa é simples — uma forma que afirma
// estrutura só pode ser usada quando a estrutura existe de fato. Quando não
// existe, sobram os desenhos neutros (cartões, painéis, marcadores, ícones
// numerados, teia), que continuam variados sem afirmar nada de falso.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Palavras que, no TÍTULO do slide, indicam que os itens estão em ordem.
 * Propositalmente restrita às fortes: "processo"/"process" ficou de fora
 * porque em conteúdo administrativo aparece o tempo todo sem querer dizer
 * sequência ("pastas de processo", "processo licitatório"), e um falso
 * positivo aqui devolve exatamente o defeito que estamos corrigindo.
 */
const TITULO_SEQUENCIAL = [
  // português
  "etapa", "etapas", "passo", "passos", "fase", "fases", "ciclo", "fluxo",
  "sequência", "sequencia", "cronologia", "roteiro", "jornada",
  "linha do tempo", "passo a passo",
  // inglês
  "step", "steps", "phase", "phases", "stage", "stages", "cycle", "flow",
  "sequence", "timeline", "journey", "roadmap", "workflow",
  // espanhol
  "paso", "pasos", "secuencia", "cronología", "cronologia", "hoja de ruta",
];

/** "1." / "2)" / "3 -" / "1º" no começo do item. */
const PREFIXO_NUMERICO = /^\s*\d{1,2}\s*[.)\-–º°]\s+/;

/** "Passo 1", "Etapa 2", "Fase 3", "Step 1"… no começo do item. */
const PREFIXO_ROTULADO =
  /^\s*(?:passo|etapa|fase|paso|step|phase|stage)\s*\d{1,2}\b/i;

/** Conectivos de ordem, quando abrem o item. */
const ABERTURA_ORDINAL = [
  /^\s*(?:primeiro|primeiramente|inicialmente|de início|de inicio)\b/i,
  /^\s*(?:depois|em seguida|na sequência|na sequencia|a seguir|então|entao)\b/i,
  /^\s*(?:por fim|finalmente|por último|por ultimo|ao final)\b/i,
  /^\s*(?:first|then|next|finally|lastly)\b/i,
  /^\s*(?:primero|luego|después|despues|finalmente)\b/i,
];

function normaliza(t: string): string {
  return (t || "").toLowerCase().normalize("NFC");
}

/**
 * O conteúdo está em ordem? Só devolve `true` diante de um sinal explícito —
 * na dúvida, responde `false`. O custo dos dois erros é diferente: deixar de
 * usar seta num conteúdo sequencial custa um pouco de variedade visual; usar
 * seta num conteúdo que não é sequencial faz o leitor entender errado.
 */
export function ehSequencia(titulo: string, itens: string[]): boolean {
  const lista = (itens ?? []).map((i) => (i || "").trim()).filter(Boolean);
  if (lista.length < 2) return false;

  // Sinal 1 — o título nomeia uma sequência.
  const t = normaliza(titulo);
  if (TITULO_SEQUENCIAL.some((p) => new RegExp(`(^|[^\\p{L}])${p}([^\\p{L}]|$)`, "u").test(t))) {
    return true;
  }

  // Sinal 2 — TODOS os itens vêm numerados ou rotulados. Exigir todos, e não
  // "a maioria", evita ler como processo uma lista em que só um item começa
  // com número por acaso (uma data, um valor, um artigo de lei).
  if (lista.every((i) => PREFIXO_NUMERICO.test(i) || PREFIXO_ROTULADO.test(i))) {
    return true;
  }

  // Sinal 3 — pelo menos dois itens abrem com conectivo de ordem.
  const comConectivo = lista.filter((i) => ABERTURA_ORDINAL.some((re) => re.test(i))).length;
  return comConectivo >= 2;
}

/**
 * Um gráfico de proporção só informa alguma coisa quando as fatias são
 * DIFERENTES. Com todos os valores iguais, a rosca desenha um todo repartido em
 * partes idênticas — que é o mesmo que não dizer nada, com a agravante de
 * parecer um dado. Tolerância de 2% para absorver arredondamento.
 */
export function proporcaoInformativa(valores: number[]): boolean {
  const v = (valores ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (v.length < 2) return false;
  const max = Math.max(...v);
  const min = Math.min(...v);
  if (max <= 0) return false;
  return (max - min) / max >= 0.02;
}
