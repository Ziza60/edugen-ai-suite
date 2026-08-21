import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // As Edge Functions importam do runtime do Deno (`jsr:`, `https://esm.sh/`),
      // endereços que o Vite não resolve — o course-pipeline inteiro ficava fora
      // do alcance dos testes por causa de duas linhas de import no topo. Aqui
      // elas apontam para um stub e a lógica desses módulos vira testável.
      "jsr:@supabase/functions-js/edge-runtime.d.ts": path.resolve(
        __dirname,
        "./src/test/stubs/deno-edge.ts",
      ),
      "https://esm.sh/@supabase/supabase-js@2": path.resolve(
        __dirname,
        "./src/test/stubs/deno-edge.ts",
      ),
    },
  },
});
