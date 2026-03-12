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
  export-pptx/index.ts        # PPTX exporter v1 (7888 lines, production)
  export-pptx-v2/index.ts     # PPTX exporter v2 (~5173 lines, v2.8.1)
  export-pptx-v3/index.ts     # PPTX exporter v3 (~2284 lines, v3.4.1, DEFAULT)
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

## PPTX Exporter v3 (Current Engine)
Production exporter at `supabase/functions/export-pptx-v3/index.ts` (2284 lines, v3.4.1).
Pipeline: Parse → Segment → Distribute → Merge Sparse → Visual Fit → Anti-Repetition → Image Fetch → Render → Export.
v3 is the active engine; v1 remains untouched as emergency fallback; v2 at 5173 lines (v2.8.1).
- Bug fixes applied (v3.4.1): gradient bar overflows, summary numSize, objectives height, colonIdx thresholds, image fallback, per_page random selection

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
