import { LandingTemplate } from "@/components/course/landing/LandingTemplate";

interface LandingPreviewProps {
  landing: any;
  modules?: { title: string; order_index?: number }[];
}

/**
 * Editor preview — renders the exact same template as the public page
 * (src/pages/CourseLanding.tsx) so what the creator sees is what ships.
 * `interactive` is off here: CTAs are inert inside the editor.
 */
export function LandingPreview({ landing, modules = [] }: LandingPreviewProps) {
  return <LandingTemplate landing={landing} modules={modules} />;
}
