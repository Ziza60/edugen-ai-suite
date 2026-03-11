import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Send, BrainCircuit, GraduationCap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { v4 as uuidv4 } from "uuid";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function getSessionToken(): string {
  const key = "tutor_session_token";
  let token = sessionStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    sessionStorage.setItem(key, token);
  }
  return token;
}

export default function TutorPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionToken = useRef(getSessionToken());

  const { data: course, isLoading: loadingCourse, error } = useQuery({
    queryKey: ["tutor-course", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, title, description")
        .eq("tutor_slug" as any, slug!)
        .eq("tutor_enabled" as any, true)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const q = input.trim();
    if (!q || loading || !slug) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("tutor-chat", {
        body: {
          course_slug: slug,
          question: q,
          session_token: sessionToken.current,
          history: newMessages.slice(-6),
        },
      });

      if (error) throw error;
      setMessages([...newMessages, { role: "assistant", content: data.answer }]);
    } catch (err: any) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  if (loadingCourse) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-md px-6">
          <BrainCircuit className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Tutor não disponível</h1>
          <p className="text-muted-foreground text-sm">
            Este tutor pode estar desativado ou o curso não está publicado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <BrainCircuit className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground truncate">Tutor IA</h1>
            <p className="text-xs text-muted-foreground truncate">{course.title}</p>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16 space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <GraduationCap className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Olá! Sou o Tutor IA deste curso.</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Faça perguntas sobre o conteúdo do curso e eu vou te ajudar a entender melhor os temas abordados.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {["Qual o resumo do curso?", "Quais são os principais conceitos?", "Explique o módulo 1"].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="text-xs bg-muted hover:bg-muted/80 text-foreground rounded-full px-3 py-1.5 transition-colors"
                    >
                      {suggestion}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-li:my-0.5">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Pensando...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Faça uma pergunta sobre o curso..."
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px] max-h-[120px]"
            rows={1}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            size="icon"
            className="h-11 w-11 rounded-xl shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground mt-2 max-w-3xl mx-auto">
          Respostas geradas por IA com base exclusivamente no conteúdo do curso.
        </p>
      </div>
    </div>
  );
}
