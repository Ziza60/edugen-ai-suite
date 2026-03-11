import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreVertical, Copy, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface Module {
  id: string;
  title: string;
  content: string | null;
  order_index: number;
  course_id: string;
}

interface ModuleSidebarProps {
  modules: Module[];
  activeModuleIndex: number;
  onSelectModule: (index: number) => void;
  courseId: string;
}

function SortableModuleItem({
  mod,
  index,
  isActive,
  onSelect,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
  isFirst,
  isLast,
}: {
  mod: Module;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-start gap-1 rounded-xl px-2 py-2.5 text-sm transition-all ${
        isActive
          ? "bg-primary/10 text-primary font-semibold border border-primary/20"
          : "text-foreground/70 hover:bg-muted hover:text-foreground"
      }`}
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 mt-1 cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <button onClick={onSelect} className="flex items-start gap-2 flex-1 text-left min-w-0">
        <span
          className={`shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold mt-0.5 ${
            isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {index + 1}
        </span>
        <span className="line-clamp-2 leading-snug">{mod.title}</span>
      </button>

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="shrink-0 p-1 rounded-md hover:bg-muted mt-0.5">
              <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Duplicar
            </DropdownMenuItem>
            {!isFirst && (
              <DropdownMenuItem onClick={onMoveUp}>
                <ArrowUp className="h-3.5 w-3.5 mr-2" />
                Mover para cima
              </DropdownMenuItem>
            )}
            {!isLast && (
              <DropdownMenuItem onClick={onMoveDown}>
                <ArrowDown className="h-3.5 w-3.5 mr-2" />
                Mover para baixo
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function ModuleSidebar({ modules, activeModuleIndex, onSelectModule, courseId }: ModuleSidebarProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = modules.findIndex((m) => m.id === active.id);
    const newIndex = modules.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(modules, oldIndex, newIndex);
    const updates = reordered.map((mod, idx) => ({ id: mod.id, order_index: idx }));

    // Optimistic: adjust active index
    if (activeModuleIndex === oldIndex) {
      onSelectModule(newIndex);
    } else if (oldIndex < activeModuleIndex && newIndex >= activeModuleIndex) {
      onSelectModule(activeModuleIndex - 1);
    } else if (oldIndex > activeModuleIndex && newIndex <= activeModuleIndex) {
      onSelectModule(activeModuleIndex + 1);
    }

    await Promise.all(
      updates.map((u) =>
        supabase.from("course_modules").update({ order_index: u.order_index }).eq("id", u.id)
      )
    );
    queryClient.invalidateQueries({ queryKey: ["course-modules", courseId] });
  };

  const handleDuplicate = async (mod: Module) => {
    const maxOrder = Math.max(...modules.map((m) => m.order_index), 0);
    const { error } = await supabase.from("course_modules").insert({
      course_id: courseId,
      title: mod.title + " (cópia)",
      content: mod.content,
      order_index: maxOrder + 1,
    });
    if (error) {
      toast({ title: "Erro ao duplicar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Módulo duplicado!" });
      queryClient.invalidateQueries({ queryKey: ["course-modules", courseId] });
    }
  };

  const handleSwap = async (indexA: number, indexB: number) => {
    const modA = modules[indexA];
    const modB = modules[indexB];
    if (!modA || !modB) return;
    await Promise.all([
      supabase.from("course_modules").update({ order_index: modB.order_index }).eq("id", modA.id),
      supabase.from("course_modules").update({ order_index: modA.order_index }).eq("id", modB.id),
    ]);
    queryClient.invalidateQueries({ queryKey: ["course-modules", courseId] });
    onSelectModule(indexB);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("course_modules").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Módulo excluído" });
      if (activeModuleIndex >= modules.length - 1) {
        onSelectModule(Math.max(0, modules.length - 2));
      }
      queryClient.invalidateQueries({ queryKey: ["course-modules", courseId] });
    }
    setDeleteTarget(null);
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <nav className="space-y-1">
            {modules.map((mod, i) => (
              <SortableModuleItem
                key={mod.id}
                mod={mod}
                index={i}
                isActive={i === activeModuleIndex}
                onSelect={() => onSelectModule(i)}
                onDuplicate={() => handleDuplicate(mod)}
                onMoveUp={() => handleSwap(i, i - 1)}
                onMoveDown={() => handleSwap(i, i + 1)}
                onDelete={() => setDeleteTarget(mod)}
                isFirst={i === 0}
                isLast={i === modules.length - 1}
              />
            ))}
          </nav>
        </SortableContext>
      </DndContext>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              O módulo "{deleteTarget?.title}" será excluído permanentemente, incluindo quizzes e flashcards associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
