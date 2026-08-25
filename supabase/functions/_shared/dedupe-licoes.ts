// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o mesmo parágrafo explicado quatro vezes
//
// O RELATO
//
// "O trio PPA/LDO/LOA é explicado por extenso umas quatro vezes entre os
// módulos 1 e 2, quase com as mesmas frases." Confirmado no curso: a frase
// "O PPA estabelece as diretrizes, objetivos e metas…" aparece quase idêntica
// nas páginas 7, 9 e 20.
//
// POR QUE ACONTECE
//
// Cada módulo é gerado por uma invocação independente — foi assim que
// resolvemos o estouro de tempo da edge function. O preço é que nenhum módulo
// sabe o que os outros escreveram, e todos acham que precisam apresentar o
// conceito central antes de usá-lo. É o sintoma clássico da geração lição a
// lição sem memória.
//
// POR QUE A CORREÇÃO É AQUI, E NÃO NA GERAÇÃO
//
// O caminho ideal seria o módulo 3 saber o que o módulo 1 já disse. Não dá: os
// jobs de um mesmo curso são despachados em lote e rodam em PARALELO, então na
// hora em que o módulo 3 escreve, o 1 pode nem ter terminado. Dar memória a
// eles significaria serializar a geração — desfazendo justamente a divisão que
// impede o estouro de tempo.
//
// Então a limpeza acontece na montagem da apostila, onde os módulos estão todos
// na mão. Consequência que vale registrar: o texto GRAVADO continua com a
// repetição, e a tela do curso também. Quem lê a apostila — que é o produto
// vendido — recebe o texto limpo.
//
// O CUIDADO
//
// Apagar parágrafo é destrutivo e um falso positivo custa conteúdo. Por isso a
// regra é conservadora em quatro frentes ao mesmo tempo: só entre módulos
// DIFERENTES, só parágrafos longos, só semelhança alta, e no máximo dois por
// módulo. E o que entra no lugar não é o vazio: é uma remissão que devolve ao
// leitor onde aquilo foi explicado — o que transforma a repetição em reforço.
// ═══════════════════════════════════════════════════════════════════════════

/** Semelhança mínima para considerar repetição. Alta de propósito. */
export const LIMIAR = 0.72;
/** Parágrafo curto repete por motivo legítimo (definição, rótulo, transição). */
export const MINIMO_PALAVRAS = 30;
/** Teto por módulo: se "tudo" é repetido, o problema é outro e não é aqui. */
export const MAXIMO_POR_MODULO = 2;

const VAZIAS = new Set([
  "para", "como", "que", "com", "dos", "das", "por", "uma", "seu", "sua",
  "ser", "sao", "nao", "mais", "esse", "essa", "isso", "pelo", "pela",
  "entre", "sobre", "quando", "onde", "porque", "cada", "todo", "toda",
]);

/**
 * Vocabulário do texto: sem acento, sem palavra de ligação, sem palavra curta.
 * Serve para MEDIR SEMELHANÇA, e não para medir tamanho.
 */
function palavras(t: string): string[] {
  return (t || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z]{3,}/g)
    ?.filter((w) => !VAZIAS.has(w)) ?? [];
}

/**
 * Tamanho do parágrafo como o leitor o vê.
 *
 * Contar pelo vocabulário filtrado seria muito mais severo do que parece: um
 * parágrafo de 40 palavras cai para 22 depois de tirar artigos, preposições e
 * palavras de três letras. Com o piso de 30 aplicado ali, parágrafo nenhum de
 * tamanho normal passava — e o dedupe não removia nada, silenciosamente.
 */
