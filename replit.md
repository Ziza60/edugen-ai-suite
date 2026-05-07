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
`supabase/functions/export-pptx-v4/index.ts` (~6300 lines, ENGINE_VERSION=5.1.4).

### Hardening Pass 4 (v5.1.4) — Deterministic technical-damage repair
- **`repairTechnicalSanitizationDamage(text, moduleTitle, courseTopic, language)`**: domain-aware reconstruction of stripped technical tokens. Runs in 3 places: (1) pre-QA (after sanitize, before runPptxQA), (2) cascade L1 case `TECHNICAL_SANITIZATION_DAMAGE`, (3) post-cascade safety pass before veto. Re-runs `runPptxQA` after the post-cascade repair so `qaVeto` consumes the up-to-date report (no longer stale `cascadeReport`)
- **Domain dictionaries** (gated by module-title detection — `detectModuleDomain`):
  - `PY_FILES_DICT` — `leitura ()`→`leitura com read()`, `escrita ()`→`escrita com write()`, `abrir/abertura ()`→``open()``, `fechar/fechamento ()`→``close()``, `with open ()`→``with open(...)``, `try/except/finally/raise ()`→``$1`` (statements, not calls), `FileNotFound ()`→``FileNotFoundError``, `IOError ()`→``IOError``, `encoding ()`→``encoding='utf-8'``, `modo de abertura ()`→`(`'r'`, `'w'`, `'a'`)`, `trata erros e para limpeza`→`Use except para tratar erros e finally para limpeza`, `blocos try e ()`→`blocos try e except`, "Use () para abrir/ler/escrever/fechar" → restored verb mapping
  - `PY_OOP_DICT` — `construtor ()`→``__init__()``, `método ()`→`método correspondente`, `instanciar ()`→`instanciar a classe`, `use () para criar/instanciar`→`use o construtor para criar/instanciar`
  - `PY_TESTS_DICT` — `classes com e métodos`→`classes com unittest.TestCase e métodos test_*`, `use () para asserções`→`use assertEqual() para asserções`, `teste ()`→`função de teste`
  - `PY_GENERIC_DICT` — fallback when no specific match: `verb () e ()`→`verb as funções correspondentes`, `verb ()`→`verb a função apropriada`, `função ()`→`função correspondente`, `() e ()`→`as funções correspondentes`, bare `()` → drop
  - `ORPHAN_PUNCT_DICT` — gated by `detectTechnicalDamage` (only fires on flagged fields): `, ,`→`,`, ` e .`→`.`, ` ou .`→`.`, `: .`→`.`, collapse whitespace
- **`l1VisualFix` signature extended**: now takes `moduleTitle` and `courseTopic` (passed by `resolveQAIssues`) so the L1 repair sees real domain context (not inferred from `s.label`/module text)
- **Repair logging**: `[V5-REPAIR] {slideId} | "{before}" → "{after}"` per fixed field. `[V5-QA-POSTREPAIR] After final repair: status=... | unfixed=N | fixed=N` summary. Veto remains identical — no relaxation; only repair coverage expanded

### Diagnostic Payload (v5.1.3+)
Both 200 and 422 responses include: `engine`, `engine_version`, `status` (`exported`|`blocked`), `fallback_used`, `cache` (`miss`), `slide_count`, `blocking_issues`, plus on success a `qa` summary: `qa_status` (`PASSED`|`WARNING`|`FAILED`), `issues_unfixed`, `issues_fixed`, `original_slides`, `rendered_slides`, `removed_slides`, and per-type `fixed_breakdown`/`unfixed_breakdown`. Frontend `ExportButtons.tsx` logs unified `[PPTX][DIAG] {...}` line on every export end (success or veto).

