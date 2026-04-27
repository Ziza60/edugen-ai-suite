## Objetivo

Aplicar GEMMA v3.11.1 no `export-pptx-v3/index.ts` para resolver overflow nos slides com bullets, grid_cards, summary_slide e numbered_takeaways. As mudanças combinam: (1) estimador de altura mais realista, (2) splitter mais agressivo, (3) `shouldForceContinuation` mais rigoroso, (4) padding/shrinkText nos layouts críticos.

## Mudanças (exatamente 7 edições no arquivo `supabase/functions/export-pptx-v3/index.ts`)

### 1. `estimateTextHeightInches` — fator empírico realista (L380-387)

Substituir o corpo da função para usar `charWidthFactor = 0.0198`, `lineSpacingMultiple = 1.6` por padrão e multiplicador 1.24 para cobrir bold/runs/wrapping real do PowerPoint:

```ts
function estimateTextHeightInches(
  text: string, fontSize: number, boxW: number, lineSpacingMultiple = 1.6
): number {
  const safeText = sanitizeText(text || "").trim();
  if (!safeText) return 0.4;
  const charWidthFactor = 0.0198;
  const charsPerLine = Math.max(8, Math.floor(boxW / (fontSize * charWidthFactor)));
  const lines = Math.max(1, Math.ceil(safeText.length / charsPerLine));
  return lines * ((fontSize / 72) * lineSpacingMultiple * 1.24);
}
```

### 2. `shouldForceContinuation` — mais rigoroso (L404-426)

Substituir thresholds: bullets força continuação se `unified ≤ 18.5` ou `longest > 105`; grid_cards se `< MIN_FONT.BODY + 0.5`; summary/takeaways se `unified ≤ 18` ou `longest > 95`:

```ts
case "bullets": {
  const unified = computeUnifiedSlideFontSize(items, 20, 92, MIN_FONT.BODY);
  return unified <= 18.5 || longest > 105;
}
case "grid_cards":
  return computeDeterministicGridFontSize(items) < MIN_FONT.BODY + 0.5;
case "summary_slide":
case "numbered_takeaways": {
  const unified = computeUnifiedSlideFontSize(items, 19, 85, MIN_FONT.BODY);
  return unified <= 18 || longest > 95;
}
```

### 3. `normalizeAndSplitSlide` — split mais cedo (L468 e L483)

- L468: trocar `totalChars < 800 && items.length <= 8` por `totalChars < 650 && items.length <= 7`.
- L483: trocar limite de chars de `> 580` para `> 520`.

### 4. `renderBullets` variant 1 — padding e shrinkText (L2826-2840)

- `v1X = contentX + 0.68` (era +0.55)
- `v1W = contentW - 0.88` (era −0.70)
- `h: itemH - 0.05` mantido
- `shrinkText: true`, adicionar `maxFontSize: 19`, `minFontSize: 13`

### 5. `renderGridCards` — padding lateral + shrinkText (L3171-3179)

- Calcular localmente `textW = geometry.cardW - geometry.textXOffset - 0.32` e `textH = geometry.cardH - geometry.textYOffset - 0.26` (em vez de usar `geometry.textW/textH`).
- No `addText`: `lineSpacingMultiple: 1.22`, `shrinkText: true`, `minFontSize: 12`.

### 6. `renderSummarySlide` — card menor + shrinkText (L3920 e L3951-3962)

- L3920: `cardH = Math.max(1.35, (contentHAvail - gap*(rows-1))/rows - 0.08)`.
- No `addText` final do item: remover `autoFit: true`, adicionar `shrinkText: true`, `minFontSize: 12`.

### 7. `renderNumberedTakeaways` — card menor + shrinkText (L4010 e L4060-4073)

- L4010: trocar `cardH = Math.min(1.85, Math.max(1.4, rawCardH))` por `cardH = Math.max(1.35, rawCardH - 0.08)` mantendo o teto seguro `Math.min(1.85, ...)`.
- No `addText` final: remover `autoFit: true`, adicionar `shrinkText: true`, `minFontSize: 12`.

## Deploy e verificação

- `supabase--deploy_edge_functions(["export-pptx-v3"])`.
- Confirmar números de linha exatos das edições no resumo final.

## Fora de escopo

- Nenhuma outra função, layout ou arquivo é tocado.
- `measureTextHeight` (calibração de fontes) permanece como está; o ajuste atual é no `estimateTextHeightInches` usado pelo planner.
