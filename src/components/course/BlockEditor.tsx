import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3,
  Link as LinkIcon, Undo2, Redo2, Sparkles, Loader2,
  Type, Minus, Quote, Code, Scissors, Layers, Lightbulb,
  FlaskConical, BookOpen, PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AiDiffDialog } from "./AiDiffDialog";
import {
  markdownToHtml,
  htmlToMarkdown,
  stripInternalBlocks,
  restoreProtectedBlocks,
  reconcileProtectedTables,
  type ProtectedBlock,
} from "@/lib/markdown-roundtrip";
import {
  resolverEscopo,
  markdownDoEscopo,
  aplicarEdicaoAprovada,
  ESCOPO_LABEL,
  type EscopoIA,
} from "@/lib/editor-scope";
import { MODO_PADRAO, ROTULOS_IA } from "@/lib/ai-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ── Pedagogical section emojis for visual blocks ──
const SECTION_ICONS: Record<string, string> = {
  "objetivo": "🎯",
  "fundamentos": "🧠",
  "como funciona": "⚙️",
  "modelos": "🧩",
  "tipos": "🧩",
  "aplicações": "🛠️",
  "exemplo": "💡",
  "desafios": "⚠️",
  "cuidados": "⚠️",
  "reflexão": "💭",
  "resumo": "🧾",
  "key takeaways": "📌",
  "takeaways": "📌",
};

function getSectionIcon(title: string): string {
  const lower = title.toLowerCase();
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "📝";
}

// ── Section parser for visual blocks ──
interface Section {
  title: string;
  icon: string;
  content: string;
  startLine: number;
  endLine: number;
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2Match = line.match(/^## (.+)$/);

    if (h2Match) {
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }
      const title = h2Match[1].replace(/^[^\w\s]+\s*/, "").trim();
      currentSection = {
        title: h2Match[1],
        icon: getSectionIcon(title),
        content: "",
        startLine: i,
        endLine: lines.length - 1,
      };
    } else if (currentSection) {
      currentSection.content += (currentSection.content ? "\n" : "") + line;
    }
  }

  if (currentSection) {
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }

  return sections;
}

// ── Toolbar button component ──
function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        isActive
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      {children}
    </button>
  );
}

// ── Main BlockEditor ──
interface BlockEditorProps {
  content: string; // markdown
  onChange: (markdown: string) => void;
  isPro?: boolean;
  isStarter?: boolean;
}

interface EdicaoPendente {
  escopo: EscopoIA;
  action: string;
  /** Os dois lados do diff, já com as tabelas de verdade — é o que o autor lê. */
  antes: string;
  depois: string;
  /** O mesmo "depois", mas com marcadores: é este que vai para o documento. */
  depoisComTokens: string;
  blocos: ProtectedBlock[];
  /** "append" só existe no escopo de módulo (gerar exemplo, atividade…). */
  mode: "append" | "replace";
}