### Hardening Pass 3 (v5.1.3) — Veto enforcement + broader damage detection
- **Frontend fallback bug fix (root cause of "veto não funciona")**: `src/components/course/ExportButtons.tsx` was silently falling back to v3 (no QA) on ANY non-2xx from v4 — including the intentional 422 from QA veto. Now distinguishes `res.status === 422 && v4data.code === "PPTX_QA_VETO"` (semantic block — hard stop, surfaces structured `blockingIssues` to user, does NOT export) vs infra failures (timeout/5xx/network — falls back to v3 as before)
- **`detectTechnicalDamage` broadened**: original detector only caught empty parens (`leitura ()`). Added 5 punctuation-only damage patterns:
  - `ORPHAN_COMMAS_RE` (`,\s*,`) — "Estruture em , , , ."
  - `STRIPPED_VERB_PHRASE_RE` — "Use e ." / "Use X e ." (action verb + missing item)
  - `ORPHAN_CONJ_PERIOD_RE` (`\s(e|ou)\s+\.`) — conjunction directly before period
  - `STRIPPED_TAIL_AFTER_COLON_RE` (`:\s*[,\s\.]+$`) — colon followed by nothing meaningful
  - `STRIPPED_ENUMERATION_AFTER_PREP_RE` — preposition + commas + period with stripped content
  - All 5 still gated by `PARENS_TOPIC_RE` exemption

### Hardening Pass 2 (v5.1.1)
- **DOMAIN_CONTAMINATION two-layer**: Layer 1 = HARD prose check (title+items+code) for SQL DDL/DML keywords (`CREATE/ALTER/DROP/TRUNCATE TABLE`, `DELETE FROM`, `INSERT INTO`, `FOREIGN/PRIMARY KEY`) when course is non-SQL — virtually never legitimate in Python prose; Layer 2 = code-block analysis (with `stripCommentsAndStrings`) as before
- **`isGenericLearningObjective(text, moduleTitle)`**: detects filler verbs (`compreender/aplicar/identificar/conhecer/...`) without concrete tech action — checks for concrete tech verb (criar/implementar/executar/tratar/...) or concrete tech noun (função/classe/lista/exceção/loop/...). Also flags items that are ≥60% restatement of the module title. Wired into QA check #17 (CRITICAL → drop bad items, drop slide if <3 valid items remain)
- **Sanitizer fix (root cause of `read()`/`write()` loss)**: `removeOrBlockPlaceholders()` no longer strips `[[BT_N]]`/`[[SQLW_N]]` (those are protected backtick/SQL-wildcard slots from `globalSanitize`). Now `sanitizeSlidePlaceholders` pipes every text field through `globalSanitize` FIRST (which restores slots safely) THEN through `removeOrBlockPlaceholders` (which only kills foreign tokens like `{{...}}`/`lorem ipsum`/`TODO:`). `FOREIGN_PLACEHOLDER_PATTERNS` (used by sanitizer) is separate from `RESIDUAL_PLACEHOLDER_PATTERNS` (used by veto)
- **`detectTechnicalDamage()` + QA check #18**: detects "verb ()" / ". ()" / "() e ()" patterns as symptom of stripped function names → `TECHNICAL_SANITIZATION_DAMAGE` CRITICAL → veto (cannot recover the lost name, only block export)
- **TOC pagination redesign**: `renderTOC` accepts optional `pagination` object. Multi-page TOC now shows header `ÍNDICE — PARTE 2/2` (instead of `(2/2)`) and bottom chip `Módulos 7–8 de 8` (instead of `2 Módulos` which read like a separate course). Single-page TOC unchanged. Chip width auto-expands for paginated label
- **1 new QA issue type**: `TECHNICAL_SANITIZATION_DAMAGE` — added to `HARD_CRITICAL_TYPES` (qaVeto blocks export when surviving)
- **False-positive guards (v5.1.2)**: `isGenericLearningObjective` exempts items with purpose clauses (`para/com/usando/...`) and only triggers title-overlap rule when the tail has no concrete tech verb. `detectTechnicalDamage` only fires after a small set of calling verbs/nouns (`leitura/escrita/função/chamar/...`) and is exempted when the prose explicitly discusses parens/notation/sintaxe as a topic

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

## PPTX Exporter v3 (Legacy)
`supabase/functions/export-pptx-v3/index.ts` (2284 lines, v3.4.1). Superseded by v5.

