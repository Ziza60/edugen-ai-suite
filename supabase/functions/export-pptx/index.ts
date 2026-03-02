import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM
   ═══════════════════════════════════════════════════════ */

const C = {
  PRIMARY:    "1E2761",
  MEDIUM:     "3A5A9B",
  ACCENT:     "F5A623",
  BG_LIGHT:   "F7F8FA",
  TEXT_BODY:   "2D3748",
  TEXT_SEC:    "718096",
  WHITE:       "FFFFFF",
  LIGHT_BLUE:  "CADCFC",
  TABLE_ALT:   "EEF2FF",
  TABLE_BORDER:"CBD5E1",
};

const FONT = "Calibri";
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MX = 0.6; // margin X
const MY = 0.6; // margin Y
const CONTENT_W = SLIDE_W - MX * 2; // 8.8"

const MIN_BULLETS = 3;
const MAX_BULLETS = 6;
const MAX_CHARS = 900;

/* ═══════════════════════════════════════════════════════
   TEXT SANITIZATION
   ═══════════════════════════════════════════════════════ */

function sanitize(text: string): string {
  if (!text) return "";
  let t = text;
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/?(p|div|span|strong|em|b|i|u|a|li|ul|ol|h[1-6]|blockquote|code|pre|table|tr|td|th|thead|tbody|section|article|header|footer|main|nav|figure|figcaption|details|summary|mark|small|sup|sub|dl|dt|dd)[^>]*>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/#{1,6}\s*/g, "");
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1");
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^---+$/gm, "");
  t = t.replace(/\s*[→⟶➜➔➞►▶︎⇒⇨]\s*/g, ": ");
  t = t.replace(/\s*->\s*/g, ": ");
  t = t.replace(/&amp;/gi, "&");
  t = t.replace(/&lt;/gi, "<"); // will be caught by final check
  t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " ");
  t = t.replace(/&quot;/gi, '"');
  // Final pass: remove any remaining < or > that look like tags
  t = t.replace(/<\/?[a-z][^>]*>/gi, " ");
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function deduplicateTitle(title: string): string {
  return title.replace(/^(Módulo\s+\d+\s*[:–\-]\s*)\1/i, "$1").trim();
}

/* ═══════════════════════════════════════════════════════
   CONTENT PARSING
   ═══════════════════════════════════════════════════════ */

interface ParsedBlock {
  heading: string;
  items: string[];       // bullet items
  isTable: boolean;
  headers?: string[];
  rows?: string[][];
  isParallel?: boolean;  // items are structurally similar (for cards)
}

function parseModuleContent(content: string): ParsedBlock[] {
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let curHeading = "";
  let curBullets: string[] = [];
  let inTable = false;
  let tHeaders: string[] = [];
  let tRows: string[][] = [];

  const flushBullets = () => {
    if (curBullets.length > 0) {
      blocks.push({ heading: curHeading, items: [...curBullets], isTable: false });
      curBullets = [];
    }
  };

  const flushTable = () => {
    if (tRows.length > 0) {
      blocks.push({
        heading: curHeading,
        items: [],
        isTable: true,
        headers: [...tHeaders],
        rows: [...tRows],
      });
      tHeaders = [];
      tRows = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Markdown table
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        flushBullets();
        inTable = true;
        tHeaders = trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim()));
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator
      } else {
        tRows.push(trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim())));
      }
      continue;
    }
    if (inTable) flushTable();

    // Heading
    if (/^#{1,6}\s/.test(trimmed)) {
      flushBullets();
      curHeading = sanitize(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }

    // Bullet / numbered list
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const raw = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      const clean = sanitize(raw);
      if (clean.length > 3) curBullets.push(clean);
      continue;
    }

    // Plain text as bullet
    const clean = sanitize(trimmed);
    if (clean.length > 8) curBullets.push(clean);
  }

  if (inTable) flushTable();
  flushBullets();
  return blocks;
}

/* ═══════════════════════════════════════════════════════
   SLIDE MODEL
   ═══════════════════════════════════════════════════════ */

type LayoutType = "CAPA" | "ABERTURA_MODULO" | "BULLETS" | "CARDS_GRID" | "TABELA" | "RESUMO" | "ENCERRAMENTO";

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
}

/* ═══════════════════════════════════════════════════════
   CONTENT PREPROCESSING & BALANCING
   ═══════════════════════════════════════════════════════ */

