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

  const assunto = e.brief
    ? `The user has described the image they want. Follow this description as the subject — it takes priority over the title, which is context only:

USER'S DESCRIPTION: "${e.brief}"

Context — ${ehCapa ? `course cover for "${curso || e.moduleTitle}"` : `educational module "${e.moduleTitle}" (course: "${curso}")`}.`
    : ehCapa
    ? `Generate a conceptual cover illustration for the course "${curso || e.moduleTitle}".`
    : `Generate a conceptual illustration for the educational module "${e.moduleTitle}" (course: "${curso}").`;

  return `${assunto}

${ehCapa ? ESTILO_CAPA : ESTILO_MODULO}
${SEM_TEXTO}`;
}
