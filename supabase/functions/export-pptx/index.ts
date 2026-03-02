import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ════════════════════════════════════════════════════════════
   TEXT SANITIZATION — remove ALL markup residue
   ════════════════════════════════════════════════════════════ */

function sanitize(text: string): string {
  let t = text;
  // HTML tags → space or nothing
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<\/?(p|div|span|strong|em|b|i|u|a|li|ul|ol|h[1-6]|blockquote|code|pre|table|tr|td|th|thead|tbody)[^>]*>/gi, " ");
  t = t.replace(/<[^>]+>/g, " "); // catch-all remaining tags
  // Markdown
  t = t.replace(/#{1,6}\s*/g, "");
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1");
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^---+$/gm, "");
  // Arrows → colon or dash
  t = t.replace(/\s*[→⟶➜➔➞►▶︎]\s*/g, ": ");
  t = t.replace(/\s*->\s*/g, ": ");
  // Emoji strip
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  // Multiple spaces / trim
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

/** Detect if a line is a comparison pattern like "A: X → Y" or "Aspecto | Trad | Gen" */
function isComparisonLine(line: string): boolean {
  // Contains arrow separators
  if (/[→⟶➜➔➞►▶︎]/.test(line) || /\s+->\s+/.test(line)) return true;
  return false;
}

/* ════════════════════════════════════════════════════════════
   CONTENT PARSING — extract semantic blocks from markdown
   ════════════════════════════════════════════════════════════ */

interface ContentBlock {
  type: "heading" | "bullets" | "table" | "takeaways" | "objectives" | "comparison";
  heading?: string;
  items?: string[];
  rows?: string[][];
  headers?: string[];
}

function parseModuleContent(content: string): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  let currentHeading = "";
  let currentBullets: string[] = [];
  let comparisonItems: string[] = [];
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const flushComparisons = () => {
    if (comparisonItems.length > 0) {
      // Try to parse comparison items into a table structure
      const parsed = parseComparisonLines(comparisonItems, currentHeading);
      blocks.push(parsed);
      comparisonItems = [];
    }
  };

  const flushBullets = () => {
    flushComparisons();
    if (currentBullets.length > 0) {
      const isObjectives = /objetivo|objetivos?\s+d[oe]/i.test(currentHeading);
      const isTakeaway = /resumo|key takeaway|takeaway|pontos[- ]chave/i.test(currentHeading);
      blocks.push({
        type: isObjectives ? "objectives" : isTakeaway ? "takeaways" : "bullets",
        heading: currentHeading,
        items: [...currentBullets],
      });
      currentBullets = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ type: "table", heading: currentHeading, headers: [...tableHeaders], rows: [...tableRows] });
      tableHeaders = [];
      tableRows = [];
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
        tableHeaders = trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim()));
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator row — skip
      } else {
        tableRows.push(trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim())));
      }
      continue;
    }
    if (inTable) flushTable();

    // Heading
    if (/^#{1,6}\s/.test(trimmed)) {
      flushBullets();
      currentHeading = sanitize(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }

    // Bullet / numbered list
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const raw = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      // Check if this bullet is a comparison
      if (isComparisonLine(raw)) {
        flushBullets(); // flush normal bullets first
        comparisonItems.push(raw);
      } else {
        flushComparisons(); // flush comparisons first
        const clean = sanitize(raw);
        if (clean.length > 3) currentBullets.push(clean);
      }
      continue;
    }

    // Plain text line — could be comparison or content
    if (isComparisonLine(trimmed)) {
      flushBullets();
      comparisonItems.push(trimmed);
      continue;
    }

    flushComparisons();
    const clean = sanitize(trimmed);
    if (clean.length > 8) currentBullets.push(clean);
  }

  if (inTable) flushTable();
  flushBullets();
  return blocks;
}

