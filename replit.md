# EduGenAI — AI-Powered Course Creation SaaS

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Auth, Database, Edge Functions, Storage)
- **Billing**: Stripe (Free/Pro plans)
- **AI**: AI Gateway (course generation)

## Project Structure
```
src/                          # React frontend
  components/                 # UI components (shadcn/ui based)
  hooks/                      # React hooks (useAuth, etc.)
  integrations/supabase/      # Supabase client + types
  pages/                      # Route pages

supabase/functions/           # Supabase Edge Functions (Deno)
  export-pptx/index.ts        # PPTX exporter v1 (legacy)
  export-pptx-v2/index.ts     # PPTX exporter v2 (legacy)
  export-pptx-v3/index.ts     # PPTX exporter v3 (v4.0.0-COMMERCIAL, DEFAULT native engine)
  export-pptx-2slides/        # PPTX via 2Slides AI API (v1.0.0-2SLIDES) — premium design
  export-pptx-v3-magicslides/ # PPTX via MagicSlides API (legacy, requires paid credits)
  generate-course/            # AI course generation
  export-pdf/                 # PDF export
  export-scorm/               # SCORM export
  export-notion/              # Notion export
  check-subscription/         # Stripe subscription check
  check-entitlements/         # Plan entitlements
  create-checkout/            # Stripe checkout
  customer-portal/            # Stripe portal
  reprocess-flashcards/       # Flashcard reprocessing
  restructure-modules/        # Module restructuring
  upload-course-source/       # Source upload
  validate-certificate/       # Certificate validation
```

## Replit Configuration
- Vite dev server: host 0.0.0.0, port 5000
- No Node.js backend server needed (pure frontend + Supabase)
- Supabase client gracefully handles missing credentials (shows warning)

## Environment Variables Needed
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/public key

## Student Portal — `/learn/:slug` (v1.0)
Public URL where students access a course without registration. Shares the same slug as the landing page (`/c/:slug`).
- **Edge function**: `supabase/functions/get-course-portal/index.ts` — GET ?slug returns all portal data (course, modules, flashcards, quizzes); POST {courseId, studentName} issues a certificate using course owner's user_id.
- **Page**: `src/pages/StudentPortal.tsx` — full dark-themed portal (Udemy-style) with:
  - Sticky header with progress bar
  - Collapsible sidebar with module list + completion status
  - Markdown renderer for module content
  - Inline 3D flip flashcard player
  - Multiple-choice quiz with score + explanations
  - Progress persisted in localStorage per courseId
  - Certificate modal (student enters name → edge function → redirect to /certificate/:token)
- **Landing page**: Added "Acessar curso" + "Começar agora" buttons to `/c/:slug` pointing to `/learn/:slug`
- **Route**: `/learn/:slug` added to `src/App.tsx`

## YouTube → Curso (Feature)
- **Edge function**: `supabase/functions/analyze-youtube/index.ts` — extrai transcrição, salva como course_source, analisa com Gemini (título/tema/público/módulos/idioma)
- **UI**: `src/components/course/YouTubeImportScreen.tsx` — tela dedicada com URL input, loading steps animados, preview das sugestões da IA
- **Fluxo**: TemplateSelector → card YouTube → YouTubeImportScreen → auto-preenche formulário (title/theme/audience/language/modules) + ativa useSources com a transcrição como fonte → wizard pré-preenchido
- **Compatível**: qualquer vídeo com legendas automáticas ou manuais (pt-BR, pt, en, es, fr, de)

## PPTX Exporter v5 (Active Engine — export-pptx-v4)

**Files**
- `supabase/functions/export-pptx-v4/index.ts` (~7460 lines, `ENGINE_VERSION="5.2.2"`) — pipeline orchestrator + renderer
- `supabase/functions/export-pptx-v4/presentation-plan.ts` (~1090 lines) — Presentation Planner (active path)

**Pipeline**
```
Course MD → PresentationPlan (per-module LLM, 3-wide batch)
          → validate (11 checks) → repair → V5SlideLike
          → per-module gate ──┬─ accepted → split / variety / semanticQualityGate
                              └─ rejected → legacy processBatch (THIS module only)
          → sanitize → PPTX QA Engine (11 checks) → Resolution Cascade (L1/L2/L3)
          → sanitize → QA Veto → Render → Export
```

### Active path: Presentation Planner (v5.2.2)

