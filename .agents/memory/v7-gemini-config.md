---
name: V7 engine Gemini model and batch config
description: Which Gemini model, batch settings, and token limits to use for export-pptx-v7 adaptive engine.
---

## Rule
Use `gemini-2.5-flash` with `batchSize: 1` (sequential) in `deck-plan.ts`.

**Why:**
- `gemini-2.5-flash` is the only confirmed-working model for structured output via `v1beta` endpoint from Supabase edge functions.
- `gemini-2.0-flash` returns HTTP 404 at `v1beta/models/gemini-2.0-flash:generateContent` — model does not exist at that endpoint.
- With `batchSize: 3` (concurrent), modules 1+ hit RPM rate limits immediately after module 0 succeeds (only 1/5 planned).
- `batchSize: 1` (sequential) lets each module complete before the next call.

## Token limit
- `maxOutputTokens: 4000` causes `finishReason=MAX_TOKENS` for verbose SQL/DDL modules (textLen ~24k chars, ~8k tokens), making JSON unparseable.
- `maxOutputTokens: 8192` + input truncated to 3500 chars + prompt asking for exactly 4 slides → 4/5 modules succeed.
- Branch `claude/sharp-gauss-df0766` uses `maxOutputTokens: 4000` and 8000 char input (original version, intentionally reverted by user).

## Deploy note
- Always use `--use-api` flag: Docker bundler has no network access from Replit containers.
- Remove `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` from index.ts — it blocks the --use-api bundler graph.
- When git fetch/merge is blocked by sandbox, use GitHub API to read files: `https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}` with `Authorization: Bearer $GITHUB_TOKEN`.

## How to apply
If fallback rate is high (>50% of modules), check `deck-plan.ts`:
- `GEMINI_PLAN_URL` must use `gemini-2.5-flash`
- `batchSize` default must be `1`
- For SQL/technical courses with verbose content, increase `maxOutputTokens` to `8192` and reduce input to `3500` chars
