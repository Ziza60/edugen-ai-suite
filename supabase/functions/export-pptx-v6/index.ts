import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const ENGINE_VERSION = "6.0.0";
const TEMPLATE_STORAGE_PATH = "templates/edugenai_template.pptx";

const RID_BASE = 20;

const SLIDE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

const LAYOUT_INDEX: Record<string, number> = {
  COVER: 0, TOC: 1, MODULE_COVER: 2, BULLETS: 3,
  CARDS_2: 4, CARDS_3: 5, CARDS_4: 6, PROCESS: 7,
  COMPARISON: 8, TIMELINE: 9, TWOCOL: 10, TAKEAWAYS: 11, CLOSING: 12,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ═══════════════════════════════════════════════════════════
// SANITIZAÇÃO
// ═══════════════════════════════════════════════════════════

function san(text: unknown): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\\n\s*\d*\.?/g, "")
    .replace(/\n\s*\d*\.?/g, " ")
    .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanList(items: unknown, maxN = 5): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((x) => san(String(x))).filter(Boolean).slice(0, maxN);
}

// ═══════════════════════════════════════════════════════════
// ESCAPE XML
// ═══════════════════════════════════════════════════════════

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════════════════
// NORMALIZAÇÃO DO LAYOUT
// ═══════════════════════════════════════════════════════════

function normalizeLayout(layout: string, nItems = 0): string {
  const l = layout.toUpperCase();
  if (l === "CARDS" || l === "CARD") {
    return `CARDS_${Math.max(2, Math.min(4, nItems || 2))}`;
  }
  return l;
}

// ═══════════════════════════════════════════════════════════
// BUILD REPLACEMENTS
// ═══════════════════════════════════════════════════════════

