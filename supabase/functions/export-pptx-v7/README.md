# export-pptx-v7 — "Adaptive Engine"

A **topic-agnostic** PPTX exporter, and the engine the product ships with.
`export-pptx-v4` remains in the repository as the fallback the frontend calls
when v7 fails.

## Why this exists

`export-pptx-v4` was hardened, version after version, with **hundreds of
topic-specific deterministic rules** (Python/SQL contamination, code
completeness, etc.). Every new course subject surfaced new failure modes, so
the engine needed new rules — "a new engine for every road". The cost grows
without bound.

v7 fixes the problem at its root: **build quality at the source, then validate
only what is universal.**

## Architecture

```
course markdown
  └─▶ deck-plan.ts   buildDeck()
        • planModuleSlides() — ONE structured Gemini call per module
          (responseSchema guarantees render-ready JSON; ZERO domain rules)
        • fallbackModuleSlides() — deterministic markdown→slides when the LLM
          is unavailable or returns junk (graceful degradation)
  └─▶ validate.ts    normalizeDeck()
        • universal-only fixes: cap bullets/cards/steps, strip ellipsis &
          dangling words, split overflow into "(cont.)" slides, drop empties,
          break layout monotony. NEVER throws, NEVER vetoes.
  └─▶ images.ts      resolveImages()  (optional, best-effort Pexels)
        • curated-images.ts — hand-picked fallbacks per theme
  └─▶ render.ts      renderDeck(PptxGenJS, deck)
        • clean design system, 16:9, 17 slide kinds, image support
        • chart-palette.ts     — categorical colours (never a magnitude ramp)
        • chevron-geometry.ts  — chevron centroid, so the number sits centred
        • layout-fit.ts        — which layouts a given content may claim
  └─▶ index.ts       Deno handler: auth ▸ fetch ▸ build ▸ render ▸ upload ▸ URL
```

### Key differences from v4

| | v4 (fallback) | v7 (primary) |
|---|---|---|
| Output guarantee | QA **veto** → HTTP 422 can block the whole export | Always ships a deck (graceful degrade) |
| Topic rules | Hundreds (Python/SQL/…) | **Zero** |
| LLM output | free prose, parsed & repaired downstream | structured JSON via `responseSchema` |
| Lines of code | 10,663 in a single file | ~6,000 across 9 modules |
| Images | none | optional (Pexels + curated fallbacks) |

## Slide kinds

`cover` · `toc` · `section` · `bullets` · `tiles` · `bento` · `cards` ·
`steps` · `compare` · `matrix` · `table` · `quote` · `stat` · `chart` ·
`code` · `closing`. The planner picks the best kind per idea; the renderer
just draws them.

`layout-fit.ts` is the guard on that freedom: a layout that makes a
*structural claim* about the content may only be used when the content
actually supports it. A chevron/timeline says "these steps happen in this
order", so `ehSequencia()` only allows it for titles that name a sequence; a
donut says "these are parts of a whole", so `proporcaoInformativa()` refuses
it when the values are within 2% of each other and the chart would show a
featureless ring.

## Testing (offline, no Deno / no network)

`deck-plan.ts`, `validate.ts`, `render.ts`, `images.ts` are pure TS — only
`index.ts` uses Deno APIs. `PptxGenJS` is injected into `renderDeck`, so the
renderer runs under Node/Bun.

```bash
# from the repository root
npm install pptxgenjs@3.12.0 --no-save
bun run supabase/functions/export-pptx-v7/__tests__/render.smoke.ts
bun run supabase/functions/export-pptx-v7/__tests__/robustness.smoke.ts
```

`render.smoke.ts` renders real PPTX files for two unrelated topics (a Python
course and a Brazilian-history course) plus an empty-course edge case, and
verifies the output is a valid zip — proving the engine is topic-agnostic.
`robustness.smoke.ts` covers the planner's failure modes: truncated JSON,
starved modules, echoed titles, degenerate tables and charts.

Both run in CI on every push and pull request to `main`
(`.github/workflows/smoke-tests.yml`). `pptxgenjs` is installed there with
`--no-save`, not declared as a dependency: the edge function pins it itself
(`npm:pptxgenjs@3.12.0` in `index.ts`), and the frontend bundle must not carry
it. Keep the two pins equal.

## Status

**Primary engine.** `ExportButtons.tsx` calls `export-pptx-v7` first and only
falls back to `export-pptx-v4` when v7 returns an error. Deploy with:

```bash
supabase functions deploy export-pptx-v7
```

### Optional env

- `GEMINI_API_KEY` — enables the structured planner (without it, the engine
  uses the deterministic fallback and still produces a deck).
- `PEXELS_API_KEY` — enables decorative images (without it, images are skipped).
