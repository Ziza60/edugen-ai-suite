import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const rootElement = document.getElementById("root")!;

// Guard against missing env vars (transient Vite issue)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (!supabaseUrl) {
  console.error("[EduGen] VITE_SUPABASE_URL not available — retrying in 1s");
  rootElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888">Carregando...</div>';
  setTimeout(() => window.location.reload(), 1500);
} else {
  createRoot(rootElement).render(<App />);
}