function buildReplacements(d: Record<string, unknown>): [string, Record<string, string>] {
  const nItems =
    (d.items as unknown[] | undefined)?.length ||
    (d.cards as unknown[] | undefined)?.length ||
    (d.steps as unknown[] | undefined)?.length || 0;

  const layout = normalizeLayout(String(d.layout || "BULLETS"), nItems);

  const s = (k: string, dv = "") => san(String((d[k] as string) || dv));
  const sl = (k: string, mn = 5) => sanList(d[k], mn);

  const r: Record<string, string> = {};

  switch (layout) {
    case "COVER":
      r.BADGE   = s("badge", "CURSO COMPLETO").toUpperCase();
      r.TITLE   = s("title");
      r.TAGLINE = s("tagline", "Curso completo com material profissional");
      break;

    case "TOC": {
      const mods = sl("modules", 10);
      r.MODULE_COUNT = `${mods.length} Módulo${mods.length !== 1 ? "s" : ""}`;
      for (let i = 0; i < 10; i++) {
        r[`MOD_${i + 1}`] = mods[i] ?? "";
        // NUM_N: preencher com o número formatado se módulo existe, string vazia se não existe.
        // String vazia apaga o número âmbar e o círculo fica sem texto — mais limpo que
        // mostrar 8, 9, 10 sem módulo correspondente.
        r[`NUM_${i + 1}`] = i < mods.length ? String(i + 1) : "";
      }
      break;
    }

    case "MODULE_COVER": {
      const titleLower = s("title").toLowerCase();
      const comps = sl("competencies", 3).filter(
        (c) => c.toLowerCase() !== titleLower
      );
      r.MODULE_NUMBER = s("module_number", "01");
      r.MODULE_LABEL  = s("module_label", "MÓDULO 1");
      r.TITLE         = s("title");
      r.COMP_1        = comps[0] ?? "";
      r.COMP_2        = comps[1] ?? "";
      r.COMP_3        = comps[2] ?? "";
      break;
    }

    case "BULLETS": {
      let items = sl("items", 5);
      // Garantia: bullets sempre com mínimo 4 itens visíveis.
      // Se o Gemini gerou menos de 4, repete o último item até completar.
      // Isso evita que marcadores âmbar apareçam sem texto no template.
      if (items.length > 0 && items.length < 4) {
        while (items.length < 4) {
          items.push(items[items.length - 1]);
        }
      }
      r.LABEL = s("label", "CONTEÚDO").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 5; i++) r[`ITEM_${i + 1}`] = items[i] ?? "";
      break;
    }

    case "CARDS_2":
    case "CARDS_3":
    case "CARDS_4": {
      const n = parseInt(layout.split("_")[1]);
      const cards = ((d.cards as unknown[]) || []).slice(0, n);
      r.LABEL = s("label", "CONCEITOS").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < n; i++) {
        const c = cards[i];
        if (typeof c === "string") {
          const [title, ...rest] = c.split(": ");
          r[`CARD${i + 1}_TITLE`] = san(title);
          r[`CARD${i + 1}_BODY`]  = san(rest.join(": "));
        } else if (c && typeof c === "object") {
          const obj = c as Record<string, unknown>;
          r[`CARD${i + 1}_TITLE`] = san(String(obj.title ?? ""));
          r[`CARD${i + 1}_BODY`]  = san(String(obj.body ?? ""));
        } else {
          r[`CARD${i + 1}_TITLE`] = "";
          r[`CARD${i + 1}_BODY`]  = "";
        }
      }
      for (let i = cards.length; i < n; i++) {
        r[`CARD${i + 1}_TITLE`] = "";
        r[`CARD${i + 1}_BODY`]  = "";
      }
      break;
    }

    case "PROCESS": {
      const steps = sl("steps").length ? sl("steps") : sl("items", 5);
      r.LABEL = s("label", "PROCESSO").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 5; i++) r[`STEP_${i + 1}`] = steps[i] ?? "";
      break;
    }

    case "COMPARISON": {
      const left  = sl("left_items").length ? sl("left_items")  : sl("leftItems",  4);
      const right = sl("right_items").length ? sl("right_items") : sl("rightItems", 4);
      r.LABEL        = s("label", "COMPARAÇÃO").toUpperCase().slice(0, 32);
      r.TITLE        = s("title");
      r.LEFT_HEADER  = s("left_header")  || s("leftHeader",  "A");
      r.RIGHT_HEADER = s("right_header") || s("rightHeader", "B");
      for (let i = 0; i < 4; i++) {
        r[`LEFT_${i + 1}`]  = left[i]  ?? "";
        r[`RIGHT_${i + 1}`] = right[i] ?? "";
      }
      break;
    }

    case "TIMELINE": {
      const items = sl("items", 5);
      r.LABEL = s("label", "LINHA DO TEMPO").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 5; i++) r[`ITEM_${i + 1}`] = items[i] ?? "";
      break;
    }

    case "TWOCOL": {
      // Suporta dois formatos de resposta do Gemini:
      // 1. {items:[...8 itens...]} → divide ao meio
      // 2. {leftItems:[...], rightItems:[...]} → usa diretamente
      const hasExplicitSides =
        Array.isArray(d.leftItems) || Array.isArray(d.left_items);
      let left: string[];
      let right: string[];
      if (hasExplicitSides) {
        left  = sanList(d.leftItems  ?? d.left_items,  4);
        right = sanList(d.rightItems ?? d.right_items, 4);
      } else {
        const all  = sl("items", 8);
        const half = Math.ceil(all.length / 2);
        left  = all.slice(0, half);
        right = all.slice(half);
      }
      r.LABEL = s("label", "CONTEÚDO").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 4; i++) {
        r[`L${i + 1}`] = left[i]  ?? "";
        r[`R${i + 1}`] = right[i] ?? "";
      }
      break;
    }

    case "TAKEAWAYS": {
      const items = sl("items", 5);
      r.LABEL = s("label", "APRENDIZADOS").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 5; i++) r[`ITEM_${i + 1}`] = items[i] ?? "";
      break;
    }

    case "CLOSING": {
      const nexts = sl("next_steps").length ? sl("next_steps") : sl("items", 4);
      while (nexts.length < 4) nexts.push("");
      r.COURSE_TITLE = s("course_title");
      r.NEXT_1 = nexts[0]; r.NEXT_2 = nexts[1];
      r.NEXT_3 = nexts[2]; r.NEXT_4 = nexts[3];
      break;
    }

    default: {
      const items = sl("items", 5);
      r.LABEL = s("label", "CONTEÚDO").toUpperCase().slice(0, 32);
      r.TITLE = s("title");
      for (let i = 0; i < 5; i++) r[`ITEM_${i + 1}`] = items[i] ?? "";
    }
  }

  return [layout, r];
}