**Module exports** (`presentation-plan.ts`)
- `PresentationSlide`, `PresentationPlan`, `PlanIntent` (`module_cover` | `concept` | `example` | `code_walkthrough` | `process` | `comparison` | `cards` | `takeaways` | `summary` | `closing`)
- `generatePresentationPlan(input)` — per-module Gemini call, 3-wide batch, prompt embeds module allow/deny + hard contract (3-5 slides, module coherence, no truncation, no generic objectives)
- `validatePresentationPlan(plan, courseTitle)` — 11 deterministic checks: `MISSING_TITLE`, `EMPTY_SLIDE`, `INVALID_INTENT`, `TOO_MANY_BULLETS`, `CODE_TOO_LONG`, `EMPTY_ITEM`, `GENERIC_OBJECTIVE`, `TRUNCATED_SENTENCE`, `CODE_IN_BULLET`, `DOMAIN_CONTAMINATION` / `SQL_IN_PYTHON`, `DUPLICATE_SLIDE`. Cross-module-leak in title is **fatal**.
- `repairPlan(plan, report, courseTitle)` — drops fatals, filters bad items, promotes code-in-bullet to `code` field, caps bullets/code, dedupes; returns stats
- `presentationPlanToV5Slides(plan)` — converts to `V5SlideLike[][]`

**Hard rules baked into prompt + parser**
- Exactly 3-4 slides/module (parser slices to 4, preserves trailing `takeaways`/`summary`/`closing`). Prompt: "Prefer 3 slides for short/simple modules; use 4 only when truly needed."
- One idea per slide; max 5 items; ≤15 words/item; code in `code` field (≤12 lines); last slide must be `takeaways`
- "Every slide MUST teach a concept that belongs to '${moduleTitle}'. Do NOT teach concepts that belong to other modules."

**Per-module Python rules** (`PYTHON_MODULE_RULES`) — title regex + allow/deny lists + hard `denyPatterns`:

| kind | matches | forbids |
|---|---|---|
| `fundamentals` | "fundamentos" / "introdução" / "básico" | SQL DDL/DML, POO, herança |
| `control_flow` | "controle de fluxo" / "funções" / "loops" | SQL, classes POO |
| `data_structures` | "estruturas de dados" / "listas" / "dicionários" | SQL DDL/DML, JOIN, "banco de dados relacional", chave primária |
| `files_exceptions` | "arquivos" / "exceções" / "tratamento de erros" | SQL, POO avançado |
| `json_apis` | "JSON" / "APIs" / "HTTP" | SQL CREATE TABLE |
| `oop` | "POO" / "orientado a objetos" / "herança" | SQL + 9 fundamentals patterns (variáveis básicas, tipos primitivos, operadores aritméticos, expressões aritméticas, input()/print() topic, atribuição simples, hello world, sintaxe básica) |
| `tests_logs` | "testes" / "logs" / "depuração" | SQL + 3 fundamentals patterns |
| `best_practices` | "boas práticas" / "implantação" / "deploy" / "CI/CD" | SQL + 6 fundamentals patterns |

**Cross-module leak detector** (`isCrossModuleBasicLeak(text, moduleTitle)`)
`ADVANCED_MODULE_TITLE_RE` (POO / herança / encapsul / polimorf / boas práticas / implant / deploy / avançado / otimiz / performance / CI-CD / monitora / segurança / refactor / arquitetura / testes / logs / depura / debug) × `FUNDAMENTALS_TOPIC_RE` (variáveis básicas/primitivas/e tipos/simples, **variáveis,? tipos e operadores**, tipos primitivos, operadores aritméticos/básicos/de atribuição, expressões aritméticas, **expressões e atribuições**, **criar expressões**, hello world, sintaxe básica do python, atribuição simples/básica/de valores, entrada/saída básica, **entrada e saída com variáveis**, **aplicar entrada e saída**, input() e print()). Wired into validation 7b (item, fixable) + 7c (title, FATAL) + repair `cleanItems` + `filterColumn` + non-item field guard.

**Truncation patterns** (`isTruncatedSentence`)
Catches: ending in `,:\-(`, `,.$` (verdadeiro ou falso,.), stripped tokens (`com e`, `com :`, `(Ex: )`, `objeto ().`), `,\s+e\s+'X'` (abertura, e 'a'), `\bcom\s*,\s+e\s+` (leitura com, e escrita), bare verb+`e`+preposition with **30+ verbs** (Trata/Captura/Utilizar/Garantir/Permite/Habilita/Verifica/Analisa/Identifica/Prepara/Limpa/etc), verb→`para` with no object (`^Use\s+para`, `^Utilizar\s+para`), leading `e` + verb (`^e preparam`), orphan comma in parens (`\(\s*,` — "(, ERROR)"), bare "Que [Title-Case]" ending in `?` or with 2+ Title-Case words and no "Por Que" anywhere, `(leitura|escrita|abertura|fechamento|entrada|saída)\s+com\s*,`. **15/15 truncation tests pass.**

