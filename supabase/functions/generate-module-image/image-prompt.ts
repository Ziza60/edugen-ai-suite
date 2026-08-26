// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o texto que a IA de imagem recebe
//
// POR QUE O ENQUADRAMENTO É REGRA DO SISTEMA, E NÃO DO AUTOR
//
// A capa de um curso não é exibida inteira. No PDF ela entra numa faixa de
// 162 x 62 mm — proporção 2,6:1 — enquanto o gerador devolve 16:9 (1,78:1).
// Para preencher a faixa sem distorcer, o exportador amplia e recorta o topo e
// a base: sobra a terça parte central da altura. No PPTX é pior, porque a capa
// ocupa uma faixa VERTICAL e o recorte é lateral.
//
// Quem sabe disso é o sistema, não quem escreve a descrição. Enquanto essas
// regras não estavam aqui, a única saída era o autor adivinhá-las e repetir a
// cada curso — e uma descrição pedindo "margem igual nos quatro lados" fez o
// modelo desenhar um quadro COM MOLDURA. Cortado o topo e a base, sumiram os
// lados horizontais da moldura e ficaram duas listras verticais penduradas nas
// pontas, com um vazio enorme no meio.
//
// Pior: o estilo fixo pedia "generous negative space" para TODA imagem. Numa
// capa que vai ser cortada, pedir espaço vazio é pedir o defeito.
//
// Daí a separação abaixo. A descrição do autor diz O QUE aparece; estas regras
// dizem COMO a imagem tem de ser construída para sobreviver ao corte.
// ═══════════════════════════════════════════════════════════════════════════

export type EscopoImagem = "cover" | "module";

/** Vale para as duas: é o que impede letra deformada em selo, papel e placa. */
export const SEM_TEXTO =
  "Strict directive: purely visual — no text, no typography, no letters, no numbers, no logos, no watermarks. Any surface that would carry writing must be blank and smooth.";

/**
 * Aspas em volta de um título são um PEDIDO DE ESCRITA, não um rótulo.
 *
 * As imagens de módulo vinham com palavras deformadas em português, e o prompt
 * já terminava com SEM_TEXTO — em inglês, e estrito. A contradição estava três
 * linhas acima: o título do módulo e o do curso iam entre aspas.
 *
 *     Generate a conceptual illustration for the educational module
 *     "Gestão Ágil e Experimentação na Transformação" (course: "…").
 *     …
 *     Strict directive: purely visual — no text…
 *
 * Aspas delimitando texto são o idioma que modelos de imagem leem como "renderize
 * isto"; é assim que se pede um letreiro. Entregávamos duas frases longas em
 * português nessa forma e, em seguida, mandávamos não escrever nada. Entre uma
 * instrução concreta e uma proibição genérica, o modelo segue a concreta — e
 * erra a ortografia, porque desenhar letra não é escrever.
 *
 * O tema passa a ir como tema, sem delimitador. Perde-se a marcação visual de
 * onde o título começa e termina, e é uma troca que vale: o título é a última
 * coisa que deve aparecer desenhada numa ilustração cuja legenda já está na
 * página, e que ainda precisa servir ao curso traduzido para outro idioma.
 */
