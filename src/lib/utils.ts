import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normalize a heading/title for comparison (strip markdown, module prefix,
 *  accents, non-alphanumerics) so a duplicated leading "## <title>" can be
 *  detected regardless of formatting. */
function headingKey(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^m[óo]dul[oe]\s*\d+\s*[:.\-–—]\s*/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().toLowerCase();
}

/** Strip a stray ```markdown wrapper fence and a leading heading that merely
 *  repeats the module title (every consumer renders the title separately).
 *  Re-added after it was accidentally dropped from utils.ts during a refactor —
 *  its absence broke the app bundle (ExportButtons imports it). */
export function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  // Strip a whole-module wrapper fence ONLY when the content starts with one,
  // so we never remove the closing fence of a real trailing code block.
  if (/^```/.test(c)) {
    c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();
  }
  if (title) {
    const lines = c.split("\n");
    let k = 0;
    while (k < lines.length && !lines[k].trim()) k++;
    if (
      k < lines.length && /^#{1,3}\s+/.test(lines[k]) &&
      headingKey(title).length > 0 && headingKey(lines[k]) === headingKey(title)
    ) {
      lines.splice(0, k + 1);
      while (lines.length && !lines[0].trim()) lines.shift();
      c = lines.join("\n").trim();
    }
  }
  return c;
}
