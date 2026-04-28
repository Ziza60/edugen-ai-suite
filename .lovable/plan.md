# Diagnóstico v3.12.3 — Causa Raiz da Explosão de Slides

## O que os logs mostram (run 1777356191xxx, módulo "Configurando Ambiente")

Coletei 100+ entradas `[V3-SPLIT]`, `[V3-FIT]` e `[V3-DEBUG][SPLIT-CUT/RESULT]`. Padrão consistente em TODOS os módulos:

| Slide original (IA) | chars | items | Virou | Por quê |
|---|---|---|---|---|
| "VS Code: Editor Ideal" (grid_cards) | 688 | 5 | **5 slides de 1 item** | Cada item tem ~130-146 chars; o `wouldExceedMeasure` corta a cada 2 |
| "Python: Vantagens" (grid_cards) | 673 | 5 | **5 slides de 1 item** | Mesma causa |
| "Configurando Ambiente" (bullets) | 561 | 4 | **4 slides de 1 item** | Mesma causa |
| "Exemplo Prático" (bullets) | 534 | 4 | **4 slides de 1 item** | Mesma causa |
| "Key Takeaways" (numbered) | 488 | 4 | **4 slides de 1 item** | Mesma causa |
| "Instalação Python" (bullets) | 534 | 5 | **2 slides** (4+1) | Único caso saudável |

**Resultado**: 8 módulos x ~25 slides/módulo = **~200 slides**, sendo a maioria com **1 único bullet**.

Um exemplo gritante:
```
[SPLIT-RESULT] slideIdx:0 title:"Key Takeaways" totalChars:111 itemCount:1
[SPLIT-RESULT] slideIdx:1 title:"Key Takeaways (Continuação)" totalChars:133 itemCount:1
[SPLIT-RESULT] slideIdx:2 title:"Key Takeaways (Continuação)" totalChars:118 itemCount:1
[SPLIT-RESULT] slideIdx:3 title:"Key Takeaways (Continuação)" totalChars:126 itemCount:1
```
4 slides, cada um com 1 item de ~120 chars. Cabem todos juntos no mesmo slide (488 chars total, bem abaixo do limite de 720).

---

## Causa raiz (linhas 549-587 de `export-pptx-v3/index.ts`)

O loop tem TRÊS gates de corte avaliados em ordem:

1. `wouldExceedItems` — passa do `maxItems` (5)
2. `wouldExceedChars` — passa de 590 chars no chunk
3. `wouldExceedMeasure` — `computeUnifiedSlideFontSize(...) <= MIN_FONT.BODY`

**O gate #3 (`measure`) está disparando em quase todos os pares de items**, mesmo quando o chunk tem só 2 items totalizando 250-290 chars. Os logs comprovam: TODOS os `SPLIT-CUT` mostram `reason:"measure"` com `currentChars:111-146` e `currentItems:1`.

Por quê: a função `computeUnifiedSlideFontSize` é chamada com **`items.length`** original (5) como base de tier (`>=6 ? 18 : 19`), mas calcula altura para o **chunk acumulado + próximo item**. O cálculo está retornando `<= MIN_FONT.BODY` na 2ª iteração porque o estimador de altura é pessimista para items longos (~140 chars cada).

Confirmando pelos logs `[V3-FIT]`: depois do split, slides com **2 items de 250-280 chars** rodam tranquilamente em `fontSize=18pt estH=2.24in (max=4.95in)` — sobra **2.7 polegadas vazias**. Ou seja, o `measure` está super-cortando.

---

## Correção (1 arquivo, ~15 linhas)

`supabase/functions/export-pptx-v3/index.ts` — função `normalizeAndSplitSlide` + bump de versão para `3.12.4-MEASURE-FIX`.

### Mudança 1 — Tornar o gate `measure` muito mais conservador (linha 554-556)

```ts
// ANTES (corta cedo demais):
const wouldExceedMeasure =
  current.length > 0 &&
  computeUnifiedSlideFontSize([...current, it], items.length >= 6 ? 18 : 19, items.length >= 6 ? 78 : 92, MIN_FONT.BODY) <= MIN_FONT.BODY;

// DEPOIS — só corta por measure se chunk já tem >=3 items E acumulou >=400 chars:
const wouldExceedMeasure =
  current.length >= 3 &&
  currentChars + itLen > 400 &&
  computeUnifiedSlideFontSize([...current, it], 16, 70, MIN_FONT.BODY) < MIN_FONT.BODY;
```

Justificativa: o estimador é uma heurística; o motor real (`[V3-FIT]`) prova depois que 4 items de 130 chars cabem em 4.5 in. Só faz sentido cortar por measure quando estamos verdadeiramente saturados.

### Mudança 2 — Elevar o limite de char por chunk (linha 553)

```ts
// ANTES: const wouldExceedChars = currentChars + itLen > 590 && current.length > 0;
// DEPOIS:
const wouldExceedChars = currentChars + itLen > 720 && current.length > 0;
```

Alinha com o limite `<= 720` do early-return na linha 537 (o slide só entra no splitter se passar de 720; faz sentido o chunk-cap ser igual).

### Mudança 3 — Bump de versão e log

```ts
const ENGINE_VERSION = "3.12.4-MEASURE-FIX";
```

E adicionar `console.log("[V3-SPLIT-CFG] measure-min-items=3 char-cap=720")` no início do split do primeiro slide para confirmar a versão em produção.

### Mudança 4 — Remover/silenciar logs verbosos

Após confirmar o fix, transformar `[V3-DEBUG][SPLIT-CUT]` e `[V3-DEBUG][SPLIT-RESULT]` em condicionais `if (DEBUG_SPLIT_VERBOSE)` (flag default `false`). Mantém `[V3-SPLIT]` resumo e `[V3-FIT]` para auditoria futura.

---

## Resultado esperado

| Antes | Depois |
|---|---|
| ~200 slides totais | ~70-90 slides (8 módulos x 8-11 slides) |
| Slides com 1 bullet | Slides com 3-5 bullets |
| 4-5 "(Continuação)" por seção | 0-1 "(Continuação)" |
| Espaço vazio (estH 2.24 / max 4.95) | Densidade saudável (estH 3.5-4.5) |

Os outros sintomas (texto truncado "com frameworks como Django e bibli.", "(Continuação) (Continuação)" duplicado) **derivam da mesma causa** — eles aparecem porque o splitter está agressivo demais e renomeando títulos repetidamente. Com o fix, somem naturalmente.

---

## Não vou tocar

- `computeUnifiedSlideFontSize` — heurística complexa; mexer ali quebra outros engines
- Prompt da IA — JSON está perfeito (logs `[V3-AI-DIAG]` confirmam)
- `[V3-FIT]` — funciona corretamente
- `buildFallbackSlides` — não está sendo usado (zero `[V3-AI-ERR]` nos logs)

Aprove para eu aplicar o patch e fazer redeploy.