## PPTX Exporter v2 (Legacy)
`supabase/functions/export-pptx-v2/index.ts` (5173 lines, v2.8.1). Bug fixes applied but superseded by v3.

### Image System
- Fetches thematic images from Unsplash API based on course/module titles
- Requires `UNSPLASH_ACCESS_KEY` env var in Supabase Edge Functions (set via `supabase secrets set`)
- Graceful degradation: if no key set, slides render without images (same as before)
- Diagnostic logging: logs `unsplashKey=SET|MISSING` and `includeImages_raw` at export start
- Images applied to: cover slide (full-bleed background), module covers (right-side panel), closing slide (background)
- Overlays for readability: dark overlay on backgrounds, accent-tinted overlay on module image panels
- Credits: photographer attribution shown at bottom-right of image slides
- Keyword extraction: Portuguese titles translated to English via PT_EN_MAP for better Unsplash results
- All images fetched in parallel via Promise.allSettled (max 4 concurrent)

### v2 Visual Design (Premium Layout)
- **Color palette**: Purple-primary (`6C63FF`), blue (`3B82F6`), green (`10B981`), amber (`F59E0B`), cyan (`06B6D4`)
- **Backgrounds**: Deep navy (`050A18` cover, `F7F8FC` light, `0C1322` dark)
- **Card shadows**: Simulated via semi-transparent offset shapes (`addCardShadow`)
- **Gradient bars**: Simulated via stepped transparency shapes (`addGradientBar`)
- **Left edge**: Double-line accent (solid + 50% transparency ghost line)
- **Footer**: Gradient accent bar + branded dot + "EduGenAI" label
- **Slide title**: Double underline (accent + divider)
- **Cards**: White backgrounds with left color accent bars, rounded corners, shadows
- **Number badges**: Adaptive sizing (capped by card dimensions to prevent overflow)
- **Text autoFit**: All content text boxes use autoFit to prevent text clipping
- **Images**: `slide.addImage()` used instead of `slide.background` for reliability
- **Base64 prefix**: `data:image/jpeg;base64,...` (PptxGenJS requires `data:` prefix)

### Example Highlight (Case Study) Layout
- Dark background with left-side timeline panel
- Up to 5 phases: Contexto → Desafio → Solução → Implementação → Resultado
- Numbered circle badges per phase with accent colors
- Label detection pipeline: "Label: content" parsing with canonical label mapping
- Unlabeled items get auto-assigned to available phase labels
- Minimum 3 phases enforced — synthesizes labels from raw content if needed
- Badge "ESTUDO DE CASO" at top

### Warning Callout Layout
- Max 4 items (reduced from 6 to prevent dense slides)
- Items with "Label: content" get separated header/description styling
- Red accent theme with alternating card backgrounds

### Gender Agreement System
- Context-aware "amplamente utilizado/a/os/as" with separate masculine/feminine noun groups
- Feminine nouns: ferramenta, plataforma, tecnologia, técnica, abordagem, etc.
- Masculine nouns: software, sistema, modelo, método, processo, etc.
- Broad pattern-based agreement for ~30 feminine nouns × ~30 adjectives
- "percepções" + masculine adjective → feminine adjective correction
- Preposition insertion for "gestão/análise/segurança X" → "gestão de X"

### v2 Density Parameters
- `maxItemsPerSlide: 9` — max content items per slide
- `maxCharsPerItem: 200` — max text length per bullet
- `LAYOUT_VISUAL_MAX_ITEMS.bullets: 7`
- `LAYOUT_VISUAL_MAX_ITEMS.example_highlight: 5`
- `LAYOUT_VISUAL_MAX_ITEMS.warning_callout: 4`
- `mergeShortItems` threshold: 90 chars
- `MIN_CONTINUATION_ITEMS: 4`
- Stage 3.6: merges adjacent sparse continuation slides

### Critical Constraints
- NEVER modify `export-pptx/index.ts` (v1) — must remain 100% untouched
- v1 confirmed untouched across all sessions
