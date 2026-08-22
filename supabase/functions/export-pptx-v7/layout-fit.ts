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
  "etapas", "passos", "fases", "estágios", "estagios", "ciclo", "fluxo",
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

/**
 * "CATEGORIA A" PERDIA O "A"
 *
 * A palavra de ligação é descartada do rótulo — é o certo para "de", "do",
 * "para". Mas o "A" de "Categoria A — Os Produtos Essenciais" não é artigo: é o
 * NOME da categoria, e justamente a mais importante do curso de Curva ABC. No
 * deck de 22/08 o slide 10 exibia "Categoria", "Categoria B" e "Categoria C" —
 * a primeira, decapitada, ficou sem sentido ao lado das outras duas.
 *
 * Uma letra sozinha em maiúscula é classificador: Categoria A, Anexo I,
 * Vitamina C, Plano B. Fica.
 */
const CLASSIFICADOR_DE_UMA_LETRA = /^[A-ZÀ-Ý]$/;

function ehLigacao(palavra: string, anterior?: string): boolean {
  // Classificador só depois de uma palavra DE VERDADE. "Categoria A" tem nome
  // antes da letra; "A e O" não tem — ali o "O" é artigo, e o teste de borda
  // que exige o texto de volta continua valendo.
  const depoisDePalavra = !!anterior && !LIGACAO.has(anterior.toLowerCase());
  if (depoisDePalavra && CLASSIFICADOR_DE_UMA_LETRA.test(palavra)) return false;
  return LIGACAO.has(palavra.toLowerCase());
}

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

  const brutas = base.split(/\s+/).filter(Boolean);
  const palavras = brutas.filter((p, i) => !ehLigacao(p, brutas[i - 1]));
  const escolhidas = (palavras.length ? palavras : brutas)
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

// ═══════════════════════════════════════════════════════════════════════════
// O ESQUELETO DE ESTUDO DE CASO
//
// "1 Contexto · 2 Desafio · 3 Solução · 4 Resultado" e nenhuma frase. Um slide
// assim não ensina: ocupa tempo de aula e faz quem apresenta parecer
// despreparado.
//
// POR QUE MORA AQUI, E NÃO ONDE NASCEU
//
// A primeira versão vivia na checagem de cobertura, que roda ANTES da
// normalização — e essa era a falha. No deck de 22/08, os slides 19 e 29
// escaparam mesmo com a proteção no ar: naquele momento os passos AINDA TINHAM
// corpo, e foi a normalização, logo depois, que os esvaziou (um corpo que se
// resume a reticências ou a um resto de numeração vira string vazia ao ser
// limpo). A proteção olhava o slide cheio e aprovava; o aluno recebia o vazio.
//
// Agora a pergunta é feita nos dois lugares. Na cobertura, para que o slide
// possa ser SUBSTITUÍDO pelo caso preenchido a partir da fonte — que é o
// desfecho bom. E na normalização, no fim de tudo, quando o conteúdo já é o
// que será desenhado, para que um esqueleto não embarque de jeito nenhum.
//
// O critério não exige que TODOS os itens sejam rótulo: o slide 29 trazia
// "Contexto · Desafio · Dados · Solução · Resultado", e "Dados" não é rótulo de
// caso — a exigência de unanimidade deixou esse passar. Três rótulos e maioria
// bastam, o que mantém fora de perigo uma sequência legítima como
// "Fixação · Empenho · Liquidação · Pagamento", que não tem rótulo nenhum.
// ═══════════════════════════════════════════════════════════════════════════

const ROTULO_DE_CASO =
  /^(contexto|desafio|solu[çc][ãa]o|resultado|problema|cen[áa]rio|tarefa|proposta|enunciado|situa[çc][ãa]o)\b/i;

/** Forma mínima de um slide, para não amarrar este módulo ao tipo completo. */
interface SlideParaTriagem {
  kind?: string;
  steps?: Array<{ heading?: string; body?: string }>;
  cards?: Array<{ heading?: string; body?: string }>;
  bullets?: string[];
}

