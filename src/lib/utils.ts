import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Accent/case-insensitive heading key with the "Módulo N:" scaffolding removed,
// so a content heading can be matched to a module title regardless of which one
// carries the prefix.
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
 *  - strips a stray ```markdown / ``` fence the generator sometimes wrapped
 *    around the whole module;
 *  - drops a leading heading that merely repeats the module title (the portal,
 *    PDF, DOCX and MD export all render the title themselves, so the content's
 *    own "## Título" would print it twice in a row).
 * Idempotent and safe on already-clean content.
 */
export function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();
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