function comoTema(texto: string): string {
  // Aspas de qualquer família viram vírgula: o modelo continua lendo a frase
  // inteira como um assunto só, sem o convite a desenhá-la.
  return String(texto ?? "").replace(/["'\u2018\u2019\u201c\u201d]/g, "").trim();
}

/**
 * O QUE FALTA QUANDO NÃO HÁ DESCRIÇÃO: UMA CENA.
 *
 * Tirar as aspas do título ajudou, mas não era a causa principal. O relato que
 * a encontrou foi um teste do autor: "as imagens que eu não pedi ajuda da IA
 * para escrever o prompt ela gerou imagem com textos. Quando gerei imagens com
 * sugestão de prompt ela gerou imagens sem texto."
 *
 * A correlação é com a DESCRIÇÃO, não com as aspas. E olhando os dois prompts
 * lado a lado, o motivo salta:
 *
 *   com descrição .... "Uma balança de pratos metálica centraliza a cena. Um
 *                       dos pratos contém cubos cinzas empilhados…"
 *   sem descrição .... "an educational module about Análise Fundamentada de
 *                       Custos e Ponto de Equilíbrio"
 *
 * No segundo caso, a única coisa concreta que o modelo recebe é um título em
 * português. Não há objeto, não há composição, não há material — não há o que
 * desenhar. Então ele desenha o que tem: as palavras. E erra a ortografia,
 * porque desenhar letra não é escrever.
 *
 * A proibição já existia em SEM_TEXTO, três linhas abaixo, e não bastava: ela é
 * genérica e distante, enquanto o título é concreto e imediato. Entre as duas,
 * o modelo segue a concreta. A correção então faz as duas coisas que faltavam —
 * PEDIR uma cena, e negar o título ALI, colado nele, em vez de no rodapé.
 */
const COMO_SEM_DESCRICAO =
  "No description was given, so build the scene yourself: choose concrete objects, symbols and spatial metaphor that stand for that theme — the kind of scene a designer would draw to represent it. The theme words above are a TOPIC TO INTERPRET, never content to display: they must not appear drawn, lettered or spelled anywhere in the image.";

const ESTILO_BASE =
  "premium and minimalist — flat vector / soft 3D, geometric shapes, smooth matte surfaces, soft gradient colors, modern and elegant, 16:9 aspect";

/**
 * Imagem de módulo: aparece inteira na apostila, logo abaixo do título do
 * módulo. Aqui o respiro ajuda — nada será cortado.
 */
const ESTILO_MODULO = `Style: ${ESTILO_BASE}, generous negative space.`;

/**
 * Capa: será AMPLIADA E RECORTADA para caber numa faixa larga. Só a faixa
 * central da altura sobrevive, então tudo que importa precisa morar nela, e o
 * quadro precisa estar cheio de ponta a ponta.
 */
const ESTILO_CAPA = `Style: ${ESTILO_BASE}, balanced composition.
Framing (this image will be CROPPED to a wide horizontal band — only the middle third of its height survives):
- Fill the frame edge to edge. No border, no frame, no vignette, no matte, no picture-within-a-picture.
- Spread the subject across the FULL width; do not leave a large empty area on any side.
- Keep every important element inside the central horizontal band. Nothing essential near the top or bottom edge.
- Prefer a wide, side-by-side arrangement of elements over a tall or stacked one.`;

export interface EntradaPrompt {
  escopo: EscopoImagem;
  moduleTitle: string;
  courseTitle?: string | null;
  /** Descrição escrita pelo autor, já normalizada e limitada. */
  brief?: string;
}

/**
 * Monta o texto completo. A descrição do autor, quando existe, é o ASSUNTO e o
 * título vira contexto — inverter isso faria a descrição ser ignorada, que é
 * justamente a queixa que motivou o campo.
 */
export function montarPromptDeImagem(e: EntradaPrompt): string {
  const ehCapa = e.escopo === "cover";
  const curso = e.courseTitle ?? "";

  const tituloDoModulo = comoTema(e.moduleTitle);
  const tituloDoCurso = comoTema(curso);

  const assunto = e.brief
    ? `The user has described the image they want. Follow this description as the subject — it takes priority over the theme, which is context only:

USER'S DESCRIPTION — ${comoTema(e.brief)}

Context — ${
      ehCapa
        ? `course cover about ${tituloDoCurso || tituloDoModulo}`
        : `educational module about ${tituloDoModulo}, from a course about ${tituloDoCurso}`
    }.`
    : ehCapa
    ? `Generate a conceptual cover illustration for a course about ${tituloDoCurso || tituloDoModulo}.

${COMO_SEM_DESCRICAO}`
    : `Generate a conceptual illustration for an educational module about ${tituloDoModulo}, from a course about ${tituloDoCurso}.

${COMO_SEM_DESCRICAO}`;

  return `${assunto}

${ehCapa ? ESTILO_CAPA : ESTILO_MODULO}
${SEM_TEXTO}`;
}

// ── Texto alternativo da imagem ─────────────────────────────────────────────
//
// O alt_text gravado era `Imagem IA: ${brief}` — o PROMPT inteiro, com as
// instruções de composição e de paleta. Ele saía impresso na apostila, cinco
// linhas de "A paleta de cores foca em azul marinho, dourado e tons de
// madeira", que é conversa interna com o gerador e não diz nada a quem lê.
//
// Alt-text é para o leitor de tela e responde a uma pergunta só: o que a
// imagem mostra. Nem "Imagem IA:" entra — o leitor de tela já anuncia que
// aquilo é uma imagem, e a procedência não ajuda quem não está vendo.

/** Frases que instruem o gerador em vez de descrever a cena. */
const INSTRUCAO_DE_ESTILO =
  /\b(paleta|estilo|ilumina|renderiz|render\b|3d\b|resolu[çc][ãa]o|propor[çc][ãa]o|c[âa]mera|profundidade de campo|fotorrealis|alta qualidade|sem (?:texto|palavras|letras)|nenhum texto)/i;

const LIMITE_ALT = 180;

/**
 * Transforma a descrição usada para gerar a imagem num texto alternativo.
 *
 * Fica com as frases que descrevem a CENA, descarta as que instruem o gerador
 * e corta em fronteira de frase. Sem descrição aproveitável, cai no título do
 * módulo, que é impreciso mas honesto.
 */
export function altDaImagem(brief: string | null | undefined, tituloDoModulo: string): string {
  const limpo = (brief ?? "").replace(/\s+/g, " ").trim();
  const titulo = (tituloDoModulo || "").trim();
  if (!limpo) return titulo;

  const frases = limpo.split(/(?<=[.!?])\s+/).filter(Boolean);
  const cena: string[] = [];
  for (const f of frases) {
    if (INSTRUCAO_DE_ESTILO.test(f)) continue;
    const proximo = cena.length ? `${cena.join(" ")} ${f}` : f;
    // Sempre entra a primeira frase, mesmo longa: melhor uma frase inteira e
    // um pouco acima do limite do que nenhuma descrição.
    if (cena.length && proximo.length > LIMITE_ALT) break;
    cena.push(f);
  }
  if (!cena.length) return titulo;

  let alt = cena.join(" ").trim();
  if (alt.length > LIMITE_ALT) {
    const corte = alt.slice(0, LIMITE_ALT);
    const espaco = corte.lastIndexOf(" ");
    alt = `${(espaco > 40 ? corte.slice(0, espaco) : corte).replace(/[,;:\s]+$/, "")}…`;
  }
  return alt;
}
