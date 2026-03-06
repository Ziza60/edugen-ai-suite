import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface FlashcardsFlipViewProps {
  flashcards: Flashcard[];
}

function ensureQuestion(text: string): string {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return trimmed;
  // Simple heuristic: if it looks like a nominal title, prefix with "O que é"
  const startsWithVerb = /^(o que|como|qual|quais|por que|quando|onde|quem|de que|em que|what|how|why|when|where|which|who)/i.test(trimmed);
  if (startsWithVerb) return trimmed + "?";
  return `O que é ${trimmed}?`;
}

export function FlashcardsFlipView({ flashcards }: FlashcardsFlipViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const flip = useCallback(() => setIsFlipped((f) => !f), []);

  const goNext = useCallback(() => {
    if (currentIndex < flashcards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex((i) => i + 1), prefersReducedMotion ? 0 : 150);
    }
  }, [currentIndex, flashcards.length, prefersReducedMotion]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex((i) => i - 1), prefersReducedMotion ? 0 : 150);
    }
  }, [currentIndex, prefersReducedMotion]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture keys when user is typing in an input/textarea or inside a dialog
      const tag = (e.target as HTMLElement)?.tagName;
      const isInsideDialog = (e.target as HTMLElement)?.closest('[role="dialog"]');
      if (tag === "INPUT" || tag === "TEXTAREA" || isInsideDialog) return;

      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, flip]);

  if (flashcards.length === 0) return null;

  const card = flashcards[currentIndex];

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Counter */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{currentIndex + 1}</span>
        <span>/</span>
        <span>{flashcards.length}</span>
      </div>

      {/* Flip Card */}
      <div
        className="w-full max-w-lg mx-auto cursor-pointer"
        style={{ perspective: "1200px" }}
        onClick={flip}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            flip();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={isFlipped ? "Voltar para a pergunta" : "Virar para ver a resposta"}
      >
        <div
          className="relative w-full transition-transform duration-500 ease-out"
          style={{
            transformStyle: prefersReducedMotion ? undefined : "preserve-3d",
            transform: prefersReducedMotion
              ? undefined
              : isFlipped
              ? "rotateY(180deg)"
              : "rotateY(0deg)",
          }}
        >
          {/* Front */}
          {prefersReducedMotion ? (
            <AnimatePresence mode="wait">
              {!isFlipped && (
                <motion.div
                  key="front"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <CardFace side="front" card={card} />
                </motion.div>
              )}
              {isFlipped && (
                <motion.div
                  key="back"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <CardFace side="back" card={card} />
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            <>
              <div
                className="w-full"
                style={{ backfaceVisibility: "hidden" }}
              >
                <CardFace side="front" card={card} />
              </div>
              <div
                className="w-full absolute top-0 left-0"
                style={{
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                }}
              >
                <CardFace side="back" card={card} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground">
        {isFlipped ? "Clique para voltar à pergunta" : "Clique ou pressione Espaço para virar"}
      </p>

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          disabled={currentIndex === 0}
          aria-label="Flashcard anterior"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
            setCurrentIndex(0);
          }}
          aria-label="Reiniciar flashcards"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          disabled={currentIndex === flashcards.length - 1}
          aria-label="Próximo flashcard"
        >
          Próximo <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Keyboard hint (desktop) */}
      <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
        <span>← → navegar</span>
        <span>Espaço virar</span>
      </div>
    </div>
  );
}

function CardFace({ side, card }: { side: "front" | "back"; card: { front: string; back: string } }) {
  const isFront = side === "front";
  return (
    <div className="rounded-xl border border-border bg-card shadow-lg p-6 sm:p-8 min-h-[260px] flex flex-col justify-between">
      <div>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isFront ? "text-primary" : "text-secondary"}`}>
          {isFront ? "Pergunta" : "Resposta"}
        </span>
        <div className="mt-4">
          {isFront ? (
            <p className="font-display text-lg sm:text-xl font-semibold leading-relaxed text-card-foreground">
              {ensureQuestion(card.front)}
            </p>
          ) : (
            <div className="text-base leading-loose text-card-foreground whitespace-pre-line">
              {card.back}
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 text-center">
        <span className="text-xs text-muted-foreground">
          {isFront ? "Virar para ver a resposta" : "Voltar para a pergunta"}
        </span>
      </div>
    </div>
  );
}
