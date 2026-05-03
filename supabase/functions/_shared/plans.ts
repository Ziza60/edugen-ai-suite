/**
 * SINGLE SOURCE OF TRUTH — plan limits for all edge functions.
 * Keep in sync with src/lib/plans.ts (frontend mirror).
 *
 * Plans:
 *  free    — Grátis
 *  starter — Criador · R$ 54,90/mês · R$ 41,90/mês (anual)
 *  pro     — Pro     · R$ 127,00/mês · R$ 97,00/mês (anual)
 */

export type PlanType = "free" | "starter" | "pro";

export interface PlanLimits {
  maxCoursesPerMonth: number;
  maxModules: number;
  maxSourceFilesPerCourse: number;
  pdfAnalysesPerHour: number;
  maxImagesPerCourse: number;
  hasProPptx: boolean;
  hasPresenton: boolean;
  has2Slides: boolean;
  hasScorm: boolean;
  hasMoodle: boolean;
  hasNotion: boolean;
  hasTutor: boolean;
  hasCustomCertificate: boolean;
  hasTranslateAI: boolean;
  hasEduScore: boolean;
  hasRestructureAI: boolean;
  hasFlashcards: boolean;
  hasQuizzes: boolean;
  hasStudentPortal: boolean;
  hasPDF: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxCoursesPerMonth:       1,
    maxModules:               5,
    maxSourceFilesPerCourse:  3,
    pdfAnalysesPerHour:       3,
    maxImagesPerCourse:       0,
    hasProPptx:               false,
    hasPresenton:             false,
    has2Slides:               false,
    hasScorm:                 false,
    hasMoodle:                false,
    hasNotion:                false,
    hasTutor:                 false,
    hasCustomCertificate:     false,
    hasTranslateAI:           false,
    hasEduScore:              false,
    hasRestructureAI:         false,
    hasFlashcards:            false,
    hasQuizzes:               false,
    hasStudentPortal:         false,
    hasPDF:                   false,
  },
  starter: {
    maxCoursesPerMonth:       4,
    maxModules:               10,
    maxSourceFilesPerCourse:  5,
    pdfAnalysesPerHour:       15,
    maxImagesPerCourse:       15,
    hasProPptx:               true,
    hasPresenton:             false,
    has2Slides:               false,
    hasScorm:                 false,
    hasMoodle:                false,
    hasNotion:                false,
    hasTutor:                 false,
    hasCustomCertificate:     false,
    hasTranslateAI:           false,
    hasEduScore:              true,
    hasRestructureAI:         true,
    hasFlashcards:            true,
    hasQuizzes:               true,
    hasStudentPortal:         true,
    hasPDF:                   true,
  },
  pro: {
    maxCoursesPerMonth:       12,
    maxModules:               15,
    maxSourceFilesPerCourse:  10,
    pdfAnalysesPerHour:       50,
    maxImagesPerCourse:       25,
    hasProPptx:               true,
    hasPresenton:             true,
    has2Slides:               true,
    hasScorm:                 true,
    hasMoodle:                true,
    hasNotion:                true,
    hasTutor:                 true,
    hasCustomCertificate:     true,
    hasTranslateAI:           true,
    hasEduScore:              true,
    hasRestructureAI:         true,
    hasFlashcards:            true,
    hasQuizzes:               true,
    hasStudentPortal:         true,
    hasPDF:                   true,
  },
};

/** Returns limits for a plan string. Falls back to "free" for unknown values. */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan as PlanType) ?? "free"] ?? PLAN_LIMITS.free;
}

/** Pro-only features checked by check-entitlements. */
export const PRO_ONLY_FEATURES = [
  "flashcards_flip",
  "export_scorm",
  "export_moodle",
  "export_notion",
  "tutor_ia",
  "custom_certificate",
  "pptx_premium",
  "pptx_presenton",
  "pptx_2slides",
  "google_slides",
  "microsoft_pptx",
  "translate_ai",
] as const;

/** Features available on starter AND pro (not free). */
export const STARTER_PLUS_FEATURES: string[] = [
  "eduscore",
  "restructure_ai",
  "flashcards",
  "quizzes",
  "student_portal",
  "export_pdf",
  "export_pptx_v4",
  "ai_images",
];
