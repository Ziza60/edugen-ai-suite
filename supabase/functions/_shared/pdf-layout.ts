// ═══════════════════════════════════════════════════════════════════════════
// Cálculos de layout do PDF que não dependem do jsPDF
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A imagem do módulo e a página de sumário já existiram no export-pdf e se
// perderam quando ele foi separado em arquivos. Nada acusou: eram funções sem
// teste dentro de um arquivo de 1.900 linhas, e a refatoração as deixou para
// trás em silêncio. O curso continuou saindo — só que sem as imagens que o
// autor pagou para gerar, e sem sumário.
//
// O que dá para testar sem abrir um PDF mora aqui: a conta de proporção da
// imagem, a identificação do formato pelos bytes e a regra de quebra do título
// no sumário. O desenho em si continua no export-pdf, onde precisa do jsPDF.
// ═══════════════════════════════════════════════════════════════════════════

/** Formatos que o addImage do jsPDF aceita. */
export type ImageFormat = "PNG" | "JPEG";

/**
 * Descobre o formato pelos bytes do arquivo.
 *
 * A versão anterior decidia pelo cabeçalho content-type e pela extensão da URL.
 * Isso erra em dois casos que acontecem: o Pexels serve imagem sem extensão na
 * URL, e um WebP com content-type errado era tratado como JPEG — o addImage
 * falhava e a imagem sumia sem mensagem. Ler os bytes não depende de ninguém
 * ter configurado o cabeçalho direito.
 *
 * Devolve null para o que o jsPDF não sabe desenhar (WebP, GIF, SVG), para que
 * quem chama registre o motivo em vez de estourar uma exceção genérica.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "PNG";

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";

  return null;
}

export interface CaixaImagem {
  w: number;
  h: number;
}

/**
 * Encaixa a imagem na área disponível preservando a proporção.
 *
 * Primeiro tenta ocupar toda a largura; se com isso a altura passar do teto,
 * reduz pela altura. O teto de altura existe para a imagem não empurrar o texto
 * do módulo para a página seguinte.
 */
export function fitImageBox(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): CaixaImagem {
  if (!(imgW > 0) || !(imgH > 0)) return { w: maxW, h: maxH };

  let w = maxW;
  let h = (imgH / imgW) * w;
  if (h > maxH) {
    h = maxH;
    w = (imgW / imgH) * h;
  }
  return { w, h };
}

export interface DesenhoImagem {
  x: number;
  y: number;
  w: number;
  h: number;
  /** true quando a imagem foi ampliada além da faixa e precisa de recorte. */
  recortada: boolean;
}

/**
 * Fração da imagem que se aceita perder no recorte antes de desistir de
 * preencher. Uma foto em pé numa faixa deitada precisaria de um corte enorme, e
 * o que sobra na tela é uma tira fina que não se lê. Nesse caso vale mais a
 * sobra branca das laterais do que uma fatia sem sentido.
 */
const PERDA_MAXIMA = 0.6;

/**
 * Preenche a faixa INTEIRA com a imagem, sem distorcer: amplia até cobrir os
 * dois lados e centraliza, deixando o excedente para fora — quem chama recorta
 * na faixa.
 *
 * Por que não basta o fitImageBox: ele encaixa a imagem DENTRO da faixa, então
 * sobra branco no lado que não limitou. Na capa do PDF a faixa tem 162 x 62 mm
 * e a imagem gerada é 16:9; encaixando, ela saía com 108,5 mm e deixava 53,5 mm
 * de branco — um terço da largura reservada, vazio. Onde a faixa é fixa e o
 * espaço não é reaproveitado por mais nada, encaixar é desperdício.
 *
 * O fitImageBox continua certo onde a imagem FLUI com o texto (a do módulo): lá
 * a altura não é reservada, ela empurra o que vem depois, e recortar só perderia
 * conteúdo sem ganhar espaço nenhum.
 */
