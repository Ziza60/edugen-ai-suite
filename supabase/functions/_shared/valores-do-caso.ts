// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — Leitura dos números do caso condutor
//
// POR QUE ISTO EXISTE
//
// Um curso gerado por módulos independentes contradiz a si mesmo. No curso de
// precificação de 24/08, o mesmo suco Detox Verde, da mesma empresa, no mesmo
// lançamento, tinha custo variável de R$ 7,20 no módulo 1, R$ 12,75 no módulo 2
// e R$ 8,00 três páginas depois; os custos fixos mensais eram R$ 25.000 num
// módulo e R$ 15.000 no outro. O aluno calcula um número e encontra outro na
// página seguinte.
//
// Havia uma tentativa de resolver isso — a "ponte de valores" — e ela lia o
// texto pelo glossário: pegava cada termo do `terminology_ledger` e procurava o
// primeiro valor depois dele. Num curso de precificação isso encontra
// "Custo Variável: R$ 0,80" numa tabela de OUTRO produto e propaga o número
// errado para os módulos seguintes, com autoridade de instrução. Um valor
// extraído errado é pior do que valor nenhum: o modelo obedece.
//
// A LEITURA AQUI É INVERTIDA
//
// Não se tenta nomear a grandeza a partir de uma lista externa. Lê-se:
//
//   1. QUEM é o caso — o nome próprio que o texto apresentou entre aspas
//      ('Detox Verde') e que reaparece ao longo do curso. Aspas, e não
//      maiúsculas: "Custo Variável" e "Margem de Contribuição" também vêm
//      capitalizados, e como âncora agrupariam produtos diferentes sob o
//      mesmo nome.
//
//   2. QUE grandeza — o rótulo que o próprio texto escreveu imediatamente
//      antes do valor, reduzido às suas duas primeiras palavras de conteúdo.
//      Duas, e não três: com três, "Total de Custos Variáveis Unitários" deixa
//      de casar com "custo variável por garrafa", e o defeito principal escapa.
//
//   3. QUAL valor — o número ligado ao rótulo por dois-pontos, igual ou verbo;
//      numa soma, o total depois do "=", não a primeira parcela.
//
// O modo de falha é silencioso por construção: rótulo lido errado não casa com
// nada, e parágrafo sem âncora não produz nada. Erra para menos, nunca para
// mais.
//
// MEDIDO: contra os cinco cursos reais gerados na semana de 24/08 — as duas
// divergências verdadeiras do curso de precificação, com a evidência certa, e
// zero falsos alarmes nos outros quatro.
// ═══════════════════════════════════════════════════════════════════════════

