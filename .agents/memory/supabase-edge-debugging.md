---
name: Supabase edge function debugging limitations
description: What access is/isn't available when debugging a Supabase edge function error from Replit, and how to make future errors self-diagnosing.
---

- The `SUPABASE_ACCESS_TOKEN` secret available in this environment does NOT have privileges for the Management API's log/analytics endpoints (`analytics/endpoints/logs.all`) or the `database/query` endpoint — both return 403/404. It's only sufficient for `supabase functions deploy --use-api`.
- CORRECTED: the 403 `does not have the necessary privileges` on `functions deploy --use-api` was NOT a token-scope or role issue (Supabase PATs aren't scoped; user was already Owner). It was a **wrong `--project-ref`** — `supabase/config.toml`'s `project_id` field (`hhlzaryhsyqbqktxdgyb`) did not match the actual linked project. Root cause turned out to be a stale/incorrect value in `config.toml`. Always verify the real ref with `supabase projects list` (look for the `●` linked marker) before trusting `config.toml`, especially if deploy 403s persist across multiple regenerated tokens. Correct ref for this project (EduGenai) is `hqysyalrvxjeadmkujig`.
- The app's `DATABASE_URL` (Replit-provisioned Postgres) is a *different* database from the Supabase project's Postgres — querying `DATABASE_URL` for app tables like `courses` fails with "relation does not exist". Don't try it for Supabase-backed apps.
- The anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`) is subject to RLS, so it can't read arbitrary rows (e.g. unpublished courses) for debugging.
- Net effect: when a user reports "edge function returned a non-2xx status code" with no other detail, there is no way to pull the real server-side error or the exact row content from this environment. The fastest path is to read the edge function's code for likely uncaught-exception patterns (non-string DB fields passed into `.split`/`.normalize`, division-by-zero from mismatched array lengths, etc.) and harden defensively, AND fix the frontend to surface the real error.

**Why:** `supabase-js`'s `functions.invoke()` throws a generic `FunctionsHttpError` with message "Edge Function returned a non-2xx status code" — it does NOT put the function's actual JSON error body into `.message`. The real message is in `error.context` (a `Response` object); call `error.context.clone().json()` to get it.

**How to apply:** In any `handleExportWithFunction`-style helper that calls `supabase.functions.invoke`, parse `error.context` for the real message before falling back to `error.message`. This turns future "non-2xx" reports into actionable errors immediately, without needing platform log access.
