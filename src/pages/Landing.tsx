import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Brain, FileUp, Target, BarChart3, Pencil, Globe,
  Presentation, GraduationCap, School, Bot, Video, Users,
  Star, FileText, ArrowRight, CheckCircle, Crown, Sparkles,
  BookOpen, Play, X,
} from "lucide-react";

// ── Substitua pela URL do YouTube do seu vídeo demo ──────────────────────────
// Formatos aceitos:
//   https://www.youtube.com/watch?v=XXXXXXXXXXX
//   https://youtu.be/XXXXXXXXXXX
// Deixe em branco ("") para mostrar um placeholder enquanto o vídeo não está pronto.
const DEMO_VIDEO_ID = ""; // ex: "dQw4w9WgXcQ"

const ACCENT = "#DF7C3A";
const GOLD = "#C9A96E";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };

const features = [
  { icon: Brain, title: "Geração por IA", desc: "Tema → curso completo em menos de 2 minutos. Módulos, quizzes e flashcards automáticos.", cat: "Criação", pro: false },
  { icon: FileUp, title: "Fontes próprias", desc: "Envie PDFs, YouTube ou artigos. A IA extrai e estrutura o conteúdo fielmente.", cat: "Criação", pro: true },
  { icon: Target, title: "Templates por nicho", desc: "Onboarding, Vendas, RH, Tech. Estrutura pedagógica pronta para começar.", cat: "Criação", pro: false },
  { icon: BarChart3, title: "EduScore™", desc: "Score de qualidade pedagógica exclusivo. Clareza, completude, engajamento e equilíbrio.", cat: "Qualidade", pro: true },
  { icon: Pencil, title: "Editor rico com IA", desc: "TipTap com toolbar completa. Selecione qualquer trecho e melhore com IA em 1 clique.", cat: "Qualidade", pro: false },
  { icon: Globe, title: "Tradução pedagógica", desc: "Traduz e adapta exemplos culturais para o idioma-alvo. Localização real, não só tradução.", cat: "Qualidade", pro: true },
  { icon: Presentation, title: "PPTX profissional", desc: "Apresentações com design premium, temas, paletas e densidade configurável.", cat: "Distribuição", pro: true },
  { icon: GraduationCap, title: "SCORM para LMS", desc: "Exportação compatível com Moodle, Canvas, Blackboard e qualquer LMS.", cat: "Distribuição", pro: true },
  { icon: School, title: "Moodle XML", desc: "Backup nativo do Moodle com quiz, páginas e flashcards. Sem API, funciona offline.", cat: "Distribuição", pro: true },
  { icon: Bot, title: "Tutor IA para alunos", desc: "Link público com chat IA treinado no seu curso. Alunos perguntam, a IA responde.", cat: "Engajamento", pro: true },
  { icon: Video, title: "Script para vídeo", desc: "Gera roteiro de apresentação oral com marcadores de pausa e ênfases. Exporta em DOCX.", cat: "Engajamento", pro: true },
  { icon: Users, title: "Revisão colaborativa", desc: "Compartilhe o curso para revisores externos deixarem comentários por módulo.", cat: "Engajamento", pro: true },
];

const catColors: Record<string, string> = {
  Criação: "#DF7C3A",
  Qualidade: "#C9A96E",
  Distribuição: "#7B9E87",
  Engajamento: "#A08EC2",
};

const exportFormats = [
  { icon: FileText, label: "PDF" },
  { icon: Presentation, label: "PPTX" },
  { icon: GraduationCap, label: "SCORM" },
  { icon: School, label: "Moodle XML" },
  { icon: BookOpen, label: "Notion" },
  { icon: Video, label: "Script de Vídeo" },
];

const eduScoreDimensions = [
  { label: "Clareza", score: 87, color: "#7B9E87" },
  { label: "Completude", score: 74, color: "#C9A96E" },
  { label: "Engajamento", score: 91, color: "#DF7C3A" },
  { label: "Equilíbrio", score: 68, color: "#A08EC2" },
];

