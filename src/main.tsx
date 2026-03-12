import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Erro inesperado ao carregar a aplicação.",
    };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error("[RootErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}>
          <h1 style={{ fontSize: "20px", margin: 0 }}>Falha ao carregar o app</h1>
          <p style={{ margin: 0, opacity: 0.8 }}>{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: "10px 14px", borderRadius: "8px", cursor: "pointer" }}
          >
            Recarregar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
