import { useMemo } from "react";

const TEMPLATE_FONTS: Record<string, { heading: string; body: string }> = {
  default:   { heading: "'Montserrat', sans-serif",       body: "'Open Sans', sans-serif" },
  academic:  { heading: "'Times New Roman', 'Georgia', serif", body: "'Arial', sans-serif" },
  corporate: { heading: "'Montserrat', sans-serif",       body: "'Open Sans', sans-serif" },
  creative:  { heading: "'Playfair Display', 'Georgia', serif", body: "'Lato', sans-serif" },
};

interface SlidePreviewProps {
  previewColors: string[];
  theme: "light" | "dark";
  courseType: string;
  footerBrand: string | null;
  template?: string;
}

export function SlidePreview({ previewColors, theme, courseType, footerBrand, template = "default" }: SlidePreviewProps) {
  const colors = useMemo(() => {
    const bg       = theme === "dark" ? "#0C1322" : "#F7F8FC";
    const bgCard   = theme === "dark" ? "#141E34" : "#FFFFFF";
    const coverBg  = "#050A18";
    const textColor= theme === "dark" ? "#E8EDF5" : "#0F172A";
    const mutedText= theme === "dark" ? "#64748B" : "#94A3B8";
    const accent   = previewColors[0] || "#6C63FF";
    const accent2  = previewColors[1] || "#3B82F6";
    const accent3  = previewColors[2] || "#10B981";
    const accent4  = previewColors[3] || "#F59E0B";
    const panelMid = "#111D38";
    return { bg, bgCard, coverBg, textColor, mutedText, accent, accent2, accent3, accent4, panelMid };
  }, [previewColors, theme]);

  const fonts = TEMPLATE_FONTS[template] || TEMPLATE_FONTS.default;
  const brand = footerBrand || "EduGenAI";
  const W = 220; // slide width in px

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1"
      title="Pré-visualização aproximada — o arquivo final pode variar"
    >
      {/* ── Slide 1: Cover ── */}
      <div
        className="shrink-0 rounded overflow-hidden relative"
        style={{ width: W, aspectRatio: "16/9", backgroundColor: colors.coverBg }}
      >
        <div className="absolute left-0 top-0 bottom-0" style={{ width: 7, backgroundColor: colors.accent }} />
        <div
          className="absolute"
          style={{
            top: 10, left: 18,
            fontSize: 6, fontWeight: 700, letterSpacing: 2,
            color: colors.accent,
            fontFamily: fonts.heading,
          }}
        >
          {courseType}
        </div>
        <div
          className="absolute"
          style={{
            top: "34%", left: 18, right: 24,
            fontSize: 14, fontWeight: 700, lineHeight: 1.25,
            color: "#FFFFFF",
            fontFamily: fonts.heading,
          }}
        >
          Título do Curso
        </div>
        <div
          className="absolute"
          style={{
            top: "60%", left: 18,
            width: "40%", height: 1,
            backgroundColor: colors.accent,
          }}
        />
        <div
          className="absolute"
          style={{
            top: "66%", left: 18, right: 24,
            fontSize: 7, color: "#94A3B8",
            fontFamily: fonts.body,
          }}
        >
          Subtítulo descritivo do curso
        </div>
        <div
          className="absolute"
          style={{
            bottom: 6, right: 10,
            fontSize: 6, color: "#64748B",
            fontFamily: fonts.body,
          }}
        >
          março de 2026
        </div>
        <div
          className="absolute"
          style={{
            right: 0, top: 0, bottom: 0, width: "35%",
            background: `linear-gradient(135deg, transparent 0%, ${colors.accent}15 100%)`,
          }}
        />
      </div>

      {/* ── Slide 2: Bullets Content ── */}
      <div
        className="shrink-0 rounded overflow-hidden relative"
        style={{ width: W, aspectRatio: "16/9", backgroundColor: colors.bg }}
      >
        <div className="absolute left-0 top-0 bottom-0" style={{ width: 5, backgroundColor: colors.accent }} />
        <div
          className="absolute"
          style={{
            top: 8, left: 14,
            fontSize: 6, fontWeight: 700, letterSpacing: 2,
            color: colors.accent,
            fontFamily: fonts.heading,
          }}
        >
          FUNDAMENTOS
        </div>
        <div
          className="absolute"
          style={{
            top: 20, left: 14,
            fontSize: 10, fontWeight: 700,
            color: colors.textColor,
            fontFamily: fonts.heading,
          }}
        >
          Conceitos Principais
        </div>
        {[colors.accent, colors.accent2, colors.accent3].map((c, i) => (
          <div
            key={i}
            className="absolute flex items-center gap-2"
            style={{
              top: 38 + i * 24, left: 14, right: 14,
              height: 18,
              backgroundColor: colors.bgCard,
              borderRadius: 3,
              borderLeft: `3px solid ${c}`,
              padding: "3px 6px",
            }}
          >
            <div
              style={{
                width: 8, height: 8, borderRadius: "50%",
                backgroundColor: c, flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: 6, color: colors.mutedText,
                fontFamily: fonts.body,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {["Conceito fundamental do tema", "Aplicação prática no contexto", "Exemplo de caso real"][i]}
            </div>
          </div>
        ))}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 12 }}>
          <div style={{ height: 0.5, backgroundColor: colors.mutedText, opacity: 0.2, marginLeft: 14, marginRight: 14 }} />
          <div
            className="absolute"
            style={{
              bottom: 3, right: 10,
              fontSize: 5, color: colors.mutedText, opacity: 0.6,
              fontFamily: fonts.body,
            }}
          >
            {brand}
          </div>
        </div>
      </div>

      {/* ── Slide 3: Process Timeline ── */}
      <div
        className="shrink-0 rounded overflow-hidden relative"
        style={{ width: W, aspectRatio: "16/9", backgroundColor: colors.coverBg }}
      >
        <div
          className="absolute"
          style={{
            top: 8, left: 12,
            fontSize: 6, fontWeight: 700, letterSpacing: 1.5,
            color: colors.accent,
            fontFamily: fonts.heading,
          }}
        >
          COMO FUNCIONA
        </div>
        <div
          className="absolute"
          style={{
            top: 19, left: 12,
            fontSize: 10, fontWeight: 700,
            color: "#FFFFFF",
            fontFamily: fonts.heading,
          }}
        >
          Processo
        </div>
        <div
          className="absolute flex items-center"
          style={{ top: 38, left: 10, right: 10, bottom: 10, gap: 4 }}
        >
          {[colors.accent, colors.accent2, colors.accent3, colors.accent4].map((c, i) => (
            <div key={i} className="flex items-center" style={{ flex: 1, minWidth: 0 }}>
              <div
                className="relative flex flex-col"
                style={{
                  flex: 1, minWidth: 0,
                  backgroundColor: colors.panelMid,
                  borderRadius: 3,
                  height: "100%",
                  overflow: "hidden",
                }}
              >
                <div style={{ height: 2, backgroundColor: c, flexShrink: 0 }} />
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 12, height: 12, borderRadius: 2,
                    backgroundColor: c,
                    margin: "5px auto 3px",
                    fontSize: 6, fontWeight: 700, color: "#FFFFFF",
                    lineHeight: 1,
                    fontFamily: fonts.heading,
                  }}
                >
                  {i + 1}
                </div>
                <div className="flex flex-col gap-1 px-1.5" style={{ marginTop: 2 }}>
                  <div style={{ height: 2, width: "85%", borderRadius: 1, backgroundColor: "#64748B", opacity: 0.4 }} />
                  <div style={{ height: 2, width: "65%", borderRadius: 1, backgroundColor: "#64748B", opacity: 0.25 }} />
                </div>
              </div>
              {i < 3 && (
                <span style={{ fontSize: 7, color: colors.accent, margin: "0 1px", flexShrink: 0 }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
