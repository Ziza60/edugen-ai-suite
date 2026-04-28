# Fase 1 — Melhorias de Qualidade no PPTX v3

Todas as alterações são no arquivo único `supabase/functions/export-pptx-v3/index.ts`. Após o deploy da Edge Function, basta gerar um PPTX para validar.

## Mudanças

### 1. Bump de versão
- `ENGINE_VERSION` (linha 8): `"3.11.7-BALANCED-DENSITY"` → `"3.12.0-QUALITY-PHASE-1"`.

### 2. Reescrita do `buildSlidePrompt()` (linha ~1469)
Substituir a função inteira pela nova versão fornecida, que:
- Força densidade mínima por slide (3-4 / 4-5 / 5-6 itens conforme densidade).
- Padrão obrigatório `Conceito: Explicação completa.` em cada item.
- Takeaways como **síntese** (`Agora você sabe...`, `Lembre-se: ...`), nunca repetição literal.
- Slide `example_highlight` obrigatório por módulo, com 4 fases canônicas.
- Variedade de layouts (no máx. 2x o mesmo seguidos).
- Catálogo completo de layouts disponíveis com regras claras.
- Exemplo dourado de saída JSON ao final.

### 3. Reforço dos guards em `normalizeSlide()` (linhas 1824-1832)
Substituir o bloco atual pelo novo guard reforçado:
- Mantém o drop de slides vazios.
- Exige `tableRows.length >= 2` para considerar tabela válida.
- **Novo requisito mínimo de densidade**: slides de conteúdo precisam de ≥2 itens com ≥20 caracteres; caso contrário são descartados.
- Filtra itens muito curtos (<20 chars) automaticamente, mantendo até 6.

### 4. Ajuste de `SPLIT_LIMITS` (linha 239)
- `MAX_TOTAL_CHARS`: 580 → **500** (split preventivo antes de cair no piso de fonte).
- `MAX_ITEM_CHARS_HARD`: 220 → **180** (itens longos são quebrados mais cedo).

### 5. Ajuste de `shouldForceContinuation()` (linha 477)
- `bullets`: thresholds passam de `unified <= 17.5 || longest > 110` para **`<= 18.5 || > 100`**.
- `summary_slide` / `numbered_takeaways`: de `<= 17 || > 100` para **`<= 18 || > 90`**.
- `grid_cards`: inalterado.

### 6. Dicionário técnico + nova `buildImageQuery()` (linha ~1187)
- Adicionar a constante `TECH_IMAGE_QUERIES` (Record completo: linguagens, áreas técnicas, bancos, ferramentas, negócios, áreas acadêmicas, soft skills, domínios) **antes** da função.
- Substituir `buildImageQuery` pela nova versão que:
  1. Faz match exato de termos no dicionário (prioridade máxima).
  2. Cai no fluxo atual `PT_EN_MAP` + `PT_STOP_WORDS` se nada bater.
  3. Sufixo melhorado: `education professional` se houver âncora visual técnica, senão `learning education` (substitui o genérico anterior).

### 7. Campo opcional `coverQuery` no SlidePlan
- `SlidePlanSchema` (linha 10): adicionar `coverQuery: z.string().max(100).optional()`.
- `interface SlidePlan` (linha 126): adicionar `coverQuery?: string;`.
- Não há uso ainda — apenas reserva o campo para a IA poder sugerir queries customizadas em fases futuras.

## O que NÃO será alterado
- `MIN_FONT`, `computeUnifiedSlideFontSize`, `estimateTextHeightInches` e demais constantes de geometria — calibradas para evitar overflow.
- Restante do `repairPptxPackage` (já validado em iterações anteriores).
- Layouts de renderização (`renderBullets`, etc.) — mantidos como estão.

## Plano de rollback
Se aparecer overflow após o deploy, reverter **apenas** `SPLIT_LIMITS.MAX_TOTAL_CHARS` para 580; demais mudanças permanecem.

## Validação pós-deploy
Gerar 1 curso de teste (ex.: Python) e verificar:
- Nenhum slide com 1-2 itens de conteúdo.
- Takeaways usando expressões de síntese.
- Imagens de capa contextualmente relevantes (ex.: Python → "python programming code").
- Zero transbordo visual.
