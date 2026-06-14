---
name: V7 engine Gemini model and batch config
description: Which Gemini model and batch settings to use for the export-pptx-v7 adaptive engine to avoid rate limiting.
---

## Rule
Use `gemini-2.0-flash` (not `gemini-2.5-flash`) with `batchSize: 1` (sequential, not concurrent) in `deck-plan.ts`.

**Why:** `gemini-2.5-flash` has stricter RPM limits and caused 4/5 modules to fall back to deterministic in production. With the default `batchSize: 3` (concurrent calls), modules 1 and 2 in each batch hit rate limits while module 0 succeeded. Switching to `gemini-2.0-flash` + sequential processing (`batchSize: 1`) resolved the fallback spike.

**How to apply:** If fallback rate is high (>50% of modules), check model name and batch concurrency in `supabase/functions/export-pptx-v7/deck-plan.ts` — `GEMINI_PLAN_URL` and `batchSize` default.
