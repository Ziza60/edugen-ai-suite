/**
 * O título do curso usa o vocabulário dos documentos?
 *
 * ─── O DEFEITO ───────────────────────────────────────────────────────────────
 *
 * APONTADO por quem usou, em 19/11/2026, sobre o título sugerido
 * "Auditoria Operacional no Setor Público: Fundamentos e Planejamento
 * Estratégico":
 *
 *   "não se trata desse tipo de planejamento amplo que as empresas e órgãos
 *    públicos fazem"
 *
 * Ele está certo, e eu havia classificado isto como escolha de palavra. É mais
 * do que isso. MEDIDO nas duas fontes do curso:
 *
 *   "planejamento estratégico" .......... 0 ocorrências
 *   "fase de planejamento" .............. 12
 *   "plano de auditoria" ................ 11
 *   "estratégia global de auditoria" .....4
 *
 * O modelo cunhou uma expressão que não existe em nenhum dos documentos, num
 * curso cuja premissa inteira (`useSources`) é que nada vem de fora. "Planejamento
 * estratégico" é um bigrama muito mais frequente em português geral do que
 * "fase de planejamento de auditoria", e o modelo seguiu a frequência da língua
 * em vez da terminologia da fonte. Em auditoria os dois não são sinônimos: um é
 * planejamento estratégico de uma organização, o outro é uma fase do trabalho
 * de auditoria.
 *
 * E não foi um caso: o curso de 18/11, gerado de UM documento só, saiu como
 * "Planejamento Estratégico e Operacional de Auditorias". Dois de três títulos.
 *
 * ─── POR QUE BIGRAMA, E NÃO PALAVRA ──────────────────────────────────────────
 *
 * Palavra isolada criativa é legítima: "Navegando nas ISSAI e NBASP: O Alicerce
 * da Auditoria Operacional" usa "Alicerce", que não está nas fontes, e é um
 * título bom. Já um bigrama técnico ausente do corpus é terminologia inventada.
 *
 * MEDIDO em cinco títulos reais, com as fontes reais:
 *
 *   ACUSA  "...Fundamentos e Planejamento Estratégico"   → "planejamento estrategico"
 *   ACUSA  "Planejamento Estratégico e Operacional..."   → "planejamento estrategico"
 *   limpo  "Planejamento da Auditoria Operacional no Setor Público: Da Teoria…"
 *   limpo  "Navegando nas ISSAI e NBASP: O Alicerce da Auditoria Operacional"
 *   limpo  "Fase de Planejamento da Auditoria Operacional no Setor Público"
 *
 * Dois verdadeiros, zero falsos. O aviso é aviso: quem decide é quem conhece o
 * assunto, e o campo é editável. A função não reescreve o título.
 *
 * Só o TÍTULO passa por aqui. Tema e resumo são prosa de duas frases, onde
 * paráfrase legítima é a regra e bigrama ausente não significa invenção.
 */