/** Nome próprio do caso, como o texto o apresenta: entre aspas. */
const NOME_CITADO_RE =
  /['‘’"“”]([A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[\wÀ-ÿ]+){1,2})['‘’"“”]/g;

// O número precisa PARAR onde acaba. Um `\d[\d.,]*` frouxo engole o ponto final
// da frase — "custa R$ 25.000." vira "R$25.000.", um valor diferente de
// "R$25.000" no mesmo grupo. As quatro formas, da mais longa para a mais curta:
//
//   25.000,00   milhar com ponto e centavos com vírgula (pt-BR)
//   7,20        centavos com vírgula
//   185.00      centavos com PONTO — é assim que a apostila de estoque de 23/08
//               escreveu o Custo de Pedido, e ignorar essa forma deixaria o
//               defeito original desta ponte passar batido
//   8           inteiro
const NUMERO_RE = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+,\d{2}|\d+\.\d{2}|\d+`;
const MOEDA_RE = String.raw`(?:R\$|US\$|\$|€|£)\s?(?:${NUMERO_RE})`;
const PERCENTUAL_RE = String.raw`\d+(?:[.,]\d+)?\s?%`;

// Grandeza contada, não monetária: "o Ponto de Pedido é 60 unidades". A lista
// de unidades é curta de propósito — cada palavra aqui é uma chance de casar
// com um número que não é grandeza fixa do caso ("5.000 garrafas por mês" é
// premissa do exercício, não valor a manter).
const QUANTIDADE_RE = String.raw`(?:${NUMERO_RE})\s?(?:unidades?|dias?|horas?|meses|m[êe]s|itens|pe[çc]as|caixas|pedidos?)`;

const VALOR_RE = `(?:${MOEDA_RE}|${PERCENTUAL_RE}|${QUANTIDADE_RE})`;
const PRIMEIRO_VALOR_RE = new RegExp(VALOR_RE);

/** O que liga um rótulo ao seu valor: dois-pontos, igual, ou o verbo. */
const LIGACAO_RE = String.raw`(?:\s*[:=]\s*|\s+(?:é|de|são|sao|será|sera|foi|` +
  String.raw`equivale\s+a|totalizam|totalizando|totaliza|somam|soma|custa|custam)\s+(?:de\s+)?)`;

/** Parêntese explicativo dentro de uma soma: "R$8,00 (matéria-prima) + …". */
const PARENTESE_RE = String.raw`(?:\s*\([^)]{0,60}\))?`;

const ROTULO_E_VALOR_RE = new RegExp(
  String.raw`(?<rotulo>.*?)` + LIGACAO_RE +
    String.raw`(?<expressao>${VALOR_RE}${PARENTESE_RE}` +
    String.raw`(?:\s*[+\-*/x×]\s*${VALOR_RE}${PARENTESE_RE})*` +
    String.raw`(?:\s*=\s*(?<total>${VALOR_RE}))?)`,
  "gi",
);

// Palavras que não distinguem uma grandeza de outra. Os qualificadores
// ("total", "unitário", "sugerido") saem junto: o mesmo número aparece ora como
// "custo variável total", ora como "custos variáveis unitários", e é o mesmo
// custo variável.
const PALAVRAS_VAZIAS = new Set(
  ("de do da dos das o a os as um uma uns umas por para em no na nos nas e ou que " +
    "se ao aos com sobre entre seu sua seus suas este esta esse essa aquele cada qual quais " +
    "ser sao eh esta estao apos antes ja mais menos muito bem tambem entao assim isso " +
    "total geral aproximado medio estimado previsto definido sugerido projetado proposto " +
    "inicial final novo atual desejado necessario obtido calculado considerando primeiro " +
    // Rótulos estruturais do próprio gerador. Abrem quase todo bloco de exemplo
    // ("Resultado: O Custo de Pedido … é de R$185.00") e, se entrassem na
    // chave, a MESMA grandeza sairia como "resultado custo" num parágrafo e
    // "custo pedido" no outro — e a leitura deixaria de ver que ela se repete.
    "resultado solucao contexto desafio exemplo passo etapa conclusao observacao " +
    "nota dica atencao importante lembre")
    .split(" "),
);

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Reduz plural e flexão ao suficiente para "custos variáveis" casar com
 *  "custo variável". Não é um lematizador: é só o bastante para agrupar. */
export function raizDaPalavra(t: string): string {
  const s = semAcento(t);
  if (s.endsWith("veis")) return `${s.slice(0, -4)}vel`;
  if (s.endsWith("ais")) return `${s.slice(0, -3)}al`;
  if (s.endsWith("oes")) return `${s.slice(0, -3)}ao`;
  if (s.endsWith("ns")) return `${s.slice(0, -2)}m`;
  if (s.endsWith("es") && s.length > 4) return s.slice(0, -2);
  if (s.endsWith("s") && s.length > 3) return s.slice(0, -1);
  return s;
}

/** Um valor em número, para comparar ordens de grandeza. `null` quando o
 *  formato não é o do pt-BR — aí quem chama simplesmente não compara. */
export function valorEmNumero(v: string): number | null {
  const cru = v.replace(/\s/g, "").replace(/^(?:R\$|US\$|\$|€|£)/, "")
    .replace(/%$/, "").replace(/[a-zà-ÿ]+$/i, "");
  // Milhar com ponto: "25.000" e "25.000,00". O ponto é separador, não decimal.
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/.test(cru)) {
    return Number(cru.replace(/\./g, "").replace(",", "."));
  }
  // Vírgula decimal, ponto decimal, ou inteiro.
  if (/^\d+(?:[.,]\d+)?$/.test(cru)) return Number(cru.replace(",", "."));
  return null;
}

/** Abreviaturas cujo ponto NÃO termina a frase. A lista é curta e existe por
 *  um caso concreto: a apostila de estoque escreveu
 *  "= R$125.00 (Sr. João) + R$25.00 … = R$185.00", e cortar em "Sr. João"
 *  partia a soma ao meio — o rótulo ficava com a primeira parcela, R$ 125,00,
 *  em vez do total, R$ 185,00. Era esse total que a ponte precisava carregar
 *  para o módulo 3, onde ele reapareceu como R$ 50,00. */
const ABREVIATURA_RE = /(?:sr|sra|srs|dr|dra|prof|profa|ex|art|pág|pag|fig|nº|no|etc|aprox|máx|max|mín|min)\.$/i;

/**
 * Recorta o parágrafo em orações. Uma oração carrega um rótulo e um valor; sem
 * o corte, o rótulo de uma frase gruda no valor da seguinte.
 *
 * Dois pontos NÃO cortam: o de uma abreviatura, e o que está dentro de um
 * parêntese ainda aberto. Ambos aparecem no meio de contas.
 */
export function oracoes(paragrafo: string): string[] {
  const out: string[] = [];
  let inicio = 0;
  let profundidade = 0;
  for (let i = 0; i < paragrafo.length; i++) {
    const c = paragrafo[i];
    if (c === "(") profundidade++;
    else if (c === ")") profundidade = Math.max(0, profundidade - 1);
    else if ((c === "." || c === ";") && profundidade === 0) {
      const depois = paragrafo.slice(i + 1);
      if (!/^\s/.test(depois)) continue;
      if (ABREVIATURA_RE.test(paragrafo.slice(Math.max(0, i - 8), i + 1))) continue;
      const salto = depois.match(/^\s+/)![0].length;
      out.push(paragrafo.slice(inicio, i + 1));
      inicio = i + 1 + salto;
      i = inicio - 1;
    }
  }
  if (inicio < paragrafo.length) out.push(paragrafo.slice(inicio));
  // O enumerador " 1. " de uma solução em passos também separa orações, e não
  // é ponto final de nada.
  return out.flatMap((o) => o.split(/\s+\d\.\s+/)).filter((o) => o.trim());
}

/** Parágrafos numa linha só cada, que é a forma que a leitura espera. */
export function paragrafosDe(texto: string): string[] {
  return String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export interface Caso {
  /** Os nomes próprios do caso condutor, do mais geral ao mais específico. */
  nomes: string[];
  /** Quantos parágrafos citam cada nome — a medida de "quão específico". */
  frequencia: Map<string, number>;
  /** As raízes das palavras dos nomes, para não entrarem no rótulo. */
  tokens: Set<string>;
}

/**
 * Quem é o caso condutor do curso.
 *
 * Um nome só entra se o texto o apresentou entre aspas, se ele reaparece em
 * pelo menos `minFontes` blocos distintos (módulos, ou lições) e se aparece em
 * três parágrafos ou mais. Um curso sem caso condutor devolve lista vazia, e
 * quem chama não injeta nada — que é o comportamento certo: sem âncora, todo
 * valor lido é um palpite.
 */
export function identificarCaso(
  blocos: Array<{ paragrafos: string[] }>,
  minFontes = 2,
): Caso {
  const citados = new Set<string>();
  for (const b of blocos) {
    for (const p of b.paragrafos) {
      for (const m of p.matchAll(NOME_CITADO_RE)) citados.add(m[1].trim());
    }
  }
  const frequencia = new Map<string, number>();
  const fontesDoNome = new Map<string, number>();
  for (const b of blocos) {
    const vistosNesteBloco = new Set<string>();
    for (const p of b.paragrafos) {
      for (const nome of citados) {
        if (!p.includes(nome)) continue;
        frequencia.set(nome, (frequencia.get(nome) ?? 0) + 1);
        vistosNesteBloco.add(nome);
      }
    }
    for (const nome of vistosNesteBloco) {
      fontesDoNome.set(nome, (fontesDoNome.get(nome) ?? 0) + 1);
    }
  }
  const nomes = [...citados].filter((n) =>
    (fontesDoNome.get(n) ?? 0) >= minFontes && (frequencia.get(n) ?? 0) >= 3
  );
  return {
    nomes,
    frequencia,
    tokens: new Set(nomes.flatMap((n) => n.split(/\s+/).map(raizDaPalavra))),
  };
}

export interface Grandeza {
  /** Chave normalizada, para agrupar: "custo variavel". */
  chave: string;
  /** Como o texto escreveu, para mostrar a gente: "Custos Variáveis". */
  rotulo: string;
  /** O nome do caso a que esta grandeza pertence. */
  caso: string;
  /** O valor como o texto escreveu: "R$ 7,20". */
  valor: string;
  /** O valor em número, ou null quando o formato não é reconhecido. */
  numero: number | null;
  /** A oração de onde saiu, para servir de evidência. */
  trecho: string;
  /**
   * A quem a oração prendeu a grandeza: as palavras de conteúdo que vêm depois
   * de uma preposição dentro do rótulo — "do Pão Tradicional", "para o bolo
   * artesanal", "por garrafa".
   *
   * Existe por um falso alarme medido: no curso de padaria, "Preço de Venda
   * Unitário do Pão Tradicional: R$ 5,00" e "O Preço de Venda calculado para o
   * novo bolo artesanal é de R$ 62,50" caem na mesma chave ("preço venda") e no
   * mesmo caso ('Pão Fresco', que é a PADARIA), porque nem o pão nem o bolo
   * aparecem entre aspas para servirem de âncora mais específica. São dois
   * produtos, não uma contradição.
   */
  complemento: Set<string>;
}

/** Preposições que introduzem o complemento do rótulo. */
const PREPOSICAO = new Set(
  "de do da dos das para por em no na nos nas com sobre entre a ao aos as".split(" "),
);

/**
 * A chave e o rótulo da grandeza a partir do que o texto escreveu antes do
 * valor. `null` quando não sobram duas palavras de conteúdo — e não sobrar é
 * um desfecho legítimo, que apenas não produz leitura nenhuma.
 */
function lerRotulo(
  bruto: string,
  tokensDoCaso: Set<string>,
): { chave: string; rotulo: string; complemento: Set<string> } | null {
  const palavras = bruto.match(/[\wÀ-ÿ]+/g) ?? [];
  const conteudo: Array<{ i: number; raiz: string }> = [];
  palavras.forEach((p, i) => {
    const raiz = raizDaPalavra(p);
    if (
      raiz.length > 2 && !PALAVRAS_VAZIAS.has(raiz) && !tokensDoCaso.has(raiz) &&
      !/^\d/.test(raiz)
    ) conteudo.push({ i, raiz });
  });
  if (conteudo.length < 2) return null;
  // O rótulo exibido vai da primeira à segunda palavra de conteúdo, inclusive
  // o que estiver no meio: "preço" + "venda" devolve "preço de venda".
  // O complemento começa DEPOIS da segunda palavra de conteúdo: o que vem antes
  // é a própria grandeza ("preço DE venda"), não a coisa a que ela se aplica.
  const complemento = new Set<string>();
  for (let i = conteudo[1].i + 1; i < palavras.length; i++) {
    if (!PREPOSICAO.has(semAcento(palavras[i]))) continue;
    for (let j = i + 1; j < palavras.length; j++) {
      const raiz = raizDaPalavra(palavras[j]);
      if (PREPOSICAO.has(raiz) || PALAVRAS_VAZIAS.has(raiz)) continue;
      if (raiz.length > 2 && !tokensDoCaso.has(raiz) && !/^\d/.test(raiz)) {
        complemento.add(raiz);
      }
    }
    break;
  }
  return {
    chave: `${conteudo[0].raiz} ${conteudo[1].raiz}`,
    rotulo: palavras.slice(conteudo[0].i, conteudo[1].i + 1).join(" "),
    complemento,
  };
}

/**
 * Dois valores falam da MESMA coisa?
 *
 * Sim quando os complementos se tocam, e sim quando um dos lados não tem
 * complemento nenhum — aí não há nada a contradizer. Não quando cada lado
 * prende a grandeza a um objeto diferente: aí são duas medidas, não uma
 * divergência.
 */
export function mesmoObjeto(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return true;
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * As grandezas que um texto fixou para o caso condutor.
 *
 * Só lê parágrafos que citam o caso, e atribui cada grandeza ao nome MAIS
 * ESPECÍFICO ali presente — o de menor frequência no curso. Um parágrafo que
 * fala do suco 'Imunidade' e cita a empresa pertence ao suco, não à empresa.
 */
export function grandezasDoTexto(texto: string, caso: Caso): Grandeza[] {
  if (!caso.nomes.length) return [];
  const out: Grandeza[] = [];
  for (const p of paragrafosDe(texto)) {
    const presentes = caso.nomes.filter((n) => p.includes(n));
    if (!presentes.length) continue;
    const alvo = presentes.reduce((a, b) =>
      (caso.frequencia.get(b) ?? 0) < (caso.frequencia.get(a) ?? 0) ? b : a
    );
    for (const oracao of oracoes(p)) {
      for (const m of oracao.matchAll(ROTULO_E_VALOR_RE)) {
        const lido = lerRotulo(m.groups?.rotulo ?? "", caso.tokens);
        if (!lido) continue;
        // Numa soma, o que vale é o total depois do "=", não a primeira parcela:
        // "R$8,00 + R$1,50 + R$2,00 + R$1,25 = R$12,75" fixa R$ 12,75.
        const bruto = m.groups?.total ??
          m.groups?.expressao?.match(PRIMEIRO_VALOR_RE)?.[0];
        if (!bruto) continue;
        const valor = bruto.replace(/\s+/g, " ").trim();
        out.push({
          chave: lido.chave,
          rotulo: lido.rotulo,
          caso: alvo,
          valor,
          numero: valorEmNumero(valor),
          trecho: oracao.trim(),
          complemento: lido.complemento,
        });
      }
    }
  }
  return out;
}

/**
 * Duas grandezas diferentes podem começar com as mesmas duas palavras:
 * "custos fixos MENSAIS" (R$ 25.000) e "custos fixos RATEADOS POR UNIDADE"
 * (R$ 3,50). Ordens de grandeza distantes denunciam isso — R$ 25.000 e R$ 3,50
 * não são o mesmo número escrito de dois jeitos, são dois números diferentes.
 *
 * Quando algum valor do grupo não é legível como número, o filtro não age: sem
 * saber comparar, não se descarta nada.
 */
export function mesmaOrdemDeGrandeza(numeros: Array<number | null>): boolean[] {
  if (!numeros.every((n) => n !== null && n > 0)) return numeros.map(() => true);
  const ordenados = (numeros as number[]).slice().sort((a, b) => a - b);
  const mediana = ordenados[Math.floor(ordenados.length / 2)];
  return (numeros as number[]).map((n) =>
    n / mediana >= 0.05 && n / mediana <= 20
  );
}
