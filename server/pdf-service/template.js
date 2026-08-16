import { moduleContentToHtml } from "./markdown.js";

const CSS = `
  @page { size: A4; margin: 22mm 18mm 20mm 18mm; }
  :root {
    --navy: #121844;
    --navy-light: #2d3778;
    --gold: #c49828;
    --gold-light: #dcb95a;
    --ink: #28292f;
    --muted: #696c7d;
    --line: #dbe3ee;
    --soft: #f4f4fc;
    --accent: #e6e6f6;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: var(--ink); font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, h4, p { margin: 0 0 10px; }
  h1 { font-size: 24pt; line-height: 1.15; color: white; }
  h2 { font-size: 15pt; margin-top: 20px; padding-bottom: 6px; border-bottom: 2px solid var(--gold); color: var(--navy); }
  h3 { font-size: 12pt; margin-top: 16px; color: var(--navy-light); }
  h4 { font-size: 11pt; margin-top: 12px; }
  p { color: var(--ink); }
  a { color: var(--navy-light); }
  .muted { color: var(--muted); }
  .page { page-break-after: always; padding-top: 4mm; }
  .page:last-child { page-break-after: auto; }

  /* ── Cover ── */
  .cover { min-height: 250mm; display: flex; flex-direction: column; padding: 0; }
  .cover-hero {
    background: linear-gradient(145deg, var(--navy) 0%, #1e2a72 60%, #2d3778 100%);
    padding: 40px 36px 36px; flex: 1; display: flex; flex-direction: column; justify-content: flex-end;
    border-radius: 0 0 24px 24px;
  }
  .cover-eyebrow {
    display: inline-block; border: 1.5px solid rgba(196,152,40,0.7); color: var(--gold-light);
    padding: 5px 14px; border-radius: 999px; font-size: 9pt; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 20px;
  }
  .cover-subtitle {
    color: rgba(255,255,255,0.72); font-size: 12pt; margin-top: 10px; line-height: 1.4;
    max-width: 80%;
  }
  .cover-divider { height: 3px; background: var(--gold); width: 52px; border-radius: 2px; margin: 18px 0 0; }
  .cover-meta {
    display: flex; gap: 0; margin-top: 0; border-top: 1px solid rgba(255,255,255,0.12);
  }
  .cover-meta-item {
    flex: 1; padding: 14px 0 0; border-right: 1px solid rgba(255,255,255,0.10);
  }
  .cover-meta-item:last-child { border-right: none; }
  .cover-meta-label { font-size: 8pt; color: rgba(255,255,255,0.5); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.06em; }
  .cover-meta-value { font-size: 11pt; font-weight: 700; color: white; }
  .cover-bottom { padding: 16px 0 0; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
  table th, table td { border: 1px solid var(--line); padding: 7px 9px; vertical-align: top; text-align: left; }
  table th { background: var(--navy); color: white; font-weight: 700; }
  table tr:nth-child(even) td { background: var(--soft); }

  ul, ol { padding-left: 20px; margin: 0 0 10px; }
  li { margin: 0 0 5px; }

  code { font-family: 'Courier New', monospace; background: var(--soft); padding: 1px 5px; border-radius: 4px; font-size: 9.3pt; }
  pre { background: #12183f; color: #e8ecff; padding: 12px 14px; border-radius: 10px; overflow-x: auto; page-break-inside: avoid; }
  pre code { background: none; color: inherit; padding: 0; }

  blockquote { border-left: 4px solid var(--navy-light); background: var(--soft); margin: 10px 0; padding: 8px 14px; border-radius: 0 8px 8px 0; }

  /* ── Callout boxes ── */
  .callout { border-radius: 10px; padding: 11px 15px; margin: 13px 0; page-break-inside: avoid; }
  .callout-label { font-weight: 700; font-size: 9.5pt; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .callout-body p:last-child { margin-bottom: 0; }
  .callout-note     { background: #f0f0f8; border-left: 4px solid #5f5f7d; }
  .callout-note .callout-label     { color: #3d3d5c; }
  .callout-tip      { background: #fff4e6; border-left: 4px solid #d77319; }
  .callout-tip .callout-label      { color: #a3510c; }
  .callout-example  { background: #e9f6ed; border-left: 4px solid #238241; }
  .callout-example .callout-label  { color: #165c2c; }
  .callout-reflection { background: #f0ecfc; border-left: 4px solid #6941af; }
  .callout-reflection .callout-label { color: #4a2d82; }
  .callout-summary  { background: #e8f2fe; border-left: 4px solid #235faf; }
  .callout-summary .callout-label  { color: #143d78; }
  .callout-takeaways { background: #fef9e7; border-left: 4px solid #c39119; }
  .callout-takeaways .callout-label { color: #8a6310; }
  .callout-formula  { background: #f4f4fc; border: 1.5px solid var(--navy-light); border-radius: 10px; padding: 10px 15px; margin: 13px 0; page-break-inside: avoid; }
  .callout-formula .callout-label  { color: var(--navy); font-variant: small-caps; letter-spacing: 0.06em; }
  .callout-formula .callout-body p { font-family: 'Courier New', monospace; font-size: 10pt; color: var(--navy); }

  /* ── TOC ── */
  .toc-table td:first-child { font-weight: 700; color: var(--navy); width: 12%; }

  /* ── Module header ── */
  .module-header { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid var(--gold); padding-bottom: 10px; margin-bottom: 16px; }
  .module-index {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--navy); color: white; border-radius: 999px;
    width: 28px; height: 28px; font-weight: 700; font-size: 11pt; flex-shrink: 0;
  }
  .module-title { font-size: 15pt; font-weight: 700; color: var(--navy); line-height: 1.2; }
`;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Cleans a course title that may contain LLM prompt artefacts.
 * Examples handled:
 *   "Crie um curso no tema 'Precificação…'"  → "Precificação…"
 *   "Crie m curso sobre Python"              → "Python"
 *   "Curso sobre X"                          → "X"
 */