export function BlockEditor({ content, onChange, isPro = false, isStarter = false }: BlockEditorProps) {
  const hasAI = isPro || isStarter;
  const { toast } = useToast();
  const [enhancing, setEnhancing] = useState(false);
  const [pendente, setPendente] = useState<EdicaoPendente | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customEscopoModulo, setCustomEscopoModulo] = useState(false);
  const sections = useMemo(() => parseSections(content), [content]);

  // Blocos que o TipTap não representa (tabelas) ficam fora do editor e voltam
  // no caminho de saída. Sem isto, abrir e fechar o editor já destruía toda
  // tabela do módulo — ver src/lib/markdown-roundtrip.ts.
  const protegidosRef = useRef<ProtectedBlock[]>([]);

  const initialHtml = useMemo(() => {
    // O filtro vem ANTES da proteção de tabelas: se um bloco interno de QA
    // trouxer tabela, ela sai junto com o bloco em vez de virar um marcador
    // órfão apontando para conteúdo que ninguém mais vai ver.
    const { html, protectedBlocks } = markdownToHtml(stripInternalBlocks(content));
    protegidosRef.current = protectedBlocks;
    return html;
  }, []);

  const editor = useEditor({
    extensions: [
      // O StarterKit da v3 já traz a extensão Link. Registrar a nossa por cima
      // deixava duas com o mesmo nome ("Duplicate extension names found:
      // ['link']") e a configuração abaixo — openOnClick e a classe do link —
      // dependia de qual das duas o schema resolvesse primeiro. Desligamos a do
      // StarterKit para que valha a nossa.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Placeholder.configure({
        placeholder: "Comece a escrever o conteúdo do módulo...",
      }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none dark:prose-invert focus:outline-none min-h-[300px] px-4 py-3 prose-headings:font-display prose-headings:font-bold",
      },
      handleKeyDown: (_view, event) => {
        // ⌘+Enter or Ctrl+Enter = AI enhance
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          handleAIEnhance("improve");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      // Os blocos protegidos voltam aqui: é este markdown que o CourseView
      // grava no banco pelo auto-save.
      onChange(htmlToMarkdown(editor.getHTML(), protegidosRef.current));
    },
  });

  // O modo de inserção e os rótulos moram em src/lib/ai-actions.ts, ao lado da
  // lista canônica das ações — um teste compara essa lista com a do servidor,
  // que é o que faltava quando seis ações do menu não existiam lá.
  const DEFAULT_MODE = MODO_PADRAO as Record<string, "append" | "replace">;
  const ACTION_LABELS = ROTULOS_IA as Record<string, string>;

  const handleAIEnhance = useCallback(
    async (
      action: string,
      opcoes?: { mode?: "append" | "replace"; escopoModulo?: boolean; instruction?: string },
    ) => {
      if (!editor || enhancing) return;

      const escopo = resolverEscopo(editor, opcoes?.escopoModulo ?? false);
      const { texto: contextText, tabelas } = markdownDoEscopo(
        editor,
        escopo,
        protegidosRef.current,
      );
      const mode = opcoes?.mode ?? DEFAULT_MODE[action] ?? "replace";

      if (!contextText || contextText.trim().length < 5) {
        toast({
          title: "O módulo está vazio — adicione conteúdo antes de usar a IA",
          variant: "destructive",
        });
        return;
      }

      setEnhancing(true);
      try {
        const { data, error } = await supabase.functions.invoke("enhance-paragraph", {
          body: {
            text: contextText,
            action,
            // O servidor precisa do modo: anexando, ele devolve SÓ o trecho
            // novo; substituindo, o texto inteiro reescrito. Sem isto, "Gerar
            // exemplo → Adicionar ao módulo" recebia o módulo reescrito e o
            // anexava — o conteúdo saía duplicado.
            mode,
            ...(opcoes?.instruction ? { instruction: opcoes.instruction } : {}),
          },
        });

        if (error) {
          // O supabase-js não entrega o corpo das respostas não-2xx em `data`:
          // ele vem preso no erro, e sem abrir isto a função devolveria ao autor
          // um "non-2xx status code" que não diz nada.
          const corpo = await (error as { context?: Response }).context
            ?.json()
            .catch(() => null);
          if (corpo?.truncated) {
            toast({
              title: "O trecho é grande demais para uma edição só",
              description:
                "A IA não conseguiu terminar e o resultado sairia cortado — nada foi alterado. " +
                "Selecione um trecho menor e tente de novo.",
              variant: "destructive",
            });
            return;
          }
          if (corpo?.semEfeito) {
            // Antes isto chegava como sucesso: a função devolvia o próprio texto
            // do autor e o diff abria sem nenhuma diferença, o que se lê como
            // "o botão não faz nada". Dizer que a IA não mudou nada é honesto e
            // dá ao autor o que fazer a seguir.
            toast({
              title: "A IA não mudou nada neste trecho",
              description:
                "Ela considerou que o texto já atende ao que foi pedido. Tente um trecho " +
                "maior, outra ação, ou use “Instrução personalizada” dizendo o que mudar.",
            });
            return;
          }
          throw new Error(corpo?.error ?? (error as Error).message);
        }
        if (!data?.enhanced) throw new Error("Nenhum conteúdo retornado");

        // As tabelas originais voltam para o resultado antes de ele virar diff:
        // o autor precisa aprovar exatamente o que será gravado. Em "append" o
        // texto original continua no documento, então não há original a repor —
        // repor aqui duplicaria toda tabela do módulo.
        const rec = reconcileProtectedTables(
          String(data.enhanced).trim(),
          mode === "append" ? [] : tabelas,
          protegidosRef.current.length,
        );

        // O resultado NÃO é aplicado aqui. Ele fica pendente até o autor aceitar
        // no diff — antes, a IA sobrescrevia a seleção na hora e só depois se
        // via o que havia mudado.
        setPendente({
          escopo,
          action,
          antes: contextText,
          depois: restoreProtectedBlocks(rec.markdown, rec.blocks),
          depoisComTokens: rec.markdown,
          blocos: rec.blocks,
          mode,
        });
      } catch (err: any) {
        toast({
          title: "Erro ao processar com IA",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setEnhancing(false);
      }
    },
    [editor, enhancing, toast],
  );

  /** Aplica a edição aprovada. Só daqui sai escrita no documento. */
  const aceitarEdicao = useCallback(() => {
    if (!editor || !pendente) return;
    const { escopo, depoisComTokens, blocos, action, mode } = pendente;

    const { markdown, protegidos } = aplicarEdicaoAprovada(
      editor,
      escopo,
      depoisComTokens,
      blocos,
      protegidosRef.current,
      mode,
    );
    protegidosRef.current = protegidos;

    // O onUpdate do TipTap dispara o onChange e, com ele, o auto-save do
    // CourseView. setContent não emite update por padrão, então garantimos aqui.
    onChange(markdown);

    setPendente(null);
    toast({ title: ACTION_LABELS[action] ?? "Pronto ✨" });
  }, [editor, pendente, onChange, toast]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL do link:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-border bg-muted/30 flex-wrap">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          title="Título H2"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive("heading", { level: 3 })}
          title="Título H3"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Negrito (⌘B)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Itálico (⌘I)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          title="Código inline"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={setLink} isActive={editor.isActive("link")} title="Link (⌘K)">
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Lista com marcadores"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Lista numerada"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Citação"
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Separador"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Desfazer (⌘Z)"
        >
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Refazer (⌘⇧Z)"
        >
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="flex-1" />

        {/* AI Actions */}
        {hasAI ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                disabled={enhancing}
                data-testid="button-ai-editor"
              >
                {enhancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                IA
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => handleAIEnhance("improve")}>
                <Sparkles className="h-4 w-4 mr-2 text-primary" />
                Melhorar texto
                <span className="ml-auto text-xs text-muted-foreground">⌘↵</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("fix")}>
                <Code className="h-4 w-4 mr-2" />
                Corrigir erros
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("simplify")}>
                <Type className="h-4 w-4 mr-2" />
                Simplificar linguagem
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("shorten")}>
                <Scissors className="h-4 w-4 mr-2" />
                Encurtar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("expand")}>
                <ListOrdered className="h-4 w-4 mr-2" />
                Expandir
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("deepen")}>
                <Layers className="h-4 w-4 mr-2" />
                Aprofundar
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Lightbulb className="h-4 w-4 mr-2" />
                  Gerar exemplo prático
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleAIEnhance("example", { mode: "append" })}>
                    <ListOrdered className="h-4 w-4 mr-2" />
                    Adicionar ao módulo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAIEnhance("example", { mode: "replace" })}>
                    <Scissors className="h-4 w-4 mr-2" />
                    Substituir exemplo existente
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => handleAIEnhance("practical")}>
                <FlaskConical className="h-4 w-4 mr-2" />
                Transformar em aula prática
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("activity")}>
                <BookOpen className="h-4 w-4 mr-2" />
                Adicionar atividade
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => { setCustomText(""); setCustomEscopoModulo(false); setCustomOpen(true); }}
                data-testid="menu-ai-custom"
              >
                <PenLine className="h-4 w-4 mr-2 text-primary" />
                Instrução personalizada…
              </DropdownMenuItem>

              {/* O escopo padrão é a seleção ou a seção sob o cursor. O módulo
                  inteiro continua acessível, mas exige escolha explícita. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Layers className="h-4 w-4 mr-2" />
                  Aplicar ao módulo inteiro
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleAIEnhance("improve", { escopoModulo: true })}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Melhorar o módulo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAIEnhance("simplify", { escopoModulo: true })}>
                    <Type className="h-4 w-4 mr-2" />
                    Simplificar o módulo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { setCustomText(""); setCustomEscopoModulo(true); setCustomOpen(true); }}
                  >
                    <PenLine className="h-4 w-4 mr-2" />
                    Instrução personalizada…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground"
            disabled
            title="Disponível nos planos Starter e Pro"
          >
            <Sparkles className="h-3.5 w-3.5" />
            IA
          </Button>
        )}
      </div>

      {/* ── Section indicators (left sidebar) ── */}
      <div className="flex">
        {sections.length > 1 && (
          <div className="w-10 shrink-0 border-r border-border bg-muted/20 py-3">
            <div className="flex flex-col items-center gap-2">
              {sections.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  title={s.title}
                  className="text-base hover:scale-125 transition-transform cursor-default"
                  onClick={() => {
                    // Scroll to section heading in editor
                    const headings = editor?.view.dom.querySelectorAll("h2");
                    if (headings?.[i]) {
                      headings[i].scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  {s.icon}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Editor content ── */}
        <div className="flex-1 overflow-y-auto max-h-[60vh]">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Bubble menu removed — toolbar at top provides all formatting */}

      {/* ── Footer status ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
        <span>{sections.length} seções · {content.split("\n").length} linhas</span>
        {hasAI && (
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            ⌘+Enter para melhorar com IA
          </span>
        )}
      </div>

      {/* ── Instrução personalizada ── */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4 text-primary" />
              Instrução personalizada
            </DialogTitle>
            <DialogDescription>
              Diga o que fazer com {customEscopoModulo ? "o módulo inteiro" : "o trecho selecionado (ou a seção sob o cursor)"}.
              O resultado aparece antes de ser aplicado.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customText.trim().length >= 3) {
                e.preventDefault();
                const instrucao = customText.trim();
                setCustomOpen(false);
                handleAIEnhance("custom", { instruction: instrucao, escopoModulo: customEscopoModulo });
              }
            }}
            maxLength={400}
            autoFocus
            placeholder="Ex: reescreva em tom mais direto, com exemplos do varejo"
            data-testid="input-ai-custom-instruction"
          />
          <DialogFooter className="gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground self-center">{customText.length}/400</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCustomOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={customText.trim().length < 3 || enhancing}
                onClick={() => {
                  const instrucao = customText.trim();
                  setCustomOpen(false);
                  handleAIEnhance("custom", { instruction: instrucao, escopoModulo: customEscopoModulo });
                }}
                data-testid="button-ai-custom-run"
              >
                {enhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gerar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Diff antes/depois: nada é escrito no documento até "Aceitar" ── */}
      {pendente && (
        <AiDiffDialog
          open
          onOpenChange={(o) => { if (!o) setPendente(null); }}
          title={ACTION_LABELS[pendente.action]?.replace(" ✨", "") ?? "Sugestão da IA"}
          pairs={[{
            id: "ai",
            label: "Trecho",
            before: pendente.antes,
            after: pendente.mode === "append"
              ? `${pendente.antes}\n\n${pendente.depois}`
              : pendente.depois,
          }]}
          onAccept={aceitarEdicao}
          onReject={() => setPendente(null)}
          acceptLabel="Aceitar"
          rejectLabel="Rejeitar"
          hint={`Escopo: ${ESCOPO_LABEL[pendente.escopo.tipo]}${
            pendente.escopo.tipo === "secao" ? ` — ${pendente.escopo.titulo}` : ""
          }`}
        />
      )}
    </div>
  );
}
