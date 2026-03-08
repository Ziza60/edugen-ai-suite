# EduGenAI — AI-Powered Course Creation SaaS

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Auth, Database, Edge Functions, Storage)
- **Billing**: Stripe (Free/Pro plans)
- **AI**: Lovable AI Gateway (course generation)

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

## Environment Variables Needed
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/public key

## PPTX Exporter v2 (Controlled Integration)
Parallel exporter at `supabase/functions/export-pptx-v2/index.ts`.
Pipeline: Parse → Segment → Distribute → Render → Export.
Does NOT replace v1. Integrated via "Motor v2 Beta" toggle in PptxExportDialog.
- Toggle OFF (default): calls `export-pptx` (v1, production)
- Toggle ON: calls `export-pptx-v2` (v2, beta)
- `useV2` flag is NOT sent to the edge function — only used for URL routing.
- Rollback: remove `useV2` from PptxExportOptions, revert URL logic in ExportButtons.tsx.