**Per-module gate** (`runPipeline`, index.ts ~line 6892)
A module is accepted ONLY if all three hold:
1. `1 ≤ slideCount ≤ 4`
2. zero fatal validation issues for this `moduleIndex`
3. zero residual semantic blockers (`DOMAIN_CONTAMINATION` / `SQL_IN_PYTHON` / `GENERIC_OBJECTIVE` / `CODE_IN_BULLET` / `TRUNCATED_SENTENCE`) for this `moduleIndex`

Failing modules fall back to **legacy `processBatch` for THAT INDEX ONLY** — accepted modules still benefit from clean planner output. If `generatePresentationPlan` throws entirely, all modules fall back. The QA veto stays active in both paths. **7/7 gate-logic tests pass.**

**Logs**
- `[PRESENTATION-PLAN]` — module/slide counts, intents breakdown, repair stats (repaired_objectives, blocked_contamination, moved_code, removed_duplicates, removed_truncated, capped_bullets, capped_code, modules_failed)
- `[PRESENTATION-PLAN-VALIDATION]` — `PASSED` / `FAILED` + issues by type
- `[PRESENTATION-PLAN] module N ("title") rejected: slides=X, fatals=Y, blockers=Z → legacy fallback for this module only`
- `[PRESENTATION-PLAN] per-module gate: accepted=N/M | fallback_indices=[...]`

### Legacy safety net (pre-planner pipeline — still active)

These layers run AFTER the planner output (or legacy fallback) flows through, so any residual damage from either path gets caught. Built up across hardening passes 1-16 (full history in git).

**Pipeline order**: Parse → Segment → **VisualPlanner** → LayoutVariety → SemanticQualityGate → TemplateSplits → **Sanitize** → **PPTX QA Engine** → **Cascade** → **Sanitize** → **QA Veto** → Render → Export

**Visual Planner** (heuristic, no AI) — `SlideVisualPlan { slideId, intent, emotionalWeight, focalElement, pacingRole, densityTolerance, preferredLayout?, fallbackLayouts? }`. `createVisualPlan(slide, prevSlides, moduleContext)` analyzes title keywords + item count + density to detect intent (`code`/`comparison`/`process`/`summary`/`impact`/`example`/`concept`/`educational`) and pacingRole (`module_transition`/`recap`/`deep_dive`/`visual_break`/`normal`). `chooseLayout` uses it for layout hint, visual-break enforcement, and anti-repetition fallback. Plan=null → 100% original behavior.

**Domain guard** — `inferCourseDomain()` + `detectDomainContamination()` block SQL/DDL leaking into Python (and vice versa). Inspects ONLY `slide.code` after `stripCommentsAndStrings()`. Module allow-lists are ecosystem-aware (postgres/mysql/oracle/pandas/numpy/django/flask/node/react/etc).

**Detectors** — `HARD_SQL_PROSE_RE` + `PT_SQL_DDL_RE` + `BARE_SQL_UPPER_RE` + `BARE_SQL_DDL_VERBS_RE` (DROP/TRUNCATE/CREATE/ALTER) + `BROADER_PT_DB_RE`; `isGenericLearningObjective` (3 patterns including "em + concrete-tech-noun" application context); `detectBrokenNaturalLanguage` (5 patterns); `detectIncompleteTechnicalSentence` (10 patterns); `detectTechnicalDamage` (10 patterns including `STRIPPED_LEADING_COMMA_RE`, `BARE_COM_E_RE`, `NO_DOT_TAIL_RE`, `TRAILING_NOUN_DOT_RE`, `COM_COLON_GAP_RE`); `detectRawCodeLeak` (5 patterns); `isCrossModuleBasicLeak` (legacy version, kept for non-planner path); `(?<!\bPor\s)\bQue\s+...` for `missing_por_que` (Pass 13 lookbehind to avoid self-rejection).

**Repairs** — `repairTechnicalSanitizationDamage` (PY_FILES_DICT/PY_OOP_DICT/PY_TESTS_DICT/PY_GENERIC_DICT/ORPHAN_PUNCT_DICT), `repairSemanticBreak` (SEMANTIC_REPAIRS[subdomain][key]), `repairLearningObjective` (PYTHON_OBJECTIVE_TAILS), `dedupeSemanticDuplicates` (jaccard ≥0.70 global, ≥0.55 for adjacent slides). Run pre-QA + post-cascade; `runPptxQA` re-runs after repair so `qaVeto` consumes fresh report.