/** Parse lines like "Aspecto: X → Y" into a table block */
function parseComparisonLines(lines: string[], heading: string): ContentBlock {
  const rows: string[][] = [];
  const headers: string[] = [];

  for (const line of lines) {
    // Try "Label: Value1 → Value2 → Value3"
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 40) {
      const label = sanitize(line.substring(0, colonIdx));
      const rest = line.substring(colonIdx + 1);
      const parts = rest.split(/[→⟶➜➔➞►▶︎]|->/).map((p) => sanitize(p));
      if (parts.length >= 2) {
        rows.push([label, ...parts]);
        continue;
      }
    }
    // Try "Value1 → Value2"
    const parts = line.split(/[→⟶➜➔➞►▶︎]|->/).map((p) => sanitize(p));
    if (parts.length >= 2) {
      rows.push(parts);
    } else {
      rows.push([sanitize(line)]);
    }
  }

  // Infer headers from column count
  if (rows.length > 0) {
    const maxCols = Math.max(...rows.map((r) => r.length));
    if (maxCols === 3) {
      headers.push("Aspecto", "Antes", "Depois");
    } else if (maxCols === 2) {
      headers.push("Item", "Descrição");
    } else {
      for (let i = 0; i < maxCols; i++) headers.push(`Col ${i + 1}`);
    }
    // Normalize row lengths
    for (const row of rows) {
      while (row.length < maxCols) row.push("");
    }
  }

  return { type: "comparison", heading: heading || "Comparativo", headers, rows };
}

/* ════════════════════════════════════════════════════════════
   SLIDE MODEL — 4 layout types only
   ════════════════════════════════════════════════════════════ */

const PRIMARY = "16213E";
const TEXT_WHITE = "FFFFFF";
const TEXT_DARK = "1E1E23";
const ACCENT = "5C6BC0";
const TAKEAWAY_BG = "FFF8E1";
const TAKEAWAY_ACCENT = "F9A825";
const TABLE_HEADER_BG = "E8EAF6";
const TABLE_ALT_BG = "F5F5F5";

// Slide = 10" x 5.625"
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const HEADER_H = 0.52;     // ~9% of slide
const TITLE_H = 0.36;
const ACCENT_LINE_Y = HEADER_H + 0.04;
const CONTENT_TOP = 0.68;  // content starts here
const FOOTER_Y = 5.38;
const FOOTER_H = 0.24;
const CONTENT_BOTTOM = 5.30;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP; // ~4.62"
const MARGIN_X = 0.5;      // left/right margin
const CONTENT_W = SLIDE_W - MARGIN_X * 2; // 9.0"

// Font stepping: 18 → 17 → 16 (minimum)
const FONT_SIZES = [18, 17, 16];
const MIN_BULLETS_PER_SLIDE = 4;
const MAX_BULLETS_PER_SLIDE = 8;
const MAX_CHARS_PER_SLIDE = 900;

interface SlideContent {
  type: "cover" | "divider" | "content" | "comparison" | "takeaways";
  title: string;
  subtitle?: string;
  bullets?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
}

/* ════════════════════════════════════════════════════════════
   HEIGHT ESTIMATION — accurate character-based wrapping
   ════════════════════════════════════════════════════════════ */

function charsPerLine(fontSize: number, colWidth: number): number {
  // Arial at various sizes: empirical chars-per-inch ≈ 90/fontSize
  const cpi = 90 / fontSize;
  return Math.max(15, Math.floor(colWidth * cpi));
}

function estimateBulletsHeight(bullets: string[], fontSize: number, width: number): number {
  const cpl = charsPerLine(fontSize, width);
  const lineH = (fontSize / 72) * 1.20; // line height factor 1.20
  const bulletGap = 0.04; // gap between bullets
  let total = 0;
  for (const b of bullets) {
    const lines = Math.max(1, Math.ceil(b.length / cpl));
    total += lines * lineH + bulletGap;
  }
  return total;
}

function bulletsFitInArea(bullets: string[], fontSize: number, availableH: number, width: number): boolean {
  return estimateBulletsHeight(bullets, fontSize, width) <= availableH;
}

/** Find best fontSize that fits bullets in the available area */
function bestFontForBullets(bullets: string[], availableH: number, width: number): number {
  for (const fs of FONT_SIZES) {
    if (bulletsFitInArea(bullets, fs, availableH, width)) return fs;
  }
  return FONT_SIZES[FONT_SIZES.length - 1]; // minimum
}

/* ════════════════════════════════════════════════════════════
   SEMANTIC PAGINATION — split by topic, merge small sections
   ════════════════════════════════════════════════════════════ */