// ═══════════════════════════════════════════════════════════
// FILL XML
// ═══════════════════════════════════════════════════════════

function fillXml(xml: string, reps: Record<string, string>): string {
  for (const [key, value] of Object.entries(reps)) {
    xml = xml.replaceAll(`{{${key}}}`, escapeXml(value ?? ""));
  }
  return xml;
}

// ═══════════════════════════════════════════════════════════
// GENERATE PPTX ZIP
// ═══════════════════════════════════════════════════════════

async function generatePptxZip(
  slidesData: Record<string, unknown>[],
  brand: string,
  templateBytes: Uint8Array
): Promise<Uint8Array> {

  const tpl = await JSZip.loadAsync(templateBytes);
  const allNames = Object.keys(tpl.files);

  const layoutXmls: Record<string, string> = {};
  const layoutRels: Record<string, string> = {};
  await Promise.all(
    Array.from({ length: 13 }, async (_, i) => {
      const slideName = `ppt/slides/slide${i + 1}.xml`;
      const relName   = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
      layoutXmls[slideName] = await tpl.file(slideName)!.async("string");
      const relFile = tpl.file(relName);
      layoutRels[relName] = relFile ? await relFile.async("string") : "";
    })
  );

  const filledSlides: { xml: string; rel: string }[] = slidesData.map((sd) => {
    const [layout, reps] = buildReplacements(sd);
    const idx = LAYOUT_INDEX[layout] ?? LAYOUT_INDEX["BULLETS"];
    const slideXml = layoutXmls[`ppt/slides/slide${idx + 1}.xml`];
    const slideRel = layoutRels[`ppt/slides/_rels/slide${idx + 1}.xml.rels`];
    return {
      xml: fillXml(slideXml, reps),
      rel: slideRel,
    };
  });

  const total = filledSlides.length;
  const finalSlides = filledSlides.map((s, i) => ({
    xml: s.xml
      .replaceAll("1 / 45", `${i + 1} / ${total}`)
      .replaceAll("EduGenAI", escapeXml(brand)),
    rel: s.rel,
  }));

  const prsXmlOrig = await tpl.file("ppt/presentation.xml")!.async("string");
  const newSldIds = finalSlides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${RID_BASE + i}"/>`)
    .join("");
  const prsXml = prsXmlOrig
    .replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/s, `<p:sldIdLst>${newSldIds}</p:sldIdLst>`);

  const prsRelsOrig = await tpl.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const prsRelsClean = prsRelsOrig.replace(
    /<Relationship[^>]*Type="[^"]*\/slide"[^>]*\/>/g, ""
  );
  const newSlideRels = finalSlides
    .map((_, i) =>
      `<Relationship Id="rId${RID_BASE + i}" Type="${SLIDE_RELATIONSHIP_TYPE}" Target="slides/slide${i + 1}.xml"/>`
    )
    .join("\n");
  const prsRels = prsRelsClean.replace(
    "</Relationships>",
    newSlideRels + "\n</Relationships>"
  );

  const ctOrig = await tpl.file("[Content_Types].xml")!.async("string");
  const ctClean = ctOrig.replace(
    /<Override[^>]*PartName="\/ppt\/slides\/slide[^"]*"[^>]*\/>\s*/g, ""
  );
  const newOverrides = finalSlides
    .map((_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${SLIDE_CONTENT_TYPE}"/>`
    )
    .join("\n");
  const ct = ctClean.replace("</Types>", newOverrides + "\n</Types>");

  const slidePattern = /^ppt\/slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)$/;

  const outZip = new JSZip();

  await Promise.all(
    allNames
      .filter((name) => !slidePattern.test(name))
      .map(async (name) => {
        let content: string;
        if (name === "ppt/presentation.xml") {
          content = prsXml;
        } else if (name === "ppt/_rels/presentation.xml.rels") {
          content = prsRels;
        } else if (name === "[Content_Types].xml") {
          content = ct;
        } else {
          const bytes = await tpl.file(name)!.async("uint8array");
          outZip.file(name, bytes, { binary: true });
          return;
        }
        outZip.file(name, content);
      })
  );

  finalSlides.forEach((s, i) => {
    outZip.file(`ppt/slides/slide${i + 1}.xml`, s.xml);
    if (s.rel) {
      outZip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, s.rel);
    }
  });

  return outZip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

