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
 * Palavras que, no TÍTULO do slide, indicam que OS ITENS estão em ordem.
 *
 * Duas exclusões deliberadas, as duas por falso positivo observado em curso
 * real:
 *
 * • "processo"/"process" ficou de fora porque em conteúdo administrativo
 *   aparece o tempo todo sem querer dizer sequência: "processo licitatório",
 *   "pastas de processo".
 *
 * • as formas SINGULARES de etapa/passo/fase saíram junto com "roteiro" e
 *   "jornada". Um título como "Etapa 1: Como responder ao desconhecimento?"
 *   diz que ESTE SLIDE é uma etapa — os itens dele eram alternativas A/B/C/D
 *   de uma questão. "PGCI: Roteiro Essencial" e "Avançar na fase prática" são
 *   floreio de título, não anúncio de lista ordenada. Quando os itens são
 *   mesmo etapas, o título quase sempre traz o PLURAL ("Etapas da
 *   implantação"), e se não trouxer, os sinais 2 e 3 ainda pegam.
 */
const TITULO_SEQUENCIAL = [
  // português — plurais e coletivos
  "etapas", "passos", "fases", "ciclo", "fluxo",
  "sequência", "sequencia", "cronologia", "linha do tempo", "passo a passo",
  // inglês
  "steps", "phases", "stages", "cycle", "flow",
  "sequence", "timeline", "workflow",
  // espanhol
  "pasos", "secuencia", "cronología", "cronologia",
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

// ── Rótulo do núcleo (teia e radial) ────────────────────────────────────────
//
// O núcleo é um círculo pequeno no meio do diagrama e cabe pouca coisa nele, de
// modo que o título precisa virar um rótulo curto. A regra antiga era "tire as
// palavras de ligação e fique com as duas primeiras". Em "PPA: O Plano
// Plurianual" isso devolveu **"PPA: Plano"** — que não parece um resumo, parece
// um defeito: termina em dois-pontos, prometendo uma continuação que não vem.
//
// A sigla antes do dois-pontos costuma ser o melhor rótulo que existe: já é
// curta e já é o nome da coisa. Então o dois-pontos deixa de ser um caractere
// qualquer no meio das palavras e passa a ser o que sempre foi — a divisa entre
// um nome e sua explicação. Fica-se com um lado ou com o outro, nunca com um
// pedaço de cada.

const LIGACAO = new Set([
  "a", "o", "as", "os", "da", "de", "do", "das", "dos", "e", "em", "na", "no",
  "nas", "nos", "por", "para", "com", "sobre", "um", "uma",
  "the", "of", "to", "and", "in", "on", "for", "a", "an",
  "el", "la", "los", "las", "y", "en", "por", "para", "con",
]);

/**
 * Rótulo curto para o centro de um diagrama, a partir do título do slide.
 *
 * `maxPalavras` e `maxChars` são o que cabe no círculo de cada layout.
 */
export function rotuloDoNucleo(titulo: string, maxPalavras = 2, maxChars = 18): string {
  const bruto = (titulo || "").trim();
  if (!bruto) return "";

  // O dois-pontos separa nome e explicação. Se o nome couber, ele É o rótulo.
  // `>= 0` e não `> 0`: um título que ABRE com dois-pontos tem nome vazio, e o
  // ramo abaixo já sabe cair na explicação. Com `> 0` ele escapava do
  // tratamento e voltava a sair com dois-pontos no rótulo — ": Plano".
  const divisa = bruto.indexOf(":");
  let base = bruto;
  if (divisa >= 0) {
    const nome = bruto.slice(0, divisa).trim();
    const explicacao = bruto.slice(divisa + 1).trim();
    base = nome && nome.length <= maxChars ? nome : (explicacao || nome);
  }

  const palavras = base.split(/\s+/).filter((p) => p && !LIGACAO.has(p.toLowerCase()));
  const escolhidas = (palavras.length ? palavras : base.split(/\s+/).filter(Boolean))
    .slice(0, maxPalavras);
  let rotulo = escolhidas.join(" ").trim();

  if (rotulo.length > maxChars) {
    // Uma palavra só e longa demais: corta com reticência, que ao menos avisa
    // que há mais. Duas palavras: fica com a primeira, inteira.
    rotulo = escolhidas.length > 1 && escolhidas[0].length <= maxChars
      ? escolhidas[0]
      : `${rotulo.slice(0, maxChars - 1).trim()}…`;
  }
  // Nenhum rótulo termina em pontuação de divisa — é ela que fazia "PPA:
  // Plano" parecer um corte.
  return rotulo.replace(/[\s:;,\-–—]+$/, "");
}
