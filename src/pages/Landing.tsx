import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, BookOpen, Zap, Award, ArrowRight, FileUp, CheckCircle, Crown,
  Moon, Sun, Brain, Target, BarChart3, Pencil, Globe, Presentation,
  GraduationCap, School, Bot, Video, Users, Star, FileText, Download,
  MessageSquare, ExternalLink, Copy,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";
import { useState } from "react";
import { toast } from "sonner";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const features = [
  // Row 1 — CRIAÇÃO
  { icon: Brain, title: "Geração por IA", desc: "Tema → curso completo em < 2 min. Módulos, quizzes e flashcards automáticos.", gradient: "from-indigo-500 to-indigo-600", row: 0 },
  { icon: FileUp, title: "Fontes próprias", desc: "Envie PDFs, YouTube ou artigos. A IA extrai e estrutura o conteúdo fielmente.", gradient: "from-indigo-500 to-indigo-600", pro: true, row: 0 },
  { icon: Target, title: "Templates por nicho", desc: "Onboarding, Vendas, RH, Tech. Estrutura pedagógica pronta para começar.", gradient: "from-indigo-500 to-indigo-600", row: 0 },
  // Row 2 — QUALIDADE
  { icon: BarChart3, title: "EduScore™", desc: "Score de qualidade pedagógica exclusivo. Clareza, completude, engajamento e equilíbrio.", gradient: "from-violet-500 to-violet-600", pro: true, row: 1 },
  { icon: Pencil, title: "Editor rico com IA", desc: "TipTap com toolbar completa. Selecione qualquer trecho e melhore com IA em 1 clique.", gradient: "from-violet-500 to-violet-600", row: 1 },
  { icon: Globe, title: "Tradução pedagógica", desc: "Traduz e adapta exemplos culturais para o idioma-alvo. Não é só tradução — é localização.", gradient: "from-violet-500 to-violet-600", row: 1 },
  // Row 3 — DISTRIBUIÇÃO
  { icon: Presentation, title: "PPTX profissional", desc: "Apresentações com design premium, temas, paletas e densidade configurável.", gradient: "from-emerald-500 to-emerald-600", pro: true, row: 2 },
  { icon: GraduationCap, title: "SCORM para LMS", desc: "Exportação compatível com Moodle, Canvas, Blackboard e qualquer LMS.", gradient: "from-emerald-500 to-emerald-600", pro: true, row: 2 },
  { icon: School, title: "Moodle XML", desc: "Backup nativo do Moodle com quiz, páginas e flashcards. Sem API, funciona offline.", gradient: "from-emerald-500 to-emerald-600", pro: true, row: 2 },
  // Row 4 — ENGAJAMENTO
  { icon: Bot, title: "Tutor IA para alunos", desc: "Link público com chat IA treinado no seu curso. Alunos perguntam, a IA responde.", gradient: "from-amber-500 to-amber-600", pro: true, row: 3 },
  { icon: Video, title: "Script para vídeo", desc: "Gera roteiro de apresentação oral com marcadores de pausa e ênfases. Exporta em DOCX.", gradient: "from-amber-500 to-amber-600", pro: true, row: 3 },
  { icon: Users, title: "Revisão colaborativa", desc: "Compartilhe o curso para revisores externos deixarem comentários por módulo. IA sintetiza.", gradient: "from-amber-500 to-amber-600", pro: true, row: 3 },
];

const exportFormats = [
  { icon: FileText, label: "PDF" },
  { icon: Presentation, label: "PPTX" },
  { icon: GraduationCap, label: "SCORM" },
  { icon: School, label: "Moodle" },
  { icon: BookOpen, label: "Notion" },
  { icon: Video, label: "Script de Vídeo" },
];

const eduScoreDimensions = [
  { label: "Clareza", score: 87, color: "bg-emerald-500" },
  { label: "Completude", score: 74, color: "bg-indigo-500" },
  { label: "Engajamento", score: 91, color: "bg-violet-500" },
  { label: "Equilíbrio", score: 68, color: "bg-amber-500" },
];

const tutorMessages = [
  { role: "user", text: "O que é aprendizagem assíncrona?" },
  { role: "ai", text: "Aprendizagem assíncrona é quando o aluno estuda no seu próprio ritmo, sem precisar estar online ao mesmo tempo que o instrutor. Exemplos incluem videoaulas gravadas, fóruns de discussão e materiais de leitura disponíveis a qualquer hora." },
  { role: "user", text: "Qual a diferença para síncrona?" },
];

