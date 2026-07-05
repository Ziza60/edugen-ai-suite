import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { LandingTemplate } from "@/components/course/landing/LandingTemplate";

export default function CourseLanding() {
  const { slug } = useParams<{ slug: string }>();

  const { data: landing, isLoading, error } = useQuery({
    queryKey: ["course-landing", slug],
    queryFn: async () => {
      // Try published first (public access), then owner access (no is_published filter)
      const { data, error } = await (supabase.from("course_landings") as any)
        .select("*, courses(title, description, language)")
        .eq("slug", slug!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });

  // Fetch module titles for the course summary section
  const { data: modules = [] } = useQuery({
    queryKey: ["landing-modules", landing?.course_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_modules")
        .select("title, order_index")
        .eq("course_id", landing.course_id)
        .order("order_index");
      if (error) return [];
      return data;
    },
    enabled: !!landing?.course_id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !landing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Página não encontrada</h1>
          <p className="text-muted-foreground">Este curso não está disponível ou foi removido.</p>
        </div>
      </div>
    );
  }

  return (
    <LandingTemplate
      landing={landing}
      modules={modules as { title: string; order_index?: number }[]}
      slug={slug}
      interactive
    />
  );
}