/** Remove duplicate module prefix from title: "Módulo 1: Módulo 1: X" → "Módulo 1: X" */
function deduplicateTitle(title: string): string {
  // Match patterns like "Módulo X: Módulo X: ..." or "Módulo X: Módulo X - ..."
  return title.replace(/^(Módulo\s+\d+\s*[:–-]\s*)\1/i, "$1");
}

/** Split bullets into slide-sized groups, respecting min/max and height constraints */
function paginateBullets(heading: string, items: string[], type: SlideContent["type"] = "content"): SlideContent[] {
  if (items.length === 0) return [];

  const slides: SlideContent[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      slides.push({ type, title: heading, bullets: [...current] });
      current = [];
    }
  };

  for (const item of items) {
    const candidate = [...current, item];
    const totalChars = candidate.reduce((s, b) => s + b.length, 0);

    // Check if candidate fits
    if (candidate.length <= MAX_BULLETS_PER_SLIDE && totalChars <= MAX_CHARS_PER_SLIDE) {
      const fs = bestFontForBullets(candidate, CONTENT_H - 0.1, CONTENT_W);
      if (bulletsFitInArea(candidate, fs, CONTENT_H - 0.1, CONTENT_W)) {
        current = candidate;
        continue;
      }
    }

    // Doesn't fit — flush current
    flush();
    current = [item];
  }
  flush();

  // POST-PROCESS: merge tiny trailing slides back into previous
  // If last slide has < MIN_BULLETS and previous exists, try to merge
  if (slides.length >= 2) {
    const last = slides[slides.length - 1];
    const prev = slides[slides.length - 2];
    if ((last.bullets?.length || 0) < MIN_BULLETS_PER_SLIDE && prev.bullets) {
      const merged = [...prev.bullets, ...(last.bullets || [])];
      const totalChars = merged.reduce((s, b) => s + b.length, 0);
      if (merged.length <= MAX_BULLETS_PER_SLIDE + 1 && totalChars <= MAX_CHARS_PER_SLIDE + 100) {
        const fs = bestFontForBullets(merged, CONTENT_H - 0.1, CONTENT_W);
        if (bulletsFitInArea(merged, fs, CONTENT_H - 0.1, CONTENT_W)) {
          prev.bullets = merged;
          slides.pop();
        }
      }
    }
  }

  // NO part numbering — cleaner titles
  return slides;
}

