// Shared module-markdown sanitizers used by the generation pipeline and the
// export functions. Kept dependency-free so it runs unchanged under Deno.

/** Accent/diacritic- and case-insensitive comparison key, with the leading
 *  "Módulo N:" scaffolding removed, so a heading can be matched to a title
 *  regardless of which one carries the "Módulo N:" prefix. */
function headingKey(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^m[óo]dul[oe]\s*\d+\s*[:.\-–—]\s*/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().toLowerCase();
}

/**
 * Normalize stored module markdown for display/export:
 *  - strips a stray ```markdown / ``` code fence the generator sometimes leaves
 *    wrapped around the whole module;
 *  - drops a leading heading line that merely repeats the module title — every
 *    consumer (portal, PDF, DOCX, MD, PPTX) renders the title itself, so the
 *    content's own "## Título" would otherwise print it twice in a row.
 * Idempotent and safe on already-clean content.
 */
export function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  // Strip an opening fence (```markdown / ```lang / ```) and a closing fence.
  c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();

  if (title) {
    const lines = c.split("\n");
    let k = 0;
    while (k < lines.length && !lines[k].trim()) k++; // skip leading blanks
    if (k < lines.length && /^#{1,3}\s+/.test(lines[k]) &&
        headingKey(lines[k]) === headingKey(title) && headingKey(title).length > 0) {
      lines.splice(0, k + 1);
      while (lines.length && !lines[0].trim()) lines.shift(); // drop following blank(s)
      c = lines.join("\n").trim();
    }
  }
  return c;
}

/**
 * Trim a markdown block that was cut off mid-output (MAX_TOKENS) so it never ends
 * in the middle of a sentence/word. Walks back from the end, dropping trailing
 * lines until one ends "cleanly" — terminal punctuation, a heading, a table row,
 * or a horizontal rule. A prose/list line with a completed sentence inside is
 * trimmed to that sentence rather than dropped whole. Call ONLY when truncation
 * was detected, so legitimately-unpunctuated endings are left untouched otherwise.
 */
export function repairTruncation(md: string): string {
  const lines = (md || "").replace(/[ \t]+$/gm, "").replace(/\n+$/, "").split("\n");
  while (lines.length) {
    const raw = lines[lines.length - 1];
    const l = raw.trim();
    if (!l) { lines.pop(); continue; }
    const clean = /^#{1,6}\s/.test(l) || /^\|.*\|$/.test(l) || /^-{3,}$/.test(l) ||
      /[.!?:;)\]"'`*]$/.test(l);
    if (clean) break;
    const period = Math.max(l.lastIndexOf("."), l.lastIndexOf("!"), l.lastIndexOf("?"));
    if (period > 25) {
      const indent = raw.slice(0, raw.length - raw.trimStart().length);
      lines[lines.length - 1] = indent + l.slice(0, period + 1);
      break;
    }
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}
