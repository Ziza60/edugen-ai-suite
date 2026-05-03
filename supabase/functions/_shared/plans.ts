/**
 * SINGLE SOURCE OF TRUTH — plan limits for all edge functions.
 * Keep in sync with src/lib/plans.ts (frontend mirror).
 *
 * Plans:
 *  free    — Free tier
 *  starter — R$ 39,90 / mês
 *  pro     — R$ 97,00 / mês
 */

export type PlanType = "free" | "starter" | "pro";

export interface PlanLimits {
  maxCoursesPerMonth: number;
  maxModules: number;
  maxSourceFilesPerCourse: number;
  pdfAnalysesPerHour: number;
  hasProPptx: boolean;
  hasScorm: boolean;
  hasMoodle: boolean;
  hasTutor: boolean;
  hasCustomCertificate: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxCoursesPerMonth: 1,
    maxModules: 6,
    maxSourceFilesPerCourse: 3,
    pdfAnalysesPerHour: 3,
    hasProPptx: false,
    hasScorm: false,
    hasMoodle: false,
    hasTutor: false,
    hasCustomCertificate: false,
  },
  starter: {
    maxCoursesPerMonth: 2,
    maxModules: 8,
    maxSourceFilesPerCourse: 5,
    pdfAnalysesPerHour: 15,
    hasProPptx: false,
    hasScorm: false,
    hasMoodle: false,
    hasTutor: false,
    hasCustomCertificate: false,
  },
  pro: {
    maxCoursesPerMonth: 5,
    maxModules: 12,
    maxSourceFilesPerCourse: 10,
    pdfAnalysesPerHour: 50,
    hasProPptx: true,
    hasScorm: true,
    hasMoodle: true,
    hasTutor: true,
    hasCustomCertificate: true,
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
  "tutor_ia",
  "custom_certificate",
  "pptx_premium",
  "google_slides",
  "microsoft_pptx",
] as const;

/** Features available on starter AND pro (not free). */
export const STARTER_PLUS_FEATURES: string[] = [];
