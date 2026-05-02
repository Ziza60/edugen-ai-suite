import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3,
  Link as LinkIcon, Undo2, Redo2, Sparkles, Loader2,
  Type, Minus, Quote, Code,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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

// ── Markdown ↔ HTML conversion helpers ──
function markdownToHtml(md: string): string {
  let html = md;

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Unordered lists (handle nested with spaces)
  const lines = html.split("\n");
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^[\s]*[-*] (.+)$/);
    const olMatch = line.match(/^[\s]*\d+\. (.+)$/);

    if (ulMatch) {
      if (!inUl) { result.push("<ul>"); inUl = true; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inOl) { result.push("<ol>"); inOl = true; }
      if (inUl) { result.push("</ul>"); inUl = false; }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      // Wrap plain text lines in <p> if they're not already wrapped
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("<")) {
        result.push(`<p>${trimmed}</p>`);
      } else {
        result.push(line);
      }
    }
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  return result.join("\n");
}

function htmlToMarkdown(html: string): string {
  // Use a simple regex-based converter
  let md = html;

  // Remove wrapping divs
  md = md.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "\n");

  // Headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1");

  // Horizontal rules
  md = md.replace(/<hr[^>]*\/?>/gi, "---");

  // Bold and italic
  md = md.replace(/<strong><em>(.*?)<\/em><\/strong>/gi, "***$1***");
  md = md.replace(/<em><strong>(.*?)<\/strong><\/em>/gi, "***$1***");
  md = md.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i>(.*?)<\/i>/gi, "*$1*");

  // Code
  md = md.replace(/<code>(.*?)<\/code>/gi, "`$1`");

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Lists
  md = md.replace(/<ul[^>]*>/gi, "");
  md = md.replace(/<\/ul>/gi, "");
  md = md.replace(/<ol[^>]*>/gi, "");
  md = md.replace(/<\/ol>/gi, "");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1");

  // Blockquotes
  md = md.replace(/<blockquote[^>]*><p>(.*?)<\/p><\/blockquote>/gi, "> $1");
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, "> $1");

  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n");

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up excessive newlines
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
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
}

export function BlockEditor({ content, onChange, isPro = false }: BlockEditorProps) {
  const { toast } = useToast();
  const [enhancing, setEnhancing] = useState(false);
  const sections = useMemo(() => parseSections(content), [content]);

  const initialHtml = useMemo(() => markdownToHtml(content), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
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
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      onChange(md);
    },
  });

  const handleAIEnhance = useCallback(
    async (action: string) => {
      if (!editor || enhancing) return;

      const { from, to } = editor.state.selection;
      const selectedText =
        from !== to
          ? editor.state.doc.textBetween(from, to, "\n")
          : htmlToMarkdown(editor.getHTML());

      if (!selectedText || selectedText.trim().length < 5) {
        toast({ title: "Selecione texto para melhorar", variant: "destructive" });
        return;
      }

      setEnhancing(true);
      try {
        const { data, error } = await supabase.functions.invoke("enhance-paragraph", {
          body: { text: selectedText, action },
        });

        if (error) throw error;
        if (!data?.enhanced) throw new Error("No enhanced text returned");

        if (from !== to) {
          // Replace selection
          const enhancedHtml = markdownToHtml(data.enhanced);
          editor.chain().focus().deleteRange({ from, to }).insertContent(enhancedHtml).run();
        } else {
          // Replace entire content
          const enhancedHtml = markdownToHtml(data.enhanced);
          editor.commands.setContent(enhancedHtml);
          onChange(data.enhanced);
        }

        toast({ title: "Texto melhorado com IA ✨" });
      } catch (err: any) {
        toast({
          title: "Erro ao melhorar texto",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setEnhancing(false);
      }
    },
    [editor, enhancing, onChange, toast]
  );

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
        {isPro ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                disabled={enhancing}
              >
                {enhancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                IA
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleAIEnhance("improve")}>
                <Sparkles className="h-4 w-4 mr-2" />
                Melhorar texto
                <span className="ml-auto text-xs text-muted-foreground">⌘↵</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("simplify")}>
                <Type className="h-4 w-4 mr-2" />
                Simplificar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("expand")}>
                <ListOrdered className="h-4 w-4 mr-2" />
                Expandir
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAIEnhance("fix")}>
                <Code className="h-4 w-4 mr-2" />
                Corrigir erros
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground"
            disabled
            title="Disponível no plano Pro"
          >
            <Sparkles className="h-3.5 w-3.5" />
            IA (Pro)
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
        {isPro && (
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            ⌘+Enter para melhorar com IA
          </span>
        )}
      </div>
    </div>
  );
}