function detectParallel(items: string[]): boolean {
  if (items.length < 4 || items.length > 6) return false;
  // Parallel = most items contain a colon (title: description pattern)
  const withColon = items.filter((it) => {
    const ci = it.indexOf(":");
    return ci > 2 && ci < 50;
  }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function isResumoHeading(heading: string): boolean {
  return /resumo|conclus|encerramento|pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

function buildModuleSlides(mod: any, modIndex: number, totalModules: number): SlideData[] {
  const blocks = parseModuleContent(mod.content || "");
  const rawTitle = sanitize(mod.title || "");
  const moduleLabel = `Módulo ${modIndex + 1}`;

  let moduleTitle: string;
  if (/^módulo\s+\d+/i.test(rawTitle)) {
    moduleTitle = deduplicateTitle(rawTitle);
  } else {
    moduleTitle = `${moduleLabel}: ${rawTitle}`;
  }

  const slides: SlideData[] = [];

  // Collect objectives for the module intro
  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) {
      objItems.push(...block.items);
    } else if (isResumoHeading(block.heading) && !block.isTable) {
      resumoItems.push(...block.items);
    } else {
      contentBlocks.push(block);
    }
  }

  // 1) ABERTURA_MODULO
  slides.push({
    layout: "ABERTURA_MODULO",
    title: moduleTitle,
    subtitle: moduleLabel,
    items: objItems.slice(0, 4).map(sanitize),
    moduleIndex: modIndex,
  });

  // 2) Content slides — collect all items grouped by heading
  interface Section { heading: string; items: string[]; isTable: boolean; headers?: string[]; rows?: string[][] }
  const sections: Section[] = [];

  for (const block of contentBlocks) {
    if (block.isTable && block.headers && block.rows && block.rows.length > 0) {
      sections.push({
        heading: sanitize(block.heading || moduleTitle),
        items: [],
        isTable: true,
        headers: block.headers.map(sanitize),
        rows: block.rows.map((r) => r.map(sanitize)),
      });
      continue;
    }

    const items = block.items.map(sanitize).filter((s) => s.length > 3);
    if (items.length === 0) continue;
    const heading = sanitize(block.heading || moduleTitle);

    // Try to merge with previous non-table section if both are small
    const last = sections.length > 0 ? sections[sections.length - 1] : null;
    if (
      last && !last.isTable &&
      items.length < MIN_BULLETS &&
      last.items.length < MIN_BULLETS &&
      (last.items.length + items.length) <= MAX_BULLETS
    ) {
      const totalChars = [...last.items, ...items].reduce((s, b) => s + b.length, 0);
      if (totalChars <= MAX_CHARS) {
        last.items.push(...items);
        continue;
      }
    }

    sections.push({ heading, items: [...items], isTable: false });
  }

  // Now paginate each section
  for (const section of sections) {
    if (section.isTable && section.headers && section.rows) {
      // Split large tables
      const maxRows = 7;
      for (let i = 0; i < section.rows.length; i += maxRows) {
        slides.push({
          layout: "TABELA",
          title: section.heading,
          tableHeaders: section.headers,
          tableRows: section.rows.slice(i, i + maxRows),
        });
      }
      continue;
    }

    const items = section.items;
    if (items.length === 0) continue;

    // If fits in one slide
    if (items.length <= MAX_BULLETS && items.reduce((s, b) => s + b.length, 0) <= MAX_CHARS) {
      const isParallel = detectParallel(items);
      slides.push({
        layout: isParallel ? "CARDS_GRID" : "BULLETS",
        title: section.heading,
        items: [...items],
      });
      continue;
    }

    // Need to split — split at semantic boundaries (roughly MAX_BULLETS per slide)
    const chunks: string[][] = [];
    let chunk: string[] = [];
    let chunkChars = 0;
    for (const item of items) {
      if (chunk.length >= MAX_BULLETS || (chunkChars + item.length > MAX_CHARS && chunk.length >= MIN_BULLETS)) {
        chunks.push([...chunk]);
        chunk = [];
        chunkChars = 0;
      }
      chunk.push(item);
      chunkChars += item.length;
    }
    if (chunk.length > 0) chunks.push(chunk);

    // Post-process: merge last chunk if too small
    if (chunks.length >= 2) {
      const lastChunk = chunks[chunks.length - 1];
      const prevChunk = chunks[chunks.length - 2];
      if (lastChunk.length < MIN_BULLETS && (prevChunk.length + lastChunk.length) <= MAX_BULLETS + 1) {
        const merged = [...prevChunk, ...lastChunk];
        if (merged.reduce((s, b) => s + b.length, 0) <= MAX_CHARS + 100) {
          chunks[chunks.length - 2] = merged;
          chunks.pop();
        }
      }
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      const partTitle = chunks.length > 1
        ? `${section.heading} (Parte ${ci + 1})`
        : section.heading;
      slides.push({
        layout: "BULLETS",
        title: partTitle,
        items: chunks[ci],
      });
    }
  }

  // 3) Resumo slide
  if (resumoItems.length > 0) {
    slides.push({
      layout: "RESUMO",
      title: "Resumo",
      subtitle: moduleTitle,
      items: resumoItems.slice(0, 6).map(sanitize),
    });
  }

  return slides;
}

/* ═══════════════════════════════════════════════════════
   QUALITY VALIDATION
   ═══════════════════════════════════════════════════════ */

function validateAndFix(slides: SlideData[]): SlideData[] {
  const result: SlideData[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];

    // Skip validation for non-content slides
    if (slide.layout === "CAPA" || slide.layout === "ABERTURA_MODULO" || slide.layout === "TABELA" || slide.layout === "ENCERRAMENTO") {
      result.push(slide);
      continue;
    }

    const bulletCount = slide.items?.length || 0;

    // Try to merge slides with < MIN_BULLETS into previous
    if (bulletCount > 0 && bulletCount < MIN_BULLETS) {
      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (prev && (prev.layout === "BULLETS" || prev.layout === "RESUMO") && prev.items) {
        const merged = [...prev.items, ...(slide.items || [])];
        if (merged.length <= MAX_BULLETS + 1 && merged.reduce((s, b) => s + b.length, 0) <= MAX_CHARS + 100) {
          prev.items = merged;
          continue; // absorbed
        }
      }
    }

    result.push(slide);
  }

  // Final check: ensure no HTML/arrows leaked through
  for (const slide of result) {
    if (slide.title) slide.title = sanitize(slide.title);
    if (slide.subtitle) slide.subtitle = sanitize(slide.subtitle);
    if (slide.items) slide.items = slide.items.map(sanitize);
    if (slide.tableHeaders) slide.tableHeaders = slide.tableHeaders.map(sanitize);
    if (slide.tableRows) slide.tableRows = slide.tableRows.map((r) => r.map(sanitize));
  }

  return result;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS — 6 layouts + closing
   ═══════════════════════════════════════════════════════ */

// Layout 1 — CAPA
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  // Vertical accent stripe on the left
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  // Title
  slide.addText(data.title, {
    x: 0.8, y: 0.8, w: 8.4, h: 2.4,
    fontSize: 44, fontFace: FONT, color: C.WHITE, bold: true,
    align: "left", valign: "middle", shrinkText: true,
  });

  // Description
  if (data.description) {
    slide.addText(sanitize(data.description), {
      x: 0.8, y: 3.3, w: 7.6, h: 1.0,
      fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "left", valign: "top",
      shrinkText: true,
    });
  }

  // Footer line
  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footerParts = [];
  if (data.moduleCount) footerParts.push(`${data.moduleCount} módulos`);
  footerParts.push(d);
  slide.addText(footerParts.join("  •  "), {
    x: 0.8, y: 4.8, w: 8.4, h: 0.4,
    fontSize: 12, fontFace: FONT, color: C.TEXT_SEC, align: "left",
  });
}