export function fillImageBox(
  imgW: number,
  imgH: number,
  caixaX: number,
  caixaY: number,
  caixaW: number,
  caixaH: number,
): DesenhoImagem {
  if (!(imgW > 0) || !(imgH > 0)) {
    return { x: caixaX, y: caixaY, w: caixaW, h: caixaH, recortada: false };
  }

  const escala = Math.max(caixaW / imgW, caixaH / imgH);
  const w = imgW * escala;
  const h = imgH * escala;

  const perda = 1 - (caixaW * caixaH) / (w * h);
  if (perda > PERDA_MAXIMA) {
    const encaixe = fitImageBox(imgW, imgH, caixaW, caixaH);
    return {
      x: caixaX + (caixaW - encaixe.w) / 2,
      y: caixaY + (caixaH - encaixe.h) / 2,
      w: encaixe.w,
      h: encaixe.h,
      recortada: false,
    };
  }

  // A marca diz se sobra imagem para fora da faixa — não se o caminho de
  // preenchimento foi tomado. Quando a imagem já vem na proporção da faixa,
  // ela preenche sem sobrar nada, e recortar seria trabalho à toa.
  const FOLGA = 1e-9;
  return {
    x: caixaX + (caixaW - w) / 2,
    y: caixaY + (caixaH - h) / 2,
    w,
    h,
    recortada: w > caixaW + FOLGA || h > caixaH + FOLGA,
  };
}

/** Quanto uma maiúscula sobe acima da linha de base, em fração do corpo. */
const ALTURA_CAIXA_ALTA = 0.72;
/** Quanto uma descendente (g, p, q) desce abaixo da linha de base. */
const DESCIDA = 0.21;
/** Pontos por milímetro. */
const PT_POR_MM = 72 / 25.4;

/**
 * Espaçamento real entre linhas de um texto de várias linhas, em milímetros.
 *
 * O jsPDF empilha as linhas em corpo × fator, e o corpo é dado em pontos. O
 * sumário assumia 5,2 mm fixos enquanto o jsPDF usava 4,26 — de modo que, num
 * título de duas linhas, os pontinhos e o número da página caíam um milímetro
 * abaixo da segunda linha em vez de alinhados com ela.
 */
export function lineHeightMm(fontSizePt: number, lineHeightFactor = 1.15): number {
  return (fontSizePt * lineHeightFactor) / PT_POR_MM;
}

// ── Símbolos que a fonte do PDF não sabe desenhar ───────────────────────────
//
// O DEFEITO: numa tabela de conferência dos mínimos constitucionais, a célula
// dizia «Verificar se Gasto Efetivo "e Mínimo Saúde». O autor escreveu
// «Gasto Efetivo ≥ Mínimo Saúde». O ≥ virou `"e`.
//
// A CAUSA: as fontes padrão do PDF usam a codificação WinAnsi, que só alcança o
// Latin-1 mais uma pequena tabela extra. O ≥ (U+2265) está fora dela. O jsPDF
// não avisa e não desenha um quadradinho — ele emite os bytes do caractere como
// se fossem Latin-1, e o leitor mostra os caracteres correspondentes. Ou seja: o
// texto sai ERRADO em vez de sair faltando, que é o pior dos dois mundos, porque
// ninguém percebe pela ausência.
//
// A CORREÇÃO tem duas camadas. Primeiro, traduzir os símbolos que têm
// equivalente óbvio em ASCII — ≥ vira >=, → vira ->, ≠ vira !=. Depois, uma rede
// para o que sobrar acima do Latin-1: sai do texto. Um caractere que a fonte não
// sabe desenhar já estava perdido; tirá-lo é melhor que exibi-lo mutilado.

/**
 * Símbolos comuns em material técnico, com o equivalente que a fonte desenha.
 *
 * A pontuação tipográfica (travessão, aspas curvas, reticências) entra aqui
 * mesmo já sendo tratada pelo chamador: ela também está acima do Latin-1, e uma
 * função que se basta sozinha não depende da ordem em que é chamada. Aplicar
 * duas vezes não muda nada.
 */
