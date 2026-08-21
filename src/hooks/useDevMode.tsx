import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useDevMode() {
  const { user } = useAuth();

  const { data: isDev = false, isLoading } = useQuery({
    queryKey: ["dev-mode", user?.id],
    queryFn: async () => {
      if (!user) return false;
      // `.single()` ESTOURA quando não há linha, e o erro era engolido pelo
      // `return false` logo abaixo — "sem perfil" ficava indistinguível de "não
      // é dev". Foi assim que um perfil ausente passou meses invisível: a conta
      // denisiomp@bol.com.br nunca teve linha em `profiles` (é anterior ao
      // gatilho que os cria), e só apareceu quando o teto mensal de 12 cursos
      // foi atingido pela primeira vez e o `is_dev` que a liberaria não pôde
      // ser lido. `.maybeSingle()` devolve null sem erro, que é o caso real.
      const { data, error } = await supabase
        .from("profiles")
        .select("is_dev")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) {
        console.warn("[useDevMode] não foi possível ler o perfil:", error.message);
        return false;
      }
      // Sem perfil não é erro — é uma conta sem linha em `profiles`. O servidor
      // trata do mesmo jeito (generate-course: maybeSingle, sem perfil = não dev).
      return data?.is_dev === true;
    },
    enabled: !!user,
  });

  return { isDev, isLoading };
}