// Layout 2 — ABERTURA DE MÓDULO
function renderAberturaModulo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  // Module badge pill
  if (data.subtitle) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6, y: 0.6, w: 1.6, h: 0.38,
      fill: { color: C.ACCENT },
      rectRadius: 0.08,
    });
    slide.addText(data.subtitle.toUpperCase(), {
      x: 0.6, y: 0.6, w: 1.6, h: 0.38,
      fontSize: 13, fontFace: FONT, color: C.PRIMARY, bold: true,
      align: "center", valign: "middle",
    });
  }

  // Module title
  slide.addText(data.title, {
    x: 0.6, y: 1.2, w: 8.8, h: 1.4,
    fontSize: 38, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "top", shrinkText: true,
  });

  // Objectives
  if (data.items && data.items.length > 0) {
    slide.addText("Objetivos", {
      x: 0.6, y: 2.9, w: 3, h: 0.35,
      fontSize: 14, fontFace: FONT, color: C.ACCENT, bold: true,
    });

    const objText = data.items.map((b) => ({
      text: `✓  ${b}`,
      options: {
        fontSize: 16, fontFace: FONT, color: C.WHITE,
        paraSpaceAfter: 6, lineSpacing: 20,
      },
    }));
    slide.addText(objText, {
      x: 0.6, y: 3.3, w: 8.8, h: 1.9,
      valign: "top", shrinkText: true,
    });
  }
}

