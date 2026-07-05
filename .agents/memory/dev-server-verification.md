---
name: Verifying dev server state after edits
description: How to distinguish real build errors from stale HMR/browser-log noise when checking if a Vite/React app is broken.
---

When `refresh_all_logs` shows a browser console error mentioning a file you just edited, check the error's timestamp against your last edit — HMR fires on every intermediate save, so an error from a partial/in-progress edit can linger in the log after the file is already fixed.

**Why:** Vite hot-reloads on each file write. Multi-step edits to the same file (e.g. building a JSX block in stages) can trigger a transient syntax error mid-sequence that gets logged, even though the final state compiles fine. Reacting to it as if it's the current state wastes a debugging cycle.

**How to apply:** Before treating a console/HMR error as real, re-read the current file (or `curl localhost:5000/<path-to-file>` to see what the dev server is actually serving/compiling) and/or run `tsc --noEmit` to confirm the error still exists. Only debug further if it's still present in the current state.
