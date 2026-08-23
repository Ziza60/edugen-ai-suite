// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7  ·  image-relevance.ts
//
// O QUE ISTO RESOLVE
//
// A busca de imagem pedia `per_page=1` e usava a PRIMEIRA foto que voltasse,
// sem olhar para o que ela mostra. O Pexels sempre devolve alguma coisa: uma
// consulta ruim não dá erro, dá uma foto qualquer. Foi assim que slides sobre
// curva ABC de estoque receberam imagens sem relação com o assunto.
//
// Duas coisas estavam sendo jogadas fora:
//
//   1. O TEXTO QUE OS PROVEDORES DEVOLVEM. O Pexels manda `alt` (uma descrição
//      da foto) e o Pixabay manda `tags`. Dá para conferir se a foto tem
//      alguma relação com o que foi pedido antes de colá-la no slide.
//
//   2. A CHANCE DE NÃO BUSCAR. O planejador é instruído a escrever uma cena
//      concreta em inglês, de 2 a 4 palavras. Mas quando ele não escreve nada,
//      dois pontos do código caem para o TÍTULO DO MÓDULO em português —
//      "Diagnóstico de Estoque: Entendendo o Mix com a Curva ABC". Procurar
//      isso no Pexels não devolve nada de relacionado; devolve o que calhar.
//
// A REGRA: melhor slide sem foto do que slide com foto errada. Uma foto
// decorativa que não fala do assunto não é neutra — ela desmente o slide.
// ═══════════════════════════════════════════════════════════════════════════

/** Palavras que não carregam assunto, nos dois idiomas que aparecem aqui. */
const VAZIAS = new Set([
  // inglês
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the",
  "to", "with", "into", "over", "under", "up", "out", "his", "her", "their",
  "its", "some", "very", "photo", "image", "picture", "background", "close",
  // português — aparecem quando a consulta caiu para o título do módulo
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na",
  "nos", "nas", "com", "para", "por", "um", "uma", "ao", "à", "que", "seu",
  "sua", "pelo", "pela", "entre", "sobre",
]);

/** Marcas de que a consulta é um título em português, não uma cena em inglês. */
// Só entram palavras que NÃO são também palavras inglesas. "a", "o", "e",
// "as", "no" ficaram de fora de propósito: rejeitariam consultas legítimas como
// "person at a desk". O acento e a pontuação de título já pegam o resto.
const PALAVRAS_PORTUGUESAS =
  /\b(?:de|da|do|das|dos|com|para|por|uma|ao|que|seu|sua|pelo|pela|entre|sobre|como|na|nas|nos)\b/i;

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Raiz aproximada, só para o plural encontrar o singular.
 *
 * Não é um stemmer de verdade e não precisa ser: serve para "shelves" casar com
 * "shelf" e "boxes" com "box". A primeira versão cortava só o "s" final e
 * deixava "shelve" e "boxe" — que não casam com nada, e a busca pedia
 * justamente "warehouse shelves".
 */
function raiz(palavra: string): string {
  if (palavra.length <= 3) return palavra;
  if (palavra.endsWith("ves")) return `${palavra.slice(0, -3)}f`;
  if (palavra.endsWith("ies")) return `${palavra.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/.test(palavra)) return palavra.slice(0, -2);
  if (palavra.endsWith("s") && !palavra.endsWith("ss")) return palavra.slice(0, -1);
  return palavra;
}

/** Palavras de conteúdo, minúsculas, sem acento e sem plural. */
export function palavrasDeConteudo(texto: string): string[] {
  return semAcento(String(texto ?? "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !VAZIAS.has(p))
    .map(raiz);
}

/**
 * Vale a pena gastar uma busca com esta consulta?
 *
 * Recusa o que sabidamente não devolve foto relacionada: título com pontuação
 * de título, frase longa, texto em português, palavra solta. Nenhuma delas é
 * a "cena concreta em inglês, de 2 a 4 palavras" que o planejador deveria
 * produzir — e para todas o provedor devolveria uma foto qualquer.
 */
export function consultaUtil(consulta: string): boolean {
  const q = String(consulta ?? "").trim();
  if (!q) return false;
  // Pontuação de título: dois-pontos, travessão, reticências, parênteses.
  if (/[:—–…()|]/.test(q)) return false;
  const palavras = q.split(/\s+/);
  // O planejador pede de 2 a 4 palavras. Uma só é abstrata demais; mais de
  // cinco é frase, e frase o acervo não casa.
  if (palavras.length < 2 || palavras.length > 5) return false;
  if (/[áàâãéêíóôõúüç]/i.test(q)) return false;
  if (PALAVRAS_PORTUGUESAS.test(q)) return false;
  return palavrasDeConteudo(q).length >= 1;
}

/**
 * A foto tem relação com o que foi pedido?
 *
 * Basta uma palavra de conteúdo em comum: o acervo descreve a foto com outras
 * palavras que não as da busca, e exigir demais devolveria o slide vazio quase
 * sempre. Sem descrição, aceita — não dá para julgar, e recusar por falta de
 * metadado tiraria imagem boa.
 */
export function fotoCombina(consulta: string, descricao: string): boolean {
  const desc = String(descricao ?? "").trim();
  if (!desc) return true;
  const pedidas = new Set(palavrasDeConteudo(consulta));
  if (!pedidas.size) return false;
  return palavrasDeConteudo(desc).some((p) => pedidas.has(p));
}

export interface FotoCandidata {
  url: string;
  descricao: string;
}

/**
 * A primeira foto da lista que fala do assunto pedido. null quando nenhuma
 * fala — e aí o slide sai sem imagem, que é o resultado certo.
 */
export function escolherFoto(
  consulta: string,
  candidatas: FotoCandidata[],
): string | null {
  for (const foto of candidatas) {
    if (!foto?.url) continue;
    if (fotoCombina(consulta, foto.descricao)) return foto.url;
  }
  return null;
}
