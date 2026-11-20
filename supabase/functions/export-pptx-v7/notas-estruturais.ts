// ═══════════════════════════════════════════════════════════════════════════
// AS NOTAS DOS SLIDES QUE NINGUÉM ESCREVE
//
// MEDIDO no deck de 20/11/2026: 17 dos 67 slides saíram sem nota nenhuma — e
// não são quaisquer 17. São a capa, a agenda, as seis divisórias de módulo e o
// encerramento: exatamente os slides em que o apresentador não tem conteúdo na
// tela para se apoiar e precisa da frase de transição.
//
// A causa é estrutural: `speakerNotes` só é chamada dentro do laço de slides de
// conteúdo, a partir do campo `notes` que o planejador escreve. Capa, agenda,
// divisória e encerramento são montadas fora desse laço, por `renderCover`,
// `renderTOC`, `renderSection` e `renderCourseOutro`, e não passam por ali.
//
// Estas notas são DETERMINÍSTICAS — montadas do que o deck já sabe, sem
// chamada de IA. O apresentador recebe o que dizer; não recebe conteúdo
// inventado.
// ═══════════════════════════════════════════════════════════════════════════

interface Frases {
  capa: (curso: string, n: number) => string;
  agenda: (n: number) => string;
  divisoria: (n: number, titulo: string) => string;
  objetivos: string;
  encerramento: string;
}

const PT: Frases = {
  capa: (curso, n) =>
    `Abertura. Apresente-se e diga o que é "${curso}". ` +
    `São ${n} ${n === 1 ? "módulo" : "módulos"}. ` +
    `Diga ao grupo o que ele vai saber fazer ao final, e combine como serão as perguntas.`,
  agenda: (n) =>
    `Percorra os ${n} ${n === 1 ? "módulo" : "módulos"} em uma frase cada, sem entrar no conteúdo. ` +
    `O objetivo aqui é dar o mapa: onde começamos, onde chegamos e por que esta ordem.`,
  divisoria: (n, titulo) =>
    `Entrada do módulo ${n}: "${titulo}". ` +
    `Feche o módulo anterior em uma frase antes de virar a página e diga por que este vem agora.`,
  objetivos: "Ao final deste módulo o participante deve conseguir:",
  encerramento:
    `Retome a competência central do curso em uma frase, não a lista inteira. ` +
    `Aponte o próximo passo concreto — avaliação, certificado, material de apoio — e abra para perguntas.`,
};

const EN: Frases = {
  capa: (curso, n) =>
    `Opening. Introduce yourself and say what "${curso}" is. ` +
    `There ${n === 1 ? "is 1 module" : `are ${n} modules`}. ` +
    `Tell the group what they will be able to do by the end, and agree how questions will work.`,
  agenda: (n) =>
    `Walk through the ${n} ${n === 1 ? "module" : "modules"} in one sentence each, without going into content. ` +
    `The goal is the map: where we start, where we land, and why this order.`,
  divisoria: (n, titulo) =>
    `Entering module ${n}: "${titulo}". ` +
    `Close the previous module in one sentence before turning the page, and say why this one comes now.`,
  objetivos: "By the end of this module participants should be able to:",
  encerramento:
    `Restate the course's central competence in one sentence, not the whole list. ` +
    `Point to the concrete next step — assessment, certificate, support material — and open for questions.`,
};

const ES: Frases = {
  capa: (curso, n) =>
    `Apertura. Preséntese y diga qué es "${curso}". ` +
    `Son ${n} ${n === 1 ? "módulo" : "módulos"}. ` +
    `Diga al grupo qué sabrá hacer al final y acuerde cómo serán las preguntas.`,
  agenda: (n) =>
    `Recorra los ${n} ${n === 1 ? "módulo" : "módulos"} en una frase cada uno, sin entrar en el contenido. ` +
    `El objetivo es dar el mapa: dónde empezamos, dónde llegamos y por qué este orden.`,
  divisoria: (n, titulo) =>
    `Entrada del módulo ${n}: "${titulo}". ` +
    `Cierre el módulo anterior en una frase antes de pasar la página y diga por qué este viene ahora.`,
  objetivos: "Al final de este módulo el participante debe poder:",
  encerramento:
    `Retome la competencia central del curso en una frase, no la lista entera. ` +
    `Señale el próximo paso concreto — evaluación, certificado, material — y abra para preguntas.`,
};

/** O idioma do deck decide as frases; português é o padrão do produto. */
export function frases(language: string): Frases {
  const l = (language || "").toLowerCase();
  if (/espa|spanish/.test(l)) return ES;
  if (/ingl|english|^en\b|^en-/.test(l)) return EN;
  return PT;
}

export function notaDaCapa(courseTitle: string, modulos: number, language: string): string {
  return frases(language).capa(courseTitle.trim(), Math.max(modulos, 0));
}

export function notaDaAgenda(modulos: number, language: string): string {
  return frases(language).agenda(Math.max(modulos, 0));
}

/**
 * A nota da divisória carrega os objetivos do módulo quando eles existem — é o
 * único lugar do deck em que o apresentador os tem por escrito, já que a
 * divisória mostra só o número e o título.
 */
export function notaDaDivisoria(
  numero: number,
  titulo: string,
  objetivos: readonly string[] | undefined,
  language: string,
): string {
  const f = frases(language);
  const base = f.divisoria(numero, titulo.trim());
  const lista = (objetivos ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 6);
  if (!lista.length) return base;
  return `${base}\n\n${f.objetivos}\n${lista.map((o) => `• ${o}`).join("\n")}`;
}

export function notaDoEncerramento(language: string): string {
  return frases(language).encerramento;
}
