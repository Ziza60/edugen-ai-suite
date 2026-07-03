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
  name: "search_courses",
  title: "Search courses",
  description: "Search the signed-in user's courses by title or description.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Text to search in course title/description."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const like = `%${query.replace(/[%_]/g, "")}%`;
    const { data, error } = await sb
      .from("courses")
      .select("id, title, description, status, updated_at")
      .eq("user_id", ctx.getUserId())
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { courses: data },
    };
  },
});
