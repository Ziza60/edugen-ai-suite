// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — Portão de qualidade  ·  endpoint
//
// Carrega um curso, submete ao portão estrutural (_shared/quality-gate.ts),
// grava o laudo e ajusta o status de geração conforme o veredito.
//
// Dois chamadores, duas autorizações:
//
//   • O pipeline, com a service role key, logo após o último módulo terminar.
//     É o caminho que de fato protege o cliente: o curso só chega a `ready`
//     se passar.
//   • O dono do curso, pela interface, para reexecutar depois de uma edição.
//     Aqui vale a mesma disciplina do calculate-eduscore: a checagem é feita
//     comparando o `sub` do token com o dono, porque a anon key é um JWT
//     válido e passaria por qualquer verificação feita só no gateway.
//
// O portão NUNCA derruba a entrega. Se ele próprio falhar, o curso segue com o
// status que já tinha e o erro fica no log — um controle de qualidade que
// impede a entrega quando quebra é pior que não ter controle nenhum.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  inspectCourse,
  summarizeReport,
  type ModuleInspectionInput,
} from "../_shared/quality-gate.ts";
import { secretsMatch } from "../_shared/course-dispatch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const courseId = String(body?.course_id ?? "").trim();
    if (!courseId) return json(400, { error: "course_id é obrigatório" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "Não autenticado" });

    // A service role key identifica o pipeline. Comparação em tempo constante:
    // `===` em string vaza o tamanho do prefixo correto pelo tempo de resposta,
    // e este endpoint aceita chamadas de fora.
    const interno = secretsMatch(token, serviceKey);

    const { data: course, error: courseErr } = await service
      .from("courses")
      .select("id, title, user_id, modules_expected, generation_status, generation_params")
      .eq("id", courseId)
      .maybeSingle();

    if (courseErr || !course) return json(404, { error: "Curso não encontrado" });

    if (!interno) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
      const userId = claims?.claims?.sub as string | undefined;
      if (claimsErr || !userId) return json(401, { error: "Sessão inválida" });
      if (course.user_id !== userId) {
        // 404, e não 403: dizer "existe, mas não é seu" confirmaria a
        // existência do curso para quem estivesse varrendo UUIDs.
        console.warn(
          `[course-quality-gate] Acesso negado: usuário ${userId} pediu curso ${courseId}.`,
        );
        return json(404, { error: "Curso não encontrado" });
      }
    }

    const { data: modules } = await service
      .from("course_modules")
      .select("id, title, content, order_index")
      .eq("course_id", courseId)
      .order("order_index");

    if (!modules || modules.length === 0) {
      return json(400, { error: "Curso sem módulos" });
    }

    // A faixa de densidade vem do perfil de profundidade escolhido na geração;
    // sem ela o portão usa o piso padrão.
    const params = (course.generation_params ?? {}) as Record<string, unknown>;
    const inspecionaveis: ModuleInspectionInput[] = modules.map((m, i) => ({
      module_number: (m.order_index ?? i) + 1,
      title: m.title ?? `Módulo ${i + 1}`,
      markdown: m.content ?? "",
      is_capstone: i === modules.length - 1,
    }));

    const report = inspectCourse({
      course_title: course.title ?? "",
      modules: inspecionaveis,
      modules_expected: course.modules_expected ?? modules.length,
      lesson_min_words: Number(params?.lesson_min_words) || undefined,
      lesson_max_words: Number(params?.lesson_max_words) || undefined,
    });

    console.log(
      JSON.stringify({
        event: "course-quality-gate",
        course_id: courseId,
        ...report,
        checks: undefined,
        resumo: summarizeReport(report),
      }),
    );

    // Persistência é best-effort: o laudo é valioso, mas perder o registro não
    // pode custar o ajuste de status, que é o que protege o cliente.
    const { error: reportErr } = await service.from("course_quality_reports").insert({
      course_id: courseId,
      verdict: report.verdict,
      structural_score: report.structural_score,
      blockers: report.blockers,
      warnings: report.warnings,
      checks: report.checks,
      criteria_version: report.criteria_version,
    });
    if (reportErr) {
      console.warn(`[course-quality-gate] Laudo não gravado: ${reportErr.message}`);
    }

    // O status só é rebaixado, nunca promovido. Se a geração já marcou o curso
    // como `failed` ou `needs_review` (módulo que não veio, por exemplo), o
    // portão não tem autoridade para dizer que está pronto — ele conhece a
    // estrutura do que chegou, não o que faltou chegar.
    const atual = String(course.generation_status ?? "");
    const rebaixavel = atual === "ready" || atual === "ready_with_warnings";
    const patch: Record<string, unknown> = {
      quality_verdict: report.verdict,
      quality_score: report.structural_score,
      quality_checked_at: new Date().toISOString(),
    };
    if (rebaixavel && report.verdict !== "ready") {
      patch.generation_status = report.verdict;
    }
    const { error: updErr } = await service
      .from("courses")
      .update(patch)
      .eq("id", courseId);
    if (updErr) {
      console.warn(`[course-quality-gate] Status não atualizado: ${updErr.message}`);
    }

    return json(200, {
      course_id: courseId,
      verdict: report.verdict,
      structural_score: report.structural_score,
      blockers: report.blockers,
      warnings: report.warnings,
      checks: report.checks,
      criteria_version: report.criteria_version,
      generation_status: patch.generation_status ?? atual,
    });
  } catch (err: any) {
    console.error("[course-quality-gate]", err?.message ?? err);
    return json(500, { error: err?.message ?? String(err) });
  }
});
