/**
 * SINGLE SOURCE OF TRUTH — plan limits for the frontend.
 * Keep in sync with supabase/functions/_shared/plans.ts (backend mirror).
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

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan as PlanType) ?? "free"] ?? PLAN_LIMITS.free;
}
