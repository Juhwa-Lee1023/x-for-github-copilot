export const SPECIALIST_LANES = [
  "visual-engineering",
  "writing",
  "multimodal-look",
  "artistry"
] as const;

export type SpecialistLane = (typeof SPECIALIST_LANES)[number];

export type SpecialistRoute = {
  lane: SpecialistLane;
  agentId: string;
  displayName: string;
};

export const SPECIALIST_ROUTES: Record<SpecialistLane, SpecialistRoute> = {
  "visual-engineering": {
    lane: "visual-engineering",
    agentId: "visual-forge",
    displayName: "Visual Forge"
  },
  writing: {
    lane: "writing",
    agentId: "writing-desk",
    displayName: "Writing Desk"
  },
  "multimodal-look": {
    lane: "multimodal-look",
    agentId: "multimodal-look",
    displayName: "Multimodal Look"
  },
  artistry: {
    lane: "artistry",
    agentId: "artistry-studio",
    displayName: "Artistry Studio"
  }
};

const visualPattern =
  /\b(ui|ux|frontend|front-end|css|layout|responsive|animation|motion|visual polish|design system|spacing|contrast|accessibility|component styling)\b/i;
const writingPattern =
  /\b(docs?|documentation|readme|guide|onboarding|release notes?|migration notes?|changelog|copywriting|product copy|interface copy|prose|technical writing|explain|tutorial)\b/i;
const multimodalPattern =
  /\bmultimodal look\b|\bmultimodal-look\b|\b(analy[sz]e|inspect|review|read|extract|compare|parse)\b[\s\S]{0,80}\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact|scan|photo|figma|screen capture)\b|\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact|scan|photo|figma|screen capture)\b[\s\S]{0,80}\b(analy[sz]e|inspect|review|read|extract|compare|parse)\b/i;
const multimodalSuppressionPattern =
  /\bdo\s+not\s+(?:force|require|invoke|use)\s+(?:the\s+)?(?:multimodal|multimodal look|multimodal-look)\b|\b(?:no|without)\s+(?:an?\s+|any\s+|actual\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)s?\b|\bunless\s+(?:an?\s+|any\s+|actual\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)s?\b|\b(?:multimodal|multimodal look|multimodal-look)\b[\s\S]{0,80}\b(?:not required|not applicable|skip|skipped)\b/i;
const artistryPattern =
  /\b(naming|tagline|tone options|tone of voice|voice and tone|messaging|brand voice|creative concept|aesthetic direction|ideation)\b/i;

export function classifySpecialistRoute(input: string): SpecialistRoute | null {
  if (multimodalPattern.test(input) && !multimodalSuppressionPattern.test(input)) return SPECIALIST_ROUTES["multimodal-look"];
  if (visualPattern.test(input)) return SPECIALIST_ROUTES["visual-engineering"];
  if (writingPattern.test(input)) return SPECIALIST_ROUTES.writing;
  if (artistryPattern.test(input)) return SPECIALIST_ROUTES.artistry;
  return null;
}
