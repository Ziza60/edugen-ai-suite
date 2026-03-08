import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://mckazbpyruthpwsmiqru.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ja2F6YnB5cnV0aHB3c21pcXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MzAwMTQsImV4cCI6MjA4ODUwNjAxNH0.6jD3wRL4swzwRNVjB7tiRKptvCbCe0PKqpQqJ_83mZ4";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Criar usuário temporário e fazer login
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = "test123456";

console.log("1. Criando usuário de teste...");
const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
  email: testEmail,
  password: testPassword,
});

if (signUpError) {
  console.error("Erro ao criar usuário:", signUpError);
  Deno.exit(1);
}

console.log("2. Fazendo login...");
const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
  email: testEmail,
  password: testPassword,
});

if (signInError || !signInData.session) {
  console.error("Erro ao fazer login:", signInError);
  Deno.exit(1);
}

const accessToken = signInData.session.access_token;
const userId = signInData.user.id;

console.log("3. Criando curso de teste...");
const { data: course, error: courseError } = await supabase
  .from("courses")
  .insert({
    user_id: userId,
    title: "Teste Split PPTX",
    language: "pt-BR",
    status: "published",
  })
  .select()
  .single();

if (courseError || !course) {
  console.error("Erro ao criar curso:", courseError);
  Deno.exit(1);
}

console.log("4. Criando módulo com conteúdo longo...");
const { error: moduleError } = await supabase
  .from("course_modules")
  .insert({
    course_id: course.id,
    title: "Sistemas de Gerenciamento",
    content: `## 🎯 Objetivo do Módulo

Compreender os fundamentos dos sistemas de gerenciamento empresarial.

## 🧠 Fundamentos

**Definição**: Sistemas de gerenciamento empresarial são plataformas integradas que automatizam e otimizam processos organizacionais permitindo controle centralizado de operações financeiras administrativas logísticas comerciais e recursos humanos através de módulos especializados interconectados.

**Características principais**: Automação de fluxos de trabalho, integração de dados em tempo real, relatórios analíticos avançados, conformidade regulatória, escalabilidade organizacional, rastreabilidade de transações.

## ⚙️ Como funciona

1. **Coleta centralizada**: O sistema captura dados de todas as áreas da empresa através de interfaces unificadas padronizadas e formulários customizáveis que garantem consistência e integridade das informações desde o ponto de entrada inicial.
2. **Processamento integrado**: Algoritmos de validação verificam a conformidade dos dados enquanto regras de negócio automatizadas executam cálculos transformações e distribuições entre módulos interconectados mantendo sincronização em tempo real.
3. **Análise estratégica**: Motores analíticos processam grandes volumes de dados históricos e transacionais gerando insights preditivos dashboards executivos e relatórios personalizados para suporte à tomada de decisões corporativas.

## 🧩 Modelos / Tipos

- **ERP Tradicional**: Solução completa on-premise com infraestrutura própria customização profunda e controle total dos processos internos ideal para grandes corporações com requisitos regulatórios complexos.
- **Cloud ERP**: Plataforma baseada em nuvem com acesso remoto atualizações automáticas escalabilidade elástica e custos operacionais reduzidos adequada para empresas em crescimento que priorizam agilidade e mobilidade.
- **Híbrido**: Combinação de módulos locais e em nuvem permitindo manter sistemas legados críticos internamente enquanto migra gradualmente processos menos sensíveis para infraestrutura externa.

## 🛠️ Aplicações reais

Indústria manufatureira: controle de produção gestão de estoque rastreamento de qualidade planejamento de capacidade e manutenção preventiva de equipamentos fabris.

Varejo omnichannel: gestão de múltiplos canais de venda sincronização de inventário precificação dinâmica programas de fidelidade e análise comportamental de clientes.`,
    order_index: 0,
  });

if (moduleError) {
  console.error("Erro ao criar módulo:", moduleError);
  Deno.exit(1);
}

console.log("5. Chamando edge function export-pptx...");
const exportResponse = await fetch(
  `${supabaseUrl}/functions/v1/export-pptx`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      course_id: course.id,
      palette: "default",
      density: "standard",
      theme: "light",
    }),
  }
);

if (!exportResponse.ok) {
  const errorText = await exportResponse.text();
  console.error("Erro na exportação:", exportResponse.status, errorText);
  Deno.exit(1);
}

console.log("6. Salvando arquivo PPTX...");
const pptxBlob = await exportResponse.blob();
const arrayBuffer = await pptxBlob.arrayBuffer();
const uint8Array = new Uint8Array(arrayBuffer);

await Deno.writeFile("/tmp/cc-agent/64448711/project/test-output.pptx", uint8Array);

console.log("✅ Arquivo gerado: test-output.pptx");
console.log(`   Tamanho: ${(uint8Array.length / 1024).toFixed(2)} KB`);
