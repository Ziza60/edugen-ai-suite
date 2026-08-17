// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — comparação de textos para a tela de aprovação da edição por IA
//
// POR QUE ISTO EXISTE
//
// A tela que o autor usa para aceitar ou rejeitar uma edição da IA mostrava os
// dois textos lado a lado e mais nada. O painel da direita vinha com um fundo
// tingido inteiro, que se lia como "isto aqui mudou" — mas era só a cor do
// painel. Para saber o que a IA tinha feito, o autor precisava ler o antes e o
// depois inteiros e comparar de cabeça. Numa seção de curso, isso é dois mil
// caracteres de cada lado.
//
// O contador de "linhas modificadas" também mentia: comparava a linha 1 com a
// linha 1, a 2 com a 2. Bastava a IA remover uma linha no começo para tudo o
// que vinha depois entrar na conta como alterado.
//
// Aqui mora a comparação de verdade — alinhamento por maior subsequência comum,
// primeiro entre linhas e depois entre palavras dentro das linhas que foram
// reescritas. Fica separado da tela porque comparação é lógica pura e a tela é
// desenho; e porque assim dá para testar sem montar componente.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoLinha = "igual" | "removida" | "adicionada" | "alterada";

export interface PedacoTexto {
  texto: string;
  tipo: "igual" | "removido" | "adicionado";
}

export interface LinhaDiff {
  tipo: TipoLinha;
  /** Conteúdo do lado esquerdo. Ausente em linha só adicionada. */
  antes?: string;
  /** Conteúdo do lado direito. Ausente em linha só removida. */
  depois?: string;
  /** Em linha "alterada": o antes quebrado em pedaços iguais e removidos. */
  pedacosAntes?: PedacoTexto[];
  /** Em linha "alterada": o depois quebrado em pedaços iguais e adicionados. */
  pedacosDepois?: PedacoTexto[];
}

/**
 * Acima disto, o alinhamento por subsequência comum sai caro demais para rodar
 * no navegador enquanto o autor espera. Só a parte do meio conta: prefixo e
 * sufixo iguais são cortados antes, e é o que costuma sobrar de um texto
 * editado por IA. Passando do teto, o meio inteiro vira "removido + adicionado"
 * — mais grosseiro, mas honesto e imediato.
 */
const TETO_ALINHAMENTO = 1200;

/**
 * Quão parecidas duas linhas precisam ser para valer a pena mostrá-las como
 * UMA linha reescrita, com destaque palavra a palavra, em vez de duas linhas
 * soltas. Abaixo disso a comparação palavra a palavra vira ruído: quase tudo
 * aparece marcado e não ajuda ninguém.
 */
const SEMELHANCA_MINIMA = 0.5;

/** Compara dois textos linha a linha, com detalhe por palavra onde couber. */
export function diffLinhas(antes: string, depois: string): LinhaDiff[] {
  // Texto vazio é ZERO linha, não uma linha em branco: "".split("\n") devolve
  // [""], e sem esta ressalva um lado vazio apareceria como uma linha removida
  // fantasma ao lado do conteúdo real do outro.
  const a = antes ? antes.split("\n") : [];
  const b = depois ? depois.split("\n") : [];

  // Prefixo e sufixo iguais saem fora do alinhamento: são a maior parte de uma
  // edição localizada, e mantê-los no cálculo só custa tempo.
  let inicio = 0;
  while (inicio < a.length && inicio < b.length && a[inicio] === b[inicio]) inicio++;

  let fimA = a.length;
  let fimB = b.length;
  while (fimA > inicio && fimB > inicio && a[fimA - 1] === b[fimB - 1]) {
    fimA--;
    fimB--;
  }

  const saida: LinhaDiff[] = [];
  for (let i = 0; i < inicio; i++) {
    saida.push({ tipo: "igual", antes: a[i], depois: a[i] });
  }

  const meioA = a.slice(inicio, fimA);
  const meioB = b.slice(inicio, fimB);
  saida.push(...alinharMeio(meioA, meioB));

  for (let i = fimA; i < a.length; i++) {
    saida.push({ tipo: "igual", antes: a[i], depois: a[i] });
  }
  return saida;
}

