import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SlideLogEntry {
  "#": number;
  fn: string;
  variant?: string;
  items?: number;
  title?: string;
  theme?: string;
  template?: string;
  [key: string]: unknown;
}

const FN_COLORS: Record<string, string> = {
  bullets: "bg-blue-600",
  twoColumn: "bg-purple-600",
  gridCards: "bg-green-600",
  moduleCover: "bg-orange-500",
  cover: "bg-pink-600",
  toc: "bg-yellow-500",
  closing: "bg-gray-500",
  processTimeline: "bg-cyan-600",
  summarySlide: "bg-teal-600",
  numberedTakeaways: "bg-indigo-600",
  comparisonTable: "bg-red-600",
  exampleHighlight: "bg-amber-500",
  warningCallout: "bg-rose-600",
  reflectionCallout: "bg-violet-600",
  codeBlock: "bg-zinc-600",
};

const VARIANT_COLORS: Record<string, string> = {
  SplitScreen: "bg-sky-500",
  IndexTab: "bg-emerald-500",
  CapCards: "bg-violet-500",
  Spotlight: "bg-amber-500",
};

export default function PptxDebug() {
  const [log, setLog] = useState<SlideLogEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("pptx_slide_log");
      if (stored) setLog(JSON.parse(stored));
    } catch {}
  }, []);

  const reload = () => {
    try {
      const stored = localStorage.getItem("pptx_slide_log");
      if (stored) setLog(JSON.parse(stored));
    } catch {}
  };

  const clear = () => {
    localStorage.removeItem("pptx_slide_log");
    setLog([]);
  };

  const filtered = filter
    ? log.filter(e =>
        e.fn?.includes(filter) ||
        e.variant?.includes(filter) ||
        String(e.items) === filter ||
        e.title?.toLowerCase().includes(filter.toLowerCase())
      )
    : log;

  const bulletSlides = log.filter(e => e.fn === "bullets");
  const byVariant = bulletSlides.reduce<Record<string, number>>((acc, e) => {
    const v = String(e.variant ?? "?");
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
  const singleItemBullets = bulletSlides.filter(e => e.items === 1);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">PPTX Slide Log</h1>
            <p className="text-gray-400 text-sm mt-1">
              Gere um PPTX na plataforma para popular este log.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reload}>Recarregar</Button>
            <Button variant="destructive" size="sm" onClick={clear}>Limpar</Button>
          </div>
        </div>

        {log.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 p-12 text-center text-gray-500">
            Nenhum log disponível. Exporte um PPTX para ver o mapa de slides aqui.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <div className="text-3xl font-bold text-white">{log.length}</div>
                <div className="text-gray-400 text-sm">Total de slides</div>
              </div>
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <div className="text-3xl font-bold text-white">{bulletSlides.length}</div>
                <div className="text-gray-400 text-sm">Bullet slides</div>
              </div>
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <div className="text-3xl font-bold text-amber-400">{singleItemBullets.length}</div>
                <div className="text-gray-400 text-sm">Slides com 1 item ⚠️</div>
              </div>
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(byVariant).map(([v, count]) => (
                    <span key={v} className={`text-xs text-white px-2 py-0.5 rounded ${VARIANT_COLORS[v] ?? "bg-gray-600"}`}>
                      {v}: {count}
                    </span>
                  ))}
                </div>
                <div className="text-gray-400 text-sm mt-1">Variantes</div>
              </div>
            </div>

            <div className="mb-4">
              <input
                type="text"
                placeholder="Filtrar por tipo, variante, número de items ou título..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="rounded-lg border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 border-b border-gray-800">
                    <th className="px-3 py-2 text-left text-gray-400 font-medium w-12">#</th>
                    <th className="px-3 py-2 text-left text-gray-400 font-medium">Tipo</th>
                    <th className="px-3 py-2 text-left text-gray-400 font-medium">Variante</th>
                    <th className="px-3 py-2 text-left text-gray-400 font-medium w-14">Items</th>
                    <th className="px-3 py-2 text-left text-gray-400 font-medium">Título</th>
                    <th className="px-3 py-2 text-left text-gray-400 font-medium w-20">Tema</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry, i) => {
                    const isOdd = i % 2 === 0;
                    const isSingleItem = entry.fn === "bullets" && entry.items === 1;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-gray-800/50 ${isOdd ? "bg-gray-900/40" : ""} ${isSingleItem ? "bg-amber-950/30" : ""}`}
                      >
                        <td className="px-3 py-1.5 text-gray-500 font-mono text-xs">{String(entry["#"]).padStart(2, "0")}</td>
                        <td className="px-3 py-1.5">
                          <span className={`text-xs text-white px-2 py-0.5 rounded font-mono ${FN_COLORS[entry.fn] ?? "bg-gray-600"}`}>
                            {entry.fn}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {entry.variant ? (
                            <span className={`text-xs text-white px-2 py-0.5 rounded ${VARIANT_COLORS[entry.variant as string] ?? "bg-gray-600"}`}>
                              {entry.variant}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {entry.items !== undefined ? (
                            <span className={`font-mono font-bold ${entry.items === 1 ? "text-amber-400" : entry.items && entry.items >= 5 ? "text-red-400" : "text-gray-300"}`}>
                              {entry.items}
                              {entry.items === 1 && " ⚠️"}
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-300 max-w-xs truncate text-xs">{entry.title ?? ""}</td>
                        <td className="px-3 py-1.5">
                          {entry.theme ? (
                            <Badge variant={entry.theme === "dark" ? "secondary" : "outline"} className="text-xs">
                              {entry.theme as string}
                            </Badge>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {singleItemBullets.length > 0 && (
              <div className="mt-4 p-4 bg-amber-950/40 border border-amber-800/50 rounded-lg">
                <h3 className="text-amber-400 font-semibold mb-2">⚠️ Slides com 1 item ({singleItemBullets.length})</h3>
                <p className="text-amber-200/70 text-sm mb-2">
                  Estes slides usam o card expandido (altura total). Verifique se o visual está correto.
                </p>
                <div className="flex flex-wrap gap-2">
                  {singleItemBullets.map((e, i) => (
                    <span key={i} className="text-xs bg-amber-900/50 text-amber-200 px-2 py-1 rounded font-mono">
                      #{String(e["#"]).padStart(2,"0")} {e.variant} — {e.title?.slice(0,30)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