// Layout 3 — CONTEÚDO COM BULLETS (full-width)
function renderBullets(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  // Top header bar (60px ≈ 0.83")
  const headerH = 0.7;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });
  slide.addText(deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: headerH - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle", shrinkText: true,
  });

  // Content area
  const contentTop = headerH + 0.25;
  const contentH = SLIDE_H - contentTop - 0.4;
  const bullets = data.items || [];

  // Pick font size: try 16 first, step down if needed
  let fontSize = 16;
  const lineH = 1.20;

  // Detect subcategories: items ending with ":" followed by sub-items
  const bulletObjs: any[] = [];
  for (const b of bullets) {
    // Check if this is a subcategory header (e.g., "Organização de Tempo:")
    const colonEnd = b.match(/^(.+):$/);
    if (colonEnd && b.length < 50) {
      bulletObjs.push({
        text: b,
        options: {
          fontSize: 15, fontFace: FONT, color: C.PRIMARY, bold: true,
          paraSpaceBefore: 8, paraSpaceAfter: 2, lineSpacing: Math.round(15 * lineH),
          indentLevel: 0,
        },
      });
    } else {
      bulletObjs.push({
        text: b,
        options: {
          fontSize, fontFace: FONT, color: C.TEXT_BODY,
          bullet: { type: "bullet" as const, color: C.MEDIUM },
          paraSpaceAfter: 4, lineSpacing: Math.round(fontSize * lineH),
          indentLevel: 0,
        },
      });
    }
  }

  slide.addText(bulletObjs, {
    x: MX, y: contentTop, w: CONTENT_W, h: contentH,
    valign: "top", shrinkText: true,
  });
}

// Layout 4 — CARDS EM GRID
function renderCardsGrid(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  // Header bar
  const headerH = 0.7;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });
  slide.addText(deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: headerH - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle", shrinkText: true,
  });

  const items = data.items || [];
  const count = items.length;

  // Grid: 2 columns, up to 3 rows
  const cols = 2;
  const rows = Math.ceil(count / cols);
  const gridTop = headerH + 0.3;
  const gridH = SLIDE_H - gridTop - 0.35;
  const cardW = (CONTENT_W - 0.3) / cols; // 0.3" gap between columns
  const cardH = Math.min((gridH - (rows - 1) * 0.2) / rows, 1.4);
  const gapX = 0.3;
  const gapY = 0.2;

  items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MX + col * (cardW + gapX);
    const y = gridTop + row * (cardH + gapY);

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.WHITE },
      shadow: { type: "outer", blur: 4, offset: 1, color: "000000", opacity: 0.1 },
      rectRadius: 0.04,
    });

    // Left accent border
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.06, w: 0.06, h: cardH - 0.12,
      fill: { color: C.ACCENT },
    });

    // Parse "Title: Description" pattern
    const colonIdx = item.indexOf(":");
    if (colonIdx > 2 && colonIdx < 50) {
      const cardTitle = item.substring(0, colonIdx).trim();
      const cardDesc = item.substring(colonIdx + 1).trim();
      slide.addText(cardTitle, {
        x: x + 0.2, y: y + 0.1, w: cardW - 0.35, h: 0.35,
        fontSize: 14, fontFace: FONT, color: C.PRIMARY, bold: true,
        valign: "top", shrinkText: true,
      });
      slide.addText(cardDesc, {
        x: x + 0.2, y: y + 0.42, w: cardW - 0.35, h: cardH - 0.55,
        fontSize: 13, fontFace: FONT, color: C.TEXT_BODY,
        valign: "top", shrinkText: true,
      });
    } else {
      slide.addText(item, {
        x: x + 0.2, y: y + 0.1, w: cardW - 0.35, h: cardH - 0.2,
        fontSize: 14, fontFace: FONT, color: C.TEXT_BODY,
        valign: "middle", shrinkText: true,
      });
    }
  });
}

