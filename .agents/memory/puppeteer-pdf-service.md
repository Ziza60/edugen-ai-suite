---
name: Puppeteer PDF service architecture
description: How EduGenAI's HTML/CSS+Puppeteer PDF exporter is wired, replacing jsPDF hand-coded layout logic.
---

Course PDF export moved from jsPDF (Supabase Deno edge function, manual layout math) to a
separate Node/Express service using `puppeteer-core` against the Nix-provided `chromium`
binary, because Supabase Edge Functions (Deno isolates) cannot run headless Chromium.

**Why:** jsPDF requires hand-coding every layout primitive (page breaks, table wrapping,
blockquote nesting) — this caused repeated regressions (extra columns, blank pages) that
were fixed one at a time. Real markdown parsing (`marked`) + real browser layout (Puppeteer)
handles structural cases like tables-inside-blockquotes natively, eliminating a whole class
of bugs at once.

**How to apply:** New service lives at `server/pdf-service/` (own Express app, own workflow
"PDF Service" on port 8080), separate from the Supabase edge functions. Frontend calls it via
a Vite dev-server proxy (`/api/pdf/* → localhost:8080`) rather than `supabase.functions.invoke`.
The frontend sends the already-loaded course+modules JSON directly (same pattern as the
in-editor "Visualizar como Aluno" preview) — the Node service never touches Supabase directly,
avoiding the need for service-role keys. `puppeteer-core`'s `executablePath` must point at the
Nix store chromium path (not bundled Chromium, which isn't installed by default). Production
deployment (single vs. two services) is still an open decision — revisit before publishing.
