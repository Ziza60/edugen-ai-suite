import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { XCircle, Lightbulb, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface Dimension {
  score: number;
  label: string;
  description: string;
  icon: string;
}

interface EduScoreData {
  course_title: string;
  overall_score: number;
  dimensions: {
    clareza: Dimension;
    completude: Dimension;
    engajamento: Dimension;
    equilibrio: Dimension;
  };
  module_details: {
    module: number;
    title: string;
    sectionsFound: number;
    totalSections: number;
    missingSections: string[];
  }[];
  suggestions: string[];
  modules_count: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

function getScoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 60) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bom";
  if (score >= 60) return "Regular";
  if (score >= 40) return "Precisa melhorar";
  return "Crítico";
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="text-muted/30"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold ${getScoreColor(score)}`}>{score}</span>
      </div>
    </div>
  );
}

function DimensionBar({ dimension }: { dimension: Dimension }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <span>{dimension.icon}</span>
          {dimension.label}
        </span>
        <span className={`text-xs font-bold ${getScoreColor(dimension.score)}`}>
          {dimension.score}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            backgroundColor:
              dimension.score >= 80 ? "#10b981" : dimension.score >= 60 ? "#f59e0b" : "#ef4444",
          }}
          initial={{ width: 0 }}
          animate={{ width: `${dimension.score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">{dimension.description}</p>
    </div>
  );
}

export function EduScorePanel({
  data,
  onClose,
}: {
  data: EduScoreData;
  onClose: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const dims = data.dimensions;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[1400px] mx-auto w-full px-6 py-4 border-b border-border bg-card"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <ScoreRing score={data.overall_score} />
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              EduScore™
              <Badge
                variant="outline"
                className={`text-[10px] ${getScoreBg(data.overall_score)}`}
              >
                {getScoreLabel(data.overall_score)}
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.modules_count} módulos analisados
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
          <XCircle className="h-3.5 w-3.5 mr-1" /> Fechar
        </Button>
      </div>

      {/* Dimensions grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <DimensionBar dimension={dims.clareza} />
        <DimensionBar dimension={dims.completude} />
        <DimensionBar dimension={dims.engajamento} />
        <DimensionBar dimension={dims.equilibrio} />
      </div>

      {/* Suggestions */}
      {data.suggestions.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 mb-3">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            Sugestões de melhoria
          </p>
          <ul className="space-y-1">
            {data.suggestions.map((s, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <TrendingUp className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Module details toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-7"
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
        {showDetails ? "Ocultar detalhes" : "Ver detalhes por módulo"}
      </Button>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mt-2"
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.module_details.map((m) => {
                const pct = Math.round((m.sectionsFound / m.totalSections) * 100);
                return (
                  <div
                    key={m.module}
                    className={`rounded-lg border p-3 text-xs ${getScoreBg(pct)}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-foreground">Módulo {m.module}</span>
                      <span className={`font-bold ${getScoreColor(pct)}`}>{pct}%</span>
                    </div>
                    <p className="text-muted-foreground truncate mb-1">{m.title}</p>
                    <p className="text-muted-foreground">
                      {m.sectionsFound}/{m.totalSections} seções
                    </p>
                    {m.missingSections.length > 0 && m.missingSections.length <= 3 && (
                      <p className="text-red-400 mt-1 truncate">
                        Falta: {m.missingSections.map((s) => s.split(" ")[0]).join(" ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
