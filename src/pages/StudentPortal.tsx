import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, BookOpen } from "lucide-react";
import { StudentPortalView, type PortalData } from "@/components/course/StudentPortalView";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── Route wrapper for the public student portal (`/learn/:slug`) ──────────
// Fetches portal data by slug and renders the shared `StudentPortalView`,
// the same component used for the "Visualizar como Aluno" preview inside
// the course editor — so real students and creator previews always match.
export default function StudentPortal() {
  const { slug } = useParams<{ slug: string }>();

  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["portal", slug],
    queryFn: async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-course-portal?slug=${slug}`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) throw new Error("Portal não encontrado");
      return res.json();
    },
    enabled: !!slug,
  });

  if (isLoading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-center px-4">
      <div>
        <BookOpen className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Portal não encontrado</h1>
        <p className="text-slate-500">Verifique o link ou entre em contato com o instrutor.</p>
      </div>
    </div>
  );

  return <StudentPortalView data={data} exitHref={`/c/${slug}`} />;
}
