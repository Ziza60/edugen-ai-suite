import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const LOAD_TIMEOUT_MS = 12000;

const fallbackStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "32px",
    fontFamily: "'Inter', system-ui, sans-serif",
    textAlign: "center",
    background: "linear-gradient(135deg, #0C1322 0%, #141E34 100%)",
    color: "#E8EDF5",
  },
  icon: { fontSize: "40px", lineHeight: 1 },
  title: { fontSize: "22px", fontWeight: 700, margin: 0 },
  msg: { fontSize: "14px", margin: 0, opacity: 0.7, maxWidth: 420 },
  btn: {
    marginTop: "8px",
    padding: "10px 24px",
    borderRadius: "8px",
    border: "none",
    background: "#6C63FF",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent",
    color: "#94A3B8",
    fontSize: "13px",
    cursor: "pointer",
  },
};

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; timedOut: boolean }
> {
  state = { hasError: false, message: "", timedOut: false };
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Erro inesperado ao carregar a aplicação.",
    };
  }

  componentDidMount() {
    this.mounted = true;
    this.timerId = setTimeout(() => {
      if (this.mounted && !this.state.hasError) {
        const appRoot = document.getElementById("root");
        const hasContent = appRoot && appRoot.children.length > 0 &&
          appRoot.innerHTML.length > 200;
        if (!hasContent) {
          this.setState({
            timedOut: true,
            hasError: true,
            message: "O app demorou demais para carregar. Isso pode ser um problema temporário.",
          });
        }
      }
    }, LOAD_TIMEOUT_MS);
  }

  componentDidUpdate() {
    // Cancel timeout if app rendered successfully
    if (!this.state.hasError && this.timerId) {
      const appRoot = document.getElementById("root");
      if (appRoot && appRoot.innerHTML.length > 200) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
    }
  }

  componentWillUnmount() {
    this.mounted = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error("[RootErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={fallbackStyles.wrapper}>
          <div style={fallbackStyles.icon}>⚠️</div>
          <h1 style={fallbackStyles.title}>
            {this.state.timedOut ? "Carregamento lento" : "Falha ao carregar o app"}
          </h1>
          <p style={fallbackStyles.msg}>{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={fallbackStyles.btn}
          >
            🔄 Recarregar página
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = window.location.origin + window.location.pathname;
            }}
            style={fallbackStyles.btnSecondary}
          >
            Limpar cache e recarregar
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
