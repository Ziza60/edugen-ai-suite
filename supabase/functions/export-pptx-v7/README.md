# export-pptx-v7 — "Adaptive Engine"

A **topic-agnostic** PPTX exporter. It is a clean-room reimplementation that
inverts the architecture of `export-pptx-v4` (the current canonical v5.8.7
engine), without touching it.

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
  └─▶ render.ts      renderDeck(PptxGenJS, deck)
        • clean design system, 16:9, 11 slide kinds, image support
  └─▶ index.ts       Deno handler: auth ▸ fetch ▸ build ▸ render ▸ upload ▸ URL
```

### Key differences from v4

| | v4 (canonical) | v7 (this) |
|---|---|---|
| Output guarantee | QA **veto** → HTTP 422 can block the whole export | Always ships a deck (graceful degrade) |
| Topic rules | Hundreds (Python/SQL/…) | **Zero** |
| LLM output | free prose, parsed & repaired downstream | structured JSON via `responseSchema` |
| Lines of code | ~10,300 (single file) + helpers | ~1,200 across 5 small modules |
| Images | none | optional (Pexels) |

## Slide kinds

`cover` · `toc` · `section` · `bullets` · `cards` · `steps` · `compare` ·
`quote` · `stat` · `code` · `closing`. The planner picks the best kind per
idea; the renderer just draws them.

## Testing (offline, no Deno / no network)

`deck-plan.ts`, `validate.ts`, `render.ts`, `images.ts` are pure TS — only
`index.ts` uses Deno APIs. `PptxGenJS` is injected into `renderDeck`, so the
renderer runs under Node/Bun.

```bash
# from this directory, with pptxgenjs available (npm i pptxgenjs@3.12.0 --no-save)
bun run __tests__/render.smoke.ts
```

The smoke test renders real PPTX files for two unrelated topics (a Python
course and a Brazilian-history course) plus an empty-course edge case, and
verifies the output is a valid zip — proving the engine is topic-agnostic.

## Status

**Not wired into the frontend.** `ExportButtons.tsx` still uses `export-pptx-v4`
as the canonical engine. To trial v7, call the function directly or add an
opt-in path. Deploy with:

```bash
supabase functions deploy export-pptx-v7
```

### Optional env

- `GEMINI_API_KEY` — enables the structured planner (without it, the engine
  uses the deterministic fallback and still produces a deck).
- `PEXELS_API_KEY` — enables decorative images (without it, images are skipped).