// ═══════════════════════════════════════════════════════════
// GEMINI
// ═══════════════════════════════════════════════════════════

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
}

function buildPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
  density: string,
  language: string
): string {
  const nSlides = density === "compact" ? 4 : density === "detailed" ? 8 : 6;
  const maxItems = density === "compact" ? 4 : density === "detailed" ? 6 : 5;

  const snippet = moduleContent
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_]/g, "")
    .replace(/:\n+\d+\./g, ":")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 3500);

  return `You are a senior instructional designer. Generate exactly ${nSlides} slides for MODULE ${moduleIndex + 1}.

COURSE: "${courseTitle}"
MODULE ${moduleIndex + 1}: "${moduleTitle}"

CONTENT:
---
${snippet}
---

RULES:
1. Language: ${language}. ALL text in ${language}.
2. Generate EXACTLY ${nSlides} slides.
3. Titles: 5–60 chars, specific. NEVER use: "Introduction", "Overview", "Module ${moduleIndex + 1}", or the module name alone.
4. Items: ONE idea each, max 15 words. No bullet prefixes, no numbering, no escape sequences.
5. "bullets" layout: generate EXACTLY 4 or 5 items — never fewer than 4. Other layouts: max ${maxItems} items. Last slide MUST be "takeaways".
6. Never place same layout in more than 2 consecutive slides.

LAYOUTS:
- "bullets"    → 3–5 key facts/definitions
- "cards"      → 2–4 named concepts. Each item: "Term: short explanation"
- "twocol"     → 6–8 items split in 2 parallel groups
- "process"    → 3–5 ordered steps, each starting with an action verb
- "comparison" → exactly 2 things contrasted. Needs: leftHeader, rightHeader, leftItems[], rightItems[]
- "timeline"   → 3–5 chronological milestones
- "takeaways"  → LAST slide only. 3–5 key learnings starting with action verbs.

OUTPUT: JSON array only. No markdown, no explanation.

Schema:
[
  {"layout":"bullets","label":"SECTION LABEL","title":"Specific title","items":["item 1","item 2"]},
  {"layout":"cards","label":"LABEL","title":"Title","items":["Term: explanation","Term: explanation"]},
  {"layout":"process","label":"LABEL","title":"Title","items":["Verb step 1","Verb step 2"]},
  {"layout":"comparison","label":"LABEL","title":"A vs B","leftHeader":"A","rightHeader":"B","leftItems":["..."],"rightItems":["..."]},
  {"layout":"takeaways","label":"APRENDIZADOS","title":"Lessons title","items":["learning 1","learning 2"]}
]`;
}

