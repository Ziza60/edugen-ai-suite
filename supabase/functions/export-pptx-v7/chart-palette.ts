// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — cores para partes de um gráfico (categorias, não magnitudes)
//
// O problema que isso resolve: as fatias da rosca e do donut nativo eram
// geradas interpolando `accent` → `accent2` do tema. No tema "Gold & Dark"
// esses dois tokens são D9810A e F0B23C — dois laranjas. Cinco fatias viravam
// cinco laranjas quase idênticos, e o leitor não conseguia ligar a fatia à
// legenda. A cor estava fazendo trabalho de IDENTIDADE com uma rampa de
// MAGNITUDE, que é a ferramenta errada.
//
// Quando a cor identifica categorias (quem é quem), o que se precisa é de matiz
// distinta por fatia, em ordem FIXA — nunca ciclada, nunca gerada. Estas são as
// oito matizes de referência, na etapa escolhida para fundo escuro.
//
// Validadas com o validador do método (OKLab, Machado-Oliveira-Fernandes 2009 a
// severidade 1.0) contra os cinco fundos dos temas do produto — 0D1117, 0A1628,
// 040D1C, 0B0912 e 0F1219. Em todos os cinco, com seis fatias:
//
//   faixa de luminosidade  todas dentro de L 0,48–0,67          PASS
//   piso de croma          todas ≥ 0,10                          PASS
//   separação sob daltonismo  pior par adjacente ΔE 8,4 (protan) PASS
//   piso de visão normal      pior par adjacente ΔE 19,3         PASS
//   contraste contra o fundo  todas ≥ 3:1                        PASS
//
// A ORDEM é o mecanismo de segurança, não enfeite: ela é o que garante que duas
// fatias vizinhas — as únicas que se encostam — fiquem distinguíveis. Reordenar
// à mão invalida a checagem acima. Se precisar mexer, rode o validador de novo.
// ═══════════════════════════════════════════════════════════════════════════

/** Matizes categóricas, em ordem fixa, na etapa para fundo escuro. */
export const CATEGORICAL_DARK = [
  "3987E5", // 1 azul
  "D95926", // 2 laranja
  "199E70", // 3 verde-água
  "C98500", // 4 amarelo
  "D55181", // 5 magenta
  "008300", // 6 verde
  "9085E9", // 7 violeta
  "E66767", // 8 vermelho
] as const;

/**
 * Cinza neutro para o que passa da oitava categoria. Um nono matiz gerado por
 * interpolação voltaria ao problema original — cores parecidas demais para
 * identificar. Um gráfico com mais de oito fatias já não é legível de qualquer
 * forma; o cinza torna isso explícito em vez de fingir que dá certo.
 */
export const CATEGORICAL_OVERFLOW = "6B7785";

/**
 * As `n` primeiras cores da ordem fixa. Nunca cicla: a partir da nona, devolve
 * o cinza de excedente.
 */
export function categoricalColors(n: number): string[] {
  return Array.from(
    { length: Math.max(0, Math.floor(n)) },
    (_, i) => CATEGORICAL_DARK[i] ?? CATEGORICAL_OVERFLOW,
  );
}
