/**
 * Pure helper functions for the tutor-chat edge function.
 * No Deno/ESM-URL imports — usable in both Deno edge functions and
 * Node.js/Vitest unit tests.
 */

/**
 * Cleans a citation string so it never contains internal XML tags or
 * attributes — only the plain "Módulo N: Título — trecho N" format.
 */
export function normalizeTutorCitation(citation: string): string {
  return citation
    .replace(/<TRECHO[^>]*>/gi, "")
    .replace(/<\/TRECHO>/gi, "")
    .replace(/\bfonte="[^"]*"/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Defensive sanitizer applied to every tutor answer before it is stored or
 * returned to the client.  Removes any internal XML tags, attributes, or
 * "Fontes usadas:" sections that leak from the model output.
 */
export function sanitizeTutorAnswer(answer: string): string {
  let text = answer;

  // ── Step 1: Remove "Fontes usadas:" section FIRST, while tags are still
  //   present so the body-contains-XML check can fire correctly.
  //   The heading may be plain text or bold (**...**); the body runs to end.
  text = text.replace(
    /\n*\*{0,2}Fontes\s+usadas:?\*{0,2}[\s\S]*/i,
    (match) => {
      const hasXml = /<\/?TRECHO|fonte="|fonte =/i.test(match);
      return hasXml ? "" : match; // keep only if already clean
    },
  );

  // ── Step 2: Remove any remaining internal XML tags and attributes.
  // Opening tags: <TRECHO fonte="..."> (with or without attributes)
  text = text.replace(/<TRECHO[^>]*>/gi, "");
  // Closing tags: </TRECHO>
  text = text.replace(/<\/TRECHO>/gi, "");
  // Stray fonte="..." attribute fragments
  text = text.replace(/\bfonte="[^"]*"/gi, "");
  // Any remaining spaced variants < TRECHO > / < /TRECHO >
  text = text.replace(/<\s*\/?TRECHO[^>]*>/gi, "");

  // ── Step 3: Collapse 3+ consecutive blank lines into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
