// ═══════════════════════════════════════════════════════════════════════════
// A DEFINIÇÃO VOLTA DA FONTE, SEM PEDIR LICENÇA AO MODELO
//
// Três tentativas de prompt, três decks, a mesma perda:
//
//   18/11 .. o curso nomeava os quatro critérios e não definia nenhum
//   19/11 .. regra de definição no prompt do CURSO → o curso passou a definir
//   20/11 .. teto do cartão subiu de 90 para 165 caracteres, e o prompt do
//            DECK ganhou a exceção às 12 palavras
//   21/11 .. o deck trouxe "Grau de alcance das metas programadas." — 37
//            caracteres, com 128 de folga sob o teto
//
// MEDIDO no deck de 21/11: a cláusula "independentemente dos custos
// implicados" estava no texto condensado que o planejador leu, o teto era de
// 165 caracteres e o corpo saiu com 37. Nada cortou. O modelo escolheu.
//
// E há uma suspeita contra a própria regra: ela citava o ERRO entre aspas —
// `"Eficácia: grau de alcance das metas programadas" is WRONG` — e o modelo
// devolveu exatamente essa frase. Um exemplo negativo literal é um exemplo.
//
// Daí este arquivo. Quando o cartão define um termo e a fonte do módulo define
// o MESMO termo com mais palavras, o corpo do cartão passa a ser o da fonte.
// Determinístico: não depende de o modelo obedecer, e a regra de fontes do
// projeto já diz que a palavra da fonte vale mais que a paráfrase.
//
// ─── POR QUE ISTO NÃO ATROPELA O PLANEJADOR ─────────────────────────────────
//
// A troca só acontece quando o corpo do cartão é um ENCOLHIMENTO da frase da
// fonte: toda palavra de conteúdo do corpo tem de estar na frase, e a frase
// tem de trazer pelo menos 5 palavras de conteúdo a mais. Medido no curso de
// auditoria, isso acerta "eficácia" e deixa em paz:
//
//   eficiência ..... o corpo é a frase inteira da fonte (diferença 3) → fica
//   economicidade .. o corpo tem palavras que a fonte não tem → fica
//
// Ou seja: completa o que foi cortado e não reescreve o que foi bem resumido.
// ═══════════════════════════════════════════════════════════════════════════

import type { DeckCard, DeckModule, ModuleInput, SlideSpec } from "./deck-plan.ts";
import { capacidadeDaCelula, capacidadeDoCorpoDoCard } from "./table-geometry.ts";

