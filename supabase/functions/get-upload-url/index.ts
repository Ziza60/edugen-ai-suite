import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Token inválido" }, 401);
    const userId = claimsData.claims.sub as string;

    const { filename, course_id } = await req.json();
    if (!filename || !course_id) {
      return json({ error: "filename e course_id são obrigatórios" }, 400);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const filePath = `${userId}/${course_id}/${Date.now()}-${filename}`;

    const { data, error } = await serviceClient.storage
      .from("course-sources")
      .createSignedUploadUrl(filePath);

    if (error || !data) {
      return json({ error: `Erro ao criar URL de upload: ${error?.message}` }, 500);
    }

    return json({ signed_url: data.signedUrl, file_path: filePath });
  } catch (err: any) {
    console.error("[get-upload-url] Error:", err);
    return json({ error: err.message || "Erro interno" }, 500);
  }
});
