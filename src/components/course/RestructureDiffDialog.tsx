import { useState } from "react";
import { AiDiffDialog, type DiffPanelPair } from "./AiDiffDialog";

// A comparação lado a lado, a rolagem sincronizada e as abas por módulo saíram
// daqui para o AiDiffDialog, para que a edição por IA na seleção usasse o mesmo
// componente em vez de uma segunda implementação do mesmo diálogo. A interface
// pública deste componente não mudou: quem o usa hoje continua passando
// beforeModules / afterModules / onApply.

interface RestructureDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeModules: { id: string; title: string; content: string | null }[];
  afterModules: { id: string; title: string; content: string }[];
  onApply: () => void;
  applying?: boolean;
}

export function RestructureDiffDialog({
  open,
  onOpenChange,
  beforeModules,
  afterModules,
  onApply,
  applying,
}: RestructureDiffDialogProps) {
  const [selectedModule, setSelectedModule] = useState(0);

  const pairs: DiffPanelPair[] = afterModules.map((mod, i) => ({
    id: mod.id,
    label: `M${i + 1}`,
    before: beforeModules[i]?.content || "",
    after: mod.content || "",
  }));

  return (
    <AiDiffDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pré-visualização da reestruturação"
      pairs={pairs}
      activeIndex={selectedModule}
      onActiveIndexChange={setSelectedModule}
      onAccept={onApply}
      applying={applying}
      acceptLabel="Aplicar mudanças"
      rejectLabel="Descartar"
    />
  );
}