function extractCompetencies(content: string, moduleTitle?: string): string[] {
  const norm = (content || "").replace(/\\n/g, "\n");
  const titleLower = (moduleTitle ?? "").trim().toLowerCase();

  const bullets = [...norm.matchAll(/^[-*•]\s+(.+)$/gm)]
    .map((m) => m[1].replace(/\*{1,2}/g, "").replace(/\\n\s*\d*\.?/g, "").trim())
    .filter((b) => b.length >= 12 && b.length <= 80)
    .filter((b) => !Array.from(b).some((c) => { const cp = c.codePointAt(0) ?? 0; return (cp >= 0x1F300 && cp <= 0x1FFFF) || (cp >= 0x2600 && cp <= 0x27BF); }))
    .filter((b) => b.toLowerCase() !== titleLower)
    .slice(0, 3);

  if (bullets.length >= 2) return bullets;

  return norm
    .replace(/#{1,6}\s*/g, "")
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 70)
    .filter((s) => !Array.from(s).some((c) => { const cp = c.codePointAt(0) ?? 0; return cp >= 0x1F300 && cp <= 0x1FFFF; }))
    .filter((s) => s.toLowerCase() !== titleLower)
    .slice(0, 3);
}

async function generateModuleSlides(
  courseTitle: string,
  mod: { title: string; content: string },
  moduleIndex: number,
  density: string,
  language: string,
  geminiKey: string
): Promise<Record<string, unknown>[]> {
  try {
    const prompt = buildPrompt(courseTitle, mod.title, mod.content || "", moduleIndex, density, language);
    const raw    = await callGemini(prompt, geminiKey);
    const clean  = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("Not an array");

    const VALID_LAYOUTS = ["bullets","cards","twocol","process","comparison","timeline","takeaways"];

    return parsed.map((s: Record<string, unknown>) => {
      const layout = VALID_LAYOUTS.includes(String(s.layout)) ? String(s.layout) : "bullets";
      const rawItems = Array.isArray(s.items) ? s.items : [];
      const items = rawItems
        .map((x) =>
          san(String(x))
            .replace(/\\n\s*\d*\.?/g, "")
            .replace(/\n\s*\d*\.?/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim()
        )
        .filter(Boolean)
        .slice(0, 6);

      const label = san(String(s.label || "CONTEÚDO")).toUpperCase().slice(0, 32);
      const title = san(String(s.title || mod.title)).slice(0, 65);

      if (layout === "cards") {
        const n = Math.max(2, Math.min(4, items.length));
        const cards = items.map((item) => {
          const idx = item.indexOf(": ");
          return idx > 0
            ? { title: item.slice(0, idx), body: item.slice(idx + 2) }
            : { title: item, body: "" };
        });
        return { layout: `CARDS_${n}`, label, title, cards };
      }

      if (layout === "comparison") {
        return {
          layout: "COMPARISON",
          label,
          title,
          left_header:  san(String(s.leftHeader  ?? s.left_header  ?? "A")),
          right_header: san(String(s.rightHeader ?? s.right_header ?? "B")),
          left_items:   sanList(s.leftItems  ?? s.left_items,  4),
          right_items:  sanList(s.rightItems ?? s.right_items, 4),
        };
      }

      if (layout === "process") {
        return { layout: "PROCESS", label, title, steps: items.slice(0, 5) };
      }

      // TWOCOL precisa de pelo menos 4 itens para ter conteúdo em ambas as colunas.
      // Se o Gemini gerou poucos itens, tratar como BULLETS para evitar slide vazio.
      if (layout === "twocol" && items.length < 4) {
        return { layout: "BULLETS", label, title, items };
      }

      return { layout: layout.toUpperCase(), label, title, items };
    });
  } catch (e) {
    console.error(`[V6] Module ${moduleIndex + 1} error: ${(e as Error).message}`);
    return [
      { layout: "BULLETS", label: "CONTEÚDO", title: mod.title,
        items: ["Conteúdo em processamento — tente novamente"] },
      { layout: "TAKEAWAYS", label: "APRENDIZADOS",
        title: `Aprendizados: ${mod.title}`,
        items: ["Revise o conteúdo deste módulo"] },
    ];
  }
}

// ═══════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL
// ═══════════════════════════════════════════════════════════

async function buildSlidesList(
  courseTitle: string,
  modules: { title: string; content: string }[],
  density: string,
  language: string,
  brand: string,
  geminiKey: string
): Promise<Record<string, unknown>[]> {
  const BATCH = 3;
  const allModuleSlides: Record<string, unknown>[][] = new Array(modules.length);

  for (let b = 0; b < modules.length; b += BATCH) {
    const batch = modules.slice(b, b + BATCH);
    const results = await Promise.all(
      batch.map((mod, j) =>
        generateModuleSlides(courseTitle, mod, b + j, density, language, geminiKey)
      )
    );
    results.forEach((slides, j) => { allModuleSlides[b + j] = slides; });
  }

  const slides: Record<string, unknown>[] = [];

  slides.push({
    layout: "COVER",
    badge: "CURSO COMPLETO",
    title: courseTitle,
    tagline: "Curso completo com material profissional",
  });

  slides.push({
    layout: "TOC",
    modules: modules.map((m) => m.title),
  });

  for (let i = 0; i < modules.length; i++) {
    const cleanTitle = modules[i].title
      .replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "")
      .trim();

    slides.push({
      layout: "MODULE_COVER",
      module_number: String(i + 1).padStart(2, "0"),
      module_label: `MÓDULO ${i + 1}`,
      title: cleanTitle,
      competencies: extractCompetencies(modules[i].content, cleanTitle),
    });

    for (const slide of allModuleSlides[i]) {
      slides.push(slide);
    }
  }

  slides.push({
    layout: "CLOSING",
    course_title: courseTitle,
    next_steps: [
      `Aplique o conteúdo de ${san(courseTitle)} em um projeto real`,
      "Explore a documentação oficial e recursos avançados",
      "Construa um portfólio com os projetos deste curso",
      "Compartilhe seu progresso com a comunidade",
    ],
  });

  return slides;
}