function alinharMeio(a: string[], b: string[]): LinhaDiff[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((l) => ({ tipo: "adicionada" as const, depois: l }));
  if (b.length === 0) return a.map((l) => ({ tipo: "removida" as const, antes: l }));

  if (a.length > TETO_ALINHAMENTO || b.length > TETO_ALINHAMENTO) {
    return [
      ...a.map((l) => ({ tipo: "removida" as const, antes: l })),
      ...b.map((l) => ({ tipo: "adicionada" as const, depois: l })),
    ];
  }

  const comuns = subsequenciaComum(a, b);
  const bruto: LinhaDiff[] = [];
  let i = 0;
  let j = 0;
  for (const [ia, ib] of comuns) {
    while (i < ia) bruto.push({ tipo: "removida", antes: a[i++] });
    while (j < ib) bruto.push({ tipo: "adicionada", depois: b[j++] });
    bruto.push({ tipo: "igual", antes: a[i], depois: b[j] });
    i++;
    j++;
  }
  while (i < a.length) bruto.push({ tipo: "removida", antes: a[i++] });
  while (j < b.length) bruto.push({ tipo: "adicionada", depois: b[j++] });

  return casarReescritas(bruto);
}

/**
 * Onde uma linha removida corresponde a uma adicionada parecida, as duas viram
 * uma linha "alterada" com destaque palavra a palavra. É o caso mais comum de
 * uma edição por IA — a frase foi reescrita, não trocada por outra — e é onde
 * o destaque rende mais para quem lê.
 *
 * O casamento é por BLOCO, não por vizinhança. Quando várias linhas seguidas
 * são reescritas — reescrever uma lista de seis objetivos, por exemplo — o
 * alinhamento produz as seis removidas e SÓ ENTÃO as seis adicionadas. Casando
 * apenas o par encostado, cinco das seis apareciam sem marcação nenhuma e o
 * painel da direita ficava com um buraco do tamanho do bloco. Aqui as duas
 * corridas são emparelhadas na ordem, que é a ordem em que a IA reescreve.
 */
function casarReescritas(linhas: LinhaDiff[]): LinhaDiff[] {
  const saida: LinhaDiff[] = [];
  let k = 0;
  while (k < linhas.length) {
    if (linhas[k].tipo !== "removida") {
      saida.push(linhas[k]);
      k++;
      continue;
    }

    let fimRemovidas = k;
    while (fimRemovidas < linhas.length && linhas[fimRemovidas].tipo === "removida") fimRemovidas++;
    let fimAdicionadas = fimRemovidas;
    while (
      fimAdicionadas < linhas.length && linhas[fimAdicionadas].tipo === "adicionada"
    ) fimAdicionadas++;

    const removidas = linhas.slice(k, fimRemovidas);
    const adicionadas = linhas.slice(fimRemovidas, fimAdicionadas);
    saida.push(...emparelhar(removidas, adicionadas));
    k = fimAdicionadas;
  }
  return saida;
}

function emparelhar(removidas: LinhaDiff[], adicionadas: LinhaDiff[]): LinhaDiff[] {
  const saida: LinhaDiff[] = [];
  const pares = Math.min(removidas.length, adicionadas.length);
  let i = 0;
  for (; i < pares; i++) {
    const antes = removidas[i].antes ?? "";
    const depois = adicionadas[i].depois ?? "";
    if (semelhanca(antes, depois) < SEMELHANCA_MINIMA) break;
    const [pa, pd] = diffPalavras(antes, depois);
    saida.push({ tipo: "alterada", antes, depois, pedacosAntes: pa, pedacosDepois: pd });
  }
  // O que não casou segue como saiu: removidas de um lado, adicionadas do outro.
  saida.push(...removidas.slice(i));
  saida.push(...adicionadas.slice(i));
  return saida;
}

/**
 * Quanto duas linhas se parecem, de 0 a 1.
 *
 * Duas medidas, e vale a maior. A primeira é a proporção de palavras comuns
 * sobre o total dos dois lados — boa quando as linhas têm tamanho parecido. Ela
 * sozinha não serve, porque penaliza exatamente o caso mais comum aqui: o
 * "Encurtar". "Este curso premium é projetado para capacitar servidores
 * municipais." virando "Capacita servidores municipais." dá 0,33 por essa
 * conta, e as duas apareceriam como linhas soltas em vez de uma reescrita.
 *
 * A segunda mede quanto da linha MENOR sobreviveu na maior — 0,67 no exemplo.
 * Ela exige pelo menos duas palavras em comum: com uma só, uma linha curta
 * casaria com qualquer parágrafo que por acaso repetisse aquela palavra.
 */
