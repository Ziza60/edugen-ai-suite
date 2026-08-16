import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    // O serviço de PDF em Puppeteer roda como processo separado, na 8080. Sem
    // este proxy o front chamaria uma origem diferente e esbarraria em CORS.
    proxy: {
      "/api/pdf": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pdf/, ""),
      },
    },
    // A lista de ignorados fica como está: o workspace do Replit havia
    // encurtado para dois itens, e vigiar supabase/functions faz o dev server
    // recarregar a cada mexida em edge function, que nem é servida por ele.
    watch: {
      ignored: [
        "**/.cache/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/supabase/functions/**",
      ],
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
