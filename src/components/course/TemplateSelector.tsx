import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase, ShoppingCart, Code2, Heart, Shield, Sparkles, ArrowRight, LayoutTemplate,
} from "lucide-react";
import { motion } from "framer-motion";

export interface CourseTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  tone: string;
  suggestedModules: number;
  targetAudience: string;
  exampleObjectives: string[];
  suggestedTitle: string;
  suggestedTheme: string;
}

export const COURSE_TEMPLATES: CourseTemplate[] = [
  {
    id: "onboarding",
    name: "Onboarding Corporativo",
    description: "Integração de novos colaboradores com cultura, processos e ferramentas da empresa.",
    icon: <Briefcase className="h-6 w-6" />,
    color: "hsl(220, 70%, 55%)",
    tone: "profissional",
    suggestedModules: 5,
    targetAudience: "Novos colaboradores em fase de integração",
    exampleObjectives: [
      "Compreender a cultura e os valores da organização",
      "Dominar os processos e ferramentas do dia a dia",
      "Conhecer a estrutura organizacional e canais de comunicação",
    ],
    suggestedTitle: "Programa de Onboarding",
    suggestedTheme: "Integração de novos colaboradores: cultura organizacional, processos internos, ferramentas de trabalho e boas práticas da empresa",
  },
  {
    id: "vendas",
    name: "Treinamento de Vendas",
    description: "Técnicas de vendas, negociação, CRM e gestão de pipeline comercial.",
    icon: <ShoppingCart className="h-6 w-6" />,
    color: "hsl(145, 65%, 42%)",
    tone: "direto",
    suggestedModules: 6,
    targetAudience: "Equipe comercial e representantes de vendas",
    exampleObjectives: [
      "Aplicar técnicas de prospecção e qualificação de leads",
      "Dominar metodologias de negociação consultiva",
      "Utilizar CRM para gestão eficiente do pipeline",
    ],
    suggestedTitle: "Treinamento Comercial",
    suggestedTheme: "Técnicas modernas de vendas: prospecção, qualificação, negociação consultiva, fechamento e gestão de relacionamento com clientes usando CRM",
  },
  {
    id: "programacao",
    name: "Curso de Programação",
    description: "Fundamentos de desenvolvimento, lógica de programação e boas práticas de código.",
    icon: <Code2 className="h-6 w-6" />,
    color: "hsl(270, 60%, 55%)",
    tone: "didatico",
    suggestedModules: 8,
    targetAudience: "Iniciantes em programação e desenvolvimento de software",
    exampleObjectives: [
      "Compreender lógica de programação e algoritmos",
      "Escrever código limpo seguindo boas práticas",
      "Construir projetos práticos aplicando os conceitos aprendidos",
    ],
    suggestedTitle: "Fundamentos de Programação",
    suggestedTheme: "Introdução à programação: lógica computacional, estruturas de dados básicas, boas práticas de código e desenvolvimento de projetos práticos",
  },
  {
    id: "desenvolvimento-pessoal",
    name: "Desenvolvimento Pessoal",
    description: "Soft skills, produtividade, inteligência emocional e gestão de carreira.",
    icon: <Heart className="h-6 w-6" />,
    color: "hsl(340, 65%, 55%)",
    tone: "didatico",
    suggestedModules: 5,
    targetAudience: "Profissionais em busca de crescimento pessoal e profissional",
    exampleObjectives: [
      "Desenvolver inteligência emocional e autoconhecimento",
      "Aplicar técnicas de produtividade e gestão do tempo",
      "Construir habilidades de comunicação e liderança",
    ],
    suggestedTitle: "Desenvolvimento Pessoal & Profissional",
    suggestedTheme: "Habilidades essenciais para o crescimento: inteligência emocional, produtividade, comunicação eficaz, liderança e planejamento de carreira",
  },
  {
    id: "compliance",
    name: "Compliance & RH",
    description: "Normas regulatórias, LGPD, ética corporativa e políticas internas de RH.",
    icon: <Shield className="h-6 w-6" />,
    color: "hsl(30, 75%, 50%)",
    tone: "profissional",
    suggestedModules: 4,
    targetAudience: "Todos os colaboradores da organização",
    exampleObjectives: [
      "Conhecer as normas regulatórias aplicáveis ao negócio",
      "Aplicar práticas de proteção de dados (LGPD)",
      "Identificar situações de risco ético e saber como agir",
    ],
    suggestedTitle: "Compliance e Ética Corporativa",
    suggestedTheme: "Compliance empresarial: normas regulatórias, LGPD e proteção de dados, ética corporativa, políticas internas e canal de denúncias",
  },
];

interface TemplateSelectorProps {
  onSelect: (template: CourseTemplate) => void;
  onSkip: () => void;
}

export function TemplateSelector({ onSelect, onSkip }: TemplateSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="bg-card border-b border-border">
        <div className="max-w-[960px] mx-auto px-6 py-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <LayoutTemplate className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-foreground">Escolha um template</h1>
            <p className="text-sm text-muted-foreground">Comece mais rápido com uma estrutura pré-configurada</p>
          </div>
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {COURSE_TEMPLATES.map((tpl, i) => (
            <motion.div
              key={tpl.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
            >
              <Card
                className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-border h-full"
                style={{
                  borderColor: hoveredId === tpl.id ? tpl.color : undefined,
                  boxShadow: hoveredId === tpl.id ? `0 8px 24px -8px ${tpl.color}30` : undefined,
                }}
                onMouseEnter={() => setHoveredId(tpl.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelect(tpl)}
              >
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${tpl.color}15`, color: tpl.color }}
                    >
                      {tpl.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-sm font-bold text-foreground leading-tight">{tpl.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                      {tpl.suggestedModules} módulos
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                      Tom {tpl.tone}
                    </Badge>
                  </div>

                  <div className="mt-auto pt-3 border-t border-border/50">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Objetivos de aprendizagem
                    </p>
                    <ul className="space-y-1">
                      {tpl.exampleObjectives.map((obj, j) => (
                        <li key={j} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0" style={{ color: tpl.color }}>•</span>
                          <span className="line-clamp-1">{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="flex justify-center">
          <Button variant="ghost" onClick={onSkip} className="text-muted-foreground hover:text-foreground gap-2">
            <Sparkles className="h-4 w-4" />
            Começar do zero
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
