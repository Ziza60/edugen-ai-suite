import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCourses from "./tools/list-courses";
import getCourse from "./tools/get-course";
import searchCourses from "./tools/search-courses";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// (see app-mcp-server-authoring). VITE_SUPABASE_PROJECT_ID is inlined by Vite at
// build time, so this stays import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "edugen-ai-mcp",
  title: "EduGen AI",
  version: "0.1.0",
  instructions:
    "Tools for EduGen AI. Use `list_courses` to browse the signed-in user's courses, `search_courses` to find one by keyword, and `get_course` to load a course with its modules.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listCourses, searchCourses, getCourse],
});
