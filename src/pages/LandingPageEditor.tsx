import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ArrowLeft, Globe, Layout, Palette, List, Settings, Eye, Save, Sparkles, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FreeEditor } from "@/components/course/landing/FreeEditor";
import { StarterEditor } from "@/components/course/landing/StarterEditor";
import { ProEditor } from "@/components/course/landing/ProEditor";
import { LandingPreview } from "@/components/course/landing/LandingPreview";
import { UpgradeModal } from "@/components/course/landing/UpgradeModal";
import { Badge } from "@/components/ui/badge";

export default function LandingPageEditor() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("editor");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState("");

  const { data: course, isLoading: loadingCourse } = useQuery({
    queryKey: ["course", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: landing, isLoading: loadingLanding, refetch: refetchLanding } = useQuery({
    queryKey: ["course-landing", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_landings")
        .select("*")
        .eq("course_id", id!)
        .maybeSingle();
      
      if (!data && !error) {
        // Create initial landing if not exists
        const { data: newData, error: createError } = await supabase
          .from("course_landings")
          .insert({
            course_id: id!,
            user_id: user?.id,
            headline: course?.title || "Novo Curso",
            subtitle: "Aprenda tudo sobre este tema com nosso curso especializado.",
            cta_text: "Quero me inscrever",
            slug: `curso-${id?.slice(0, 8)}`,
            template_id: "template1",
            layout_blocks: [
              { type: "hero", content: {} },
              { type: "benefits", content: {} },
              { type: "summary", content: {} },
              { type: "cta", content: {} }
            ]
          })
          .select()
          .single();
        
        if (createError) throw createError;
        return newData;
      }
      
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!course,
  });

  const { data: permissions } = useQuery({
    queryKey: ["landing-permissions", plan],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_page_permissions")
        .select("*")
        .eq("plan", plan!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!plan,
  });

  const saveLanding = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from("course_landings")
        .update(updates)
        .eq("course_id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-landing", id] });
      toast({ title: "Landing page salva!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
  });

  if (loadingCourse || loadingLanding) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course || !landing) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Página não encontrada.</p>
        <Button variant="outline" onClick={() => navigate("/app/dashboard")} className="mt-4">Voltar</Button>
      </div>
    );
  }

  const handleUpgradeClick = (feature: string) => {
    setUpgradeFeature(feature);
    setShowUpgrade(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/app/courses/${id}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar ao Curso
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex flex-col">
              <h1 className="font-display font-bold text-lg leading-none">Editor de Landing Page</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Editando: <span className="font-medium text-foreground">{course.title}</span>
              </p>
            </div>
            <Badge variant="outline" className="ml-2 uppercase text-[10px] tracking-widest font-bold">
              Plano {plan}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(`/c/${landing.slug}`, '_blank')}>
              <Eye className="h-4 w-4 mr-2" />
              Visualizar
            </Button>
            <Button size="sm" onClick={() => saveLanding.mutate(landing)}>
              <Save className="h-4 w-4 mr-2" />
              Salvar
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar Editor */}
        <aside className="w-full lg:w-[450px] border-r border-border bg-card overflow-y-auto h-[calc(100vh-64px)]">
          <div className="p-6">
            <Tabs defaultValue="content" className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-6">
                <TabsTrigger value="content" className="flex items-center gap-2">
                  <Layout className="h-4 w-4" />
                  Conteúdo
                </TabsTrigger>
                <TabsTrigger value="design" className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Design
                </TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="space-y-6">
                {plan === "free" && (
                  <FreeEditor 
                    landing={landing} 
                    onChange={(updates) => saveLanding.mutate(updates)} 
                    onUpgrade={() => handleUpgradeClick("Starter")}
                  />
                )}
                {plan === "starter" && (
                  <StarterEditor 
                    landing={landing} 
                    onChange={(updates) => saveLanding.mutate(updates)} 
                    onUpgrade={() => handleUpgradeClick("Pro")}
                  />
                )}
                {plan === "pro" && (
                  <ProEditor 
                    landing={landing} 
                    onChange={(updates) => saveLanding.mutate(updates)} 
                  />
                )}
              </TabsContent>

              <TabsContent value="design" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Identidade Visual</CardTitle>
                    <CardDescription>Cores e Logo</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Cor Primária</label>
                      <div className="flex gap-2">
                        {['#7c3aed', '#f97316', '#0ea5e9', '#10b981', '#ef4444'].map(color => (
                          <button
                            key={color}
                            className={`w-8 h-8 rounded-full border-2 ${landing.custom_colors?.primary === color ? 'border-foreground' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                            onClick={() => saveLanding.mutate({ custom_colors: { ...landing.custom_colors, primary: color } })}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium">Logotipo</label>
                      {plan === "free" ? (
                        <div 
                          className="p-4 border border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer bg-muted/50"
                          onClick={() => handleUpgradeClick("Starter")}
                        >
                          <Settings className="h-5 w-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Upload de Logo (Starter/Pro)</span>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full text-xs" onClick={() => toast({ title: "Funcionalidade em breve" })}>
                          Fazer upload de logo
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Configurações Avançadas</CardTitle>
                      {plan !== "pro" && <Badge variant="secondary" className="bg-primary/10 text-primary border-none">PRO</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span>Domínio Próprio</span>
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="h-auto p-0" 
                        disabled={plan !== "pro"}
                        onClick={() => plan !== "pro" ? handleUpgradeClick("Pro") : null}
                      >
                        Configurar
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Remover branding EduGenAI</span>
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="h-auto p-0" 
                        disabled={plan !== "pro"}
                        onClick={() => plan !== "pro" ? handleUpgradeClick("Pro") : null}
                      >
                        Ativar
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>CSS Customizado</span>
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="h-auto p-0" 
                        disabled={plan !== "pro"}
                        onClick={() => plan !== "pro" ? handleUpgradeClick("Pro") : null}
                      >
                        Editar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </aside>

        {/* Live Preview */}
        <section className="hidden lg:flex flex-1 bg-muted/30 p-8 overflow-y-auto items-start justify-center">
          <div className="w-full max-w-4xl bg-background shadow-2xl rounded-xl overflow-hidden border border-border min-h-[800px]">
            <LandingPreview landing={landing} />
          </div>
        </section>
      </main>

      <UpgradeModal 
        isOpen={showUpgrade} 
        onClose={() => setShowUpgrade(false)} 
        feature={upgradeFeature} 
      />
    </div>
  );
}