function sanitizeTitle(raw) {
  if (!raw) return "Curso";
  let t = raw.trim();

  const promptPatterns = [
    /^Crie\s+[a-z]*\s*curso[^"'«»]*["'«»](.+?)["'«»]?\s*$/i,
    /^Crie\s+[a-z]*\s*curso\s+(?:no\s+tema|sobre|de|em)\s+(.+)$/i,
    /^Curso\s+(?:sobre|de|em)\s+(.+)$/i,
    /^Gere\s+[a-z]*\s*curso[^"'«»]*["'«»](.+?)["'«»]?\s*$/i,
  ];

  for (const re of promptPatterns) {
    const m = t.match(re);
    if (m) { t = m[1].trim(); break; }
  }

  t = t.replace(/^['"""'''«»]|['"""'''«»]$/g, "").trim();
  return t || "Curso";
}

export function buildCourseHtml({ course, modules }) {
  const rawTitle = sanitizeTitle(course.title);
  const title = escapeHtml(rawTitle);
  const description = escapeHtml(course.description || "");
  const language = escapeHtml(course.language || "pt-BR");
  const date = new Date().toLocaleDateString("pt-BR");
  const moduleCount = modules.length;

  const tocRows = modules
    .map((m, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(m.title)}</td></tr>`)
    .join("\n");

  const modulePages = modules
    .map((m, i) => {
      const bodyHtml = moduleContentToHtml(m.content || "");
      return `
      <section class="page module-page">
        <div class="module-header">
          <span class="module-index">${i + 1}</span>
          <span class="module-title">${escapeHtml(m.title)}</span>
        </div>
        <div class="module-content">${bodyHtml}</div>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
  <section class="page cover">
    <div class="cover-hero">
      <div class="cover-eyebrow">Apostila do Curso</div>
      <h1>${title}</h1>
      ${description ? `<p class="cover-subtitle">${description}</p>` : ""}
      <div class="cover-divider"></div>
      <div class="cover-meta">
        <div class="cover-meta-item">
          <div class="cover-meta-label">Modulos</div>
          <div class="cover-meta-value">${moduleCount}</div>
        </div>
        <div class="cover-meta-item" style="padding-left:18px;">
          <div class="cover-meta-label">Idioma</div>
          <div class="cover-meta-value">${language}</div>
        </div>
        <div class="cover-meta-item" style="padding-left:18px;">
          <div class="cover-meta-label">Gerado em</div>
          <div class="cover-meta-value">${date}</div>
        </div>
      </div>
    </div>
  </section>

  <section class="page">
    <h2>Sumario do Curso</h2>
    <table class="toc-table">
      <thead><tr><th>Modulo</th><th>Titulo</th></tr></thead>
      <tbody>
        ${tocRows}
      </tbody>
    </table>
  </section>

  ${modulePages}
</body>
</html>`;
}