export default function Landing() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-[#0A0A0F] dark:bg-[#0A0A0F] text-white relative overflow-hidden selection:bg-indigo-500/30">
      {/* Grain texture overlay */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")", backgroundRepeat: "repeat" }} />

      {/* ======= SEÇÃO 1 — NAV ======= */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0A0A0F]/70 border-b border-white/5">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="font-display-sora text-xl font-bold tracking-tight">EduGen AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const url = window.location.href;
                navigator.clipboard.writeText(url).then(() => {
                  toast.success("URL copiada! Cole em uma nova aba do navegador.");
                }).catch(() => {
                  // Fallback: show URL in a prompt
                  window.prompt("Copie esta URL e cole em uma nova aba:", url);
                });
              }}
              className="text-white/60 hover:text-white hover:bg-white/5"
              title="Copiar URL do app"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-white/60 hover:text-white hover:bg-white/5">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5" asChild>
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0" asChild>
              <Link to="/auth">Começar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ======= SEÇÃO 2 — HERO ======= */}
      <section className="relative container mx-auto px-4 pt-24 pb-32 text-center">
        {/* Animated blobs */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none">
          <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-[120px]" style={{ animation: "blob-move-1 8s ease-in-out infinite" }} />
          <div className="absolute inset-0 rounded-full bg-violet-600/15 blur-[120px] translate-x-20" style={{ animation: "blob-move-2 8s ease-in-out infinite" }} />
        </div>

        <motion.div
          className="relative z-10"
          variants={stagger}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={fadeUp}>
            <div className="inline-flex items-center gap-2 bg-white/[0.06] border border-white/[0.08] text-indigo-300 px-4 py-1.5 rounded-full text-sm font-medium mb-8">
              ✦ Agora com Tutor IA para alunos
            </div>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="font-display-sora text-[44px] md:text-[72px] font-extrabold leading-[1.05] mb-6 max-w-4xl mx-auto tracking-tight"
          >
            Transforme seu conhecimento em{" "}
            <br className="hidden md:block" />
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">cursos profissionais validados por IA</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Da estrutura pedagógica ao design premium em PPTX. 
            Com EduScore™, Tutor IA e exportação nativa para Moodle, Notion e SCORM.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Button size="lg" className="text-base px-8 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0 h-12" asChild>
              <Link to="/auth">
                Criar meu primeiro curso
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" className="text-base px-8 text-white/60 hover:text-white hover:bg-white/5 h-12" asChild>
              <Link to="/auth">
                Ver demonstração ↗
              </Link>
            </Button>
          </motion.div>

          <motion.div variants={fadeUp} className="flex items-center justify-center gap-2 text-sm text-white/40">
            <div className="flex gap-0.5 text-amber-400">
              {[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
            </div>
            <span>Usado por +2.400 criadores de conteúdo</span>
          </motion.div>
        </motion.div>
      </section>

      {/* ======= SEÇÃO 3 — EXPORT FORMATS BAR ======= */}
      <section className="bg-white/[0.02] border-y border-white/5 py-6 overflow-hidden">
        <div className="container mx-auto px-4">
          <p className="text-xs text-white/30 text-center mb-4 uppercase tracking-widest">Exporte para qualquer formato</p>
          <div className="flex items-center justify-center gap-8 md:gap-12 flex-wrap">
            {exportFormats.map((f) => (
              <div key={f.label} className="flex items-center gap-2 text-white/40 text-sm">
                <f.icon className="h-4 w-4" />
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======= SEÇÃO 4 — FEATURES GRID ======= */}
      <section className="container mx-auto px-4 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="font-display-sora text-3xl md:text-[40px] font-bold tracking-tight">
            Tudo que você precisa para criar e distribuir
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              whileHover={{ scale: 1.02 }}
              className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 hover:bg-white/[0.06] hover:border-white/[0.15] transition-all duration-300 relative group"
            >
              {f.pro && (
                <div className="absolute top-4 right-4">
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] px-2 py-0.5 gap-1">
                    <Crown className="h-3 w-3" />
                    PRO
                  </Badge>
                </div>
              )}
              <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4`}>
                <f.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-display-sora text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ======= SEÇÃO 5 — EDUSCORE™ ======= */}
      <section className="bg-gradient-to-r from-indigo-950/50 to-violet-950/50 border-y border-indigo-500/20 py-24">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-semibold mb-6">
                ✦ Exclusivo EduGen AI
              </div>
              <h2 className="font-display-sora text-3xl md:text-4xl font-bold mb-4 leading-tight">
                O único score de qualidade{" "}
                <br className="hidden md:block" />
                pedagógica do mercado
              </h2>
              <p className="text-white/50 leading-relaxed mb-8 max-w-lg">
                Após cada geração, o EduScore™ avalia seu curso em 4 dimensões:
                clareza de linguagem, completude dos objetivos, equilíbrio entre
                teoria e prática, e engajamento do conteúdo.
              </p>
              <Button className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0" asChild>
                <Link to="/auth">
                  Ver meu EduScore →
                </Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 space-y-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-5 w-5 text-indigo-400" />
                <span className="font-display-sora font-semibold text-lg">EduScore™</span>
                <span className="ml-auto text-2xl font-bold text-indigo-400">80<span className="text-sm text-white/30">/100</span></span>
              </div>
              {eduScoreDimensions.map((d) => (
                <div key={d.label} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">{d.label}</span>
                    <span className="font-semibold">{d.score}</span>
                  </div>
                  <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full ${d.color} rounded-full`}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${d.score}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.3 }}
                    />
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ======= SEÇÃO 6 — TUTOR IA ======= */}
      <section className="container mx-auto px-4 py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Chat mockup */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 space-y-3 order-2 lg:order-1"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-white/[0.06]">
              <Bot className="h-5 w-5 text-violet-400" />
              <span className="font-display-sora font-semibold text-sm">Tutor IA — Marketing Digital</span>
            </div>
            {tutorMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/20"
                    : "bg-white/[0.06] text-white/70 border border-white/[0.06]"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <div className="flex-1 bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-white/20">Pergunte algo sobre o curso...</div>
            </div>
          </motion.div>

          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="order-1 lg:order-2"
          >
            <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 text-violet-300 px-3 py-1 rounded-full text-xs font-semibold mb-6">
              ✦ Novo
            </div>
            <h2 className="font-display-sora text-3xl md:text-4xl font-bold mb-4 leading-tight">
              Seus alunos têm dúvidas.{" "}
              <br className="hidden md:block" />
              A IA responde por você.
            </h2>
            <p className="text-white/50 leading-relaxed mb-6 max-w-lg">
              Ative o Tutor IA e compartilhe um link único com seus alunos.
              Cada tutor é treinado exclusivamente no conteúdo do seu curso —
              sem respostas genéricas, sem alucinação.
            </p>
            <ul className="space-y-3 text-sm text-white/60">
              <li className="flex items-center gap-2.5">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                Link público sem login do aluno
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                Histórico de perguntas no painel do criador
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                Baseado 100% no seu conteúdo
              </li>
            </ul>
          </motion.div>
        </div>
      </section>

      {/* ======= SEÇÃO 7 — PLANOS ======= */}
      <section className="container mx-auto px-4 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <h2 className="font-display-sora text-3xl md:text-4xl font-bold tracking-tight">
            Comece grátis. Escale quando precisar.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* FREE */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8"
          >
            <h3 className="font-display-sora text-xl font-bold mb-1">Free</h3>
            <p className="text-3xl font-bold mb-6">Grátis</p>
            <ul className="space-y-3 text-sm text-white/60 mb-8">
              {["3 cursos/mês", "Até 5 módulos por curso", "Quiz e flashcards", "Certificados verificáveis", "Exportação PDF"].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <CheckCircle className="h-4 w-4 text-white/20 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Button variant="outline" className="w-full border-white/10 text-white hover:bg-white/5" asChild>
              <Link to="/auth">Começar grátis</Link>
            </Button>
          </motion.div>

          {/* PRO */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="bg-white/[0.04] border-2 border-indigo-500/40 rounded-2xl p-8 scale-[1.02] relative"
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0 px-3 py-1">
                Popular
              </Badge>
            </div>
            <h3 className="font-display-sora text-xl font-bold mb-1">Pro</h3>
            <p className="text-3xl font-bold mb-1">R$59,90<span className="text-sm font-normal text-white/40">/mês</span></p>
            <p className="text-xs text-white/30 mb-6">Cancele quando quiser</p>
            <ul className="space-y-3 text-sm text-white/60 mb-8">
              {[
                "5 cursos/mês",
                "Até 10 módulos por curso",
                "Tudo do Free, mais:",
                "Fontes próprias (PDF, YouTube, web)",
                "PPTX com design premium",
                "SCORM + Moodle + Notion",
                "EduScore™ pedagógico",
                "Tutor IA para alunos",
                "Script para vídeo/narração",
                "Tradução pedagógica",
                "Revisão colaborativa",
                "Analytics do criador",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <CheckCircle className="h-4 w-4 text-indigo-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Button className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0" asChild>
              <Link to="/auth">
                Começar com Pro
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ======= SEÇÃO 8 — CTA FINAL ======= */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-[120px]" style={{ animation: "blob-move-1 8s ease-in-out infinite" }} />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative z-10 container mx-auto px-4 text-center"
        >
          <h2 className="font-display-sora text-4xl md:text-[56px] font-bold tracking-tight mb-4">
            Seu próximo curso começa agora.
          </h2>
          <p className="text-white/40 text-lg mb-10 max-w-lg mx-auto">
            Junte-se a criadores que já transformaram seu conhecimento em cursos profissionais.
          </p>
          <Button size="lg" className="text-base px-10 h-14 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0 text-lg" asChild>
            <Link to="/auth">
              Criar meu primeiro curso grátis
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* ======= SEÇÃO 9 — FOOTER ======= */}
      <footer className="border-t border-white/5 py-10">
        <div className="container mx-auto px-4 grid md:grid-cols-3 gap-8 text-sm text-white/40">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-display-sora font-bold text-white">EduGen AI</span>
            </div>
            <p className="text-white/30 text-xs">Cursos profissionais criados com inteligência artificial.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Link to="/auth" className="hover:text-white transition-colors">Entrar</Link>
            <Link to="/plans" className="hover:text-white transition-colors">Planos</Link>
            <Link to="/auth" className="hover:text-white transition-colors">Criar curso</Link>
          </div>
          <div className="flex flex-col gap-2 md:text-right md:items-end">
            <p>© {new Date().getFullYear()} EduGen AI</p>
            <p className="text-white/20 text-xs">Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