function ehRotulo(t: unknown): boolean {
  return ROTULO_DE_CASO.test(String(t ?? "").trim());
}

function semTexto(t: unknown): boolean {
  return !String(t ?? "").trim();
}

/** Rótulos de caso em maioria, e pelo menos três. */
function maioriaRotulada(itens: unknown[]): boolean {
  if (itens.length < 3) return false;
  const rotulados = itens.filter(ehRotulo).length;
  return rotulados >= 3 && rotulados / itens.length >= 0.6;
}

/**
 * O slide é um estudo de caso que chegou só com os rótulos, sem uma linha de
 * conteúdo? Vale para qualquer formato: o defeito não é da forma, é da falta
 * de texto.
 */
export function esqueletoDeCaso(s: SlideParaTriagem): boolean {
  if (s.kind === "steps") {
    const ss = s.steps ?? [];
    return maioriaRotulada(ss.map((x) => x.heading)) &&
      ss.every((x) => semTexto(x.body));
  }
  if (s.kind === "cards" || s.kind === "matrix") {
    const cs = s.cards ?? [];
    return maioriaRotulada(cs.map((x) => x.heading)) &&
      cs.every((x) => semTexto(x.body));
  }
  if (s.kind === "bullets" || s.kind === "tiles" || s.kind === "bento") {
    // Aqui o rótulo é o item inteiro: "Contexto", e nada mais. Se vier
    // "Contexto: o Sr. João...", há conteúdo e o slide fica.
    const bs = s.bullets ?? [];
    return maioriaRotulada(bs) &&
      bs.every((b) => String(b).trim().split(/\s+/).length <= 2);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// APARAR ATÉ O PENSAMENTO INTEIRO
//
// Vive aqui, e não em validate.ts, porque há DOIS cortadores em série no
// caminho de um texto até o slide — toShortPoint, em deck-plan, e capText, em
// validate — e só o segundo limpava a sujeira do corte. O primeiro entregava
// "…classificou o Café Premium" e o segundo, vendo um texto já curto, não
// tinha por que mexer. O aluno recebia a frase pela metade.
// ═══════════════════════════════════════════════════════════════════════════

export const TRAILING_JUNK_RE = /[\s,;:\-–—]+$/;
export const ELLIPSIS_RE = /(\.{2,}|…)+\s*$/;
// O artigo "o" faltava. A lista trazia "a", "as" e "os", e só o masculino
// singular ficou de fora — uma omissão de um caractere com efeito visível:
// "…e a" era aparado, "…e os" era aparado, e "Conclua com a fase de pagamento
// e o" foi entregue assim mesmo, num slide de atividade.
export const DANGLING_PREP_RE =
  /\s+(para|de|da|do|das|dos|com|e|ou|que|em|no|na|nos|nas|ao|à|aos|às|por|sobre|entre|sem|sob|a|o|as|os|um|uma|uns|umas)\s*$/i;

// Words that CAN legitimately end an intact sentence ("a decisão é sua", "isso
// depende de você") but never end an acceptable CUT one. They are stripped only
// from text we know was truncated — applying them to prose the planner wrote in
// full would mutilate it, which is why they are not in DANGLING_PREP_RE.
const CUT_TAIL_RE =
  /\s+(voc[êe]s?|ele|ela|eles|elas|n[óo]s|quem|qual|quais|onde|quando|cujos?|cujas?|algum|alguma|alguns|algumas|qualquer|quaisquer|seu|sua|seus|suas|este|esta|estes|estas|esse|essa|esses|essas|aquele|aquela|isso|isto|mesmo|mesma)\s*$/i;

// An orphan subordinate clause: a connector followed by 1–2 words and nothing
// else. "Revise sua proposta, garantindo que o controle" is not a short
// sentence, it is a sentence cut in half — the clause promises a completion the
// slide never delivers. Cutting at the connector restores a whole statement.
const ORPHAN_CLAUSE_RE =
  /[,;]?\s+\b(que|para|porque|quando|onde|se|caso|conforme|enquanto|embora|garantindo|assegurando|considerando|visando|buscando|permitindo)\b(\s+\S+){0,2}\s*$/i;

/**
 * Make a truncated fragment end on a whole thought.
 *
 * Runs only on text capText actually had to cut. Two shapes of debris:
 * a trailing function word ("…problemas que você") and an orphan subordinate
 * clause ("…garantindo que o controle"). Removing one often exposes the other,
 * so it iterates; it stops before dissolving the fragment, since three words
 * that end badly still beat one word that ends nowhere.
 */
/**
 * O mesmo "Categoria A", agora do outro lado: DANGLING_PREP_RE é insensível a
 * maiúsculas e via o "A" final como artigo pendurado. A legenda do gráfico do
 * slide 9 saiu "Categoria" pelo mesmo motivo que o rótulo do slide 10.
 * Classificador de uma letra em maiúscula nunca é sobra de corte.
 */
export function terminaEmClassificador(t: string): boolean {
  return /(?:^|\s)\p{Lu}$/u.test(t.trim());
}

export function trimToWholeThought(raw: string): string {
  let s = raw;
  // Bounded loop rather than recursion: each rule can expose work for the
  // others ("…garantindo que o controle" → "…proposta," → "…proposta"), and the
  // string strictly shrinks, so a handful of passes always settles.
  for (let i = 0; i < 6; i++) {
    if (terminaEmClassificador(s)) break; // "Categoria A" está inteiro
    let next = s
      .replace(CUT_TAIL_RE, "")
      .replace(DANGLING_PREP_RE, "")
      .replace(TRAILING_JUNK_RE, "")
      .trim();
    if (next === s) {
      next = s.replace(ORPHAN_CLAUSE_RE, "").replace(TRAILING_JUNK_RE, "").trim();
      if (next === s) break;
    }
    // Never strip past three words — below that we are deleting the point, not
    // the debris, and the caller is better served by the longer ragged version.
    if (next.split(/\s+/).filter(Boolean).length < 3) break;
    s = next;
  }
  return s;
}


// ═══════════════════════════════════════════════════════════════════════════
// A SETA SÓ DESENHA O RÓTULO — ENTÃO SÓ PODE RECEBER RÓTULOS
//
// Esta é a causa que eu procurei por três decks. Os slides que chegavam como
// "1 Contexto · 2 Desafio · 3 Solução · 4 Resultado" e nada mais NUNCA
// estiveram vazios: o texto existia, chegava inteiro à renderização, e a
// variante de chevron o descartava — ela lê apenas os títulos dos passos,
// porque é só o que cabe dentro da seta.
//
// Eu tinha diagnosticado como "estudo de caso sem conteúdo" e reforçado a
// triagem três vezes, em lugares cada vez mais tardios do caminho. As três
// mudanças eram defensáveis, mas nenhuma podia funcionar: o slide estava cheio
// em todos os pontos onde eu olhava. A perda acontecia depois de todos eles,
// no desenho.
//
// A regra correta é anterior a qualquer triagem: uma forma que não sabe
// mostrar o corpo não recebe conteúdo que tem corpo. O chevron continua
// disponível para sequências de rótulo puro — "Fixação · Empenho · Liquidação
// · Pagamento" —, que é para o que ele foi feito.
// ═══════════════════════════════════════════════════════════════════════════

/** O passo, na forma mínima de que esta decisão precisa. */
interface PassoParaSeta {
  heading?: string;
  body?: string;
}

/**
 * O slide de passos pode ser desenhado como setas em sequência?
 *
 * Três condições, e a terceira é a que faltava: rótulo curto (a seta carrega o
 * número dentro e a legenda embaixo, numa coluna estreita), entre 3 e 5 passos,
 * e NENHUM passo com corpo — porque o corpo não seria desenhado.
 */
export function chevronCabe(passos: PassoParaSeta[]): boolean {
  const ps = passos ?? [];
  if (ps.length < 3 || ps.length > 5) return false;
  if (ps.some((p) => (p.heading?.length ?? 0) > 26)) return false;
  if (ps.some((p) => String(p.body ?? "").trim())) return false;
  return true;
}