/** Build all slides for one module */
function buildModuleSlides(mod: any, index: number, total: number): SlideContent[] {
  const blocks = parseModuleContent(mod.content || "");
  const rawTitle = sanitize(mod.title || "");
  // Prevent "Módulo X: Módulo X:"
  const moduleLabel = `Módulo ${index + 1}`;
  let moduleTitle: string;
  if (/^módulo\s+\d+/i.test(rawTitle)) {
    moduleTitle = rawTitle; // already has prefix
  } else {
    moduleTitle = `${moduleLabel}: ${rawTitle}`;
  }
  moduleTitle = deduplicateTitle(moduleTitle);

  const slides: SlideContent[] = [];

  // Separate block types
  const objectiveBlocks = blocks.filter((b) => b.type === "objectives");
  const takeawayBlocks = blocks.filter((b) => b.type === "takeaways");
  const contentBlocks = blocks.filter((b) => b.type !== "objectives" && b.type !== "takeaways");

  // 1) DIVIDER slide for module
  const objBullets = objectiveBlocks.flatMap((b) => (b.items || []).map(sanitize)).filter(Boolean).slice(0, 4);
  slides.push({
    type: "divider",
    title: moduleTitle,
    subtitle: moduleLabel,
    bullets: objBullets.length > 0 ? objBullets : undefined,
  });

  // 2) Content slides — merge adjacent small blocks
  const mergedSections: { heading: string; items: string[]; isTable: boolean; headers?: string[]; rows?: string[][] }[] = [];

  for (const block of contentBlocks) {
    if ((block.type === "table" || block.type === "comparison") && block.headers && block.rows && block.rows.length > 0) {
      mergedSections.push({
        heading: sanitize(block.heading || moduleTitle),
        items: [],
        isTable: true,
        headers: block.headers.map(sanitize),
        rows: block.rows.map((r) => r.map(sanitize)),
      });
      continue;
    }

    const blockItems = (block.items || []).map(sanitize).filter((s) => s.length > 3);
    if (blockItems.length === 0) continue;

    const blockHeading = sanitize(block.heading || "");
    const blockChars = blockItems.reduce((s, b) => s + b.length, 0);
    const last = mergedSections.length > 0 ? mergedSections[mergedSections.length - 1] : null;

    // Merge small sections: if both current and previous are small
    if (
      last && !last.isTable &&
      blockItems.length < MIN_BULLETS_PER_SLIDE &&
      last.items.length < MIN_BULLETS_PER_SLIDE &&
      (last.items.length + blockItems.length) <= MAX_BULLETS_PER_SLIDE
    ) {
      const totalAfter = last.items.reduce((s, b) => s + b.length, 0) + blockChars;
      if (totalAfter <= MAX_CHARS_PER_SLIDE) {
        // Optionally add heading as separator
        if (blockHeading && blockHeading !== last.heading && blockItems.length >= 2) {
          last.items.push(""); // visual break
          last.heading = last.heading || blockHeading;
        }
        last.items.push(...blockItems);
        continue;
      }
    }

    mergedSections.push({ heading: blockHeading || moduleTitle, items: [...blockItems], isTable: false });
  }

  for (const section of mergedSections) {
    if (section.isTable && section.headers && section.rows) {
      // Render as COMPARISON slide(s)
      const maxRowsPerSlide = 6;
      for (let i = 0; i < section.rows.length; i += maxRowsPerSlide) {
        const chunk = section.rows.slice(i, i + maxRowsPerSlide);
        slides.push({
          type: "comparison",
          title: section.heading,
          tableHeaders: section.headers,
          tableRows: chunk,
        });
      }
    } else if (section.items.length > 0) {
      // Remove empty separator strings before pagination
      const cleanItems = section.items.filter((s) => s.length > 0);
      slides.push(...paginateBullets(section.heading, cleanItems));
    }
  }

  // 3) Takeaways
  const takeawayBullets = takeawayBlocks.flatMap((b) => (b.items || []).map(sanitize)).filter(Boolean);
  if (takeawayBullets.length > 0) {
    slides.push(...paginateBullets("Resumo", takeawayBullets, "takeaways"));
  }

  return slides;
}

/* ════════════════════════════════════════════════════════════
   SLIDE RENDERING — 4 layouts
   ════════════════════════════════════════════════════════════ */

function addFooter(slide: any, num: number, total: number) {
  slide.addText(`${num} / ${total}`, {
    x: 4, y: FOOTER_Y, w: 2, h: FOOTER_H,
    fontSize: 8, fontFace: "Arial", color: "999999", align: "center",
  });
}

function renderCover(pptx: any, title: string, description: string, moduleCount: number) {
  const slide = pptx.addSlide();
  slide.background = { color: PRIMARY };
  slide.addText(title, {
    x: 0.8, y: 0.6, w: 8.4, h: 2.4,
    fontSize: 32, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    align: "center", valign: "middle", shrinkText: true,
  });
  if (description) {
    slide.addText(sanitize(description), {
      x: 1.2, y: 3.2, w: 7.6, h: 1.2,
      fontSize: 14, fontFace: "Arial", color: "B0BEC5", align: "center", valign: "top",
      shrinkText: true,
    });
  }
  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  slide.addText(`${moduleCount} módulos  •  ${d}  •  Gerado por EduGen AI`, {
    x: 0, y: 4.8, w: 10, h: 0.4,
    fontSize: 10, fontFace: "Arial", color: "78909C", align: "center",
  });
}

