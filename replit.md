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
  export-pptx-v2/index.ts     # PPTX exporter v2 (parallel, in development)
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

## PPTX Exporter v2 (Default Engine)
Premium exporter at `supabase/functions/export-pptx-v2/index.ts` (~4500 lines).
Pipeline: Parse → Segment → Distribute → Merge Sparse → Visual Fit → Anti-Repetition → Image Fetch → Render → Export.
v2 is the DEFAULT engine. v1 remains untouched as emergency fallback.
- All exports route to `export-pptx-v2` automatically
- `useV2` flag hardcoded to `true` in PptxExportDialog
- Rollback: change `useState(true)` back to `useState(false)` in PptxExportDialog.tsx

### Image System
- Fetches thematic images from Unsplash API based on course/module titles
- Requires `UNSPLASH_ACCESS_KEY` env var in Supabase project
- Graceful degradation: if no key set, slides render without images (same as before)
- Images applied to: cover slide (full-bleed background), module covers (right-side panel), closing slide (background)
- Overlays for readability: dark overlay on backgrounds, accent-tinted overlay on module image panels
- Credits: photographer attribution shown at bottom-right of image slides
- Keyword extraction: Portuguese titles translated to English via PT_EN_MAP for better Unsplash results
- All images fetched in parallel via Promise.allSettled for speed
- Image sizes: Unsplash "regular" (1080px wide) for good quality without bloating PPTX
- Frontend toggle: "Incluir Imagens" switch in PptxExportDialog controls `includeImages` flag

### v2 Visual Design (Premium Layout)
- **Color palette**: Purple-primary (`6C63FF`), blue (`3B82F6`), green (`10B981`), amber (`F59E0B`), cyan (`06B6D4`)
- **Backgrounds**: Deep navy (`050A18` cover, `F7F8FC` light, `0C1322` dark)
- **Card shadows**: Simulated via semi-transparent offset shapes (`addCardShadow`)
- **Gradient bars**: Simulated via stepped transparency shapes (`addGradientBar`)
- **Left edge**: Double-line accent (solid + 50% transparency ghost line)
- **Footer**: Gradient accent bar + branded dot + "EduGenAI" label
- **Slide title**: Double underline (accent + divider)
- **Cards**: White backgrounds with left color accent bars, rounded corners, shadows
- **Number badges**: Rounded squares (not circles) with filled palette colors

### v2 Density Parameters
- `maxItemsPerSlide: 9` (was 7) — more content per slide
- `maxCharsPerItem: 200` (was 180) — longer text per bullet
- `LAYOUT_VISUAL_MAX_ITEMS.bullets: 7` (was 5) — fits more bullets
- `LAYOUT_VISUAL_MAX_ITEMS.two_column_bullets: 10` (was 8)
- `mergeShortItems` threshold: 90 chars (was 60) — merges more aggressively
- `MIN_CONTINUATION_ITEMS: 4` (was 3) — fewer weak continuation slides
- Stage 3.6: merges adjacent sparse continuation slides (<400 chars each, same section)
- Result: ~90 slides for 7-module course (was 106), 8 continuations (was 19)

### Critical Constraints
- NEVER modify `export-pptx/index.ts` (v1) — must remain 100% untouched
- v1 confirmed untouched across all sessions
