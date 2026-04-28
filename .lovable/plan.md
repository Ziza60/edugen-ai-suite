# Fase 3.12.2 — Fix do Fallback + Diagnóstico de Parsing no PPTX v3

Único arquivo: `supabase/functions/export-pptx-v3/index.ts`. Bump para `3.12.2-FALLBACK-FIX`. Deploy ao final.

## Diagnóstico

Os logs mostram slides com 1–2 itens mesmo após Fase 1.1, e takeaways copiando o conteúdo literalmente (ex.: takeaway "🧠 Fundamentos A programação eficaz…"). A causa: os módulos estão caindo no `buildFallbackSlides` (linha 2010), que:

1. Gera chunks finais com 1–2 sentenças.
2. Reaproveita as mesmas sentenças como takeaways.
3. Não passa pelo guard de densidade nem pelo detector anti-cópia (esses vivem em `normalizeSlide` / etapa 6 do `generateSlidesForModule`, mas o fallback retorna direto, sem ser revalidado).
4. Não temos visibilidade do motivo pelo qual o `JSON.parse` da IA falha (catch atual é vazio).

## Mudanças

### 1. Bump de versão (linha 8)
`"3.12.1-QUALITY-PHASE-1-1"` → `"3.12.2-FALLBACK-FIX"`.

### 2. Reescrever `buildFallbackSlides` (linha 2010)
Substituir a função inteira pela versão proposta no pedido:
- Extrai sentenças (25–160 chars), descarta marcadores de seção.
- Capa de módulo com até 3 objetivos.
- **Agrupa sentenças em chunks de 4**; chunks finais com <3 itens são fundidos com o anterior (e re-divididos se passarem de 6).
- Limita a 4 slides de conteúdo (`bullets`), com `sectionLabel: "CONTEÚDO"` e `itemStartIndex` correto.
- Slide final `numbered_takeaways` usando 4 frases sintéticas fixas ("Agora você domina…", "Lembre-se…", etc.) — nunca cópia do conteúdo.
- Log `[V3-FALLBACK] Module N: generated X slides from Y sentences in Z chunks`.

### 3. Diagnóstico de parsing (antes da linha 2108)
Inserir 3 logs `[V3-AI-DIAG]` com:
- Primeiros 300 chars de `rawText`.
- Primeiros 300 chars de `clean`.
- Length de `clean`, e se começa com `[` / termina com `]`.

### 4. Catch detalhado do `JSON.parse` (linhas ~2109–2127)
Substituir o `} catch {` vazio por `} catch (parseErr: any) {` com:
- `console.error [V3-PARSE-ERR]` com mensagem do erro, primeiros 500 chars e últimos 100 chars de `clean`.
- Mantém a tentativa via regex `match(/\[[\s\S]*\]/)`.
- Se o regex parse também falhar: log `[V3-PARSE-ERR] regex extraction also failed`, incrementa `aiCallsFailed` / `fallbacksUsed`, push warning e retorna `buildFallbackSlides`.
- Se não houver match: log `no JSON array found`, mesmo tratamento.
- Sucesso do regex: log `[V3-PARSE-OK]` com tamanho.

### 5. Indicador de fallback no log final (linha 2321)
Substituir o `console.log [V3-MODULE]` para detectar se o módulo usou fallback (procura warning contendo `Module N` + `Using fallback`) e anexa ` (FALLBACK)` ou ` (AI)` ao log.

### 6. Deploy
`supabase--deploy_edge_functions` para `export-pptx-v3`.

## NÃO alterar
`MIN_FONT`, `SPLIT_LIMITS`, `computeUnifiedSlideFontSize`, `estimateTextHeightInches`, `normalizeSlide`, `normalizeAndSplitSlide`, detector de takeaways, `TECH_IMAGE_QUERIES`, prompts, schemas, render functions.

## Validação pós-deploy
Gerar o PPTX do curso de Python e nos logs verificar:
- Quantos módulos aparecem como `(FALLBACK)` vs `(AI)`.
- Se houver fallback, ver `[V3-PARSE-ERR]` para entender o motivo (markdown fence, vírgula trailing, JSON cortado por max_tokens, etc.).
- Slides do fallback agora com ≥3 itens e takeaways genéricos ("Agora você domina…").

## Rollback
Se algo regredir, reverter apenas a mudança 2 (manter o `buildFallbackSlides` antigo) e manter os diagnósticos (mudanças 3–5) para continuar investigando.