// Layout 5 — TABELA COMPARATIVA
function renderTabela(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  // Header bar
  const headerH = 0.7;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });
  slide.addText(deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: headerH - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle", shrinkText: true,
  });

  const headers = data.tableHeaders || [];
  const rows = data.tableRows || [];
  const colCount = headers.length || (rows[0]?.length ?? 2);
  const tableY = headerH + 0.3;
  const colW = CONTENT_W / colCount;

  const borderStyle = { type: "solid" as const, pt: 1, color: C.TABLE_BORDER };
  const borders = [borderStyle, borderStyle, borderStyle, borderStyle];

  const tableData: any[][] = [];

  // Header row
  tableData.push(headers.map((h) => ({
    text: h,
    options: {
      fontSize: 14, fontFace: FONT, bold: true, color: C.WHITE,
      fill: { color: C.PRIMARY },
      border: borders,
      valign: "middle" as const,
      paraSpaceBefore: 4, paraSpaceAfter: 4,
    },
  })));

  // Data rows
  rows.forEach((row, ri) => {
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 13, fontFace: FONT,
        color: C.TEXT_BODY,
        bold: ci === 0, // first column bold
        fill: ri % 2 === 1 ? { color: C.TABLE_ALT } : { color: C.WHITE },
        border: borders,
        valign: "middle" as const,
        paraSpaceBefore: 3, paraSpaceAfter: 3,
      },
    }));
    while (dataRow.length < colCount) {
      dataRow.push({ text: "", options: { fontSize: 13, fontFace: FONT, color: C.TEXT_BODY, valign: "middle" as const, paraSpaceBefore: 3, paraSpaceAfter: 3 } });
    }
    tableData.push(dataRow);
  });

  slide.addTable(tableData, {
    x: MX, y: tableY, w: CONTENT_W,
    colW: Array(colCount).fill(colW),
    autoPage: false,
  });
}

// Layout 6 — RESUMO / ENCERRAMENTO DE MÓDULO
function renderResumo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  // Left accent stripe
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  // "RESUMO" label
  slide.addText("RESUMO", {
    x: 0.6, y: 0.5, w: 2, h: 0.35,
    fontSize: 13, fontFace: FONT, color: C.ACCENT, bold: true,
  });

  // Title
  slide.addText(deduplicateTitle(data.subtitle || data.title), {
    x: 0.6, y: 0.85, w: 8.8, h: 0.6,
    fontSize: 28, fontFace: FONT, color: C.PRIMARY, bold: true,
    valign: "top", shrinkText: true,
  });

  // Check items
  const items = data.items || [];
  const checkObjs = items.map((b) => ({
    text: `✓  ${b}`,
    options: {
      fontSize: 15, fontFace: FONT, color: C.TEXT_BODY,
      paraSpaceAfter: 6, lineSpacing: 19,
    },
  }));

  slide.addText(checkObjs, {
    x: 0.6, y: 1.6, w: 8.8, h: 3.5,
    valign: "top", shrinkText: true,
  });
}

// SLIDE FINAL — Encerramento
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  slide.addText("Obrigado!", {
    x: 0, y: 1.0, w: SLIDE_W, h: 1.8,
    fontSize: 52, fontFace: FONT, color: C.WHITE, bold: true,
    align: "center", valign: "middle",
  });

  slide.addText(sanitize(courseTitle), {
    x: 1, y: 3.0, w: 8, h: 0.7,
    fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "center",
    shrinkText: true,
  });

  slide.addText("Continue praticando  |  Acesse os materiais complementares", {
    x: 1.5, y: 4.0, w: 7, h: 0.4,
    fontSize: 14, fontFace: FONT, color: C.ACCENT, align: "center",
  });
}

/* ═══════════════════════════════════════════════════════
   MAIN HANDLER
   ═══════════════════════════════════════════════════════ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Pro-only gate
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Fetch course
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    /* ─── Build all slides ─── */
    let allSlides: SlideData[] = [];
    for (let i = 0; i < modules.length; i++) {
      allSlides.push(...buildModuleSlides(modules[i], i, modules.length));
    }

    // Validate and fix
    allSlides = validateAndFix(allSlides);

    /* ─── Build PPTX ─── */
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // 1) Cover
    renderCapa(pptx, {
      layout: "CAPA",
      title: course.title,
      description: course.description || "",
      moduleCount: modules.length,
    });

    // 2) Content slides
    for (const sd of allSlides) {
      switch (sd.layout) {
        case "ABERTURA_MODULO": renderAberturaModulo(pptx, sd); break;
        case "BULLETS":        renderBullets(pptx, sd); break;
        case "CARDS_GRID":     renderCardsGrid(pptx, sd); break;
        case "TABELA":         renderTabela(pptx, sd); break;
        case "RESUMO":         renderResumo(pptx, sd); break;
        default:               renderBullets(pptx, sd); break;
      }
    }

    // 3) Closing
    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 2;
    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PPTX - ${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX",
      metadata: { course_id, slide_count: totalSlides },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PPTX error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
