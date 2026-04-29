-- Tabela para armazenar cache de respostas da IA
CREATE TABLE IF NOT EXISTS public.ai_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    input_hash TEXT UNIQUE NOT NULL,
    model TEXT NOT NULL,
    action_type TEXT,
    prompt_preview TEXT, -- Apenas para debug humano, não usado na lógica
    response_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON public.ai_cache(input_hash);

-- Habilitar RLS
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;

-- Políticas: Apenas o service role (backend) pode ler/escrever por padrão, 
-- mas vamos permitir select para usuários autenticados se quisermos cache compartilhado (ex: Tutor IA)
CREATE POLICY "Enable read access for authenticated users" ON public.ai_cache
    FOR SELECT TO authenticated USING (true);

-- Função de limpeza opcional para cache antigo (pode ser executada via cron no futuro)
-- DELETE FROM public.ai_cache WHERE created_at < now() - interval '30 days';
