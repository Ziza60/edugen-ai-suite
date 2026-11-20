// ═══════════════════════════════════════════════════════════════════════════
// AS NOTAS DOS SLIDES QUE NINGUÉM ESCREVE
//
// MEDIDO no deck de 20/11/2026: 17 dos 67 slides saíram sem nota nenhuma. São
// de DUAS famílias, e a primeira versão deste arquivo só atendeu uma delas —
// o comentário dizia 17 e listava 9, e a conta nunca fechou.
//
//   9 slides sem SlideSpec ...... capa, agenda, 6 divisórias, encerramento.
//                                 Montados fora do laço, por `renderCover`,
//                                 `renderTOC`, `renderSection` e
//                                 `renderCourseOutro`. Resolvidos em 20/11.
//   8 slides COM SlideSpec ...... os 6 fechamentos de módulo ("Pontos-chave"),
//      e `notes` vazio            as "Trilhas de aprofundamento" e "Como Você
//                                 Será Avaliado". Passam pelo laço, mas o
//                                 planejador não escreve `notes` para eles:
//                                 dois são montados por nós, em deck-plan.ts,
//                                 e o fechamento o modelo deixa em branco.
//                                 MEDIDO no deck de 21/11: ainda sem nota.
//
// São justamente os slides em que o apresentador não tem conteúdo na tela para
// se apoiar, ou em que a tela é uma lista que ele não deve ler em voz alta.
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
  fechamento: (titulo: string) => string;
  tabela: (titulo: string) => string;
  rubrica: string;
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
  fechamento: (titulo) =>
    `Fechamento do módulo "${titulo}". Não leia a lista: ela já está na tela. ` +
    `Escolha o ponto que o grupo achou mais difícil e retome só ele, com um exemplo. ` +
    `Depois pergunte o que ficou em aberto antes de passar ao módulo seguinte.`,
  tabela: (titulo) =>
    `"${titulo}": a tabela é para consulta, não para leitura em voz alta. ` +
    `Diga o que as colunas comparam, percorra UMA linha inteira como exemplo e deixe o resto para o material.`,
  rubrica:
    `Leia os pesos em voz alta — é a informação que o participante mais quer. ` +
    `Diga o que separa o nível excelente do suficiente em cada critério e onde a avaliação costuma ser perdida.`,
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
  fechamento: (titulo) =>
    `Closing module "${titulo}". Do not read the list — it is already on screen. ` +
    `Pick the point the group found hardest and revisit just that one, with an example. ` +
    `Then ask what is still open before moving to the next module.`,
  tabela: (titulo) =>
    `"${titulo}": the table is for reference, not to be read aloud. ` +
    `Say what the columns compare, walk through ONE full row as an example, and leave the rest to the handout.`,
  rubrica:
    `Read the weights aloud — it is what participants most want to know. ` +
    `Say what separates the excellent level from the sufficient one in each criterion, and where marks are usually lost.`,
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
  fechamento: (titulo) =>
    `Cierre del módulo "${titulo}". No lea la lista: ya está en pantalla. ` +
    `Elija el punto que al grupo le resultó más difícil y retómelo solo a ese, con un ejemplo. ` +
    `Luego pregunte qué quedó abierto antes de pasar al módulo siguiente.`,
  tabela: (titulo) =>
    `"${titulo}": la tabla es para consulta, no para leerla en voz alta. ` +
    `Diga qué comparan las columnas, recorra UNA fila entera como ejemplo y deje el resto al material.`,
  rubrica:
    `Lea los pesos en voz alta — es lo que el participante más quiere saber. ` +
    `Diga qué separa el nivel excelente del suficiente en cada criterio y dónde se suele perder la evaluación.`,
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

export function notaDaRubrica(language: string): string {
  return frases(language).rubrica;
}

/**
 * A nota de apoio de um slide que TEM SlideSpec e chegou sem `notes`.
 *
 * Só para os tipos em que isso acontece por desenho, não por acaso: o
 * fechamento do módulo (o planejador o deixa em branco) e a tabela que nós
 * mesmos montamos em deck-plan.ts, como "Trilhas de aprofundamento". Para
 * qualquer outro tipo devolve "" — um slide de conteúdo sem nota é um defeito
 * do planejador, e inventar uma frase genérica ali esconderia o defeito.
 */
export function notaDeApoio(
  kind: string,
  titulo: string,
  language: string,
): string {
  const f = frases(language);
  const t = (titulo || "").trim();
  if (kind === "closing") return f.fechamento(t);
  if (kind === "table" && t) return f.tabela(t);
  return "";
}
