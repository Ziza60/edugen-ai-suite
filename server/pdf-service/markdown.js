import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Strip emoji/symbol characters that Chromium inside Nix may not render
 * cleanly. Processes line-by-line so a leading emoji doesn't leave a
 * stray space that could prevent pedagogical detection.
 */
function stripEmojis(str) {
  const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]+/gu;
  return str
    .split("\n")
    .map((line) => line.replace(EMOJI_RE, "").replace(/^\s+/, "").trimEnd())
    .join("\n");
}

/**
 * Detects pedagogical box types (Nota Técnica, Dica, Exemplo Prático, etc.).
 */
function detectPedagogicalType(text) {
  const lower = (text || "")
    .toLowerCase()
    .replace(/[*_#>`]/g, "")
    .trim();
  if (/^exemplo\s+pr[áa]tico/.test(lower) || /^na\s+pr[áa]tica/.test(lower) || /^vamos\s+praticar/.test(lower)) return "example";
  if (/^pare\s+um\s+momento/.test(lower) || /^reflita/.test(lower) || /^para\s+pensar/.test(lower) || /^checkpoint/.test(lower)) return "reflection";
  if (/^resumo/.test(lower) || /^em\s+resumo/.test(lower) || /^conclus[ãa]o/.test(lower)) return "summary";
  if (/^key\s+takeaway/.test(lower) || /^pontos[- ]chave/.test(lower)) return "takeaways";
  if (/^dica/.test(lower) || /^importante/.test(lower) || /^aten[çc][ãa]o/.test(lower)) return "tip";
  if (/^nota/.test(lower) || /^lembre[- ]se/.test(lower) || /^sa[íi]ba\s+mais/.test(lower) || /^exerc[íi]cio/.test(lower) || /^atividade/.test(lower) || /^desafio/.test(lower)) return "note";
  return null;
}

/** Detect a "Fórmula:" line — inline or standalone paragraph. */
function detectFormulaLine(text) {
  return /^\*{0,2}f[oó]rmula\s*(\d+\s*[:\-–])?\s*\*{0,2}/i.test((text || "").trim());
}

const TYPE_LABEL = {
  example: "Exemplo Pratico",
  reflection: "Reflita",
  summary: "Resumo",
  takeaways: "Pontos-Chave",
  tip: "Dica",
  note: "Nota",
  formula: "Formula",
};

/**
 * Converts one module's raw course markdown into HTML.
 * Uses `marked` (GFM) for all structural parsing; adds pedagogical callout
 * boxes and formula highlights on top.
 */
export function moduleContentToHtml(markdown) {
  if (!markdown || !markdown.trim()) return "";

  const clean = stripEmojis(markdown);
  const tokens = marked.lexer(clean);
  let html = "";

  for (const token of tokens) {
    let firstText = "";
    if (token.type === "blockquote") {
      firstText = token.tokens?.[0]?.text ?? token.text ?? "";
    } else if (token.type === "paragraph" || token.type === "heading") {
      firstText = token.text ?? "";
    }

    if (token.type === "paragraph" && detectFormulaLine(firstText)) {
      const inner = marked.parser([token]);
      html += `<div class="callout callout-formula"><div class="callout-label">${TYPE_LABEL.formula}</div><div class="callout-body">${inner}</div></div>`;
      continue;
    }

    const kind =
      token.type === "blockquote" || token.type === "paragraph"
        ? detectPedagogicalType(firstText)
        : null;

    if (kind) {
      const innerTokens = token.type === "blockquote" ? token.tokens : [token];
      const inner = marked.parser(innerTokens);
      html +=
        `<div class="callout callout-${kind}">` +
        `<div class="callout-label">${TYPE_LABEL[kind]}</div>` +
        `<div class="callout-body">${inner}</div>` +
        `</div>`;
      continue;
    }

    html += marked.parser([token]);
  }

  return html;
}
