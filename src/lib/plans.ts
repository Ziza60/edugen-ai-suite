/**
 * SINGLE SOURCE OF TRUTH — plan limits for the frontend.
 * Keep in sync with supabase/functions/_shared/plans.ts (backend mirror).
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

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan as PlanType) ?? "free"] ?? PLAN_LIMITS.free;
}