function contarPalavras(t: string): number {
  return (t || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Semelhança entre dois parágrafos, de 0 a 1.
 *
 * Usa o coeficiente de Dice sobre o vocabulário. Dois textos que dizem a mesma
 * coisa com as mesmas palavras chegam perto de 1; textos sobre o mesmo assunto
 * mas com conteúdo diferente ficam bem abaixo, porque metade do vocabulário de
 * cada um não aparece no outro.
 */
export function semelhanca(a: string, b: string): number {
  return semelhancaDeVocabulario(new Set(palavras(a)), new Set(palavras(b)));
}

/**
 * O mesmo Dice, sobre vocabulários JÁ EXTRAÍDOS.
 *
 * A versão que recebia strings tokenizava os dois lados a cada chamada, e a
 * comparação é toda-contra-todos: o vocabulário de um parágrafo já visto era
 * reconstruído uma vez para cada parágrafo novo do curso.
 */
function semelhancaDeVocabulario(A: Set<string>, B: Set<string>): number {
  if (!A.size || !B.size) return 0;
  // Percorre o MENOR: o resultado é o mesmo e o laço é mais curto.
  const [menor, maior] = A.size <= B.size ? [A, B] : [B, A];
  let comuns = 0;
  for (const w of menor) if (maior.has(w)) comuns++;
  return (2 * comuns) / (A.size + B.size);
}

/**
 * Este par PODE alcançar o limiar? Um "não" aqui dispensa contar as palavras.
 *
 * Dice = 2c/(|A|+|B|), e c nunca passa do tamanho do menor conjunto. Impondo
 * Dice ≥ L e substituindo c pelo seu teto:
 *
 *     menor ≥ L·(menor + maior)/2   ⟹   menor/maior ≥ L/(2 − L)
 *
 * Com L = 0,72 isso dá 0,5625: um parágrafo com menos de 56% do vocabulário do
 * outro não tem como atingir o limiar, por mais que as palavras coincidam. A
 * poda é EXATA — descarta só o que já estava descartado —, e num curso real a
 * maioria dos pares morre aqui, em duas comparações de inteiros.
 */
const RAZAO_MINIMA = LIMIAR / (2 - LIMIAR);

function podeAlcancarLimiar(a: number, b: number): boolean {
  if (!a || !b) return false;
  return (a <= b ? a / b : b / a) >= RAZAO_MINIMA;
}

/** Um parágrafo de prosa: nada de título, lista, tabela, citação ou código. */
function ehProsa(linha: string): boolean {
  const t = linha.trim();
  if (!t) return false;
  return !/^(#{1,6}\s|[-*+]\s|\d{1,3}[.)]\s|\||>|```|!\[)/.test(t);
}

export interface ModuloTexto {
  titulo: string;
  conteudo: string;
}

export interface Remocao {
  modulo: number;
  origem: number;
  semelhanca: number;
  trecho: string;
}

/**
 * Troca parágrafos repetidos por uma remissão ao módulo que já os explicou.
 *
 * Devolve os módulos com o conteúdo ajustado e a lista do que foi trocado, para
 * o log — uma limpeza silenciosa que ninguém consegue auditar é pior que a
 * repetição.
 */
export function removerRepeticoes(
  modulos: ModuloTexto[],
): { modulos: ModuloTexto[]; remocoes: Remocao[] } {
  const remocoes: Remocao[] = [];
  // Parágrafos já vistos, com o módulo de origem. Só os longos entram, porque
  // só eles podem ser removidos — comparar contra os curtos seria gastar tempo
  // à toa.
  const vistos: Array<{ vocabulario: Set<string>; modulo: number }> = [];

  const saida = modulos.map((m, mi) => {
    const linhas = (m.conteudo || "").split("\n");
    let trocasNesteModulo = 0;

    const novas = linhas.map((linha) => {
      if (trocasNesteModulo >= MAXIMO_POR_MODULO) return linha;
      if (!ehProsa(linha)) return linha;
      if (contarPalavras(linha) < MINIMO_PALAVRAS) return linha;

      // Uma vez por parágrafo NOVO, não uma vez por par: era isto que fazia o
      // custo do dedupe crescer com o quadrado do tamanho do curso.
      const vocabulario = new Set(palavras(linha));

      let melhor = { i: -1, s: 0 };
      for (let k = 0; k < vistos.length; k++) {
        // Só entre módulos diferentes: dentro do mesmo módulo, retomar um ponto
        // é recurso didático legítimo, não descuido.
        if (vistos[k].modulo === mi) continue;
        if (!podeAlcancarLimiar(vocabulario.size, vistos[k].vocabulario.size)) continue;
        const s = semelhancaDeVocabulario(vocabulario, vistos[k].vocabulario);
        if (s > melhor.s) melhor = { i: k, s };
      }

      if (melhor.i < 0 || melhor.s < LIMIAR) return linha;

      const origem = vistos[melhor.i].modulo;
      remocoes.push({
        modulo: mi,
        origem,
        semelhanca: Number(melhor.s.toFixed(3)),
        trecho: linha.trim().slice(0, 90),
      });
      trocasNesteModulo++;
      const nome = (modulos[origem]?.titulo ?? "").trim();
      return `> **Retomando o Módulo ${origem + 1}${nome ? ` — ${nome}` : ""}:** ` +
        `este ponto foi desenvolvido lá e é retomado aqui para aplicá-lo ao que vem a seguir.`;
    });

    // O módulo entra no acervo DEPOIS de processado, e com o texto original:
    // é contra o que ele de fato ensinou que os próximos serão comparados.
    for (const linha of linhas) {
      if (ehProsa(linha) && contarPalavras(linha) >= MINIMO_PALAVRAS) {
        vistos.push({ vocabulario: new Set(palavras(linha)), modulo: mi });
      }
    }

    return { ...m, conteudo: novas.join("\n") };
  });

  return { modulos: saida, remocoes };
}