**Module covers** — `moduleCovers: Slide[]` pre-built so covers traverse full repair pipeline; `competencies` wired through `sanitizeSlidePlaceholders`, `repairSlideTechnicalDamage`, `slideHasResidualPlaceholder`, `qaVeto.extraCovers`.

**Placeholder sanitizer** — `removeOrBlockPlaceholders()` strips `[[BT_N]]/[[BT0]]/[[SQLW_N]]/[[ANY_TOKEN]]/{{TOKEN}}/lorem ipsum`; pre-QA + post-cascade + final residual-strip.

**Code completeness validator** — per-language structural check: bracket balance after stripping comments/strings/template literals; Python def/class body presence; SQL statement termination.

**Contamination strip** — `stripSqlContaminationFromSlide` runs at 4 call sites (pre-QA + post-cascade × per-slide + cover); drops items matching SQL contamination, cross-module leak, raw-code leak, `detectTechnicalDamage`, or `detectIncompleteTechnicalSentence`. `[V5-CONTAM-STRIP]` log per drop. `isRenderableSlide` then drops the slide if too few items remain — this excises unrepairable damage instead of vetoing the whole deck.

**Global field safety net** — `runGlobalFieldSafetyNet` walks EVERY string field via `extractAllStrings(depth=6)` and runs all detectors above. `[V5-SAFETY-NET]` logs each leak.

**PPTX QA Engine** — `runPptxQA` (initial 11-check pass): `EMPTY_SLIDE`, `PLACEHOLDER_RESIDUAL`, `TITLE_FRAGMENT`, `GENERIC_LEARNING_OBJECTIVE`, `CONTENT_DENSITY_OVERFLOW`, `TOO_MANY_BULLETS`, `CODE_TOO_LONG`, `SQL_CODE_INCOMPLETE`, `LAYOUT_REPETITION`, `COMPARISON_UNSAFE`, `FONT_TOO_SMALL_RISK` — plus 5 v5.1 critical checks: `DOMAIN_CONTAMINATION`, `INCOMPLETE_CODE`, `EXTREME_DENSITY` (>80 word hard cap), `BROKEN_COMPARISON`, `UNREADABLE_SLIDE`, `GENERIC_OBJECTIVE`. Thresholds: `MAX_WORDS_PER_SLIDE=50`, `MAX_BULLETS=6`, `MAX_CODE_LINES=12`, `MAX_TABLE_CELLS=16`, `MIN_BODY_FONT_SIZE=18pt`, `MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE=2`, `MIN_REQUIRED_WHITESPACE_RATIO=0.20`. `safeSliceText()` never trims `SELECT *`/`COUNT(*)`/`SUM(*)`/`AVG(*)`/`MAX(*)`/`MIN(*)`.

**Resolution Cascade** — `resolveQAIssues` runs if any issue survives initial QA. Max 2 cycles of:
- **L1** `l1VisualFix` — per-slide visual fixes (spacing, SQL-safe text trim, title normalisation, placeholder removal, label swap, punctuation); never splits/changes layout
- **L2** `l2Replan` — splits bullets/code into (1/2)+(2/2), converts comparison→twocol, rotates repeated layouts, drops unfixable empties
- **L3** `l3LocalRewrite` — Gemini rewrite (CRITICAL only, max 3 concurrent, narrow JSON prompt, 4-5 bullets, accepts `courseTopic+moduleTitle` for domain hint, post-rewrite contamination veto). Skips LLM for `DOMAIN_CONTAMINATION`/`INCOMPLETE_CODE`/`GENERIC_OBJECTIVE` (deterministic fix already applied)
- Final `isRenderableSlide` hard filter

**QA Veto** — hard gate after cascade. `HARD_CRITICAL_TYPES` = `DOMAIN_CONTAMINATION`, `INCOMPLETE_CODE`, `PLACEHOLDER_RESIDUAL`, `EMPTY_SLIDE`, `UNREADABLE_SLIDE`, `EXTREME_DENSITY`, `BROKEN_COMPARISON`, `TITLE_FRAGMENT`, `GENERIC_OBJECTIVE`, `GENERIC_LEARNING_OBJECTIVE`. Throws `PptxQAVetoError` → HTTP 422 with structured `blockingIssues[]` (slideId/type/message) so client can show actionable feedback instead of corrupt PPTX.

