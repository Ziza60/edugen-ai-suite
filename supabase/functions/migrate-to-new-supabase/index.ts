// Edge function temporária para migrar TUDO do Lovable Cloud atual para um novo projeto Supabase.
// Preserva IDs de usuários e tabelas. Senhas NÃO são migradas (precisam de "esqueci minha senha").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Ordem importa: pais antes dos filhos (FK lógicas via RLS).
const TABLES_IN_ORDER = [
  "profiles",
  "subscriptions",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "courses",
  "course_modules",
  "course_flashcards",
  "course_quiz_questions",
  "course_images",
  "course_sources",
  "course_landings",
  "course_reviews",
  "review_comments",
  "certificates",
  "tutor_sessions",
  "usage_events",
  "pptx_export_reports",
  "landing_page_permissions",
  "ai_cache",
];

const BUCKETS = ["course-exports", "course-sources", "avatars", "course-images", "certificates"];

async function copyTable(oldDb: any, newDb: any, table: string, log: string[]) {
  const pageSize = 500;
  let from = 0;
  let total = 0;
  while (true) {
    const { data, error } = await oldDb.from(table).select("*").range(from, from + pageSize - 1);
    if (error) { log.push(`❌ ${table} read: ${error.message}`); return total; }
    if (!data || data.length === 0) break;
    const { error: insErr } = await newDb.from(table).upsert(data, { onConflict: "id" });
    if (insErr) {
      log.push(`⚠️ ${table} upsert (${data.length}): ${insErr.message}`);
      // Tenta um por um para isolar
      for (const row of data) {
        const { error: e2 } = await newDb.from(table).upsert(row, { onConflict: "id" });
        if (e2) log.push(`   ↳ row ${row.id}: ${e2.message}`);
        else total++;
      }
    } else {
      total += data.length;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  log.push(`✅ ${table}: ${total} linhas`);
  return total;
}

async function copyBucket(oldDb: any, newDb: any, bucket: string, log: string[]) {
  // Garante bucket no destino
  const { data: existing } = await newDb.storage.getBucket(bucket);
  if (!existing) {
    const isPublic = ["avatars", "course-images", "certificates"].includes(bucket);
    await newDb.storage.createBucket(bucket, { public: isPublic });
  }

  let copied = 0;
  async function walk(prefix: string) {
    const { data: items, error } = await oldDb.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) { log.push(`❌ list ${bucket}/${prefix}: ${error.message}`); return; }
    if (!items) return;
    for (const it of items) {
      const fullPath = prefix ? `${prefix}/${it.name}` : it.name;
      if (!it.id) {
        // pasta
        await walk(fullPath);
      } else {
        const { data: blob, error: dErr } = await oldDb.storage.from(bucket).download(fullPath);
        if (dErr || !blob) { log.push(`❌ download ${bucket}/${fullPath}: ${dErr?.message}`); continue; }
        const { error: uErr } = await newDb.storage.from(bucket).upload(fullPath, blob, {
          upsert: true,
          contentType: it.metadata?.mimetype || "application/octet-stream",
        });
        if (uErr) log.push(`❌ upload ${bucket}/${fullPath}: ${uErr.message}`);
        else copied++;
      }
    }
  }
  await walk("");
  log.push(`📦 bucket ${bucket}: ${copied} arquivos`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const log: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    const phase = body.phase || "all"; // "users" | "tables" | "storage" | "all"

    const oldUrl = Deno.env.get("SUPABASE_URL")!;
    const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const newUrl = Deno.env.get("NEW_SUPABASE_URL")!;
    const newKey = Deno.env.get("NEW_SUPABASE_SERVICE_ROLE_KEY")!;

    if (!newUrl || !newKey) throw new Error("NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_ROLE_KEY ausentes");

    const oldDb = createClient(oldUrl, oldKey, { auth: { persistSession: false } });
    const newDb = createClient(newUrl, newKey, { auth: { persistSession: false } });

    log.push(`🚀 Fase: ${phase}`);
    log.push(`📤 Origem: ${oldUrl}`);
    log.push(`📥 Destino: ${newUrl}`);

    // 1) USUÁRIOS
    if (phase === "all" || phase === "users") {
      let page = 1;
      let userCount = 0;
      while (true) {
        const { data, error } = await oldDb.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`listUsers: ${error.message}`);
        if (!data || data.users.length === 0) break;
        for (const u of data.users) {
          const { error: cErr } = await newDb.auth.admin.createUser({
            id: u.id,
            email: u.email!,
            email_confirm: !!u.email_confirmed_at,
            user_metadata: u.user_metadata,
            app_metadata: u.app_metadata,
          } as any);
          if (cErr && !cErr.message.includes("already")) {
            log.push(`⚠️ user ${u.email}: ${cErr.message}`);
          } else {
            userCount++;
          }
        }
        if (data.users.length < 1000) break;
        page++;
      }
      log.push(`👥 Usuários migrados: ${userCount}`);
    }

    // 2) TABELAS
    if (phase === "all" || phase === "tables") {
      for (const t of TABLES_IN_ORDER) {
        await copyTable(oldDb, newDb, t, log);
      }
    }

    // 3) STORAGE
    if (phase === "all" || phase === "storage") {
      for (const b of BUCKETS) {
        await copyBucket(oldDb, newDb, b, log);
      }
    }

    log.push("✨ Migração concluída.");
    return new Response(JSON.stringify({ ok: true, log }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    log.push(`💥 ${e instanceof Error ? e.message : String(e)}`);
    return new Response(JSON.stringify({ ok: false, log }, null, 2), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
