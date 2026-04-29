import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Rocket, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: string;
}

export function UpgradeModal({ isOpen, onClose, feature }: UpgradeModalProps) {
  const navigate = useNavigate();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-2xl">Desbloqueie o potencial máximo</DialogTitle>
          <DialogDescription className="text-center text-base pt-2">
            A funcionalidade de <span className="font-bold text-foreground">"{feature}"</span> está disponível apenas nos planos superiores.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
          <div className="p-4 border rounded-xl bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-orange-500" />
              <span className="font-bold">Starter</span>
            </div>
            <ul className="text-xs space-y-2 text-muted-foreground">
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> Layout Personalizável</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> Depoimentos e Prova Social</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> Mais cursos por mês</li>
            </ul>
          </div>
          <div className="p-4 border-2 border-primary rounded-xl bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Rocket className="h-4 w-4 text-primary" />
              <span className="font-bold">Pro</span>
            </div>
            <ul className="text-xs space-y-2 text-muted-foreground">
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> Domínio Próprio</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> White-label (Sem marca)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-primary" /> Vídeos e Blocos Avançados</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Depois</Button>
          <Button onClick={() => navigate("/app/planos")} className="w-full sm:w-auto">Ver Planos e Preços</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
