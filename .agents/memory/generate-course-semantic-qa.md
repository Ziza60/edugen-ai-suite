---
name: generate-course semantic-qa build
description: Key decisions and gotchas from the 2026-08-01a-semantic-qa patch to generate-course/index.ts
---

## What was added

- `validateLearningBlock(block)` — deep per-type validation (word counts, step counts, scenario turns, etc.)
- `validateBlueprintSemantics(course)` — checks objectives, evidence_required, rubric weights/count, applied_assignment fields
- `validateCourseForPublication(params)` — publication gate; returns `status: ready | ready_with_warnings | needs_review`
- `repairLesson(params)` — per-lesson async repair (Flash first, Pro upgrade if ENABLE_PRO_REPAIR && msLeft > 35s)
- `stripLeadingOrdinal(value)` — applied in renderModuleMarkdown and renderBlock to prevent double-numbering

## Critical regex gotchas

**em-dash in stripLeadingOrdinal**: The original Etapa pattern `[-–:.)]?` only covered en-dash (–).
Must include em-dash (—): `[-–—:.)]?`. Confirmed fix deployed.

**normalizePlaceholderCheck strips special chars**: PLACEHOLDER_PATTERNS are matched on normalized text where
`[^a-z0-9\s]` → space, so `\[insira` never matches; use `/insira/` instead. Tests must mirror this.

**words.length < 4 guard**: isPlaceholderText returns true for any text with < 4 words. Test fixtures
must use ≥4-word strings where "real" content is expected. Short titles like "Projeto Final" (2 words)
trigger the guard and become "placeholder" → repairable.

## Architecture decisions

**Per-lesson repair replaces whole-module MODULE_DOCUMENT_SCHEMA repair**:
- Envelope issues (bridge/checkpoint/takeaways) → repaired with MODULE_ENVELOPE_SCHEMA (Flash)
- Lesson issues → `repairLesson` per lesson, max 1 repair each
- Pro escalation inside repairLesson only if ENABLE_PRO_REPAIR env var is set and msLeft > 35s

**Assessment time guard**: if msLeft < 15000ms and quiz/flashcards required → skip assessment, add warning, mark needs_review via publication gate.

**Blueprint semantics gate**: runs after ensureObjectiveCoverage; blocking issues throw; repairable issues trigger a single Flash repair attempt if msLeft > 60s.

**SSE complete event**: now includes `status`, `warningCount`, `needsReview` fields (backward-compatible).

## Tests

`src/test/semantic-qa.test.ts` — 44 tests covering all 15 spec items. Run with:
`npx vitest run src/test/semantic-qa.test.ts`
