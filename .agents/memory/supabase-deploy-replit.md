---
name: Supabase edge function deploy from Replit
description: How to deploy Supabase edge functions from the Replit environment — Docker bundler fails, use --use-api instead.
---

## Rule
Always use `supabase functions deploy <slug> --project-ref <ref> --use-api` from Replit.

**Why:** The Supabase CLI's default deploy mode spins up a Docker container to bundle the function. That container has no external network access from Replit's sandbox (esm.sh, jsr.io, npm registry are all unreachable). The `--use-api` flag skips Docker and uploads raw TypeScript source files directly to the Supabase Management API, which resolves imports server-side.

**How to apply:** Any time a Supabase edge function needs to be deployed or updated from this Replit project, use the `--use-api` flag. Never use the default `--use-docker` mode.

Also: remove `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` from function entry points — it's a type-only import that causes the bundler graph to fail even with `--use-api` in older CLI versions.

Project ref: `hhlzaryhsyqbqktxdgyb` (read from `supabase/config.toml` `project_id` — don't trust a hardcoded ref here, it may go stale across projects).

**403 on deploy:** `unexpected deploy status 403: ... does not have the necessary privileges` means the `SUPABASE_ACCESS_TOKEN` secret's account lacks deploy permission on that project (not a CLI/flag problem). This is not fixable from the agent side — ask the user to either generate a token from an account with deploy rights on the project, or deploy the changed functions manually via the Supabase dashboard/CLI on their machine.
