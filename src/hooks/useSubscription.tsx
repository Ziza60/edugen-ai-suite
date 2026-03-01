import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type PlanType = "free" | "pro";

export interface PlanLimits {
  maxCourses: number;
  maxModules: number;
  images: boolean;
  pdfExport: boolean;
  customCertificate: boolean;
}

const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxCourses: 1,
    maxModules: 5,
    images: false,
    pdfExport: false,
    customCertificate: false,
  },
  pro: {
    maxCourses: 5,
    maxModules: 10,
    images: true,
    pdfExport: true,
    customCertificate: true,
  },
};

export function useSubscription() {
  const { user } = useAuth();

  const { data: subscription, isLoading } = useQuery({
    queryKey: ["subscription", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const plan: PlanType = (subscription?.plan as PlanType) ?? "free";
  const limits = PLAN_LIMITS[plan];

  return { subscription, plan, limits, isLoading };
}

export function useMonthlyUsage() {
  const { user } = useAuth();

  const { data: usage = 0, isLoading } = useQuery({
    queryKey: ["monthly-usage", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count, error } = await supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("event_type", "course_created")
        .gte("created_at", startOfMonth);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });

  return { usage, isLoading };
}
