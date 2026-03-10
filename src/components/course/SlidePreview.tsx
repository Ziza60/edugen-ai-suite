import { useMemo } from "react";

interface SlidePreviewProps {
  previewColors: string[];
  theme: "light" | "dark";
  courseType: string;
  footerBrand: string | null;
}

export function SlidePreview({ previewColors, theme, courseType, footerBrand }: SlidePreviewProps) {
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

  const brand = footerBrand || "EduGenAI";

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      title="Pré-visualização aproximada — o arquivo final pode variar"
    >
      {/* ── Slide 1: Cover ── */}
      <div
        className="shrink-0 rounded overflow-hidden relative"
        style={{ width: 160, aspectRatio: "16/9", backgroundColor: colors.coverBg }}
      >
        {/* Accent left bar */}
        <div className="absolute left-0 top-0 bottom-0" style={{ width: 6, backgroundColor: colors.accent }} />
        {/* Course type label */}
        <div
          className="absolute"
          style={{
            top: 8, left: 14,
            fontSize: 5, fontWeight: 700, letterSpacing: 2,
            color: colors.accent,
          }}
        >
          {courseType}
        </div>
        {/* Title */}
        <div
          className="absolute"
          style={{
            top: "36%", left: 14, right: 20,
            fontSize: 11, fontWeight: 700, lineHeight: 1.2,
            color: "#FFFFFF",
          }}
        >
          Título do Curso
        </div>
        {/* Accent line under title */}
        <div
          className="absolute"
          style={{
            top: "58%", left: 14,
            width: "40%", height: 1,
            backgroundColor: colors.accent,
          }}
        />
        {/* Date bottom right */}
        <div
          className="absolute"
          style={{
            bottom: 5, right: 8,
            fontSize: 5, color: "#64748B",
          }}
        >
          março de 2026
        </div>
        {/* Decorative gradient overlay */}
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
        style={{ width: 160, aspectRatio: "16/9", backgroundColor: colors.bg }}
      >
        {/* Left accent bar */}
        <div className="absolute left-0 top-0 bottom-0" style={{ width: 4, backgroundColor: colors.accent }} />
        {/* Section label */}
        <div
          className="absolute"
          style={{
            top: 6, left: 12,
            fontSize: 5, fontWeight: 700, letterSpacing: 2,
            color: colors.accent,
          }}
        >
          FUNDAMENTOS
        </div>
        {/* Title */}
        <div
          className="absolute"
          style={{
            top: 16, left: 12,
            fontSize: 8, fontWeight: 700,
            color: colors.textColor,
          }}
        >
          Conceitos Principais
        </div>
        {/* 3 bullet cards */}
        {[colors.accent, colors.accent2, colors.accent3].map((c, i) => (
          <div
            key={i}
            className="absolute flex items-center gap-1.5"
            style={{
              top: 30 + i * 18, left: 12, right: 12,
              height: 14,
              backgroundColor: colors.bgCard,
              borderRadius: 2,
              borderLeft: `2px solid ${c}`,
              padding: "2px 4px",
            }}
          >
            <div
              style={{
                width: 6, height: 6, borderRadius: "50%",
                backgroundColor: c, flexShrink: 0,
              }}
            />
            <div
              style={{
                height: 2, width: "70%", borderRadius: 1,
                backgroundColor: colors.mutedText, opacity: 0.4,
              }}
            />
          </div>
        ))}
        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 10 }}>
          <div style={{ height: 0.5, backgroundColor: colors.mutedText, opacity: 0.2, marginLeft: 12, marginRight: 12 }} />
          <div
            className="absolute"
            style={{
              bottom: 2, right: 8,
              fontSize: 4, color: colors.mutedText, opacity: 0.6,
            }}
          >
            {brand}
          </div>
        </div>
      </div>

      {/* ── Slide 3: Process Timeline ── */}
      <div
        className="shrink-0 rounded overflow-hidden relative"
        style={{ width: 160, aspectRatio: "16/9", backgroundColor: colors.coverBg }}
      >
        {/* Label */}
        <div
          className="absolute"
          style={{
            top: 6, left: 10,
            fontSize: 5, fontWeight: 700, letterSpacing: 1.5,
            color: colors.accent,
          }}
        >
          COMO FUNCIONA
        </div>
        {/* Title */}
        <div
          className="absolute"
          style={{
            top: 15, left: 10,
            fontSize: 8, fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Processo
        </div>
        {/* 4 horizontal cards */}
        <div
          className="absolute flex items-center"
          style={{ top: 30, left: 8, right: 8, bottom: 8, gap: 3 }}
        >
          {[colors.accent, colors.accent2, colors.accent3, colors.accent4].map((c, i) => (
            <div key={i} className="flex items-center" style={{ flex: 1, minWidth: 0 }}>
              <div
                className="relative flex flex-col"
                style={{
                  flex: 1, minWidth: 0,
                  backgroundColor: colors.panelMid,
                  borderRadius: 2,
                  height: "100%",
                  overflow: "hidden",
                }}
              >
                {/* Top bar */}
                <div style={{ height: 2, backgroundColor: c, flexShrink: 0 }} />
                {/* Badge */}
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 10, height: 10, borderRadius: 2,
                    backgroundColor: c,
                    margin: "4px auto 2px",
                    fontSize: 5, fontWeight: 700, color: "#FFFFFF",
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </div>
                {/* Text placeholders */}
                <div className="flex flex-col gap-1 px-1" style={{ marginTop: 2 }}>
                  <div style={{ height: 2, width: "80%", borderRadius: 1, backgroundColor: "#64748B", opacity: 0.35 }} />
                  <div style={{ height: 2, width: "60%", borderRadius: 1, backgroundColor: "#64748B", opacity: 0.25 }} />
                </div>
              </div>
              {/* Arrow between cards */}
              {i < 3 && (
                <span style={{ fontSize: 6, color: colors.accent, margin: "0 1px", flexShrink: 0 }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
