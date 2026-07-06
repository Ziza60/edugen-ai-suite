---
name: CRLF line endings break exact-match file edits
description: Some source files in this repo use CRLF (\r\n) line endings; the standard edit tool's exact-string match silently fails against them.
---
Some files (e.g. src/pages/CourseWizard.tsx) are saved with CRLF line endings instead of LF.

**Why:** The edit tool's old_string match is byte-exact; a old_string written with plain `\n` will never match a line that actually ends in `\r\n`, causing "did not appear verbatim" errors even when the visible text is identical.

**How to apply:** If an edit fails with "did not appear verbatim" and the read-tool output looks correct, check line endings first (`grep -c $'\r' <file>` or `file <file>`). If CRLF, do the replacement via a small python/sed script that preserves `\r\n`, rather than fighting the edit tool.