function renderDivider(pptx: any, sc: SlideContent, num: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: PRIMARY };

  // Subtitle label
  if (sc.subtitle) {
    slide.addText(sc.subtitle.toUpperCase(), {
      x: 0.8, y: 0.8, w: 8.4, h: 0.35,
      fontSize: 12, fontFace: "Arial", color: ACCENT, bold: true, align: "left",
      letterSpacing: 3,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.2, w: 1.0, h: 0.03, fill: { color: ACCENT } });
  }

  slide.addText(sc.title, {
    x: 0.8, y: 1.4, w: 8.4, h: 1.4,
    fontSize: 26, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    valign: "top", shrinkText: true,
  });

  // Objectives if present
  if (sc.bullets && sc.bullets.length > 0) {
    slide.addText("Objetivos", {
      x: 0.8, y: 3.0, w: 3, h: 0.3,
      fontSize: 11, fontFace: "Arial", color: ACCENT, bold: true,
    });
    const objText = sc.bullets.map((b) => ({
      text: b,
      options: {
        fontSize: 13, fontFace: "Arial", color: "B0BEC5",
        bullet: { type: "bullet" as const, color: ACCENT },
        paraSpaceAfter: 3, lineSpacing: 16,
      },
    }));
    slide.addText(objText, {
      x: 0.8, y: 3.3, w: 8.4, h: 1.8,
      valign: "top", shrinkText: true,
    });
  }

  addFooter(slide, num, total);
}

function renderContent(pptx: any, sc: SlideContent, num: number, total: number) {
  const slide = pptx.addSlide();
  const bullets = sc.bullets || [];

  // Header bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: HEADER_H, fill: { color: PRIMARY } });
  slide.addText(deduplicateTitle(sc.title), {
    x: 0.4, y: 0.06, w: 9.2, h: TITLE_H,
    fontSize: 16, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    shrinkText: true,
  });
  // Accent line
  slide.addShape(pptx.ShapeType.rect, { x: MARGIN_X, y: ACCENT_LINE_Y, w: 1.0, h: 0.025, fill: { color: ACCENT } });

  // Find best font size
  const fs = bestFontForBullets(bullets, CONTENT_H - 0.05, CONTENT_W);
  const lineSpacing = Math.round(fs * 1.18);
  const paraAfter = Math.max(2, Math.round(fs * 0.2));

  const bulletObjs = bullets.map((b) => ({
    text: b,
    options: {
      fontSize: fs,
      fontFace: "Arial",
      color: TEXT_DARK,
      bullet: { type: "bullet" as const, color: ACCENT },
      paraSpaceAfter: paraAfter,
      lineSpacing,
    },
  }));

  slide.addText(bulletObjs, {
    x: MARGIN_X, y: CONTENT_TOP, w: CONTENT_W, h: CONTENT_H,
    valign: "top", shrinkText: true,
  });

  addFooter(slide, num, total);
}

function renderComparison(pptx: any, sc: SlideContent, num: number, total: number) {
  const slide = pptx.addSlide();
  const headers = sc.tableHeaders || [];
  const rows = sc.tableRows || [];
  const colCount = headers.length || (rows[0]?.length ?? 2);

  // Header bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: HEADER_H, fill: { color: PRIMARY } });
  slide.addText(deduplicateTitle(sc.title), {
    x: 0.4, y: 0.06, w: 9.2, h: TITLE_H,
    fontSize: 16, fontFace: "Arial", color: TEXT_WHITE, bold: true, shrinkText: true,
  });
  slide.addShape(pptx.ShapeType.rect, { x: MARGIN_X, y: ACCENT_LINE_Y, w: 1.0, h: 0.025, fill: { color: ACCENT } });

  // Table
  const tableX = MARGIN_X;
  const tableY = CONTENT_TOP + 0.05;
  const tableW = CONTENT_W;
  const colW = tableW / colCount;

  // Build table data for pptxgenjs
  const tableData: any[][] = [];

  // Header row
  const headerRow = headers.map((h) => ({
    text: h,
    options: {
      fontSize: 12, fontFace: "Arial", bold: true, color: TEXT_DARK,
      fill: { color: TABLE_HEADER_BG },
      border: [
        { type: "solid", pt: 0.5, color: "CCCCCC" },
        { type: "solid", pt: 0.5, color: "CCCCCC" },
        { type: "solid", pt: 0.5, color: "CCCCCC" },
        { type: "solid", pt: 0.5, color: "CCCCCC" },
      ],
      valign: "middle",
      paraSpaceAfter: 2,
      paraSpaceBefore: 2,
    },
  }));
  tableData.push(headerRow);

  // Data rows
  rows.forEach((row, ri) => {
    const dataRow = row.map((cell) => ({
      text: cell,
      options: {
        fontSize: 11, fontFace: "Arial", color: TEXT_DARK,
        fill: ri % 2 === 1 ? { color: TABLE_ALT_BG } : undefined,
        border: [
          { type: "solid", pt: 0.5, color: "DDDDDD" },
          { type: "solid", pt: 0.5, color: "DDDDDD" },
          { type: "solid", pt: 0.5, color: "DDDDDD" },
          { type: "solid", pt: 0.5, color: "DDDDDD" },
        ],
        valign: "middle",
        paraSpaceAfter: 2,
        paraSpaceBefore: 2,
      },
    }));
    // Pad if needed
    while (dataRow.length < colCount) {
      dataRow.push({ text: "", options: { fontSize: 11, fontFace: "Arial", color: TEXT_DARK, valign: "middle" as const, paraSpaceAfter: 2, paraSpaceBefore: 2 } });
    }
    tableData.push(dataRow);
  });

  slide.addTable(tableData, {
    x: tableX, y: tableY, w: tableW,
    colW: Array(colCount).fill(colW),
    autoPage: false,
    shrinkText: true,
  });

  addFooter(slide, num, total);
}

