# Fase 3.12.3 — Diagnóstico de Erro da Chamada IA (PPTX v3)

Patch cirúrgico em `supabase/functions/export-pptx-v3/index.ts`. Bump para `3.12.3-AI-ERR-DIAG`. Deploy ao final.

## Diagnóstico

A v3.12.2 mostrou que **todos os 8 módulos caem no fallback em ~2s** (`[V3-FALLBACK] Module N: generated 6 slides...` aparece imediatamente após `[V3-STAGE-1]`). Isso significa que `callAI()` está lançando exceção antes mesmo de chegar ao `JSON.parse` — portanto os logs `[V3-AI-DIAG]` e `[V3-PARSE-ERR]` nunca disparam.

O catch atual em `generateSlidesForModule` (~linha 2120) registra o erro apenas em `report.warnings` (JSON de resposta), mas **não** em `console.error`, então o motivo real (402, 429, timeout, fetch error) fica invisível nos logs da Edge Function.

## Mudanças

### 1. Bump de versão (linha 8)
`"3.12.2-FALLBACK-FIX"` → `"3.12.3-AI-ERR-DIAG"`.

### 2. Catch detalhado em `generateSlidesForModule` (~linha 2120)

Substituir:
```typescript
} catch (err: any) {
  report.aiCallsFailed++;
  report.fallbacksUsed++;
  report.warnings.push(`[V3-AI] Module ${moduleIndex + 1} AI call failed: ${err.message}. Using fallback.`);
  return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
}
```

Por:
```typescript
} catch (err: any) {
  // PARSE-FIX-DIAG: Expor o erro real nos logs para diagnóstico
  console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} "${moduleTitle}": ${err.message}`);
  console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} error type: ${err.name || 'unknown'}, code: ${err.code || 'none'}`);
  if (err.stack) {
    console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} stack first 300: ${err.stack.substring(0, 300)}`);
  }
  report.aiCallsFailed++;
  report.fallbacksUsed++;
  report.warnings.push(`[V3-AI] Module ${moduleIndex + 1} AI call failed: ${err.message}. Using fallback.`);
  return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
}
```

### 3. Deploy
`supabase--deploy_edge_functions` para `export-pptx-v3`.

## NÃO alterar
`robustJSONParse`, prompt da IA, `buildFallbackSlides`, `normalizeSlide`, `normalizeAndSplitSlide`, render functions, `MIN_FONT`, `SPLIT_LIMITS`, `TECH_IMAGE_QUERIES`, ou qualquer outra função.

## Validação pós-deploy
1. Exportar PPTX do curso de Python.
2. Filtrar logs por prefixo `[V3-AI-ERR]`.
3. As linhas vão revelar a causa raiz: `402 Payment Required`, `429 Rate Limit`, `fetch failed`, `timeout`, etc.

## Rollback
Reverter o bloco do catch para a versão anterior (3 linhas). Risco zero — mudança é apenas log adicional.