/** Minúsculas, sem acento, só letras e dígitos — para comparar texto com texto. */
export function normalizar(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Palavras que não carregam terminologia. Um bigrama com qualquer uma delas não
 * é expressão técnica, é costura de frase.
 */
const SEM_CARGA = new Set(
  ("de da do das dos e em no na nos nas o a os as para por com um uma uns umas " +
   "ao aos pelo pela pelos pelas sobre entre como que se ou mais menos seu sua " +
   "the of and in to for on at from with").split(" "),
);

const MIN_LETRAS = 4;

/**
 * As expressões de duas palavras do título em que AMBAS as palavras existem nas
 * fontes mas O PAR não existe. Lista vazia significa que o título não recombinou
 * o vocabulário dos documentos em termo que eles não usam.
 *
 * ─── POR QUE AS DUAS PALAVRAS PRECISAM SER DA FONTE ──────────────────────────
 *
 * A primeira versão desta função acusava qualquer bigrama ausente do corpus, e
 * um teste meu a pegou: "Guia Base" era acusado. Pior, "Guia Prático de
 * Planejamento de Auditoria" também seria — e isso é ENQUADRAMENTO, não
 * terminologia. Um aviso que erra assim treina quem lê a ignorá-lo, que é o
 * mesmo motivo pelo qual a coerência entre módulos saiu da tela.
 *
 * O defeito real tem assinatura própria. MEDIDO nas fontes do curso:
 *
 *   "planejamento" ... existe        "estrategico" ... existe
 *   "planejamento estrategico" ..... NÃO existe
 *
 * O modelo pegou duas palavras do próprio documento e as juntou num termo que o
 * documento nunca usa. É recombinação do vocabulário da fonte, e é isso que
 * muda o sentido numa área técnica. Já "guia prático" traz palavras que não
 * estão num manual de auditoria: é moldura, não conceito.
 *
 * MEDIDO em oito títulos, com as fontes reais:
 *
 *   ACUSA  "...Fundamentos e Planejamento Estratégico"      (relatado, 19/11)
 *   ACUSA  "Planejamento Estratégico e Operacional..."      (gerado, 18/11)
 *   limpo  "Fase de Planejamento da Auditoria Operacional no Setor Público"
 *   limpo  "Planejamento da Auditoria Operacional...Da Teoria à Prática..."
 *   limpo  "Navegando nas ISSAI e NBASP: O Alicerce da Auditoria Operacional"
 *   limpo  "Guia Prático de Planejamento de Auditoria"
 *   limpo  "Curso Completo de Auditoria Operacional"
 *   limpo  "Guia Base de Auditoria"
 *
 * Dois verdadeiros, zero falsos.
 *
 * @param titulo o título sugerido pelo modelo
 * @param corpus o texto de TODAS as fontes do curso, concatenado
 */
export function expressoesForaDasFontes(titulo: string, corpus: string): string[] {
  const texto = normalizar(corpus);
  if (!texto) return [];

  const palavrasDaFonte = new Set(texto.split(" "));
  const fora: string[] = [];

  // Pontuação separa ideias: "Setor Público: Fundamentos" não é um bigrama.
  for (const parte of (titulo || "").split(/[:;,—–()[\]{}.!?|/]/)) {
    const palavras = normalizar(parte).split(" ").filter(Boolean);
    for (let i = 0; i + 1 < palavras.length; i++) {
      const a = palavras[i];
      const b = palavras[i + 1];
      if (SEM_CARGA.has(a) || SEM_CARGA.has(b)) continue;
      if (a.length < MIN_LETRAS || b.length < MIN_LETRAS) continue;
      // As DUAS precisam ser vocabulário da fonte. Sem isto, enquadramento
      // como "guia prático" entraria como se fosse terminologia inventada.
      if (!palavrasDaFonte.has(a) || !palavrasDaFonte.has(b)) continue;
      const bigrama = `${a} ${b}`;
      if (!texto.includes(bigrama) && !fora.includes(bigrama)) fora.push(bigrama);
    }
  }

  return fora;
}

/** Uma expressão que a fonte realmente usa, com quantas vezes aparece. */
export interface ExpressaoDaFonte {
  expressao: string;
  ocorrencias: number;
}

/**
 * Quantas vezes a palavra aparece no corpus já normalizado, como palavra
 * inteira.
 */
function frequencia(palavra: string, palavras: readonly string[]): number {
  let n = 0;
  for (const p of palavras) if (p === palavra) n += 1;
  return n;
}

/**
 * Um achado só diz o que NÃO é. Isto diz o que a fonte usa no lugar.
 *
 * ─── POR QUE EXISTE UM PISO DE OCORRÊNCIAS ───────────────────────────────────
 *
 * MEDIDO nas fontes reais, pedindo sugestões para cada palavra dos dois pares
 * acusados:
 *
 *   "planejamento" → 29x "matriz de planejamento"
 *                    12x "fase de planejamento"
 *                     5x "planejamento da auditoria"
 *
 *   "estrategico"  →  1x "grupo estrategico"
 *                     1x "estrategico da orga"      ← palavra cortada pelo PDF
 *   "detalhado"    →  1x "detalhado de modo"
 *                     1x "suficientemente detalhado de modo"
 *
 * As do primeiro grupo são os termos de ofício do manual. As dos outros dois
 * são ruído, e uma delas é um pedaço de "organização" partido pela extração do
 * PDF. A diferença entre as duas situações é frequência, e só isso.
 *
 * Então: a âncora é a palavra MAIS FREQUENTE do par — a palavra do domínio, não
 * o adjetivo que o modelo grudou nela — e nada abaixo de `MIN_OCORRENCIAS`
 * entra. Sem sugestão boa, o aviso continua dizendo apenas que a expressão não
 * está nos documentos, que já é verdade útil.
 */
const MIN_OCORRENCIAS = 3;

export function comoAFonteChama(
  expressao: string,
  corpus: string,
  max = 3,
): ExpressaoDaFonte[] {
  const palavras = normalizar(corpus).split(" ").filter(Boolean);
  if (!palavras.length) return [];

  const doPar = normalizar(expressao).split(" ").filter(Boolean);
  if (!doPar.length) return [];

  // A âncora é a palavra do domínio: a que a fonte usa mais.
  const ancora = doPar
    .map((p) => ({ p, n: frequencia(p, palavras) }))
    .sort((a, b) => b.n - a.n)[0];
  if (!ancora || ancora.n < MIN_OCORRENCIAS) return [];

  const contagem = new Map<string, number>();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= palavras.length; i++) {
      const janela = palavras.slice(i, i + n);
      if (!janela.includes(ancora.p)) continue;
      if (SEM_CARGA.has(janela[0]) || SEM_CARGA.has(janela[n - 1])) continue;
      // Pelo menos duas palavras com carga, senão é costura de frase.
      if (janela.filter((w) => !SEM_CARGA.has(w) && w.length >= MIN_LETRAS).length < 2) continue;
      const e = janela.join(" ");
      if (e === normalizar(expressao)) continue;
      contagem.set(e, (contagem.get(e) || 0) + 1);
    }
  }

  return [...contagem.entries()]
    .filter(([, n]) => n >= MIN_OCORRENCIAS)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, max)
    .map(([expressao, ocorrencias]) => ({ expressao, ocorrencias }));
}

/**
 * A frase do aviso, ou `null` quando não há nada a avisar. Com o corpus, ela
 * também diz como a fonte chama a coisa.
 */
export function avisoDeVocabulario(
  fora: readonly string[],
  corpus = "",
): string | null {
  if (fora.length === 0) return null;

  const lista = fora.map((e) => `"${e}"`).join(", ");
  const abertura = fora.length === 1
    ? `A expressão ${lista} não aparece nos documentos enviados.`
    : `As expressões ${lista} não aparecem nos documentos enviados.`;

  if (!corpus) return abertura;

  // A sugestão sai da primeira expressão acusada: duas listas de sinônimos num
  // aviso de três linhas não ajudam ninguém a decidir.
  const usadas = comoAFonteChama(fora[0], corpus);
  if (!usadas.length) return abertura;

  const comoChama = usadas
    .map((u) => `"${u.expressao}" (${u.ocorrencias}x)`)
    .join(", ");
  return `${abertura} A sua fonte usa: ${comoChama}.`;
}
