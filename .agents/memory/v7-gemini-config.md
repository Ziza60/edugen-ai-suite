---
name: V7 engine Gemini model and batch config
description: Which Gemini model and batch settings to use for the export-pptx-v7 adaptive engine to avoid rate limiting.
---

## Rule
Use `gemini-2.5-flash` with `batchSize: 1` (sequential) in `deck-plan.ts`.

**Why:**
- `gemini-2.5-flash` is the only confirmed-working model for structured output via `v1beta` endpoint from Supabase edge functions.
- `gemini-2.0-flash` returns immediate silent failures (0/5 modules) at `v1beta/models/gemini-2.0-flash:generateContent` — the model name appears invalid or inaccessible at that endpoint.
- With `batchSize: 3` (concurrent), modules 1+ hit RPM rate limits immediately after module 0 succeeds.
- `batchSize: 1` (sequential) lets each module complete before the next call — resolves rate limiting.

**How to apply:** If fallback rate is high (>50% of modules), check `deck-plan.ts`:
- `GEMINI_PLAN_URL` must use `gemini-2.5-flash`
- `batchSize` default must be `1`