export function semelhanca(a: string, b: string): number {
  const pa = palavras(a).filter((p) => p.trim());
  const pb = palavras(b).filter((p) => p.trim());
  if (pa.length === 0 && pb.length === 0) return 1;
  if (pa.length === 0 || pb.length === 0) return 0;

  const comuns = subsequenciaComum(pa, pb).length;
  const proporcaoNoTotal = (2 * comuns) / (pa.length + pb.length);
  const sobrevivenciaNaMenor = comuns >= 2 ? comuns / Math.min(pa.length, pb.length) : 0;
  return Math.max(proporcaoNoTotal, sobrevivenciaNaMenor);
}

/**
 * Quebra em palavras PRESERVANDO os espaços como itens próprios, para que o
 * texto remontado a partir dos pedaços seja idêntico ao original — inclusive a
 * indentação, que em markdown muda o significado da linha.
 */
export function palavras(linha: string): string[] {
  return (linha ?? "").split(/(\s+)/).filter((p) => p !== "");
}

/** Compara duas linhas palavra a palavra. Devolve [pedaçosAntes, pedaçosDepois]. */
export function diffPalavras(antes: string, depois: string): [PedacoTexto[], PedacoTexto[]] {
  const a = palavras(antes);
  const b = palavras(depois);
  const comuns = new Set(subsequenciaComum(a, b).map(([ia, ib]) => `${ia}:${ib}`));

  const paresA = new Map<number, boolean>();
  const paresB = new Map<number, boolean>();
  for (const chave of comuns) {
    const [ia, ib] = chave.split(":").map(Number);
    paresA.set(ia, true);
    paresB.set(ib, true);
  }

  return [
    juntar(a.map((t, i) => ({ texto: t, tipo: paresA.has(i) ? "igual" : "removido" as const }))),
    juntar(b.map((t, i) => ({ texto: t, tipo: paresB.has(i) ? "igual" : "adicionado" as const }))),
  ];
}

/** Funde pedaços vizinhos do mesmo tipo, para não pintar palavra por palavra. */
function juntar(pedacos: PedacoTexto[]): PedacoTexto[] {
  const saida: PedacoTexto[] = [];
  for (const p of pedacos) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && ultimo.tipo === p.tipo) ultimo.texto += p.texto;
    else saida.push({ ...p });
  }
  return saida;
}

/**
 * Maior subsequência comum, devolvida como os pares de índices que casam.
 * Programação dinâmica clássica: é o que alinha os dois lados de um diff.
 */
function subsequenciaComum<T>(a: T[], b: T[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  // Uma linha da matriz por vez não serve aqui porque precisamos refazer o
  // caminho no fim; a matriz inteira cabe dentro do teto que já limitamos.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pares: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pares.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pares;
}

/** Quantas linhas mudaram de fato — sem contar as que só escorregaram de posição. */
export function contarLinhasAlteradas(antes: string, depois: string): number {
  return diffLinhas(antes, depois).filter((l) => l.tipo !== "igual").length;
}

export interface TrechoDeDiff {
  /** As linhas deste trecho. */
  linhas: LinhaDiff[];
  /** Quantas linhas iguais foram escondidas ANTES deste trecho. */
  ocultasAntes: number;
}

/**
 * Agrupa o diff em trechos com alteração, guardando algumas linhas iguais de
 * cada lado como contexto e escondendo os blocos longos sem mudança.
 *
 * É o que responde à queixa de origem — "o autor tem que ler tudo para achar a
 * alteração". Num módulo inteiro, o que mudou costuma ser uma fração pequena.
 */
export function agruparEmTrechos(linhas: LinhaDiff[], contexto = 2): TrechoDeDiff[] {
  const relevante = linhas.map((l) => l.tipo !== "igual");
  if (!relevante.some(Boolean)) return [];

  const manter = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i++) {
    if (!relevante[i]) continue;
    for (let j = Math.max(0, i - contexto); j <= Math.min(linhas.length - 1, i + contexto); j++) {
      manter[j] = true;
    }
  }

  const trechos: TrechoDeDiff[] = [];
  let ocultas = 0;
  let atual: LinhaDiff[] = [];
  for (let i = 0; i < linhas.length; i++) {
    if (manter[i]) {
      atual.push(linhas[i]);
    } else if (atual.length) {
      trechos.push({ linhas: atual, ocultasAntes: ocultas });
      atual = [];
      ocultas = 1;
    } else {
      ocultas++;
    }
  }
  if (atual.length) trechos.push({ linhas: atual, ocultasAntes: ocultas });
  return trechos;
}
