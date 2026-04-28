# Fase 1.1 — Correções de Qualidade no PPTX v3

Arquivo único: `supabase/functions/export-pptx-v3/index.ts`. Bump de versão para `3.12.1-QUALITY-PHASE-1-1`. Após editar, fazer deploy da Edge Function.

## Mudanças

### 1. Bump de versão (linha 8)
`"3.12.0-QUALITY-PHASE-1"` → `"3.12.1-QUALITY-PHASE-1-1"`.

### 2. Reforçar guard de densidade em `normalizeSlide()` (linhas 1956–1963)
Substituir o bloco atual pelo novo guard:
- Itens substanciais agora exigem ≥25 chars (antes 20).
- Drop se houver <2 itens substanciais (com log `[V3-GUARD-DROP]`).
- **Novo**: drop se soma total de chars dos itens substanciais < 120.
- Mantém o corte para ≤6 itens.

### 3. Detector de takeaways copiados em `generateSlidesForModule()`
Inserir novo bloco `// 6. QUALITY-PHASE-1.1` logo após a etapa 5 (anti-repetição) e antes do `console.log` final do módulo (entre linhas 2201 e 2203).

Lógica:
- Localiza o slide `numbered_takeaways` em `compacted`.
- Coleta frases normalizadas (lowercase, sem pontuação final, espaços normalizados, >15 chars) de todos os outros slides do módulo (exceto `module_cover`).
- Marca takeaway como duplicado se `normalized === prev`, `includes(prev)` ou `prev.includes(normalized)`.
- Se houver duplicados:
  - Adiciona warning `[V3-TAKEAWAYS-DUP]`.
  - Se restarem <2 únicos: substitui por fallback bilíngue (PT/ES/EN, 4 frases) + warning `[V3-TAKEAWAYS-FALLBACK]`.
  - Senão: mantém os únicos e completa com 1 frase genérica se total <4.
- Detecção de idioma via prefixo de `language` (`Port` → pt, `Span` → es, default en).

### 4. Expandir `TECH_IMAGE_QUERIES` (antes do `};` na linha 1291)
Adicionar **apenas as chaves que ainda não existem** no dicionário (várias da lista proposta já estão presentes — docker, kubernetes, devops, ML/AI, finanças, marketing, etc., serão omitidas para não duplicar):

Novas entradas a inserir:
- Estruturas/programação: `estruturas de dados`, `programação orientada a objetos`, `orientação a objetos`, `manipulação de arquivos`, `tratamento de exceções`, `testes automatizados`, `testes unitários`, `unittest`, `projeto final`, `primeiros passos`, `fundamentos`, `funções e módulos`, `organização de código`, `boas práticas`, `csv e json`, `ambiente de desenvolvimento`, `depuração`, `pypi`, `utilitário`.
- Técnicas faltantes: `criptografia`, `autenticação`, `microsserviços`, `serverless`.
- Domínios faltantes: `realidade virtual`, `realidade aumentada`.

(Chaves duplicadas como `devops`, `docker`, `kubernetes`, `machine learning`, `inteligência artificial`, `data science`, `gestão de projetos`, `liderança`, `empreendedorismo`, `produtividade`, `finanças`, `marketing`, `recursos humanos`, `matemática`, `estatística`, `medicina`, `direito`, `psicologia`, `engenharia`, `arquitetura`, `comunicação`, `oratória`, `negociação`, `criatividade`, `sustentabilidade`, `segurança`, `cyber security`, `blockchain`, `iot`, `games`, `fotografia`, `edição de vídeo` já existem e serão preservadas.)

### 5. Deploy
Executar `supabase--deploy_edge_functions` para `export-pptx-v3`.

## NÃO alterar
`MIN_FONT`, `SPLIT_LIMITS`, `computeUnifiedSlideFontSize`, `estimateTextHeightInches`, prompt, schemas, ou qualquer função de renderização.

## Validação pós-deploy
Gerar curso de teste (Python) e checar:
- Nenhum slide de conteúdo com 1–2 itens.
- Slide "Principais Aprendizados" com frases sintéticas (não cópia literal).
- Imagens de módulos como "Estruturas de Dados", "POO", "Tratamento de Exceções" mais técnicas.
- Logs com `[V3-GUARD-DROP]` e/ou `[V3-TAKEAWAYS-DUP]` quando aplicável.

## Rollback
Se aparecer overflow ou perda excessiva de slides, reverter apenas a mudança 2 (manter threshold antigo de 20 chars e remover regra de 120 chars totais).
