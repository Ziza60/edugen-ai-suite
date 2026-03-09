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

## PPTX Exporter v2 (Controlled Integration)
Parallel exporter at `supabase/functions/export-pptx-v2/index.ts` (~4180 lines).
Pipeline: Parse → Segment → Distribute → Merge Sparse → Visual Fit → Anti-Repetition → Render → Export.
Does NOT replace v1. Integrated via "Motor v2 Beta" toggle in PptxExportDialog.
- Toggle OFF (default): calls `export-pptx` (v1, production)
- Toggle ON: calls `export-pptx-v2` (v2, beta)
- `useV2` flag is NOT sent to the edge function — only used for URL routing.
- Rollback: remove `useV2` from PptxExportOptions, revert URL logic in ExportButtons.tsx.

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