// ═══════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════

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

    const geminiKey   = Deno.env.get("GEMINI_API_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const {
      course_id,
      density     = "standard",
      language    = "Português (Brasil)",
      footerBrand = "EduGenAI",
    } = body;

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: course, error: courseErr } = await svc
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

    const { data: modules = [] } = await svc
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    const courseTitle = (course.title || "Curso").trim();
    const moduleData  = (modules as { title: string; content: string }[]).map((m) => ({
      title:   (m.title   || "").replace(/\\n/g, " ").trim(),
      content: (m.content || "").trim(),
    }));

    console.log(`[V6] "${courseTitle}" | ${moduleData.length} modules | density=${density}`);

    const { data: tplBlob, error: tplErr } = await svc.storage
      .from("templates").download(TEMPLATE_STORAGE_PATH);
    if (tplErr || !tplBlob) {
      throw new Error(`Template não encontrado em storage: ${TEMPLATE_STORAGE_PATH}`);
    }
    const templateBytes = new Uint8Array(await tplBlob.arrayBuffer());

    const slidesList = await buildSlidesList(
      courseTitle, moduleData, density, language, footerBrand, geminiKey
    );
    console.log(`[V6] ${slidesList.length} slides gerados`);

    const pptxBytes = await generatePptxZip(slidesList, footerBrand, templateBytes);
    console.log(`[V6] PPTX: ${pptxBytes.byteLength.toLocaleString()} bytes`);

    const dateStr  = new Date().toISOString().slice(0, 10);
    const ts       = Math.floor(Date.now() / 1000);
    const safeName = courseTitle
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().slice(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v6-${dateStr}-${ts}.pptx`;

    let uploadErr: Error | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await svc.storage.from("course-exports").upload(fileName, pptxBytes, {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
      if (!error) { uploadErr = null; break; }
      uploadErr = error as Error;
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 15000)));
      }
    }
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await svc.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    try {
      await svc.from("usage_events").insert({
        user_id:    userId,
        event_type: "COURSE_EXPORTED_PPTX_V6",
        metadata:   { course_id, modules: moduleData.length, slides: slidesList.length },
      });
    } catch { /* não-crítico */ }

    return new Response(JSON.stringify({
      url:            signedUrl.signedUrl,
      version:        "v6",
      engine_version: ENGINE_VERSION,
      slide_count:    slidesList.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[V6] Export error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
