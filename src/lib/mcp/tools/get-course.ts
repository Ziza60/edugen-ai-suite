import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_course",
  title: "Get course",
  description: "Fetch a course with its modules for the signed-in user.",
  inputSchema: {
    course_id: z.string().uuid().describe("UUID of the course to load."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ course_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data: course, error: cErr } = await sb
      .from("courses")
      .select("id, title, description, status, created_at, updated_at, user_id")
      .eq("id", course_id)
      .maybeSingle();
    if (cErr) return { content: [{ type: "text", text: cErr.message }], isError: true };
    if (!course) return { content: [{ type: "text", text: "Course not found" }], isError: true };

    const { data: modules, error: mErr } = await sb
      .from("course_modules")
      .select("id, title, content, order_index")
      .eq("course_id", course_id)
      .order("order_index", { ascending: true });
    if (mErr) return { content: [{ type: "text", text: mErr.message }], isError: true };

    const payload = { course, modules: modules ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