const SIMBOLOS: Array<[RegExp, string]> = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[«»]/g, '"'],
  [/[‹›]/g, "'"],
  [/[–—―]/g, "-"],
  [/[…]/g, "..."],
  [/[≥]/g, ">="],
  [/[≤]/g, "<="],
  [/[≠]/g, "!="],
  [/[≈≅≃]/g, "~="],
  [/[≡]/g, "=="],
  [/[→➡⇒]/g, "->"],
  [/[←⇐]/g, "<-"],
  [/[↔⇔]/g, "<->"],
  [/[↑]/g, "^"],
  [/[↓]/g, "v"],
  [/[−]/g, "-"],
  [/[⁄∕]/g, "/"],
  [/[•●▪■‣⁃]/g, "-"],
  [/[∞]/g, "infinito"],
  [/[′]/g, "'"],
  [/[″]/g, '"'],
  [/[✓✔]/g, "OK"],
  [/[✗✘❌]/g, "X"],
  [/[     ]/g, " "],
  [/[‑]/g, "-"],

  // ── MATEMÁTICA ────────────────────────────────────────────────────────────
  // A rede de segurança abaixo apagava estes em silêncio, e com a raiz quadrada
  // isso trocou matemática certa por errada. O PDF do curso de estoque imprimia:
  //
  //     LEC = ((2 * 1200 * 50) / 3)
  //     LEC = (40000)
  //     LEC = 200 unidades
  //
  // Sem o √, a última linha é falsa: 40000 não é 200. O PPTX mostrava a fórmula
  // correta porque não passa por aqui — só o PDF perdia o símbolo. Um curso que
  // ensina a calcular não pode imprimir a conta errada.
  [/[√]/g, "sqrt"],
  [/[∛]/g, "raiz cubica de "],
  // × (U+00D7) e ÷ (U+00F7) NÃO entram: são Latin-1, a fonte os desenha, e
  // traduzi-los seria piorar um texto que já estava certo. Só o gêmeo de cima
  // da tabela é que precisa de equivalente.
  [/[⨯]/g, "x"],
  [/[∙⋅]/g, "*"],
  [/[∑]/g, "soma de "],
  [/[∏]/g, "produto de "],
  [/[Δ∆]/g, "delta "],
  [/[π]/g, "pi"],
  [/[≫]/g, ">>"],
  [/[≪]/g, "<<"],
  [/[⅓]/g, "1/3"],
  [/[⅔]/g, "2/3"],
  [/[⅕]/g, "1/5"],
  [/[⁰]/g, "^0"],
  [/[⁴]/g, "^4"],
  [/[⁵]/g, "^5"],
  [/[⁶]/g, "^6"],
  [/[⁷]/g, "^7"],
  [/[⁸]/g, "^8"],
  [/[⁹]/g, "^9"],
  [/[ⁿ]/g, "^n"],
];

/**
 * Deixa o texto com apenas caracteres que a fonte do PDF sabe desenhar.
 *
 * Traduz os símbolos com equivalente conhecido e remove o que restar acima do
 * Latin-1. Nunca lança: texto do curso não pode custar a apostila.
 */
