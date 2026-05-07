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
`supabase/functions/export-pptx-v4/index.ts` (~6900 lines, ENGINE_VERSION=5.1.16).

### Hardening Pass 16 (v5.1.16) — Last-resort drop for unrepaired damage (no more veto)
Pass 15's new detectors (`BARE_COM_E_RE`, `TRAILING_NOUN_DOT_RE`, etc.) plus the existing `empty_example_parens` / `object_empty_parens` semantic-break patterns started catching real damage in covers and content slides — but the **repair pipeline didn't know how to fix them**, so the safety net emitted HARD CRITICAL issues and the QA Veto blocked the entire export (5 issues vetoed an otherwise good 32-slide deck). Pass 16 extends `stripSqlContaminationFromSlide`'s `isContaminated` to also drop items matching `detectTechnicalDamage` (`tech_damage_unrepaired`) or `detectIncompleteTechnicalSentence` (`semantic_break:<key>`). Strip runs at 4 call sites (pre-QA + post-cascade × per-slide + cover), so by the time the safety net scans, all unrepairable damage in items/leftItems/rightItems/competencies has been silently removed. The `isRenderableSlide` gate then drops the slide entirely if too few items remain. Net effect: damage that can't be auto-repaired is excised from a single slide instead of vetoing the whole deck.

### Hardening Pass 15 (v5.1.15) — Broader contamination + gap patterns + adjacent dedup
User reported 5 leftover problems after Pass 14: (1) isolated SQL bullet "Remover objetos do banco de dados com DROP e TRUNCATE." escaped because Pass 14's `BARE_SQL_UPPER_RE` only caught SELECT/INSERT/etc — not bare `DROP`/`TRUNCATE`/`CREATE`/`ALTER` — and `PT_SQL_DDL_RE` required "relacional" after "banco de dados". (2) Module 8 "Boas Práticas e Implantação" received Module 1 fundamentals objectives (cross-module contamination). (3) Stripped-token sentences like `Usar modos de abertura , e 'a' corretamente.`, `Definir classes com e atributos no .`, `Organizar testes em classes e métodos .`, `Testes Unitários com : Crie classes...`. (4) Raw code fragment `{pizza['nome']} - R${pizza['preco']:.2f}") print(...)` leaked as bullet. (5) Slides 40-42 repeated concepts.
Fixes: (a) `isSqlContaminatedString` adds `BARE_SQL_DDL_VERBS_RE` (DROP/TRUNCATE/CREATE/ALTER as bare keywords) + `BROADER_PT_DB_RE` (any "banco de dados" / "tabela do banco" / "colunas da tabela"). (b) New `isCrossModuleBasicLeak(txt, moduleTitle)` with `ADVANCED_MODULE_RE` (boas práticas / implantação / deploy / avançado / otimização / performance / ci-cd / monitora / segurança / refactor / arquitetura) × `BASIC_FUNDAMENTALS_RE` (variáveis básicas / tipos primitivos / hello world / sintaxe básica / etc). (c) `detectTechnicalDamage` adds 5 new patterns: `STRIPPED_LEADING_COMMA_RE`, `BARE_COM_E_RE`, `NO_DOT_TAIL_RE`, `TRAILING_NOUN_DOT_RE`, `COM_COLON_GAP_RE`. (d) New `detectRawCodeLeak` with 5 patterns (`{var['key']:fmt}`, `") print(`, dangling `print("`, `:.2f}")`, `).print(`). (e) `dedupeSemanticDuplicates` lowers threshold to 0.55 for ADJACENT slides (j === i+1) since consecutive near-duplicates are almost always accidental. (f) `stripSqlContaminationFromSlide` renamed conceptually (function name kept) — now strips on ANY of the three contamination types (SQL/cross-module/raw-code), with `[V5-CONTAM-STRIP]` log including reason codes. Tests: 13/13 cases pass.

### Hardening Pass 14 (v5.1.14) — Deterministic SQL strip on covers + slides
Pass 12's `generate-course` prompt hardening reduced SQL leakage but didn't eliminate it — the LLM still occasionally emits SQL DDL pedagogy (`Criar tabelas com CREATE TABLE`) in module covers of Python courses. Pass 14 stops blocking the entire export for this: a new `stripSqlContaminationFromSlide(slide, domain, moduleTitle, slideId)` runs in 3 places (pre-QA per-slide loop, pre-QA cover loop, post-cascade cover loop) and drops ONLY the offending strings from `items`/`leftItems`/`rightItems`/`competencies`. Empty lists are left empty (renderer handles sparse covers). `[V5-SQL-STRIP]` log per cover with drop count. Allow-list logic identical to safety net so SQL courses/modules are unaffected.

