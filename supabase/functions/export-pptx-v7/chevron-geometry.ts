// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — geometria do chevron (slide de processo)
//
// O preset `chevron` do OOXML recorta um entalhe à ESQUERDA e projeta um bico à
// DIREITA, os dois com a mesma profundidade x1 = min(w,h)/2. O contorno é:
//
//     (0,0) → (w−x1, 0) → (w, h/2) → (w−x1, h) → (0, h) → (x1, h/2) → fecha
//
// Duas consequências que o código precisa respeitar:
//
// 1. A faixa preenchida DESLIZA conforme se sobe ou desce. Na altura do meio ela
//    vai de x1 até w; na altura do topo e da base, de 0 até w−x1. Uma caixa de
//    texto centrada na vertical só está garantidamente dentro da forma no
//    intervalo [x1, w − x1·(alturaDaCaixa/h)].
//
// 2. O centro visual NÃO é o meio dessa faixa segura. É w/2 — o entalhe da
//    esquerda e o bico da direita têm exatamente a mesma área, então um
//    compensa o outro e o centroide cai no meio da largura declarada.
//
// O código antigo centrava o número no meio da FAIXA SEGURA, e não no centroide.
// Com 5 chevrons de 2,31 × 1,50 pol isso empurrava o número 0,22 pol para a
// direita — quase 10% da largura — e o desalinhamento era visível a olho nu.
// ═══════════════════════════════════════════════════════════════════════════

/** Profundidade do entalhe/bico, com o ajuste padrão (adj = 50000). */
export function chevronNotch(w: number, h: number): number {
  return Math.min(w, h) / 2;
}

/**
 * Centro visual do chevron, medido a partir da borda esquerda da forma.
 *
 * Prova de que é w/2: a forma é o retângulo [0, w−x1] × [0, h] MAIS o triângulo
 * do bico e MENOS o triângulo do entalhe, ambos de área x1·h/2. Somando os
 * momentos, os dois triângulos contribuem +x1/2 sobre o centroide do retângulo,
 * que é (w−x1)/2 — e (w−x1)/2 + x1/2 = w/2.
 */
export function chevronCenterX(w: number): number {
  return w / 2;
}

/**
 * Intervalo horizontal em que uma caixa de altura `alturaCaixa`, centrada na
 * vertical, está inteiramente DENTRO da forma preenchida.
 */
export function chevronSafeSpan(
  w: number,
  h: number,
  alturaCaixa: number,
): { esquerda: number; direita: number } {
  const x1 = chevronNotch(w, h);
  // Limite esquerdo: pior caso é o ápice do entalhe, na altura do meio.
  // Limite direito: pior caso é o topo/base da caixa, onde o bico já recuou.
  const recuo = Math.min(1, Math.max(0, alturaCaixa / h));
  return { esquerda: x1, direita: w - x1 * recuo };
}

/**
 * Caixa para o número do chevron: centrada no centro visual da forma e larga
 * apenas o quanto couber simetricamente dentro da faixa segura. Devolve
 * deslocamentos relativos à origem da forma.
 *
 * Centrar E caber são requisitos separados: a faixa segura é assimétrica em
 * relação ao centroide (sobra mais à direita que à esquerda), então a largura é
 * ditada pelo lado mais apertado. Como a caixa carrega só um dígito, a folga
 * resultante é enorme — o que importa é que o `align: center` caia no centroide.
 */
export function chevronNumberBox(
  w: number,
  h: number,
  alturaCaixa: number,
): { dx: number; dy: number; w: number; h: number } {
  const centro = chevronCenterX(w);
  const { esquerda, direita } = chevronSafeSpan(w, h, alturaCaixa);
  const meiaLargura = Math.max(0, Math.min(centro - esquerda, direita - centro));
  return {
    dx: centro - meiaLargura,
    dy: (h - alturaCaixa) / 2,
    w: meiaLargura * 2,
    h: alturaCaixa,
  };
}