function renderTakeaways(pptx: any, sc: SlideContent, num: number, total: number) {
  const slide = pptx.addSlide();
  const bullets = sc.bullets || [];

  slide.background = { color: TAKEAWAY_BG };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.05, fill: { color: TAKEAWAY_ACCENT } });
  slide.addText(sc.title, {
    x: MARGIN_X, y: 0.15, w: CONTENT_W, h: 0.4,
    fontSize: 18, fontFace: "Arial", color: TEXT_DARK, bold: true,
  });

  const fs = bestFontForBullets(bullets, CONTENT_BOTTOM - 0.65, CONTENT_W);
  const lineSpacing = Math.round(fs * 1.18);
  const paraAfter = Math.max(2, Math.round(fs * 0.2));

  const bulletObjs = bullets.map((b) => ({
    text: b,
    options: {
      fontSize: fs, fontFace: "Arial", color: TEXT_DARK,
      bullet: { type: "bullet" as const, color: TAKEAWAY_ACCENT },
      paraSpaceAfter: paraAfter, lineSpacing,
    },
  }));

  slide.addText(bulletObjs, {
    x: MARGIN_X, y: 0.60, w: CONTENT_W, h: CONTENT_BOTTOM - 0.65,
    valign: "top", shrinkText: true,
  });

  addFooter(slide, num, total);
}

function renderClosing(pptx: any, title: string) {
  const slide = pptx.addSlide();
  slide.background = { color: PRIMARY };
  slide.addText("Obrigado!", {
    x: 0, y: 1.4, w: SLIDE_W, h: 1.6,
    fontSize: 38, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });
  slide.addText(sanitize(title), {
    x: 1, y: 3.3, w: 8, h: 0.6,
    fontSize: 15, fontFace: "Arial", color: "B0BEC5", align: "center", shrinkText: true,
  });
}

/* ════════════════════════════════════════════════════════════
   MAIN HANDLER
   ════════════════════════════════════════════════════════════ */

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
    const allSlides: SlideContent[] = [];
    for (let i = 0; i < modules.length; i++) {
      allSlides.push(...buildModuleSlides(modules[i], i, modules.length));
    }

    const totalSlides = allSlides.length + 2; // +cover +closing

    /* ─── Build PPTX ─── */
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // 1) Cover
    renderCover(pptx, course.title, course.description || "", modules.length);

    // 2) Content slides
    let slideNum = 2;
    for (const sc of allSlides) {
      switch (sc.type) {
        case "divider":
          renderDivider(pptx, sc, slideNum, totalSlides);
          break;
        case "comparison":
          renderComparison(pptx, sc, slideNum, totalSlides);
          break;
        case "takeaways":
          renderTakeaways(pptx, sc, slideNum, totalSlides);
          break;
        default:
          renderContent(pptx, sc, slideNum, totalSlides);
          break;
      }
      slideNum++;
    }

    // 3) Closing
    renderClosing(pptx, course.title);

    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PPTX - ${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", upsert: true });
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
