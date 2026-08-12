# Geração de curso em duas fases

## Por que mudou

A Edge Function tem teto de **150 s de wall clock** no plano gratuito (400 s em
background no pago). Um curso de 5 módulos são ~21 chamadas ao Gemini e não cabe
nessa janela — a geração morria em 150,0 s cravados, com os módulos pela metade.

A correção não foi espremer mais trabalho na janela; foi encurtar cada janela.
O tamanho do curso agora aumenta o **número de invocações**, não a duração de
cada uma. Um curso de 10 módulos usa a mesma janela de um de 2.

## As peças

| Arquivo | Papel | Duração típica |
|---|---|---|
| `_shared/course-pipeline.ts` | Schemas, prompts, normalização, validação, reparo, renderização. Sem entrypoint HTTP. | — |
| `_shared/course-dispatch.ts` | Despacho dos jobs e comparação de segredo em tempo constante. | — |
| `generate-course/` | **Fase 1**: autentica, aplica limites, gera o blueprint, cria o curso, enfileira os jobs e despacha. | ~40 s |
| `generate-course-module/` | **Fase 2**: gera **um** módulo por invocação. | ~50 s no pior caso |
| `generate-course-dispatch/` | Rede de segurança: repesca job pendente, órfão ou com tentativa sobrando. | ~1 s |

## Fluxo

```
cliente ──POST──> generate-course
                    ├── blueprint (~33 s)
                    ├── INSERT courses (generation_blueprint, generation_params)
                    ├── INSERT course_generation_jobs  (1 por módulo)
                    ├── despacha N x generate-course-module   (fire-and-forget)
                    └── SSE: complete { courseId, async: true }   ← fecha aqui

generate-course-module (x N, em paralelo)
                    ├── claim_course_generation_job   ← atômico, evita duplicata
                    ├── responde 202 imediatamente
                    └── waitUntil: gera → INSERT course_modules → job = done
                                   └── refresh_course_generation_progress
```

## Contrato para o front-end

A mudança essencial: **`type: "complete"` não significa mais "curso pronto"**.
Significa "curso planejado e módulos enfileirados". O payload traz `async: true`
para deixar isso explícito.

```jsonc
// evento final do SSE da fase 1
{
  "type": "complete",
  "courseId": "uuid",
  "status": "generating",
  "modules": 5,
  "dispatched": 5,
  "async": true,
  "follow": { "table": "course_generation_jobs", "filter": "course_id=eq.<uuid>" }
}
```

### Acompanhamento — Realtime (recomendado, disponível no plano gratuito)

```ts
supabase
  .channel(`course-${courseId}`)
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "course_generation_jobs",
    filter: `course_id=eq.${courseId}`,
  }, ({ new: job }) => {
    // job.status: pending | running | done | failed
    // job.module_index, job.attempts, job.last_error
  })
  .subscribe();
```

### Acompanhamento — polling (alternativa)

```ts
const { data } = await supabase
  .from("courses")
  .select("generation_status, modules_expected, modules_completed")
  .eq("id", courseId)
  .single();
```

`generation_status` percorre:

| Status | Significado |
|---|---|
| `generating` | Ainda há job pendente ou rodando |
| `ready` | Todos os módulos concluíram |
| `needs_review` | Ao menos um módulo falhou — **o curso é entregue parcial** |
| `failed` | Nenhum módulo pôde ser gerado |

A regra é degradar, não descartar: um curso com 4 de 5 módulos fica disponível e
marcado para revisão, em vez de ser jogado fora.

## Rede de segurança (opcional, mas recomendada)

Sem ela, um despacho perdido deixa o curso parado em `generating` para sempre.
Com ela, o pior caso vira "o módulo demora um minuto a mais".

```sql
-- Guarde o segredo no Vault; não deixe a service role key no cron.
select vault.create_secret('<COURSE_DISPATCH_SECRET>', 'course_dispatch_secret');

select cron.schedule(
  'course-generation-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-course-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'course_dispatch_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

> O `pg_cron` tem timeout de ~5 s ao chamar Edge Function. Não é problema aqui:
> a função de dispatch responde em ~1 s e os workers respondem 202 na hora,
> trabalhando em `waitUntil`.

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `COURSE_MODULE_DEADLINE_MS` | `110000` | Orçamento de uma invocação de módulo |
| `COURSE_DISPATCH_SECRET` | — | Segredo do cron; sem ele, só a service role key autentica |
| `COURSE_LESSON_CONCURRENCY` | `3` | Lições em paralelo dentro de um módulo |
| `COURSE_SOFT_DEADLINE_MS` | `120000` | Orçamento da fase 1 (blueprint) |

## Ordem de implantação

1. Aplicar a migration `20260802120000_course_generation_jobs.sql`.
2. `supabase functions deploy generate-course-module`
3. `supabase functions deploy generate-course-dispatch`
4. `supabase functions deploy generate-course`
5. Atualizar o front para tratar `async: true`.
6. Agendar o cron.

Os passos 2 e 3 vêm antes do 4 de propósito: assim que a fase 1 nova entra no ar
ela começa a despachar, e o worker precisa já existir.