**Frontend** — `ExportButtons.tsx` distinguishes `422 + PPTX_QA_VETO` (HARD STOP) from infra failures (5xx/network → fallback v3). Sanitizer no longer strips `[[BT_N]]`/`[[SQLW_N]]` protected slots. TOC pagination redesigned.

### Diagnostic Payload (v5.1.3+)
Both 200 and 422 responses include: `engine`, `engine_version`, `status` (`exported`|`blocked`), `fallback_used`, `cache` (`miss`), `slide_count`, `blocking_issues`. On success a `qa` summary: `qa_status`, `issues_unfixed`, `issues_fixed`, `original_slides`, `rendered_slides`, `removed_slides`, `fixed_breakdown`, `unfixed_breakdown`. Frontend logs unified `[PPTX][DIAG] {...}` on every export end.

### Design Systems (5 visual identities)
`DESIGN_SYSTEMS` is the canonical source of truth. `SKIN_REGISTRY` is derived from it (excludes `default_v5`). Each design has `ComponentArchetypes` driving per-layout style; missing archetype falls back to default silently (`d.componentArchetypes?.x ?? "default"`).

| Skin | cards | process | comparison | code | takeaway |
|---|---|---|---|---|---|
| `default_v5` | elevated_grid | horizontal_chevron | clean_columns | terminal_dark | numbered_list |
| `futuristic_background` | flat_grid | horizontal_chevron | split_panels | terminal_dark | highlight_cards |
| `dark_theme` | elevated_grid | numbered_steps | clean_columns | terminal_dark | numbered_list |
| `dark_elegance_xl` | minimal_blocks | numbered_steps | subtle_table | editor_light | highlight_cards |
| `dark_style_theme` | flat_grid | horizontal_chevron | split_panels | terminal_dark | numbered_list |

**Archetype visuals**: `flat_grid` (no shadow, bottom accent strip, accent title, top-right index); `minimal_blocks` (translucent bg, ultra-thin left accent bar 0.024w, no badge, editorial); `numbered_steps` (vertical spine + numbered circles + right text cards); `editor_light` (surface panel, accent border + top stripe, no traffic lights); `highlight_cards` (colored top band, shadow, no number circle); `split_panels` (colored header bands "GRUPO A"/"GRUPO B" + stacked mini-cards + center divider); `subtle_table` (alternating row tints, hairline dividers); `elevated_grid` / `horizontal_chevron` / `clean_columns` / `terminal_dark` / `numbered_list` (default behaviors).

### Version history (top-level)
- **v5.2.2** (current) — Hard cap tightened 5→4 slides/module (target 36-44 deck instead of 52-64); expanded truncation verb list 12→30+ (Captura/Utilizar/Garantir/Permite/Habilita/Verifica/Analisa/Identifica/Prepara/Limpa/etc); added 3 new truncation patterns (verb→para no-object, leading-e+verb, orphan comma in parens); broadened `FUNDAMENTALS_TOPIC_RE` to catch "expressões e atribuições", "variáveis, tipos e operadores", "entrada e saída com variáveis", "criar expressões". 21/21 detector tests pass.
- **v5.2.1** — Hard cap 5 slides/module + cross-module leak detector + per-module fallback (was all-or-nothing) + 6 new truncation patterns + tightened "Que" pattern. 23/23 detector tests + 7/7 gate tests.
- **v5.2.0** — Presentation Planner introduced as intermediate semantic stage between course MD and renderer.
- **v5.1.1 — v5.1.16** — 16 hardening passes building the legacy safety net (detectors, repairs, contamination strip, QA cascade, QA veto, module covers, global safety net). All still active as fallback for both planner-accepted and planner-rejected modules.
- **v5.1** — Architectural Correction (Scene Blueprint, domain guard, placeholder sanitizer, code completeness, 6 new QA types, 5 critical checks, QA Veto), Visual Planner (heuristic editorial layer), PPTX QA Engine (11 checks) + Resolution Cascade (L1/L2/L3), Design Systems (5 skins × 5 component archetypes).
- **v5.0** — Initial v5 engine.

## Legacy PPTX Exporters (do not modify unless asked)
- **v3** — `export-pptx-v3/index.ts` (2284 lines, v3.4.1). Superseded by v5; kept as fallback for infra failures (5xx/network).
- **v2** — `export-pptx-v2/index.ts` (5173 lines, v2.8.1). Premium layout with Unsplash image system, gender agreement, case-study/warning layouts. Superseded by v3.
- **v1** — `export-pptx/index.ts`. **NEVER modify** — must remain 100% untouched.
