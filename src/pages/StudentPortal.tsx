import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  BookOpen, CheckCircle, Circle, ChevronRight, ChevronLeft,
  Award, Menu, X, RotateCcw, Loader2, Sparkles, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── Types ────────────────────────────────────────────────────────────
interface QuizQuestion {
  id: string;
  module_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}
interface Flashcard { id: string; module_id: string; front: string; back: string; }
interface Module {
  id: string; title: string; content: string; order_index: number;
  quizQuestions: QuizQuestion[]; flashcards: Flashcard[];
}
interface PortalData {
  courseId: string; courseTitle: string; description: string;
  instructorName: string | null; primaryColor: string;
  logoUrl: string | null; modules: Module[];
}
interface Progress { completedModules: string[]; lastModuleId: string | null; }

// ── Markdown renderer ─────────────────────────────────────────────────
function inlineMd(text: string): (string | JSX.Element)[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*"))
      return <em key={i} className="italic">{p.slice(1, -1)}</em>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="bg-slate-800 text-blue-300 px-1.5 py-0.5 rounded text-sm font-mono">{p.slice(1, -1)}</code>;
    return p;
  });
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const els: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("### ")) {
      els.push(<h3 key={i} className="text-lg font-semibold mt-6 mb-2 text-white">{inlineMd(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      els.push(<h2 key={i} className="text-xl font-bold mt-8 mb-3 text-white">{inlineMd(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      els.push(<h1 key={i} className="text-2xl font-bold mt-8 mb-4 text-white">{inlineMd(line.slice(2))}</h1>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        items.push(lines[i].slice(2)); i++;
      }
      els.push(<ul key={`ul${i}`} className="list-disc list-inside space-y-1 my-3 text-slate-300 ml-2">{items.map((t, j) => <li key={j}>{inlineMd(t)}</li>)}</ul>);
      continue;
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, "")); i++;
      }
      els.push(<ol key={`ol${i}`} className="list-decimal list-inside space-y-1 my-3 text-slate-300 ml-2">{items.map((t, j) => <li key={j}>{inlineMd(t)}</li>)}</ol>);
      continue;
    } else if (line.startsWith("```")) {
      const codeLines: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      els.push(<pre key={`code${i}`} className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 my-4 overflow-x-auto"><code className="text-slate-300 text-sm font-mono">{codeLines.join("\n")}</code></pre>);
    } else if (line.startsWith(">")) {
      els.push(<blockquote key={i} className="border-l-4 border-purple-500 pl-4 my-3 text-slate-400 italic">{inlineMd(line.slice(1).trim())}</blockquote>);
    } else {
      els.push(<p key={i} className="text-slate-300 leading-relaxed mb-3">{inlineMd(line)}</p>);
    }
    i++;
  }
  return <div>{els}</div>;
}

// ── Flashcard flip component ──────────────────────────────────────────
function FlashcardPlayer({ cards }: { cards: Flashcard[] }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (!cards.length) return null;
  const card = cards[idx];
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-sm text-slate-500">{idx + 1} / {cards.length}</div>
      <div
        className="relative w-full max-w-lg cursor-pointer select-none"
        style={{ perspective: 1200, height: 180 }}
        onClick={() => setFlipped(f => !f)}
        data-testid="flashcard-flip"
      >
        <motion.div
          className="w-full h-full relative"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          style={{ transformStyle: "preserve-3d" }}
        >
          <div className="absolute inset-0 bg-[#1c2128] border border-[#30363d] rounded-2xl p-6 flex flex-col items-center justify-center" style={{ backfaceVisibility: "hidden" }}>
            <div className="text-xs text-purple-400 font-semibold mb-3 tracking-widest uppercase">Pergunta</div>
            <p className="text-white text-center font-medium text-lg leading-relaxed">{card.front}</p>
            <p className="text-slate-600 text-xs mt-4">Clique para revelar</p>
          </div>
          <div className="absolute inset-0 bg-[#1c2128] border border-purple-500/40 rounded-2xl p-6 flex flex-col items-center justify-center" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
            <div className="text-xs text-green-400 font-semibold mb-3 tracking-widest uppercase">Resposta</div>
            <p className="text-white text-center leading-relaxed">{card.back}</p>
          </div>
        </motion.div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" disabled={idx === 0} onClick={() => { setFlipped(false); setTimeout(() => setIdx(i => i - 1), 150); }} data-testid="flashcard-prev"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => { setFlipped(false); setIdx(0); }} data-testid="flashcard-reset"><RotateCcw className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" disabled={idx === cards.length - 1} onClick={() => { setFlipped(false); setTimeout(() => setIdx(i => i + 1), 150); }} data-testid="flashcard-next"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

// ── Quiz component ─────────────────────────────────────────────────────
function QuizPlayer({ questions, moduleId }: { questions: QuizQuestion[]; moduleId: string }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  if (!questions.length) return null;
  const score = submitted ? questions.filter((q, i) => answers[i] === q.correct_answer).length : 0;
  return (
    <div className="space-y-6">
      {questions.map((q, qi) => (
        <div key={q.id} className="space-y-3">
          <p className="text-white font-medium">{qi + 1}. {q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const isSelected = answers[qi] === oi;
              const isCorrect = submitted && oi === q.correct_answer;
              const isWrong = submitted && isSelected && oi !== q.correct_answer;
              return (
                <button
                  key={oi}
                  disabled={submitted}
                  onClick={() => setAnswers(a => ({ ...a, [qi]: oi }))}
                  data-testid={`quiz-option-${qi}-${oi}`}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                    isCorrect ? "border-green-500 bg-green-500/10 text-green-300" :
                    isWrong ? "border-red-500 bg-red-500/10 text-red-300" :
                    isSelected ? "border-purple-500 bg-purple-500/10 text-white" :
                    "border-[#30363d] bg-[#1c2128] text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {submitted && q.explanation && (
            <p className="text-sm text-slate-400 bg-[#161b22] rounded-xl px-4 py-2 border border-[#30363d]">💡 {q.explanation}</p>
          )}
        </div>
      ))}
      {!submitted ? (
        <Button
          onClick={() => setSubmitted(true)}
          disabled={Object.keys(answers).length < questions.length}
          className="bg-purple-600 hover:bg-purple-700 text-white"
          data-testid="quiz-submit"
        >
          Ver resultado
        </Button>
      ) : (
        <div className="flex items-center gap-3 bg-[#1c2128] border border-[#30363d] rounded-xl px-4 py-3">
          <span className="text-2xl font-bold text-white">{score}/{questions.length}</span>
          <span className="text-slate-400 text-sm">{score === questions.length ? "🎉 Perfeito!" : score >= questions.length / 2 ? "✅ Boa!" : "📚 Continue estudando"}</span>
        </div>
      )}
    </div>
  );
}

// ── Certificate modal ─────────────────────────────────────────────────
function CertModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const mutation = useMutation({
    mutationFn: async (studentName: string) => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-course-portal`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, studentName }),
      });
      if (!res.ok) throw new Error("Erro ao gerar certificado");
      return res.json();
    },
    onSuccess: (data) => { navigate(`/certificate/${data.token}`); },
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center mb-6">
          <div className="h-16 w-16 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
            <Award className="h-8 w-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Gerar Certificado</h2>
          <p className="text-slate-400 text-sm mt-1">Parabéns por concluir o curso!</p>
        </div>
        <label className="block text-sm text-slate-400 mb-1">Seu nome completo</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ex: Maria da Silva"
          data-testid="cert-name-input"
          className="w-full bg-[#161b22] border border-[#30363d] text-white rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-purple-500"
        />
        {mutation.error && <p className="text-red-400 text-sm mb-3">{(mutation.error as Error).message}</p>}
        <Button
          className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold"
          disabled={!name.trim() || mutation.isPending}
          onClick={() => mutation.mutate(name)}
          data-testid="cert-generate-btn"
        >
          {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Gerando...</> : "🎓 Gerar meu certificado"}
        </Button>
      </motion.div>
    </div>
  );
}

// ── Main portal ───────────────────────────────────────────────────────
export default function StudentPortal() {
  const { slug } = useParams<{ slug: string }>();
  const [moduleIdx, setModuleIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);

  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["portal", slug],
    queryFn: async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-course-portal?slug=${slug}`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) throw new Error("Portal não encontrado");
      return res.json();
    },
    enabled: !!slug,
  });

  // Persist progress in localStorage
  useEffect(() => {
    if (!data) return;
    const key = `portal_progress_${data.courseId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const p: Progress = JSON.parse(saved);
        setCompleted(new Set(p.completedModules));
        if (p.lastModuleId) {
          const idx = data.modules.findIndex(m => m.id === p.lastModuleId);
          if (idx !== -1) setModuleIdx(idx);
        }
      } catch {}
    }
  }, [data]);

  const saveProgress = useCallback((completedSet: Set<string>, currentModId: string, modules: Module[]) => {
    const courseId = data?.courseId;
    if (!courseId) return;
    localStorage.setItem(`portal_progress_${courseId}`, JSON.stringify({
      completedModules: [...completedSet],
      lastModuleId: currentModId,
    }));
  }, [data]);

  const markComplete = useCallback((modId: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.add(modId);
      if (data) saveProgress(next, modId, data.modules);
      return next;
    });
  }, [data, saveProgress]);

  const goToModule = (idx: number) => {
    setModuleIdx(idx);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (data) saveProgress(completed, data.modules[idx].id, data.modules);
  };

  if (isLoading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-center px-4">
      <div>
        <BookOpen className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Portal não encontrado</h1>
        <p className="text-slate-500">Verifique o link ou entre em contato com o instrutor.</p>
      </div>
    </div>
  );

  const modules = data.modules;
  const module = modules[moduleIdx];
  const isAllDone = modules.every(m => completed.has(m.id));
  const progressPct = modules.length ? Math.round((completed.size / modules.length) * 100) : 0;
  const accent = data.primaryColor;

  const Sidebar = (
    <nav className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-[#30363d]">
        <div className="flex items-center gap-2 mb-3">
          {data.logoUrl ? (
            <img src={data.logoUrl} alt="Logo" className="h-7 w-auto" />
          ) : (
            <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent }}>
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
          )}
          <span className="font-bold text-white text-sm truncate">{data.courseTitle}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{completed.size}/{modules.length} concluídos</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-[#30363d] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: accent }}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>
      </div>
      <div className="flex-1 p-3 space-y-1">
        {modules.map((m, i) => {
          const isDone = completed.has(m.id);
          const isCurrent = i === moduleIdx;
          return (
            <button
              key={m.id}
              onClick={() => goToModule(i)}
              data-testid={`sidebar-module-${i}`}
              className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all text-sm group ${
                isCurrent ? "bg-white/8 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {isDone
                  ? <CheckCircle className="h-4 w-4" style={{ color: accent }} />
                  : isCurrent
                  ? <Circle className="h-4 w-4 text-white" />
                  : <Circle className="h-4 w-4 text-slate-600" />}
              </span>
              <span className="leading-snug">{m.title}</span>
            </button>
          );
        })}
      </div>
      <div className="p-3 border-t border-[#30363d]">
        <Button
          className="w-full font-semibold text-black"
          style={{ backgroundColor: isAllDone ? "#eab308" : "#374151" }}
          disabled={!isAllDone}
          onClick={() => setCertOpen(true)}
          data-testid="cert-btn"
        >
          <Award className="h-4 w-4 mr-2" />
          {isAllDone ? "Gerar Certificado 🎓" : `Certificado (${modules.length - completed.size} restantes)`}
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-40 bg-[#161b22] border-b border-[#30363d] h-14 flex items-center px-4 gap-3">
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 text-slate-400"
          data-testid="sidebar-toggle"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <a href={`/c/${slug}`} className="text-slate-500 hover:text-white transition-colors hidden sm:flex items-center gap-1.5 text-sm">
          <ArrowLeft className="h-3.5 w-3.5" />
          Página do curso
        </a>
        <div className="h-4 w-px bg-[#30363d] hidden sm:block" />
        <span className="font-semibold text-white text-sm truncate flex-1">{data.courseTitle}</span>
        <div className="hidden md:flex items-center gap-2">
          <div className="h-1.5 w-32 bg-[#30363d] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPct}%`, backgroundColor: accent }} />
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{progressPct}%</span>
        </div>
      </header>

      <div className="flex flex-1 relative">
        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar — desktop always visible, mobile slide-over */}
        <aside className={`
          fixed lg:sticky top-14 z-30 h-[calc(100vh-3.5rem)]
          w-72 bg-[#161b22] border-r border-[#30363d] shrink-0
          transition-transform duration-300 lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          {Sidebar}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 lg:ml-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={module.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="max-w-3xl mx-auto px-4 sm:px-8 py-10"
            >
              {/* Module header */}
              <div className="mb-8">
                <div className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: accent }}>
                  Módulo {moduleIdx + 1} de {modules.length}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{module.title}</h1>
              </div>

              {/* Content */}
              <div className="prose-portal">
                <MarkdownContent text={module.content || "Conteúdo em breve."} />
              </div>

              {/* Flashcards */}
              {module.flashcards.length > 0 && (
                <section className="mt-12">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="h-px flex-1 bg-[#30363d]" />
                    <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase px-3">
                      🃏 Flashcards · {module.flashcards.length} cartões
                    </span>
                    <div className="h-px flex-1 bg-[#30363d]" />
                  </div>
                  <FlashcardPlayer cards={module.flashcards} />
                </section>
              )}

              {/* Quiz */}
              {module.quizQuestions.length > 0 && (
                <section className="mt-12">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="h-px flex-1 bg-[#30363d]" />
                    <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase px-3">
                      ✏️ Quiz · {module.quizQuestions.length} questões
                    </span>
                    <div className="h-px flex-1 bg-[#30363d]" />
                  </div>
                  <QuizPlayer questions={module.quizQuestions} moduleId={module.id} />
                </section>
              )}

              {/* Navigation */}
              <div className="mt-12 pt-8 border-t border-[#30363d] flex items-center justify-between gap-4">
                <Button
                  variant="ghost"
                  className="text-slate-400 hover:text-white"
                  disabled={moduleIdx === 0}
                  onClick={() => goToModule(moduleIdx - 1)}
                  data-testid="prev-module-btn"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <div className="flex gap-3">
                  {!completed.has(module.id) && (
                    <Button
                      variant="outline"
                      className="border-[#30363d] text-slate-300 hover:text-white hover:bg-white/5"
                      onClick={() => markComplete(module.id)}
                      data-testid="complete-module-btn"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Concluir
                    </Button>
                  )}
                  {moduleIdx < modules.length - 1 ? (
                    <Button
                      className="text-white font-semibold"
                      style={{ backgroundColor: accent }}
                      onClick={() => { markComplete(module.id); goToModule(moduleIdx + 1); }}
                      data-testid="next-module-btn"
                    >
                      Próximo módulo
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold"
                      onClick={() => { markComplete(module.id); setCertOpen(true); }}
                      data-testid="finish-btn"
                    >
                      <Award className="h-4 w-4 mr-2" />
                      Concluir curso
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {certOpen && <CertModal courseId={data.courseId} onClose={() => setCertOpen(false)} />}
    </div>
  );
}