### Hardening Pass 13 (v5.1.13) — `missing_por_que` repair self-rejection bug
`repairBrokenLanguage` runs the detector again on the repaired string to verify the fix; if the detector still flags it, the repair is rolled back. The `missing_por_que` pattern `(^|[\s:])Que\s+(Usar|...)` matched both the broken input ("POO: Que Usar...") AND the fixed output ("POO: Por Que Usar..."), because the leading-anchor `[\s:]` happily matched the space after "Por". The verify step rejected every repair and the broken title leaked all the way to the safety net. Pass 13 rewrites the detector and repair regex with a negative lookbehind `(?<!\bPor\s)\bQue\s+...` so already-fixed strings are no longer matched. Tested 8/8: detects/repairs 3 broken cases, leaves 5 valid cases ("Por Que Usar...", "Aquele que aprender", "Esquecemos algumas regras", etc.) untouched.

### Hardening Pass 12 (v5.1.12) — `isGenericLearningObjective` Pattern 3 (application context)
Pass 11's safety net was over-blocking valid pedagogical objectives like "Aplicar escopo local e global em funções Python" and "Aplicar herança e encapsulamento em classes Python" — both have concrete technical concepts and explicit application context, but the detector's purpose-clause regex only recognised `para|com|usando|através|via|de modo|de forma|a fim de` and missed the application preposition "em". Pass 12 adds **Pattern 3**: when a filler-led sentence contains `em|no|na|nos|nas|sobre|dentro de` followed (anywhere later in the tail) by a `CONCRETE_TECH_NOUNS_RE` match, the item is accepted. Vague topic-restating (`Aplicar IA em saúde`) still gets blocked because "saúde" is not a concrete tech noun. Companion fix in `generate-course/index.ts` adds **CRITICAL DOMAIN INTEGRITY** clauses to both the structure prompt and the per-module content prompt — explicit hard rules that forbid SQL DDL/DML in programming-language courses (e.g. SQL leaking into a Python "Estruturas de Dados" module) and require module summaries to cite the language by name.

### Earlier hardening passes (v5.1.1 — v5.1.11) — folded
Full history in git. Key building blocks introduced and still active:
- **Detectors**: `HARD_SQL_PROSE_RE` + `PT_SQL_DDL_RE` + `BARE_SQL_UPPER_RE` (SQL leakage in Python prose), `isGenericLearningObjective` (CRITICAL), `detectBrokenNaturalLanguage` (5 patterns), `detectIncompleteTechnicalSentence` (10 patterns), `detectTechnicalDamage` (`leitura ()`, `Use e .`, etc.), `DOMAIN_CONTAMINATION` two-layer (prose + code-block), allow-lists `MODULE_SQL_ALLOW_RE`/`MODULE_PYTHON_ALLOW_RE`.
- **Repairs**: `repairTechnicalSanitizationDamage` (`PY_FILES_DICT`/`PY_OOP_DICT`/`PY_TESTS_DICT`/`PY_GENERIC_DICT`/`ORPHAN_PUNCT_DICT`), `repairSemanticBreak` (`SEMANTIC_REPAIRS[subdomain][key]`), `repairLearningObjective` (`PYTHON_OBJECTIVE_TAILS`), `dedupeSemanticDuplicates` (jaccard ≥0.70). All run pre-QA + post-cascade; `runPptxQA` re-runs after final repair so `qaVeto` consumes fresh report.
- **Module covers** (Pass 9 + 10): `moduleCovers: Slide[]` pre-built so covers traverse full repair pipeline; `competencies` wired through `sanitizeSlidePlaceholders`, `repairSlideTechnicalDamage`, `slideHasResidualPlaceholder`, `qaVeto.extraCovers`; safety-net generic-objective check restricted to `items + competencies` of `module_cover` slides (avoids false positives on cover titles).
- **Global field safety net** (Pass 8 + 11): `runGlobalFieldSafetyNet` walks EVERY string field via `extractAllStrings(depth=6)` and runs all detectors above (incl. `detectTechnicalDamage`). `[V5-SAFETY-NET]` logs each leak.
- **Frontend** (Pass 3): `ExportButtons.tsx` distinguishes `422 + PPTX_QA_VETO` (HARD STOP) from infra failures (5xx/network → fallback v3). Sanitizer no longer strips `[[BT_N]]`/`[[SQLW_N]]` protected slots. TOC pagination redesigned.

### Diagnostic Payload (v5.1.3+)
Both 200 and 422 responses include: `engine`, `engine_version`, `status` (`exported`|`blocked`), `fallback_used`, `cache` (`miss`), `slide_count`, `blocking_issues`, plus on success a `qa` summary (`qa_status`, `issues_unfixed`, `issues_fixed`, `original_slides`, `rendered_slides`, `removed_slides`, `fixed_breakdown`, `unfixed_breakdown`). Frontend `ExportButtons.tsx` logs unified `[PPTX][DIAG] {...}` on every export end (success or veto).