/** Minúsculas, sem acento — para comparar palavra com palavra. */
function dobra(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const VAZIAS = new Set(
  dobra(
    "a o e de da do das dos em no na nos nas para por com sem as os um uma que ao aos" +
      " se os as ou mais menos ja nao ser esta estao e'",
  ).split(/\s+/),
);

/** As palavras que carregam sentido, normalizadas. */
export function palavrasDeConteudo(s: string): string[] {
  return dobra(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !VAZIAS.has(w));
}

/**
 * As frases de um texto, já limpas de marcação.
 *
 * Corta em ponto final seguido de espaço e maiúscula: abreviação com ponto no
 * meio ("art. 5º") não vira duas frases.
 */
export function frasesDoTexto(md: string): string[] {
  const limpo = md
    .replace(/```[\s\S]*?```/g, "\n\n")
    // Títulos SAEM inteiros. Sem isto, "##### Eficácia — Alcançando as Metas"
    // perdia o marcador e colava no parágrafo seguinte, que não começa por
    // maiúscula depois de um ponto: a "frase" resultante trazia o título na
    // frente da definição. Pior, um título no formato "Termo — Alguma Coisa"
    // casa com o formato de glossário e virava candidato a definição.
    .replace(/^\s{0,3}#{1,6}[^\n]*$/gm, "")
    .replace(/^\s*[>|]\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*|__|\*|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Bloco a bloco: um parágrafo que termina sem pontuação não pode emendar no
  // seguinte.
  return limpo
    .split(/\n\s*\n/)
    .flatMap((bloco) => bloco.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú"'(])/))
    .map((f) => f.replace(/\s+/g, " ").trim())
    .filter((f) => f.length > 20);
}

// ─── MENCIONAR NÃO É DEFINIR ────────────────────────────────────────────────
//
// A primeira versão aceitava qualquer frase com o termo nos 40 primeiros
// caracteres e ficava com a mais longa. No curso real isso elegeu "Para
// avaliar a eficácia no programa 'Cidade Renovada', seriam necessárias
// evidências como: ..." — 245 caracteres que não definem nada.
//
// O que distingue a definição é a GRAMÁTICA: o termo é o sujeito e vem um
// verbo de ligação. "A eficácia está ligada ao..." define; "Para avaliar a
// eficácia..." não. Sem esse formato, a função devolve null e o cartão fica
// como o planejador escreveu.
const LIGACAO =
  "e|sao|esta ligada ao|esta ligado ao|esta ligada a|esta ligado a|se refere a|" +
  "se refere ao|refere-se a|refere-se ao|consiste em|significa|investiga se|" +
  "examina|avalia|mede|analisa se|diz respeito a|corresponde a|e a|e o|" +
  "pode ser definida como|pode ser definido como|define-se como";

/** Onde termina o "A eficácia está ligada ao " de uma frase, ou -1. */
function fimDoPreambulo(frase: string, termo: string): number {
  const t = dobra(termo).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!t) return -1;
  // "A eficácia está ligada ao X" e também o formato de glossário "Eficácia: X"
  // e "Eficácia — X".
  for (
    const re of [
      new RegExp(`^(?:a|o|as|os)?\\s*${t}\\s+(?:${LIGACAO})\\s+`),
      new RegExp(`^${t}\\s*[:—–-]\\s+`),
    ]
  ) {
    const m = dobra(frase).match(re);
    if (m) return m[0].length;
  }
  return -1;
}

/**
 * "investiga SE os bens foram adquiridos" não é a mesma coisa que "avalia o
 * grau de alcance": o `se` abre uma oração, e cortar o verbo deixa um começo
 * solto — "Os bens e serviços foram adquiridos...", que perde justamente o que
 * a economicidade FAZ. MEDIDO na fonte do curso real, nas duas formas.
 */
function abreOracaoComSe(frase: string, fim: number): boolean {
  return /\sse\s$/.test(dobra(frase).slice(0, fim));
}

/**
 * A frase da fonte que DEFINE o termo — aquela em que ele é o sujeito de um
 * verbo de ligação. Devolve null quando a fonte só o menciona.
 */
export function definicaoNaFonte(termo: string, fonte: string): string | null {
  const t = termo.trim();
  if (t.length < 4 || t.split(/\s+/).length > 4) return null;
  const candidatas = frasesDoTexto(fonte).filter((f) => fimDoPreambulo(f, t) > 0);
  if (!candidatas.length) return null;
  // A mais longa entre as que definem: é a que carrega as cláusulas.
  return candidatas.sort((a, b) => b.length - a.length)[0];
}

/**
 * Tira o preâmbulo "A eficácia está ligada ao ..." quando ele só reapresenta o
 * termo que já é o título do cartão. Sem casar nenhum verbo, devolve a frase
 * como a fonte a escreveu — nunca inventa redação.
 */
export function semOPreambulo(frase: string, termo: string): string {
  const fim = fimDoPreambulo(frase, termo);
  if (fim <= 0) return frase;
  if (abreOracaoComSe(frase, fim)) return frase;
  const resto = frase.slice(fim).trim();
  if (resto.length < 30) return frase;
  return resto.charAt(0).toUpperCase() + resto.slice(1);
}

export interface Reposicao {
  termo: string;
  antes: string;
  depois: string;
}

/**
 * O corpo do cartão foi encolhido a ponto de perder cláusula da fonte?
 *
 * `true` só quando o corpo é um subconjunto estrito da frase da fonte — todas
 * as suas palavras de conteúdo estão lá — e a frase traz pelo menos
 * `margemMinima` palavras de conteúdo a mais.
 */
export function perdeuClausula(
  corpo: string,
  daFonte: string,
  margemMinima = 5,
): boolean {
  const c = palavrasDeConteudo(corpo);
  if (!c.length) return true;
  const f = new Set(palavrasDeConteudo(daFonte));
  if (!c.every((w) => f.has(w))) return false;
  return f.size - new Set(c).size >= margemMinima;
}

/**
 * Quantos caracteres o corpo comporta, pelo arranjo do grid.
 *
 * Era uma cópia local — `quantosCards === 3 ? 100 : 165` — que divergia do que
 * renderCards desenha. Duas réguas para a mesma caixa é como a definição de
 * eficácia se perdeu: uma media e a outra cortava. A conta agora é a de
 * table-geometry.ts, a mesma que o renderizador usa.
 */
export const tetoDoCorpo = capacidadeDoCorpoDoCard;

/**
 * A frase da fonte diz MAIS do que o corpo do cartão?
 *
 * Mede palavras de conteúdo, não caracteres: é a informação que interessa, e
 * uma paráfrase mais arrastada não pode ganhar da fonte por ser mais comprida.
 *
 * MEDIDO nos quatro cartões do deck de 21/11, contra a fonte do módulo 1:
 *
 *   economicidade .. corpo 13 palavras, fonte 12 → a fonte não acrescenta
 *   eficiência ..... corpo 12,          fonte 14 → troca
 *   eficácia ....... corpo  4,          fonte 12 → troca
 *   efetividade .... corpo  7,          fonte 19 → troca
 *
 * A primeira versão exigia que o corpo fosse SUBCONJUNTO da frase. Era
 * conservadora demais e produzia um resultado incoerente: eficácia e
 * eficiência ganhavam a cláusula e efetividade não, só porque o modelo
 * escrevera "comunidades" onde a fonte diz "sociedade". Para um auditor, a
 * causalidade que faltava na efetividade é tão distintiva quanto o
 * "independentemente dos custos" que faltava na eficácia.
 */
export function fonteDizMais(corpo: string, daFonte: string): boolean {
  return palavrasDeConteudo(daFonte).length > palavrasDeConteudo(corpo).length;
}

/** O que cada item deveria dizer, se a fonte define o termo. */
interface Candidato {
  card: DeckCard | null;
  termo: string;
  corpo: string;
  texto: string | null;
}

/** O candidato de um par termo/corpo já separado. */
function candidatoDe(termo: string, corpo: string, fonte: string): string | null {
  if (!termo || !corpo) return null;
  const frase = definicaoNaFonte(termo, fonte);
  if (!frase) return null;
  const t = semOPreambulo(frase, termo).replace(/\s+/g, " ").trim();
  return fonteDizMais(corpo, t) ? t : null;
}

function candidatos(cards: DeckCard[], fonte: string): Candidato[] {
  return cards.map((card) => {
    const termo = (card.heading ?? "").trim();
    const corpo = (card.body ?? "").trim();
    return { card, termo, corpo, texto: candidatoDe(termo, corpo, fonte) };
  });
}

// ─── O MESMO DEFEITO, FORA DOS CARTÕES ──────────────────────────────────────
//
// MEDIDO no slide 7 do deck de 21/11: os quatro Es saíram como BULLETS —
//
//   "Economicidade: Uso de recursos com menor custo"
//   "Eficácia: Grau de alcance das metas programadas"
//
// quarenta e cinco caracteres cada, sem cláusula distintiva, com metade do
// slide vazia. `completarDefinicoes` percorria `s.cards` e nada mais, então
// este slide passaria intacto pelo conserto. A régua não alcançava tudo o que
// governa — de novo.
//
// Um bullet "Termo: definição" é um cartão escrito em uma linha. Separa-se no
// primeiro dois-pontos e passa pelo mesmo crivo.

/** O separador tem de deixar um termo curto à esquerda e texto à direita. */
const BULLET_DEFINICAO = /^\s*([^:：]{3,40}?)\s*[:：]\s+(.{10,})$/;

export function separarBullet(bullet: string): { termo: string; corpo: string } | null {
  const m = (bullet ?? "").match(BULLET_DEFINICAO);
  if (!m) return null;
  const termo = m[1].trim();
  // Termo de glossário é um nome, não uma frase: no máximo quatro palavras, e
  // sem pontuação interna que denuncie uma oração.
  if (termo.split(/\s+/).length > 4 || /[.;!?]/.test(termo)) return null;
  return { termo, corpo: m[2].trim() };
}

function candidatosDeBullets(bullets: string[], fonte: string): Candidato[] {
  return bullets.map((b) => {
    const par = separarBullet(b);
    if (!par) return { card: null, termo: "", corpo: b, texto: null };
    return {
      card: null,
      termo: par.termo,
      corpo: par.corpo,
      texto: candidatoDe(par.termo, par.corpo, fonte),
    };
  });
}

/** Completa, num slide de cartões, as definições que a fonte tem inteiras. */
export function completarCartoes(cards: DeckCard[], fonte: string): Reposicao[] {
  const teto = tetoDoCorpo(cards.length);
  const feitas: Reposicao[] = [];
  for (const c of candidatos(cards, fonte)) {
    // Não cabe no cartão: melhor o resumo do modelo do que uma frase cortada ao
    // meio — que é exatamente o defeito que se está consertando. Quem resolve o
    // caso de não caber é `cartoesViramTabela`.
    if (!c.texto || c.texto.length > teto || !c.card) continue;
    feitas.push({ termo: c.termo, antes: c.corpo, depois: c.texto });
    c.card.body = c.texto;
  }
  return feitas;
}

// O bullet é cortado por normItems com DOIS tetos, e o de palavras é o que
// aperta: 22 palavras contra 160 caracteres. Uma definição com cláusula quase
// sempre passa de 22 palavras — por isso, nos bullets, o caminho comum é a
// tabela, e não a reescrita no lugar.
const BULLET = { palavras: 22, chars: 160 };

function cabeNoBullet(termo: string, texto: string): boolean {
  const linha = `${termo}: ${texto}`;
  return linha.length <= BULLET.chars && linha.split(/\s+/).length <= BULLET.palavras;
}

/** Reescreve os bullets "Termo: definição" que a fonte enriquece E que cabem. */
export function completarBullets(bullets: string[], fonte: string): Reposicao[] {
  const feitas: Reposicao[] = [];
  candidatosDeBullets(bullets, fonte).forEach((c, i) => {
    if (!c.texto || !cabeNoBullet(c.termo, c.texto)) return;
    feitas.push({ termo: c.termo, antes: c.corpo, depois: c.texto });
    bullets[i] = `${c.termo}: ${c.texto}`;
  });
  return feitas;
}

/** Os rótulos da tabela de definições, no idioma do deck. */
export function rotulosDaTabela(language: string): { termo: string; definicao: string } {
  const l = (language || "").toLowerCase();
  if (/espa|spanish/.test(l)) return { termo: "Concepto", definicao: "Definición" };
  if (/fran|french/.test(l)) return { termo: "Concept", definicao: "Définition" };
  if (/ingl|english|^en\b|^en-/.test(l)) return { termo: "Concept", definicao: "Definition" };
  return { termo: "Conceito", definicao: "Definição" };
}

// ─── QUANDO A DEFINIÇÃO NÃO CABE NO CARTÃO ──────────────────────────────────
//
// MEDIDO: a fonte define efetividade em 220 caracteres. O cartão comporta 165
// em QUALQUER arranjo — renderCards limita o corpo a 3 linhas, e com 2 cartões
// numa linha só a altura sobra mas o teto de linhas não olha para ela.
//
// A tabela olha: capacidadeDaCelula mede a coluna e a altura da linha, e uma
// tabela de uma coluna de dados com 4 linhas dá 472 caracteres. É mais que o
// dobro do necessário, os quatro termos continuam no MESMO slide, e a
// comparação lado a lado — que é o valor do slide dos 4 Es — se mantém.
const MIN_LINHAS_DA_TABELA = 2;

/**
 * Converte o slide de cartões em tabela "termo | definição" quando ao menos uma
 * definição da fonte não cabe no cartão. Devolve as trocas, ou null quando não
 * houve conversão.
 */
export function cartoesViramTabela(
  slide: SlideSpec,
  fonte: string,
  language: string,
): Reposicao[] | null {
  const cards = slide.cards ?? [];
  if (cards.length < MIN_LINHAS_DA_TABELA) return null;
  const cs = candidatos(cards, fonte);
  const teto = tetoDoCorpo(cards.length);
  const naoCabem = cs.filter((c) => c.texto && c.texto.length > teto);
  if (!naoCabem.length) return null;

  const tetoDaCelula = capacidadeDaCelula(1, cards.length);
  if (naoCabem.some((c) => (c.texto as string).length > tetoDaCelula)) return null;

  const rotulos = rotulosDaTabela(language);
  const feitas: Reposicao[] = [];
  const linhas = cs.map((c) => {
    const corpo = c.texto ?? c.corpo;
    if (c.texto) feitas.push({ termo: c.termo, antes: c.corpo, depois: c.texto });
    return { label: c.termo, cells: [corpo] };
  });

  slide.kind = "table";
  slide.rowHeader = rotulos.termo;
  slide.columns = [rotulos.definicao];
  slide.rows = linhas;
  delete slide.cards;
  return feitas;
}

/**
 * O mesmo, para o slide de BULLETS no formato "Termo: definição".
 *
 * MEDIDO no slide 7 do deck de 21/11, que é onde o curso apresenta os 4 Es:
 * quatro bullets de ~45 caracteres, nenhuma cláusula, metade do slide vazia. E
 * o teto do bullet (22 palavras) é apertado demais para uma definição com
 * cláusula, então aqui a tabela é o caminho comum, não a exceção.
 *
 * Exige DUAS definições vindas da fonte: um slide com um "Contexto: ..." solto
 * não é um glossário, e virar tabela ali seria atropelar o planejador.
 */
export function bulletsViramTabela(
  slide: SlideSpec,
  fonte: string,
  language: string,
): Reposicao[] | null {
  const bullets = slide.bullets ?? [];
  if (bullets.length < MIN_LINHAS_DA_TABELA) return null;
  const cs = candidatosDeBullets(bullets, fonte);
  const enriquecidos = cs.filter((c) => c.texto);
  if (enriquecidos.length < 2) return null;
  // Se todos couberem no bullet, não há motivo para mudar de forma.
  if (enriquecidos.every((c) => cabeNoBullet(c.termo, c.texto as string))) return null;
  // Metade dos itens tem de ser "Termo: corpo"; senão não é lista de conceitos.
  if (cs.filter((c) => c.termo).length * 2 < cs.length) return null;

  const tetoDaCelula = capacidadeDaCelula(1, cs.length);
  if (enriquecidos.some((c) => (c.texto as string).length > tetoDaCelula)) return null;

  const rotulos = rotulosDaTabela(language);
  const feitas: Reposicao[] = [];
  const linhas = cs.map((c) => {
    if (c.texto) feitas.push({ termo: c.termo, antes: c.corpo, depois: c.texto });
    return { label: c.termo || "—", cells: [c.texto ?? c.corpo] };
  });

  slide.kind = "table";
  slide.rowHeader = rotulos.termo;
  slide.columns = [rotulos.definicao];
  slide.rows = linhas;
  delete slide.bullets;
  return feitas;
}

/**
 * Passa o deck inteiro: para cada slide de cartões, completa as definições com
 * a palavra da fonte do próprio módulo — e, quando alguma não couber no cartão,
 * troca o slide por uma tabela, que comporta.
 */
export function completarDefinicoes(
  out: DeckModule[],
  inputs: ModuleInput[],
  language = "",
): Reposicao[] {
  const todas: Reposicao[] = [];
  for (let i = 0; i < out.length; i++) {
    const fonte = inputs[i]?.content ?? "";
    if (!fonte.trim()) continue;
    for (const s of out[i].slides as SlideSpec[]) {
      if (s.cards?.length) {
        const comoTabela = cartoesViramTabela(s, fonte, language);
        if (comoTabela) {
          todas.push(...comoTabela);
          continue;
        }
        todas.push(...completarCartoes(s.cards, fonte));
        continue;
      }
      // O fechamento do módulo é recapitulação, não glossário: seus bullets
      // resumem o que já foi dito e não devem virar tabela de definições.
      if (s.kind === "bullets" && s.bullets?.length) {
        const comoTabela = bulletsViramTabela(s, fonte, language);
        if (comoTabela) {
          todas.push(...comoTabela);
          continue;
        }
        todas.push(...completarBullets(s.bullets, fonte));
      }
    }
  }
  return todas;
}
