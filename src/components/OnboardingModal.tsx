import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, Zap, Award, ArrowRight, ArrowLeft, Rocket } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STORAGE_KEY = "edugen_onboarding_done";

export function useOnboarding() {
  const done = typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
  const [open, setOpen] = useState(!done);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  };

  const restart = () => {
    localStorage.removeItem(STORAGE_KEY);
    setOpen(true);
  };

  return { open, dismiss, restart };
}

interface Props {
  open: boolean;
  onDismiss: () => void;
  freeCourses?: number;
}

const steps = [
  {
    icon: Sparkles,
    title: "Bem-vindo ao EduGen AI 👋",
    body: "Crie cursos completos com IA em menos de 2 minutos. Vamos te mostrar como funciona.",
  },
  {
    icon: Zap,
    title: "3 passos para seu primeiro curso",
    body: null, // custom content
  },
  {
    icon: Rocket,
    title: "Seu primeiro curso, agora",
    body: null, // custom content
  },
];

export function OnboardingModal({ open, onDismiss, freeCourses = 3 }: Props) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  const handleClose = () => {
    setStep(0);
    onDismiss();
  };

  const handleCreate = () => {
    handleClose();
    navigate("/app/courses/new");
  };

  const current = steps[step];
  const Icon = current.icon;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-8 bg-primary" : "w-2 bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="px-8 py-8 flex flex-col items-center text-center"
          >
            {/* Icon */}
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
              <Icon className="h-8 w-8 text-primary" />
            </div>

            <h2 className="font-display text-xl font-bold text-foreground mb-3">{current.title}</h2>

            {step === 0 && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{current.body}</p>
            )}

            {step === 1 && (
              <div className="space-y-4 w-full max-w-xs text-left">
                {[
                  { num: "1", icon: BookOpen, text: "Descreva o tema do curso" },
                  { num: "2", icon: Zap, text: "A IA gera os módulos completos" },
                  { num: "3", icon: Award, text: "Exporte em PDF, PPTX ou SCORM" },
                ].map((item) => (
                  <div key={item.num} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">{item.num}</span>
                    </div>
                    <span className="text-sm text-foreground">{item.text}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-2">
                  Não precisa saber programar nem design — a IA faz tudo por você.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                  Você tem <strong className="text-foreground">{freeCourses} criações</strong> disponíveis no plano Free. Que tal criar o primeiro agora?
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <div className="px-8 pb-6 flex items-center justify-between">
          <div>
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground">
                Pular
              </Button>
            )}
          </div>
          <div>
            {step < steps.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground">
                  Ver depois
                </Button>
                <Button size="sm" onClick={handleCreate}>
                  <Sparkles className="h-4 w-4 mr-1" /> Criar meu primeiro curso
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