Pipeline: Parse → Segment → **VisualPlanner** → LayoutVariety → SemanticQualityGate → TemplateSplits → **Sanitize** → **PPTX QA Engine** → **Cascade** → **Sanitize** → **QA Veto** → Render → Export.

### Architectural Correction v5.1 (Section 5C + 6E)
Adds an intermediate semantic guarantee layer between LLM output and renderer:
- **Scene Blueprint**: per-slide semantic descriptor with `ContentDomain`, `SceneIntent`, `priority`, `focalElement`, `layoutCandidates`, `HardConstraints` (always win), `SoftConstraints` (preferences)
- **Domain guard**: `inferCourseDomain()` + `detectDomainContamination()` blocks SQL/DDL leaking into Python courses (and vice versa). Inspects ONLY `slide.code` after `stripCommentsAndStrings()` (avoids false positives on prose/comments). Skipped when `domain === "generic"`. Module allow-lists are ecosystem-aware (postgres/mysql/oracle/pandas/numpy/django/flask/node/react/etc.)
- **Placeholder sanitizer**: `removeOrBlockPlaceholders()` strips `[[BT_N]]/[[BT0]]/[[SQLW_N]]/[[ANY_TOKEN]]/{{TOKEN}}/lorem ipsum` — applied pre-QA + post-cascade. Strengthened `globalSanitize()` adds final residual-strip pass after restore step
- **Code completeness validator**: per-language structural check (bracket balance after stripping comments/strings/template literals; Python def/class body presence; SQL statement termination)
- **6 new QA issue types**: `DOMAIN_CONTAMINATION`, `INCOMPLETE_CODE`, `EXTREME_DENSITY` (>80 word hard cap), `BROKEN_COMPARISON`, `UNREADABLE_SLIDE`, `GENERIC_OBJECTIVE`
- **5 new CRITICAL checks** inside `runPptxQA` loop (#12-16) — fix or drop strategy
- **Domain-safe L3 rewrite**: `l3LocalRewrite` accepts `courseTopic + moduleTitle`, prompts include domain hint, post-rewrite contamination veto rejects bad output. Skips LLM for `DOMAIN_CONTAMINATION/INCOMPLETE_CODE/GENERIC_OBJECTIVE` (deterministic fix already applied)
- **QA Veto (Section 6E)**: hard gate after cascade. `HARD_CRITICAL_TYPES` includes `DOMAIN_CONTAMINATION`, `INCOMPLETE_CODE`, `PLACEHOLDER_RESIDUAL`, `EMPTY_SLIDE`, `UNREADABLE_SLIDE`, `EXTREME_DENSITY`, `BROKEN_COMPARISON`, `TITLE_FRAGMENT`, `GENERIC_OBJECTIVE`, `GENERIC_LEARNING_OBJECTIVE`. Throws `PptxQAVetoError` → HTTP 422 with structured `blockingIssues` array (slideId/type/message) so client can show actionable feedback to the user instead of a corrupt PPTX

### Visual Planner (Section 5B)
Pure-heuristic editorial layer — no AI, no coordinates, no renderer changes.
- **Type**: `SlideVisualPlan { slideId, intent, emotionalWeight, focalElement, pacingRole, densityTolerance, preferredLayout?, fallbackLayouts? }`
- **Function**: `createVisualPlan(slide, prevSlides, moduleContext)` — heuristic analysis of title keywords, item count, layout, SQL content, density
- **Intent detection**: `code` (SQL/code layout), `comparison` (vs/contraste titles), `process` (passo/etapa/fluxo), `summary` (resumo/takeaways), `impact` (≤3 items + numbers/strong words), `example` (cenário/caso), `concept` (definição/introdução), `educational` (default)
- **PacingRole**: `module_transition` (covers), `recap` (takeaways), `deep_dive` (dense code), `visual_break` (after 2+ dense slides), `normal` (default)
- **Integration**: `applyLayoutVariety` calls `createVisualPlan` per slide (silent try/catch fallback) → passes `plan` to `chooseLayout`
- **chooseLayout** uses plan in 3 ways: preferred layout hint (only when existing heuristics find no signal), visual break enforcement (redirects bullets/twocol to cards/diagram), anti-repetition fallback list (`plan.fallbackLayouts` tried before static rules)
- **Guarantee**: plan=null → 100% original behavior; all layout changes still pass `isRenderableSlide`

### PPTX QA Engine (Section 6C) + Resolution Cascade (Section 6D)
Full QA pipeline: `runPptxQA` (initial 11-point pass) → `resolveQAIssues` (3-level cascade if issues remain).

**QA Thresholds** (`const QA`): `MAX_WORDS_PER_SLIDE=50`, `MAX_BULLETS=6`, `MAX_CODE_LINES=12`, `MAX_TABLE_CELLS=16`, `MIN_BODY_FONT_SIZE=18pt`, `MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE=2`, `MIN_REQUIRED_WHITESPACE_RATIO=0.20`

**11 QA checks**: `EMPTY_SLIDE`, `PLACEHOLDER_RESIDUAL`, `TITLE_FRAGMENT`, `GENERIC_LEARNING_OBJECTIVE`, `CONTENT_DENSITY_OVERFLOW`, `TOO_MANY_BULLETS`, `CODE_TOO_LONG`, `SQL_CODE_INCOMPLETE`, `LAYOUT_REPETITION`, `COMPARISON_UNSAFE`, `FONT_TOO_SMALL_RISK`

**Resolution Cascade** (`resolveQAIssues`): runs if any issue survives initial QA pass. Max 2 cycles of:
- **Level 1** (`l1VisualFix`): visual fixes per-slide — spacing, text trim (SQL-safe), title normalisation, placeholder removal, label swap, punctuation; never splits or changes layout
- **Level 2** (`l2Replan`): layout replanning — splits bullets/code into (1/2)+(2/2) slides, converts comparison→twocol, rotates repeated layouts, drops unfixable empties
- **Level 3** (`l3LocalRewrite`): Gemini rewrite of individual slide (CRITICAL only, max 3 concurrent) — narrow prompt, JSON response, 4-5 bullets
- Final `isRenderableSlide` hard filter after all levels

**SQL preservation**: `safeSliceText()` never trims `SELECT *`, `COUNT(*)`, `SUM(*)`, `AVG(*)`, `MAX(*)`, `MIN(*)`
**Guarantee**: no PPTX exits with empty slide, visible placeholder, title fragment, or incomplete SQL code

### Design Systems (Section 2B) — v5.1
`DESIGN_SYSTEMS` is the canonical source of truth for all 5 visual identities. `SKIN_REGISTRY` is derived from it automatically (excludes `default_v5`).

**`ComponentArchetypes`** — drives per-layout visual style (added to `Design` + `SkinOverride`):
| Field | Options |
|---|---|
| `cards` | `elevated_grid` \| `flat_grid` \| `minimal_blocks` |
| `process` | `horizontal_chevron` \| `numbered_steps` |
| `comparison` | `clean_columns` \| `split_panels` \| `subtle_table` |
| `code` | `terminal_dark` \| `editor_light` |
| `takeaway` | `numbered_list` \| `highlight_cards` |

**Skin → Archetype mapping**:
| Skin | cards | process | comparison | code | takeaway |
|---|---|---|---|---|---|
| `default_v5` | elevated_grid | horizontal_chevron | clean_columns | terminal_dark | numbered_list |
| `futuristic_background` | flat_grid | horizontal_chevron | split_panels | terminal_dark | highlight_cards |
| `dark_theme` | elevated_grid | numbered_steps | clean_columns | terminal_dark | numbered_list |
| `dark_elegance_xl` | minimal_blocks | numbered_steps | subtle_table | editor_light | highlight_cards |
| `dark_style_theme` | flat_grid | horizontal_chevron | split_panels | terminal_dark | numbered_list |

**Archetype visual descriptions**:
- `flat_grid`: flat card, no shadow, bottom accent strip, accent-colored title, index label top-right
- `minimal_blocks`: translucent bg, ultra-thin left accent bar (0.024w), no badge, editorial typography
- `numbered_steps`: vertical layout with spine + numbered circle badges + right text cards
- `editor_light`: surface-colored panel, accent border, accent top stripe, no traffic lights, skin-toned code text
- `highlight_cards`: cards with colored top band, shadow, no number circle — impactful
- `split_panels`: each column has a colored header band ("GRUPO A"/"GRUPO B") + stacked mini-cards + center divider
- `subtle_table`: alternating row tints, hairline dividers, plain text, column divider line
- `elevated_grid` / `horizontal_chevron` / `clean_columns` / `terminal_dark` / `numbered_list`: existing default behaviors

**Guarantee**: `d.componentArchetypes?.x ?? "default"` — missing archetype falls back to default behavior silently.

## Legacy PPTX Exporters (do not modify unless asked)
- **v3** — `export-pptx-v3/index.ts` (2284 lines, v3.4.1). Superseded by v5; kept as fallback for infra failures (5xx/network).
- **v2** — `export-pptx-v2/index.ts` (5173 lines, v2.8.1). Premium layout with Unsplash image system, gender agreement, case-study/warning layouts. Superseded by v3.
- **v1** — `export-pptx/index.ts`. **NEVER modify** — must remain 100% untouched.
