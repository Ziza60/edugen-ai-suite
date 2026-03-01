import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useDevMode() {
  const { user } = useAuth();

  const { data: isDev = false, isLoading } = useQuery({
    queryKey: ["dev-mode", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("profiles")
        .select("is_dev")
        .eq("user_id", user.id)
        .single();
      if (error) return false;
      return data?.is_dev === true;
    },
    enabled: !!user,
  });

  return { isDev, isLoading };
}
