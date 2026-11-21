// ═══════════════════════════════════════════════════════════════════════════
// "PARTE 2" COMEÇANDO DO 1, E NOUTRO FORMATO
//
// APONTADO por quem usou, no deck de 21/11/2026. MEDIDO nos slides 51 e 52:
//
//   51 ... "Etapas de Construção da Matriz (Parte 1)"   steps,  1 2 3 4
//   52 ... "Etapas de Construção da Matriz (Parte 2)"   cards, 01 02 03
//
// É UM procedimento de sete etapas. O aluno vê duas listas: uma de quatro e
// outra de três, em desenhos diferentes, as duas começando do começo. A etapa
// 5 chama-se "01".
//
// A palavra "Parte" não existe em lugar nenhum do exportador — quem escreveu
// os dois títulos e escolheu os dois formatos foi o planejador. O prompt manda
// dividir ("MAX 5 items per slide... split it across 2 slides") e não diz nada
// sobre manter o formato nem sobre continuar a contagem.
//
// Regra de prompt não resolveria a numeração de qualquer modo: quem numera é o
// renderizador, sempre a partir de 1, e o próprio prompt proíbe o modelo de
// escrever ordinais no título do passo. O conserto tem de ser aqui.
//
// ─── O QUE CONTA COMO CONTINUAÇÃO ───────────────────────────────────────────
//
// Dois slides VIZINHOS, no mesmo módulo, cujos títulos são o mesmo tronco com
// um marcador de parte no fim. Vizinhança importa: dois slides com títulos
// parecidos em pontas opostas do módulo não são uma lista partida.
// ═══════════════════════════════════════════════════════════════════════════

import type { DeckModule, SlideSpec } from "./deck-plan.ts";

/** Marcador de parte no fim do título: (Parte 2), - Parte 2, (cont.), II... */
const MARCADOR =
  /[\s–—-]*[(\[]?\s*(?:parte|part|bloco|cont\.?|continua[çc][ãa]o|continued)\s*(\d+|[ivx]+)?\s*[)\]]?\s*$/i;

/** O título sem o marcador de parte, normalizado para comparação. */
export function troncoDoTitulo(titulo: string): string {
  return (titulo ?? "")
    .replace(MARCADOR, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.:;,]+$/, "");
}

/** O título anuncia que é parte de uma lista maior? */
export function temMarcadorDeParte(titulo: string): boolean {
  return MARCADOR.test(titulo ?? "") && troncoDoTitulo(titulo).length >= 8;
}

/** Os tipos numerados: é neles que reiniciar a contagem engana o aluno. */
const NUMERADOS = new Set(["steps", "cards", "tiles", "bento"]);

/** Quantos itens o slide numera. */
export function quantosItens(s: SlideSpec): number {
  if (s.kind === "steps") return s.steps?.length ?? 0;
  if (s.kind === "cards" || s.kind === "bento") return s.cards?.length ?? 0;
  if (s.kind === "tiles") return s.bullets?.length ?? 0;
  return 0;
}

/** cards ⇄ steps: os dois carregam heading + body, então a troca não perde nada. */
function converterPara(s: SlideSpec, destino: string): boolean {
  if (s.kind === destino) return true;
  if (!NUMERADOS.has(destino) || !NUMERADOS.has(s.kind)) return false;
  const itens = s.kind === "steps"
    ? (s.steps ?? []).map((p) => ({ heading: p.heading, body: p.body }))
    : (s.cards ?? []).map((c) => ({ heading: c.heading, body: c.body }));
  if (!itens.length) return false;
  if (destino === "steps") {
    s.steps = itens.map((i) => ({ heading: i.heading, body: i.body }));
    delete s.cards;
  } else {
    s.cards = itens.map((i) => ({ heading: i.heading, body: i.body ?? "" }));
    delete s.steps;
  }
  s.kind = destino as SlideSpec["kind"];
  return true;
}

export interface Unificacao {
  tronco: string;
  slides: number;
  formato: string;
  comecaEm: number;
}

/**
 * Nos slides vizinhos que continuam a mesma lista: um único formato, e a
 * contagem segue de onde a parte anterior parou.
 */
export function unificarContinuacoes(out: DeckModule[]): Unificacao[] {
  const feitas: Unificacao[] = [];
  for (const m of out) {
    let i = 0;
    while (i < m.slides.length) {
      const atual = m.slides[i];
      const tronco = troncoDoTitulo(atual.title ?? "");
      if (!tronco || !NUMERADOS.has(atual.kind)) {
        i++;
        continue;
      }
      // A corrida: este slide e os vizinhos seguintes com o mesmo tronco. O
      // PRIMEIRO não precisa de marcador — "Etapas (Parte 1)" costuma tê-lo,
      // mas "Etapas" seguido de "Etapas (cont.)" é a mesma coisa.
      let fim = i + 1;
      while (
        fim < m.slides.length &&
        troncoDoTitulo(m.slides[fim].title ?? "") === tronco &&
        temMarcadorDeParte(m.slides[fim].title ?? "") &&
        NUMERADOS.has(m.slides[fim].kind)
      ) fim++;

      if (fim - i < 2) {
        i++;
        continue;
      }

      // O formato da PRIMEIRA parte manda: é a que o aluno viu primeiro.
      const formato = atual.kind;
      let acumulado = quantosItens(atual);
      let unificados = 1;
      for (let k = i + 1; k < fim; k++) {
        const s = m.slides[k];
        if (!converterPara(s, formato)) continue;
        s.startIndex = acumulado;
        acumulado += quantosItens(s);
        unificados++;
      }
      if (unificados > 1) {
        feitas.push({
          tronco,
          slides: unificados,
          formato,
          comecaEm: quantosItens(atual) + 1,
        });
      }
      i = fim;
    }
  }
  return feitas;
}