const tutorMessages = [
  { role: "user", text: "O que é aprendizagem assíncrona?" },
  { role: "ai", text: "Aprendizagem assíncrona é quando o aluno estuda no seu próprio ritmo, sem precisar estar online ao mesmo tempo que o instrutor. Exemplos incluem videoaulas gravadas e materiais disponíveis a qualquer hora." },
  { role: "user", text: "Qual a diferença para síncrona?" },
];

const freePlan = ["3 cursos/mês", "Até 5 módulos por curso", "Quiz e flashcards", "Certificados verificáveis", "Exportação PDF"];
const proPlan = [
  "5 cursos/mês",
  "Até 10 módulos por curso",
  "Fontes próprias (PDF, YouTube, web)",
  "PPTX com design premium",
  "SCORM + Moodle + Notion",
  "EduScore™ pedagógico",
  "Tutor IA para alunos",
  "Script para vídeo/narração",
  "Tradução pedagógica",
  "Revisão colaborativa",
  "Analytics do criador",
];

export default function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    if (!document.getElementById("landing-fonts")) {
      const link = document.createElement("link");
      link.id = "landing-fonts";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0B0B0F", color: "#E8E3DC", minHeight: "100vh", overflowX: "hidden" }}>
      {/* grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ opacity: 0.025, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")", backgroundRepeat: "repeat" }}
      />

      {/* ── NAV ── */}
      <header className="sticky top-0 z-50 w-full" style={{ background: "rgba(11,11,15,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(232,227,220,0.06)" }}>
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(223,124,58,0.12)", border: "1px solid rgba(223,124,58,0.2)" }}>
              <GraduationCap className="h-5 w-5" style={{ color: ACCENT }} />
            </div>
            <div>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em", color: "#E8E3DC" }}>EduGen AI</span>
              <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "rgba(201,169,110,0.55)", textTransform: "uppercase", lineHeight: 1, marginTop: "-2px" }}>Motor Pedagógico</div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            {["Funcionalidades", "Planos"].map((item) => (
              <Link key={item} to="/auth"
                style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.45)", fontWeight: 400, letterSpacing: "0.02em", transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#E8E3DC")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,227,220,0.45)")}
              >{item}</Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/auth"
              style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.45)", padding: "0.4rem 1rem", borderRadius: "8px", transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#E8E3DC"; e.currentTarget.style.background = "rgba(232,227,220,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(232,227,220,0.45)"; e.currentTarget.style.background = "transparent"; }}
              className="hidden sm:block"
            >Entrar</Link>
            <Link to="/auth"
              style={{ fontSize: "0.875rem", fontWeight: 500, padding: "0.5rem 1.25rem", borderRadius: "8px", background: ACCENT, color: "#0B0B0F", textDecoration: "none", transition: "opacity 0.2s", letterSpacing: "0.01em" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >Começar agora</Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative container mx-auto px-6 pt-28 pb-36 text-center">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(223,124,58,0.08) 0%, transparent 70%)" }} />
        <motion.div className="relative z-10" variants={stagger} initial="hidden" animate="visible">
          <motion.div variants={fadeUp}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(223,124,58,0.08)", border: "1px solid rgba(223,124,58,0.2)", color: ACCENT, padding: "6px 16px", borderRadius: "100px", fontSize: "0.8125rem", fontWeight: 500, marginBottom: "2.5rem", letterSpacing: "0.02em" }}>
              <Sparkles className="h-3.5 w-3.5" /> Agora com Tutor IA para alunos
            </div>
          </motion.div>

          <motion.h1 variants={fadeUp} style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2.8rem, 6vw, 5rem)", fontWeight: 600, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: "1.5rem", maxWidth: "860px", marginLeft: "auto", marginRight: "auto", color: "#E8E3DC" }}>
            Transforme conteúdos em{" "}
            <em style={{ color: ACCENT, fontStyle: "italic" }}>cursos completos</em>
            , prontos para vender ou treinar equipes
          </motion.h1>

          <motion.p variants={fadeUp} style={{ fontSize: "1.125rem", lineHeight: 1.7, color: "rgba(232,227,220,0.5)", maxWidth: "640px", margin: "0 auto 2.5rem", fontWeight: 300 }}>
            Uma plataforma que transforma conhecimento, PDFs, aulas, vídeos e materiais internos em cursos completos — com aulas, materiais e certificação prontos para uso.
          </motion.p>

          <motion.div variants={fadeUp} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "2.5rem" }}>
            <Link to="/auth"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: ACCENT, color: "#0B0B0F", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 2rem", borderRadius: "8px", letterSpacing: "0.01em", transition: "opacity 0.2s", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >Criar meu primeiro curso <ArrowRight className="h-4 w-4" /></Link>
            <button
              onClick={() => setDemoOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "rgba(232,227,220,0.5)", fontSize: "0.9375rem", padding: "0.75rem 2rem", borderRadius: "8px", border: "1px solid rgba(232,227,220,0.1)", transition: "all 0.2s", background: "transparent", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#E8E3DC"; e.currentTarget.style.borderColor = "rgba(232,227,220,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(232,227,220,0.5)"; e.currentTarget.style.borderColor = "rgba(232,227,220,0.1)"; }}
            ><Play className="h-4 w-4 fill-current" /> Ver demonstração</button>
          </motion.div>

          <motion.div variants={fadeUp} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "0.8125rem", color: "rgba(232,227,220,0.35)" }}>
            <div style={{ display: "flex", gap: "2px", color: GOLD }}>{[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}</div>
            Usado por +2.400 criadores de conteúdo
          </motion.div>
        </motion.div>
      </section>

      {/* ── EXPORT BAR ── */}
      <div style={{ borderTop: "1px solid rgba(232,227,220,0.05)", borderBottom: "1px solid rgba(232,227,220,0.05)", background: "rgba(232,227,220,0.015)", padding: "1.5rem 0" }}>
        <div className="container mx-auto px-6">
          <p style={{ fontSize: "0.6875rem", color: "rgba(232,227,220,0.55)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "1rem" }}>Exporte para qualquer formato</p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "2.5rem" }}>
            {exportFormats.map((f) => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: "8px", color: "rgba(232,227,220,0.6)", fontSize: "0.875rem" }}>
                <f.icon className="h-4 w-4" /> {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section className="container mx-auto px-6 py-28">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} style={{ textAlign: "center", marginBottom: "4rem" }}>
          <p style={{ fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "1rem", fontWeight: 500 }}>Funcionalidades</p>
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: "#E8E3DC", lineHeight: 1.15 }}>
            Tudo que você precisa para criar e distribuir
          </h2>
        </motion.div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1px", background: "rgba(232,227,220,0.06)", borderRadius: "16px", overflow: "hidden" }}>
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              whileHover={{ scale: 1.02 }}
              style={{ background: "#0B0B0F", padding: "1.75rem", position: "relative", transition: "background 0.2s", cursor: "default" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,227,220,0.025)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#0B0B0F")}
            >
              {f.pro && (
                <div style={{ position: "absolute", top: "1.25rem", right: "1.25rem", display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)", color: GOLD, fontSize: "0.625rem", fontWeight: 600, padding: "2px 8px", borderRadius: "100px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  <Crown className="h-2.5 w-2.5" /> PRO
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.875rem" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: `${catColors[f.cat]}18`, border: `1px solid ${catColors[f.cat]}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <f.icon className="h-4 w-4" style={{ color: catColors[f.cat] }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.625rem", letterSpacing: "0.15em", textTransform: "uppercase", color: catColors[f.cat], opacity: 0.7, marginBottom: "2px", fontWeight: 500 }}>{f.cat}</div>
                  <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC", lineHeight: 1.2 }}>{f.title}</h3>
                </div>
              </div>
              <p style={{ fontSize: "0.8125rem", color: "rgba(232,227,220,0.38)", lineHeight: 1.6, fontWeight: 300 }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── EDUSCORE ── */}
      <section style={{ borderTop: "1px solid rgba(232,227,220,0.05)", borderBottom: "1px solid rgba(232,227,220,0.05)", padding: "7rem 0" }}>
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(223,124,58,0.08)", border: "1px solid rgba(223,124,58,0.2)", color: ACCENT, padding: "4px 14px", borderRadius: "100px", fontSize: "0.75rem", fontWeight: 500, marginBottom: "1.5rem" }}>✦ Exclusivo EduGen AI</div>
              <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 3.5vw, 2.5rem)", fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#E8E3DC", marginBottom: "1.25rem" }}>
                O único score de qualidade<br />pedagógica do mercado
              </h2>
              <p style={{ color: "rgba(232,227,220,0.45)", lineHeight: 1.75, marginBottom: "2rem", fontWeight: 300, maxWidth: "480px" }}>
                Após cada geração, o EduScore™ avalia seu curso em 4 dimensões: clareza de linguagem, completude dos objetivos, equilíbrio entre teoria e prática, e engajamento do conteúdo.
              </p>
              <Link to="/auth"
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: ACCENT, fontWeight: 500, fontSize: "0.875rem", textDecoration: "none", letterSpacing: "0.02em", transition: "opacity 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >Ver meu EduScore™ <ArrowRight className="h-4 w-4" /></Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.15 }}
              style={{ background: "rgba(232,227,220,0.03)", border: "1px solid rgba(232,227,220,0.07)", borderRadius: "16px", padding: "1.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.5rem" }}>
                <BarChart3 className="h-5 w-5" style={{ color: ACCENT }} />
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.125rem", fontWeight: 600, color: "#E8E3DC" }}>EduScore™</span>
                <span style={{ marginLeft: "auto", fontSize: "1.5rem", fontWeight: 700, color: ACCENT }}>80<span style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.25)", fontWeight: 400 }}>/100</span></span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {eduScoreDimensions.map((d) => (
                  <div key={d.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", marginBottom: "6px" }}>
                      <span style={{ color: "rgba(232,227,220,0.5)" }}>{d.label}</span>
                      <span style={{ color: "#E8E3DC", fontWeight: 500 }}>{d.score}</span>
                    </div>
                    <div style={{ height: "4px", background: "rgba(232,227,220,0.06)", borderRadius: "100px", overflow: "hidden" }}>
                      <motion.div style={{ height: "100%", background: d.color, borderRadius: "100px" }} initial={{ width: 0 }} whileInView={{ width: `${d.score}%` }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.3, ease: [0.22, 1, 0.36, 1] }} />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── TUTOR IA ── */}
      <section className="container mx-auto px-6 py-28">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
            style={{ background: "rgba(232,227,220,0.025)", border: "1px solid rgba(232,227,220,0.07)", borderRadius: "16px", padding: "1.5rem" }}
            className="order-2 lg:order-1">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "1rem", borderBottom: "1px solid rgba(232,227,220,0.06)", marginBottom: "1rem" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#7B9E87" }} />
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "0.9375rem", fontWeight: 600, color: "#E8E3DC" }}>Tutor IA — Marketing Digital</span>
            </div>
            {tutorMessages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: "0.75rem" }}>
                <div style={{ maxWidth: "82%", padding: "0.625rem 1rem", borderRadius: "12px", fontSize: "0.8125rem", lineHeight: 1.6, background: m.role === "user" ? `${ACCENT}18` : "rgba(232,227,220,0.05)", border: m.role === "user" ? `1px solid ${ACCENT}28` : "1px solid rgba(232,227,220,0.06)", color: m.role === "user" ? "rgba(232,227,220,0.8)" : "rgba(232,227,220,0.55)" }}>
                  {m.text}
                </div>
              </div>
            ))}
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(232,227,220,0.05)" }}>
              <div style={{ background: "rgba(232,227,220,0.03)", borderRadius: "8px", padding: "0.625rem 0.875rem", fontSize: "0.75rem", color: "rgba(232,227,220,0.18)" }}>Pergunte algo sobre o curso…</div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} className="order-1 lg:order-2">
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(160,142,194,0.1)", border: "1px solid rgba(160,142,194,0.2)", color: "#A08EC2", padding: "4px 14px", borderRadius: "100px", fontSize: "0.75rem", fontWeight: 500, marginBottom: "1.5rem" }}>✦ Novo</div>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 3.5vw, 2.5rem)", fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#E8E3DC", marginBottom: "1.25rem" }}>
              Seus alunos têm dúvidas.<br />A IA responde por você.
            </h2>
            <p style={{ color: "rgba(232,227,220,0.45)", lineHeight: 1.75, marginBottom: "1.75rem", fontWeight: 300, maxWidth: "460px" }}>
              Ative o Tutor IA e compartilhe um link único com seus alunos. Cada tutor é treinado exclusivamente no conteúdo do seu curso — sem respostas genéricas, sem alucinação.
            </p>
            <ul style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              {["Link público sem login do aluno", "Histórico de perguntas no painel do criador", "Baseado 100% no seu conteúdo"].map((item) => (
                <li key={item} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.875rem", color: "rgba(232,227,220,0.55)" }}>
                  <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "#7B9E87" }} /> {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* ── PLANOS ── */}
      <section style={{ borderTop: "1px solid rgba(232,227,220,0.05)", padding: "7rem 0" }}>
        <div className="container mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: "center", marginBottom: "4rem" }}>
            <p style={{ fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "1rem", fontWeight: 500 }}>Planos</p>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: "#E8E3DC", lineHeight: 1.15 }}>
              Comece grátis. Escale quando precisar.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              style={{ background: "rgba(232,227,220,0.025)", border: "1px solid rgba(232,227,220,0.07)", borderRadius: "16px", padding: "2rem" }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.375rem", fontWeight: 600, color: "#E8E3DC", marginBottom: "0.25rem" }}>Free</h3>
              <p style={{ fontSize: "2rem", fontWeight: 700, color: "#E8E3DC", marginBottom: "1.75rem" }}>Grátis</p>
              <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
                {freePlan.map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.875rem", color: "rgba(232,227,220,0.45)" }}>
                    <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "rgba(232,227,220,0.2)" }} /> {item}
                  </li>
                ))}
              </ul>
              <Link to="/auth"
                style={{ display: "block", textAlign: "center", padding: "0.7rem", borderRadius: "8px", border: "1px solid rgba(232,227,220,0.1)", color: "rgba(232,227,220,0.6)", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(232,227,220,0.25)"; e.currentTarget.style.color = "#E8E3DC"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(232,227,220,0.1)"; e.currentTarget.style.color = "rgba(232,227,220,0.6)"; }}
              >Começar grátis</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
              style={{ background: `${ACCENT}0D`, border: `1px solid ${ACCENT}35`, borderRadius: "16px", padding: "2rem", position: "relative" }}>
              <div style={{ position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)", background: ACCENT, color: "#0B0B0F", fontSize: "0.6875rem", fontWeight: 700, padding: "3px 14px", borderRadius: "100px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Popular</div>
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.375rem", fontWeight: 600, color: "#E8E3DC", marginBottom: "0.25rem" }}>Pro</h3>
              <div style={{ marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "2rem", fontWeight: 700, color: "#E8E3DC" }}>R$59,90</span>
                <span style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.3)", fontWeight: 300 }}>/mês</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.25)", marginBottom: "1.75rem" }}>Cancele quando quiser</p>
              <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
                {proPlan.map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.875rem", color: "rgba(232,227,220,0.55)" }}>
                    <CheckCircle className="h-4 w-4 shrink-0" style={{ color: ACCENT }} /> {item}
                  </li>
                ))}
              </ul>
              <Link to="/auth"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0.7rem", borderRadius: "8px", background: ACCENT, color: "#0B0B0F", fontSize: "0.875rem", fontWeight: 600, textDecoration: "none", transition: "opacity 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >Começar com Pro <ArrowRight className="h-4 w-4" /></Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ padding: "7rem 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, rgba(223,124,58,0.07) 0%, transparent 65%)" }} />
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "0 1.5rem" }}>
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2.5rem, 5vw, 4rem)", fontWeight: 600, letterSpacing: "-0.025em", color: "#E8E3DC", lineHeight: 1.1, marginBottom: "1.25rem" }}>
            Seu próximo curso começa agora.
          </h2>
          <p style={{ color: "rgba(232,227,220,0.4)", fontSize: "1.0625rem", margin: "0 auto 2.5rem", maxWidth: "440px", fontWeight: 300, lineHeight: 1.65 }}>
            Junte-se a criadores que já transformaram seu conhecimento em cursos profissionais.
          </p>
          <Link to="/auth"
            style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: ACCENT, color: "#0B0B0F", fontWeight: 600, fontSize: "1rem", padding: "0.875rem 2.5rem", borderRadius: "8px", textDecoration: "none", transition: "opacity 0.2s", letterSpacing: "0.01em" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >Criar meu primeiro curso grátis <ArrowRight className="h-5 w-5" /></Link>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid rgba(232,227,220,0.05)", padding: "2.5rem 0" }}>
        <div className="container mx-auto px-6 grid md:grid-cols-3 gap-8">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.625rem" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `${ACCENT}15`, border: `1px solid ${ACCENT}25`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sparkles className="h-3.5 w-3.5" style={{ color: ACCENT }} />
              </div>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 700, fontSize: "1.0625rem", color: "#E8E3DC" }}>EduGen AI</span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.25)", lineHeight: 1.6 }}>Cursos profissionais criados com inteligência artificial.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {["Entrar", "Planos", "Criar curso"].map((item) => (
              <Link key={item} to="/auth"
                style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.35)", textDecoration: "none", transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#E8E3DC")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,227,220,0.35)")}
              >{item}</Link>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", textAlign: "right", alignItems: "flex-end" }}>
            <p style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.35)" }}>© {new Date().getFullYear()} EduGen AI</p>
            <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.2)" }}>Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>

      {/* ── DEMO VIDEO MODAL ── */}
      <AnimatePresence>
        {demoOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDemoOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 1000,
              background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "1.5rem",
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: "900px",
                background: "#111115",
                borderRadius: "16px",
                border: "1px solid rgba(232,227,220,0.08)",
                overflow: "hidden",
                boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
              }}
            >
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "1rem 1.25rem",
                borderBottom: "1px solid rgba(232,227,220,0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `rgba(223,124,58,0.12)`, border: `1px solid rgba(223,124,58,0.2)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Play className="h-3.5 w-3.5" style={{ color: ACCENT, fill: ACCENT }} />
                  </div>
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1rem", fontWeight: 600, color: "#E8E3DC" }}>
                    Demonstração — EduGen AI
                  </span>
                </div>
                <button
                  onClick={() => setDemoOpen(false)}
                  style={{ background: "rgba(232,227,220,0.06)", border: "none", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(232,227,220,0.5)", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,227,220,0.12)"; e.currentTarget.style.color = "#E8E3DC"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(232,227,220,0.06)"; e.currentTarget.style.color = "rgba(232,227,220,0.5)"; }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Video area */}
              <div style={{ position: "relative", paddingBottom: "56.25%", background: "#0B0B0F" }}>
                {DEMO_VIDEO_ID ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
                    title="Demonstração EduGen AI"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                  />
                ) : (
                  /* Placeholder enquanto o vídeo não está configurado */
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem" }}>
                    <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: `rgba(223,124,58,0.12)`, border: `1px solid rgba(223,124,58,0.25)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Play className="h-8 w-8" style={{ color: ACCENT, fill: ACCENT, marginLeft: "3px" }} />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ color: "#E8E3DC", fontWeight: 500, marginBottom: "6px" }}>Vídeo em breve</p>
                      <p style={{ color: "rgba(232,227,220,0.35)", fontSize: "0.875rem", maxWidth: "320px" }}>
                        Configure <code style={{ color: ACCENT, fontSize: "0.8125rem" }}>DEMO_VIDEO_ID</code> em <code style={{ color: ACCENT, fontSize: "0.8125rem" }}>Landing.tsx</code> com o ID do seu vídeo no YouTube.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
