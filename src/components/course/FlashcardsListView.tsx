import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface FlashcardsListViewProps {
  flashcards: Flashcard[];
  showUpsell?: boolean;
}

export function FlashcardsListView({ flashcards, showUpsell = false }: FlashcardsListViewProps) {
  return (
    <div className="space-y-4">
      {showUpsell && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span>
            Desbloqueie o <strong className="text-foreground">Modo Flip</strong> no Pro — estude com foco e active recall.
          </span>
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">PRO</Badge>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {flashcards.map((fc) => (
          <Card key={fc.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <p className="font-medium text-sm mb-2 text-primary">Pergunta</p>
              <p className="mb-4">{fc.front}</p>
              <p className="font-medium text-sm mb-2 text-secondary">Resposta</p>
              <p className="text-muted-foreground">{fc.back}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