export function transliterarSimbolos(texto: string): string {
  if (!texto) return "";
  let t = String(texto);
  for (const [re, sub] of SIMBOLOS) t = t.replace(re, sub);
  // A REDE DE SEGURANÇA PRECISA FAZER BARULHO
  //
  // Ela apagava caracteres sem deixar rastro, e foi assim que a raiz quadrada
  // sumiu de um curso de cálculo de estoque sem ninguém perceber por semanas.
  // Apagar continua sendo o certo — a fonte não desenha o que não conhece —,
  // mas agora fica registrado o que foi apagado, para que a próxima lacuna do
  // mapa apareça no log em vez de aparecer no material do cliente.
  const perdidos = t.match(/[^\u0020-\u00FF]/g);
  if (perdidos) {
    const distintos = [...new Set(perdidos)];
    console.warn(
      `[PDF-SIMBOLOS] sem equivalente no mapa, removidos: ${
        distintos.map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`).join(", ")
      }`,
    );
  }
  // Rede final. O intervalo Latin-1 (até U+00FF) cobre todo o português; o que
  // passa disso e não foi traduzido acima a fonte não desenha.
  return t.replace(/[^ -ÿ]/g, "");
}

// ── Largura de palavra para justificação ────────────────────────────────────
//
// O DEFEITO: "PPAé", "PPAà", "PPApara", "Tomadade Contas". Palavras coladas na
// seguinte, sempre as mesmas — relatado numa avaliação do material e conferido
// no PDF: na frase "O PPA é mais do que um documento legal", o espaço depois de
// PPA mede 1,51 pt onde os outros espaços da MESMA linha medem 2,7 a 3,0.
//
// A CAUSA: o parágrafo justificado é desenhado palavra a palavra, avançando
// `x += doc.getTextWidth(palavra) + folga`. E o `getTextWidth` do jsPDF aplica
// o KERNING da fonte, enquanto o `doc.text()` desenha um `Tj` simples, sem
// kerning nenhum. A palavra então ocupa mais espaço do que foi medido, e a
// diferença é descontada do espaço seguinte. Medido na própria biblioteca:
//
//   getTextWidth("PPA")    19,53 pt   soma caractere a caractere  20,79 pt
//   getTextWidth("Tomada") 36,96 pt   soma caractere a caractere  38,22 pt
//   getTextWidth("LDO")    21,52 pt   soma caractere a caractere  21,52 pt
//
// Só erra quem tem par de kerning. "PA" e "To" têm; "LDO", "LOA", "RGF" não —
// e é exatamente por isso que o relato citou PPA e Tomada, e nunca LDO ou LOA.
// A tabela da Helvetica desconta 120 milésimos de em no par "PA", que a 10,5 pt
// dá 1,26 pt: o tamanho do buraco que aparece no papel.
//
// A CORREÇÃO: medir caractere a caractere. Um caractere sozinho não forma par,
// então a soma é a largura que o `Tj` realmente desenha. A justificação passa a
// distribuir folga igual de verdade.
//
// Não dá para "consertar o kerning" desenhando com ele: quem decide é o
// visualizador de PDF a partir do `Tj`, e o jsPDF 2.5.2 não emite os ajustes de
// TJ que aplicariam o kerning. Medir como se desenha é o que fecha a conta.

/**
 * Cria um medidor de palavras que ignora kerning, com cache por caractere.
 *
 * Recebe a função de medir do jsPDF (`(t) => doc.getTextWidth(t)`) e devolve
 * uma função que mede palavras somando caractere a caractere. O cache existe
 * porque um curso de 90 páginas mede dezenas de milhares de palavras e o
 * alfabeto tem algumas dezenas de caracteres.
 *
 * `medirCaractere` NUNCA recebe mais de um caractere — é essa a correção. Se
 * alguém "otimizar" isto passando a palavra inteira, o defeito volta.
 */
export function medidorSemKerning(
  medirCaractere: (t: string) => number,
): (palavra: string) => number {
  const cache = new Map<string, number>();
  return (palavra: string): number => {
    let total = 0;
    // Itera por ponto de código: "ç" e "ã" vêm do modelo em forma composta
    // (NFC) e medem como um caractere só, que é como o jsPDF os desenha.
    for (const ch of palavra) {
      let w = cache.get(ch);
      if (w === undefined) {
        const medido = medirCaractere(ch);
        w = Number.isFinite(medido) && medido > 0 ? medido : 0;
        cache.set(ch, w);
      }
      total += w;
    }
    return total;
  };
}

/**
 * Onde desenhar o traço separador entre dois itens do sumário.
 *
 * Recebe a linha de base da última linha do item de cima e o vão até o item de
 * baixo. Devolve um Y que não encosta em nenhum dos dois.
 *
 * A versão anterior desenhava o traço a 1 mm da linha de base do item seguinte.
 * Uma maiúscula de corpo 10,5 sobe 2,67 mm acima da base — então o traço não
 * ficava entre os itens, ele cortava as letras do título de baixo.
 */
export function tocSeparatorY(
  ultimaLinhaBaseY: number,
  vaoEntreItens: number,
  fontSizePt: number,
): number {
  const corpoMm = fontSizePt / PT_POR_MM;
  const limiteSuperior = ultimaLinhaBaseY + corpoMm * DESCIDA;
  const limiteInferior = ultimaLinhaBaseY + vaoEntreItens - corpoMm * ALTURA_CAIXA_ALTA;
  // Se o vão for apertado demais para caber o traço, fica no meio do que há.
  if (limiteInferior <= limiteSuperior) {
    return ultimaLinhaBaseY + vaoEntreItens / 2;
  }
  return (limiteSuperior + limiteInferior) / 2;
}

/**
 * Limita o título do sumário a um número de linhas, com reticências.
 *
 * O limite existe por causa do alinhamento: os pontinhos e o número da página
 * são ancorados na ÚLTIMA linha do título. Sem o corte, um título de quatro
 * linhas empurrava o número para longe do texto e o sumário deixava de ser
 * legível como uma tabela.
 */
export function tocTitleLines(linhas: string[], maxLinhas = 2): string[] {
  if (linhas.length <= maxLinhas) return linhas;

  const cortadas = linhas.slice(0, maxLinhas);
  const ultima = cortadas[maxLinhas - 1];
  cortadas[maxLinhas - 1] = ultima.length > 3 ? `${ultima.slice(0, -3)}…` : `${ultima}…`;
  return cortadas;
}
