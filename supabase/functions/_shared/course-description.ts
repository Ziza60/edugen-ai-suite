// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — a descrição do curso, sem autoelogio
//
// POR QUE ISTO NÃO É UMA REGRA DE PROMPT
//
// A descrição saía como "Este curso premium é projetado para...". A palavra
// vinha da primeira linha do prompt de arquitetura ("Projete um curso premium"),
// e o modelo a copiava para o texto que o COMPRADOR lê. A correção anterior
// tirou a palavra do prompt e escreveu a regra "sem adjetivo de autoelogio".
//
// Registro honesto de por que ISTO existe: a regra de prompt nunca chegou a ser
// testada. O relato de que o premium "continuava" veio de um curso ANTIGO, cuja
// descrição já estava gravada no banco desde antes da correção — a regra pode
// muito bem estar funcionando. Este módulo foi escrito sobre essa suposição
// errada.
//
// Ele fica assim mesmo, e por um motivo que se sustenta sozinho: regra de prompt
// é uma tendência, não uma garantia, e esta frase é a vitrine que o comprador lê.
// A lista é curta e fechada e o alvo tem duas linhas — dá para garantir no
// código em vez de contar com a boa vontade do modelo. As duas camadas convivem:
// o prompt reduz a frequência, o código fecha a porta.
//
// CUIDADO QUE A IMPLEMENTAÇÃO TOMA
//
// Apagar a palavra em qualquer posição estragaria curso cujo ASSUNTO é ela —
// "Gestão de marcas premium", "Estratégias para o segmento premium". Por isso
// só sai quando qualifica o próprio curso, isto é, quando está colada a um
// substantivo que nomeia o material: curso, programa, treinamento, material,
// conteúdo, capacitação, formação.
// ═══════════════════════════════════════════════════════════════════════════

/** Adjetivos de vitrine que o modelo usa para elogiar o próprio curso. */
const AUTOELOGIOS = [
  "premium",
  "completo",
  "completíssimo",
  "abrangente",
  "excepcional",
  "inovador",
  "revolucionário",
  "exclusivo",
  "definitivo",
  "avançadíssimo",
  "imperdível",
  "incrível",
  "poderoso",
  "transformador",
];

/** Substantivos que nomeiam o próprio material — é a eles que o elogio cola. */
const O_MATERIAL = [
  "curso",
  "programa",
  "treinamento",
  "material",
  "conteúdo",
  "capacitação",
  "formação",
  "módulo",
  "workshop",
];

/**
 * Gera as flexões de gênero e número de cada palavra.
 *
 * Três terminações dão conta da lista, e errar a flexão é errar em silêncio: a
 * expressão simplesmente deixa de casar e o adjetivo passa. Foi o que aconteceu
 * com "inovadora" — a primeira versão só sabia flexionar palavras terminadas em
 * -o e devolvia "inovadors".
 */
const flexoes = (palavras: string[]) =>
  palavras.flatMap((p) => {
    if (/or$/.test(p)) {
      // inovador → inovadora, inovadores, inovadoras
      return [p, `${p}a`, `${p}es`, `${p}as`];
    }
    if (/vel$/.test(p)) {
      // imperdível → imperdíveis (invariável em gênero)
      return [p, p.replace(/vel$/, "veis")];
    }
    if (/o$/.test(p)) {
      // completo → completa, completos, completas
      const base = p.slice(0, -1);
      return [p, `${base}a`, `${p}s`, `${base}as`];
    }
    // premium, incrível e afins: invariáveis ou já cobertos acima
    return [p, `${p}s`];
  }).join("|");

const ELOGIO = flexoes(AUTOELOGIOS);
const MATERIAL = flexoes(O_MATERIAL);

/** "curso premium", "programa completo" — elogio DEPOIS do substantivo. */
const DEPOIS = new RegExp(`\\b(${MATERIAL})\\s+(?:${ELOGIO})\\b`, "gi");
/** "premium curso" é raro, mas "completo programa" aparece. */
const ANTES = new RegExp(`\\b(?:${ELOGIO})\\s+(${MATERIAL})\\b`, "gi");

/**
 * Remove o adjetivo de vitrine quando ele qualifica o próprio material.
 *
 * Devolve a descrição pronta para gravar. Nunca lança: descrição é conteúdo do
 * produto, e uma falha aqui não pode custar a criação do curso.
 */
export function limparAutoelogio(descricao: string | null | undefined): string {
  if (!descricao) return "";
  try {
    let t = String(descricao);
    t = t.replace(DEPOIS, "$1");
    t = t.replace(ANTES, "$1");
    // O corte deixa espaço dobrado onde a palavra estava.
    return t.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  } catch {
    return String(descricao);
  }
}
