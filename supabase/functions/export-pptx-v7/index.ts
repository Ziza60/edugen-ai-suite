// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  index.ts  (Supabase Edge Function)
//
// Topic-agnostic PPTX exporter. Pipeline:
//   course MD ─▶ buildDeck (structured LLM per module, deterministic fallback)
//             ─▶ normalizeDeck (universal structural fixes, graceful degrade)
//             ─▶ resolveImages (optional Pexels)
//             ─▶ renderDeck (clean design system)
//             ─▶ write ▸ upload ▸ signed URL
//
// Unlike v4/v5 there is NO topic-specific QA veto. The engine always ships a
// deck; quality is built at the source, not policed downstream. This is the
// only Deno-specific file — deck-plan / validate / render / images are pure TS
// and unit-testable under Node/Bun.
// ═══════════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";

import { buildDeck, type ModuleInput, type PlannedDeck } from "./deck-plan.ts";
import { normalizeDeck } from "./validate.ts";
import { renderDeck } from "./render.ts";
import { resolveImages } from "./images.ts";

const ENGINE_VERSION = "7.1.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The image query for a module: its planner imageQuery, else its title. */
function moduleImageQuery(m: { title: string; slides: { imageQuery?: string }[] }): string {
  return m.slides.find((s) => s.imageQuery)?.imageQuery || m.title;
}

/** Attach ONE resolved image per module (used by its section divider) + cover.
 *  One image per module — not every slide — keeps the file light and the edge
 *  runtime well under its CPU/time budget. Falls back to the module title so
 *  every divider gets a photo even when the planner omits an imageQuery. */
function attachImages(deck: PlannedDeck, images: Record<string, string>) {
  const lookup = (q?: string) =>
    q ? images[q.trim().toLowerCase()] : undefined;
  (deck as any).coverImage = lookup(deck.courseTitle) ||
    Object.values(images)[0] || undefined;
  for (const m of deck.modules) {
    const img = lookup(moduleImageQuery(m));
    if (img && m.slides[0]) m.slides[0].imageData = img;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? null;
    const pexelsKey = Deno.env.get("PEXELS_API_KEY") ?? undefined;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      token,
    );
    if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const {
      course_id,
      palette = "default",
      includeImages = true,
      footerBrand = "EduGenAI",
      language = "Português (Brasil)",
    } = body ?? {};
    if (!course_id) return json({ error: "course_id required" }, 400);

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", userId)
      .single();
    if (courseErr || !course) return json({ error: "Course not found" }, 404);

    const { data: modulesRaw = [] } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");

    const courseTitle = (course.title || "Curso").trim();
    const modules: ModuleInput[] = (modulesRaw as any[]).map((m) => ({
      title: (m.title || "").trim().replace(/\s+/g, " "),
      content: (m.content || "").trim(),
    }));

    if (modules.length === 0) {
      return json({ error: "Course has no modules to export." }, 400);
    }

    const t0 = Date.now();
    console.log(
      `[V7] ENGINE=${ENGINE_VERSION} "${courseTitle}" modules=${modules.length} llm=${!!geminiKey} images=${includeImages && !!pexelsKey}`,
    );

    // 1. Build deck (structured planner + deterministic fallback)
    const { deck: rawDeck, plannedCount, fallbackCount } = await buildDeck(
      courseTitle,
      course.description || "",
      modules,
      language,
      geminiKey,
    );

    // 2. Universal normalization (graceful, never vetoes)
    const { deck, stats } = normalizeDeck(rawDeck);
    console.log(
      `[V7-NORMALIZE] in=${stats.slidesIn} out=${stats.slidesOut} split=${stats.slidesSplit} dropped=${stats.slidesDropped}`,
    );

    // 3. Optional images (best-effort)
    if (includeImages && pexelsKey) {
      // One query per module (planner hint, else module title) + the cover, so
      // every module divider gets a photo.
      const queries: string[] = [courseTitle];
      for (const m of deck.modules) queries.push(moduleImageQuery(m));
      try {
        const images = await resolveImages(queries, pexelsKey, queries.length);
        attachImages(deck, images);
        console.log(`[V7-IMAGES] resolved=${Object.keys(images).length}`);
      } catch (e) {
        console.warn("[V7-IMAGES] failed (non-blocking):", e);
      }
    }

    // 4. Render
    const { pptx, slideCount } = renderDeck(PptxGenJS, deck, {
      palette,
      footerBrand,
    });

    // 5. Write
    const rawData = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
    console.log(
      `[V7-WRITE] bytes=${rawData.byteLength} slides=${slideCount} total_ms=${Date.now() - t0}`,
    );

    // 6. Upload + signed URL (with retry)
    const dateStr = new Date().toISOString().slice(0, 10);
    const ts = Math.floor(Date.now() / 1000);
    const safeName = courseTitle
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v7-${dateStr}-${ts}.pptx`;

    let uploadErr: any = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await serviceClient.storage
        .from("course-exports")
        .upload(fileName, rawData, {
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          upsert: true,
        });
      if (!error) {
        uploadErr = null;
        break;
      }
      uploadErr = error;
      if (attempt < 4) {
        await new Promise((r) =>
          setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 15000))
        );
      }
    }
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    try {
      await serviceClient.from("usage_events").insert({
        user_id: userId,
        event_type: "COURSE_EXPORTED_PPTX_V7",
        metadata: { course_id, modules: modules.length, slides: slideCount },
      });
    } catch {
      /* non-critical */
    }

    console.log(
      `[PPTX][DIAG-FINAL] engine=export-pptx-v7 version=${ENGINE_VERSION} slides=${slideCount} planned=${plannedCount} fallback=${fallbackCount} status=exported`,
    );

    return json({
      url: signed.signedUrl,
      engine: "export-pptx-v7",
      engine_version: ENGINE_VERSION,
      status: "exported",
      slide_count: slideCount,
      modules_total: modules.length,
      modules_planned_by_llm: plannedCount,
      modules_fallback: fallbackCount,
      normalize: stats,
    });
  } catch (err: any) {
    console.error("[V7] export error:", err);
    return json(
      { error: err?.message || "Internal error", engine: "export-pptx-v7" },
      500,
    );
  }
});
