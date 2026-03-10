import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, BookOpen, Zap, Award, ArrowRight, FileUp, CheckCircle, Crown, Moon, Sun, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";

export default function Landing() {
  const features = [
    { icon: BookOpen, title: "Cursos completos", desc: "Módulos, conteúdo e estrutura gerados por IA em minutos." },
    { icon: FileUp, title: "Fontes próprias", desc: "Envie seus PDFs e textos — a IA gera o curso fielmente a partir do seu material.", pro: true },
    { icon: Zap, title: "Quizzes & Flashcards", desc: "Material de avaliação e revisão criados automaticamente." },
    { icon: Award, title: "Certificados", desc: "Emita certificados verificáveis para seus alunos." },
  ];

  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold">EduGen AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button asChild>
              <Link to="/auth">Começar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-20 pb-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            Powered by AI
          </div>
          <h1 className="font-display text-5xl md:text-7xl font-bold leading-tight mb-6 max-w-4xl mx-auto">
            Crie cursos educacionais{" "}
            <span className="text-primary">em minutos</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Transforme qualquer tema em um curso completo com módulos, quizzes, flashcards e certificados — tudo com inteligência artificial.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button size="lg" className="text-base px-8" asChild>
              <Link to="/auth">
                Criar meu primeiro curso
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 pb-24">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.1 }}
              className={`bg-card border rounded-xl p-8 hover:shadow-lg transition-shadow relative ${
                f.pro ? "border-primary/30 bg-primary/[0.02]" : "border-border"
              }`}
            >
              {f.pro && (
                <div className="absolute top-3 right-3">
                  <Badge variant="default" className="text-[10px] px-2 py-0.5 gap-1">
                    <Crown className="h-3 w-3" />
                    PRO
                  </Badge>
                </div>
              )}
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-display text-xl font-semibold mb-2">{f.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Sources CTA */}
      <section className="container mx-auto px-4 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="bg-card border border-primary/20 rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8"
        >
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Crown className="h-3.5 w-3.5" />
              Exclusivo Pro
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-3">
              Cursos a partir das suas fontes
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-5 max-w-lg">
              Envie seus próprios PDFs, textos ou arquivos Markdown e a IA gera um curso completo fielmente baseado no seu conteúdo — sem alucinação, sem informação externa.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary shrink-0" /> Até 3 documentos por curso</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary shrink-0" /> PDF, TXT e Markdown suportados</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary shrink-0" /> Conteúdo 100% fiel às suas fontes</li>
            </ul>
          </div>
          <div className="shrink-0">
            <Button size="lg" className="text-base px-8" asChild>
              <Link to="/auth">
                Começar com Pro
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} EduGen AI. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
