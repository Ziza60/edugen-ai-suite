// ═══════════════════════════════════════════════════════════════════════════
// A imagem que o autor escolheu vence a que o motor acha sozinho
//
// O v7 resolvia uma foto por módulo buscando no Pexels a partir de uma consulta
// inventada pelo planejador. Ele nunca consultou course_images — a tabela onde
// fica a imagem que o autor escolheu no app, ou gerou (e pagou) com IA, e que o
// portal do aluno já mostra.
//
// O efeito era pior que faltar imagem: o autor via uma foto na tela e o slide
// trazia OUTRA. Medido em duas exportações de cursos diferentes.
//
// A regra aqui é simples: se existe imagem curada para o módulo, é ela. A busca
// automática continua valendo para quem nunca escolheu nada — nada muda para
// esse caso.
// ═══════════════════════════════════════════════════════════════════════════

/** Mesma normalização dos dois lados, para o título casar. */
export function chaveDeTitulo(titulo: string): string {
  return (titulo || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export interface FontesDeImagem {
  /** Imagens curadas na ordem dos módulos do curso, quando disponível. */
  curadasPorIndice: Array<string | undefined>;
  /** Imagens curadas indexadas pelo título normalizado do módulo. */
  curadasPorTitulo: Record<string, string>;
  /** O que a busca automática resolveu, indexado pela consulta normalizada. */
  buscadas: Record<string, string>;
}

/**
 * Escolhe a imagem de um módulo do deck.
 *
 * O casamento por índice vem primeiro, e só vale quando o deck tem exatamente
 * tantos módulos quanto o curso — se o planejador tiver juntado ou descartado
 * algum, o índice deixa de significar o mesmo módulo e a comparação por título
 * assume. Sem nenhum dos dois, cai na busca automática.
 */
export function escolherImagemDoModulo(params: {
  indice: number;
  titulo: string;
  consultaDeBusca: string;
  totalDeModulosNoDeck: number;
  fontes: FontesDeImagem;
}): string | undefined {
  const { indice, titulo, consultaDeBusca, totalDeModulosNoDeck, fontes } = params;

  const indicesAlinhados = fontes.curadasPorIndice.length === totalDeModulosNoDeck;
  if (indicesAlinhados) {
    const porIndice = fontes.curadasPorIndice[indice];
    if (porIndice) return porIndice;
  }

  const porTitulo = fontes.curadasPorTitulo[chaveDeTitulo(titulo)];
  if (porTitulo) return porTitulo;

  return fontes.buscadas[chaveDeTitulo(consultaDeBusca)];
}

/**
 * Quais módulos ainda precisam de busca automática.
 *
 * Buscar foto para um módulo que já tem imagem curada é chamada de API jogada
 * fora, e o v7 roda com orçamento apertado de tempo e de CPU no edge.
 */
export function consultasPendentes(
  modulos: Array<{ titulo: string; consulta: string }>,
  fontes: Pick<FontesDeImagem, "curadasPorIndice" | "curadasPorTitulo">,
): string[] {
  const indicesAlinhados = fontes.curadasPorIndice.length === modulos.length;
  const pendentes: string[] = [];

  modulos.forEach((m, i) => {
    const jaTem = (indicesAlinhados && fontes.curadasPorIndice[i]) ||
      fontes.curadasPorTitulo[chaveDeTitulo(m.titulo)];
    if (!jaTem) pendentes.push(m.consulta);
  });

  return pendentes;
}
