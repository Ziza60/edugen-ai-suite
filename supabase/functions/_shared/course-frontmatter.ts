// ═══════════════════════════════════════════════════════════════════════════
// A apresentação do curso mora dentro do primeiro módulo
//
// O gerador monta o markdown do Módulo 1 assim (course-pipeline.ts,
// renderModuleMarkdown com includeOverview):
//
//     ## Visão geral do curso
//     ### Competência final
//     ### Objetivos do curso
//     ### Habilidades e conhecimentos
//     ### Pré-requisitos
//     ### Mapa de termos essenciais
//     ## <título do módulo>          ← daqui em diante é o módulo de verdade
//     ### 1.1 …
//
// Na tela isso passa. Numa apostila, não: o leitor abre em
// "MÓDULO 1 — <título>" e encontra cinco páginas de folheto do curso antes da
// primeira lição. Confirmado em dois cursos gerados, e só no primeiro módulo.
//
// Separar aqui, na exportação, conserta também os cursos já gerados — nenhum
// precisa ser refeito. Se um dia a apresentação passar a ser gravada fora do
// módulo, esta função simplesmente deixa de encontrar o que separar e devolve o
// conteúdo intacto.
// ═══════════════════════════════════════════════════════════════════════════

/** Início da apresentação, como o gerador a escreve. */
const INICIO_APRESENTACAO = /^##\s+Vis[ãa]o\s+geral\s+do\s+curso\s*$/i;
/** Qualquer título de nível 2 — é ele que marca onde o módulo começa. */
const TITULO_NIVEL_2 = /^##\s+\S/;

export interface CursoSeparado {
  /** A apresentação do curso, ou null quando o módulo não a traz. */
  apresentacao: string | null;
  /** O conteúdo do módulo, sem a apresentação. */
  modulo: string;
}

/**
 * Separa a apresentação do curso do conteúdo do módulo.
 *
 * Só age quando o markdown COMEÇA pela apresentação — se ela aparecer no meio,
 * é conteúdo que o autor escreveu ali de propósito e não se mexe. A apresentação
 * termina no primeiro título de nível 2 seguinte, que é o título do módulo.
 */
export function splitCourseOverview(markdown: string): CursoSeparado {
  const texto = (markdown ?? "").replace(/\r\n/g, "\n");
  const linhas = texto.split("\n");

  // Acha a primeira linha com conteúdo. A apresentação tem que ser ela.
  let inicio = 0;
  while (inicio < linhas.length && !linhas[inicio].trim()) inicio++;
  if (inicio >= linhas.length || !INICIO_APRESENTACAO.test(linhas[inicio].trim())) {
    return { apresentacao: null, modulo: texto };
  }

  // Onde o módulo começa: o próximo título de nível 2.
  let fim = -1;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (TITULO_NIVEL_2.test(linhas[i].trim())) {
      fim = i;
      break;
    }
  }

  // Sem um segundo "##", o módulo inteiro é só a apresentação. Devolvemos como
  // conteúdo de módulo: separar deixaria o módulo vazio, e uma página em branco
  // é pior que a ordem errada.
  if (fim === -1) return { apresentacao: null, modulo: texto };

  return {
    apresentacao: linhas.slice(inicio, fim).join("\n").trim(),
    modulo: linhas.slice(fim).join("\n").trim(),
  };
}
