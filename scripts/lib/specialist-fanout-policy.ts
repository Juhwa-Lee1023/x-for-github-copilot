export const SPECIALIST_AGENT_IDS = [
  "visual-forge",
  "writing-desk",
  "multimodal-look",
  "artistry-studio"
] as const;

export type SpecialistAgentId = (typeof SPECIALIST_AGENT_IDS)[number];

export type SpecialistFanoutStatus =
  | "not_applicable"
  | "complete"
  | "covered_by_patch_master_swarm"
  | "partial"
  | "missing_required";

export type SpecialistFanoutPolicyInput = {
  promptText?: string;
  transcriptText?: string;
  evidenceText?: string;
  routeAgents: string[];
  executedRouteAgents?: string[];
  observedSubagentCounts?: Record<string, number>;
  patchMasterInvocationCount?: number;
};

export type SpecialistFanoutPolicySummary = {
  largeProductBuildTaskObserved: boolean;
  specialistLaneExpected: boolean;
  requiredSpecialistLanes: SpecialistAgentId[];
  recommendedSpecialistLanes: SpecialistAgentId[];
  observedSpecialistLanes: SpecialistAgentId[];
  missingRequiredSpecialistLanes: SpecialistAgentId[];
  missingRecommendedSpecialistLanes: SpecialistAgentId[];
  unobservedRecommendedSpecialistLanes: SpecialistAgentId[];
  specialistFanoutObserved: boolean;
  specialistFanoutPartial: boolean;
  patchMasterSwarmObserved: boolean;
  patchMasterSwarmCount: number;
  specialistFanoutCoveredByPatchMaster: boolean;
  specialistFanoutStatus: SpecialistFanoutStatus;
  specialistFanoutReason: string | null;
};

const specialistOrder: SpecialistAgentId[] = [
  "visual-forge",
  "writing-desk",
  "multimodal-look",
  "artistry-studio"
];

const directLargeTaskPattern =
  /\b(build|create|implement|develop)\b[\s\S]{0,64}\b(product|platform|application|app|saas)\b/i;
const largeTaskQualifierPattern = /\b(complex|production-shaped|feature-rich|multi-tenant|large-scale|standalone)\b/i;
const uiDocsTestsArchitecturePattern =
  /\b(ui|ux|responsive|visual)\b[\s\S]{0,160}\b(docs?|documentation|readme)\b[\s\S]{0,160}\b(test|tests|testing)\b[\s\S]{0,160}\b(architecture|system design)\b/i;
const largeTaskModulePattern =
  /\b(dashboard|projects?|workflows?|incidents?|runbooks?|services?|approvals?|audit|analytics|notifications?|settings|teams?|members?)\b/gi;

const visualScopePattern =
  /\b(ui|ux|frontend|front-end|css|layout|responsive|animation|motion|visual (?:polish|identity)|design system|spacing|accessibility|components?|theme|light mode|dark mode|browser extension|chrome extension)\b|라이트모드|다크모드|크롬\s*익스텐션|테마/i;
const writingScopePattern =
  /\b(docs?|documentation|readme|onboarding|release notes?|migration notes?|changelog|technical writing|guide|manual)\b/i;
const multimodalAnalysisPattern =
  /\b(analy[sz]e|inspect|review|extract|read|summari[sz]e|compare|parse)\b[\s\S]{0,80}\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)\b|\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)\b[\s\S]{0,80}\b(analy[sz]e|inspect|review|extract|read|summari[sz]e|compare|parse)\b/i;
const explicitMultimodalSuppressionPattern =
  /\bdo\s+not\s+(?:force|require|invoke|use)\s+(?:the\s+)?(?:multimodal|multimodal look|multimodal-look)\b|\b(?:multimodal|multimodal look|multimodal-look)\b[\s\S]{0,80}\b(?:not required|not applicable|skip|skipped)\b/i;
const broadArtifactAbsencePattern =
  /\b(?:no|without)\s+(?:an?\s+|any\s+|actual\s+)?(?:visual artifact|media artifact|artifact input|attachment|attached file)s?\b/i;
const artifactAbsencePhrasePattern =
  /\b(?:no|without|unless)\s+(?:an?\s+|any\s+|actual\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)(?:[\s/,;:|+&-]+(?:or\s+|and\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact))*s?\b/gi;
const artistryScopePattern = /\b(naming|tone|messaging|brand|creative|tagline|voice|ideation|aesthetic direction)\b/i;
const singleSessionScopePattern =
  /\b(one\s+single|single|one|only one|just one)[-\s]+(?:github[-\s]+)?copilot(?:[-\s]+cli)?(?:[-\s]+session)?\b|\b(?:github[-\s]+)?copilot(?:[-\s]+cli)?[-\s]+session[-\s]+only\b|\b(?:single|one)[-\s]+session[-\s]+(?:copilot|xgc|run|scope|execution|prompt|request|only)\b|\b(?:keep|stay)\s+it\s+in\s+(?:a\s+)?(?:single|one)[-\s]+(?:(?:github\s+)?copilot(?:\s+cli)?(?:[-\s]+session)?|session)\b|\bdo\s+not\s+fan[-\s]+out\b|\bno\s+(?:specialist\s+)?fan[-\s]*out\b|단\s*하나의?\s*코파일럿|하나의\s*코파일럿|단일\s*코파일럿/i;

const requiredDirectPatterns: Record<SpecialistAgentId, RegExp> = {
  "visual-forge": /\bvisual forge\b|\bvisual-forge\b|\bvisual-engineering\b|\buse visual specialist\b/i,
  "writing-desk": /\bwriting desk\b|\bwriting-desk\b|\bwriting lane\b|\buse writing specialist\b/i,
  "multimodal-look": /\bmultimodal look\b|\bmultimodal-look\b|\bmultimodal lane\b/i,
  "artistry-studio": /\bartistry studio\b|\bartistry-studio\b|\bartistry lane\b|\buse artistry specialist\b/i
};

function orderedUnique(values: SpecialistAgentId[]) {
  const seen = new Set<SpecialistAgentId>();
  const result: SpecialistAgentId[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function sortSpecialist(values: Iterable<SpecialistAgentId>) {
  const lookup = new Set(values);
  return specialistOrder.filter((id) => lookup.has(id));
}

function detectLargeProductBuildTask(text: string) {
  if (!text.trim()) return false;
  let score = 0;
  if (directLargeTaskPattern.test(text)) score += 2;
  if (largeTaskQualifierPattern.test(text)) score += 1;
  if (uiDocsTestsArchitecturePattern.test(text)) score += 2;
  const moduleHits = new Set((text.match(largeTaskModulePattern) ?? []).map((hit) => hit.toLowerCase()));
  if (moduleHits.size >= 4) score += 2;
  else if (moduleHits.size >= 2) score += 1;
  return score >= 3;
}

function stripEmbeddedAgentInstructions(text: string) {
  return text.replace(/<agent_instructions>[\s\S]*?<\/agent_instructions>/gi, "").trim();
}

function extractLatestPromptLikeText(transcriptText: string) {
  const lines = transcriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^(user|prompt|request|task)\s*[:=-]/i.test(line)) {
      return stripEmbeddedAgentInstructions(line.replace(/^(user|prompt|request|task)\s*[:=-]\s*/i, ""));
    }
  }
  return lines.length > 0 ? stripEmbeddedAgentInstructions(lines.at(-1) ?? "") : "";
}

function resolveScopeText(args: SpecialistFanoutPolicyInput) {
  const promptText = stripEmbeddedAgentInstructions(args.promptText ?? "");
  if (promptText) return promptText;
  const latestTranscriptPrompt = extractLatestPromptLikeText(args.transcriptText ?? "");
  if (latestTranscriptPrompt) return latestTranscriptPrompt;
  return stripEmbeddedAgentInstructions(args.evidenceText ?? "");
}

function requiresMultimodalLook(text: string) {
  if (!multimodalAnalysisPattern.test(text)) return false;
  return !multimodalRequirementSuppressed(text);
}

function multimodalRequirementSuppressed(text: string) {
  if (explicitMultimodalSuppressionPattern.test(text)) return true;
  if (broadArtifactAbsencePattern.test(text)) return true;

  for (const match of text.matchAll(artifactAbsencePhrasePattern)) {
    const artifacts = new Set(
      [...match[0].matchAll(/\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)\b/gi)].map((artifact) =>
        artifact[1].toLowerCase()
      )
    );
    if (artifacts.size >= 2) return true;
  }

  return false;
}

function normalizeSpecialistLane(agentName: string): SpecialistAgentId | null {
  const normalized = agentName.trim().toLowerCase();
  if (
    normalized === "visual forge" ||
    normalized === "visual-forge" ||
    normalized === "visual-engineering" ||
    normalized.includes("xgc:visual-forge")
  ) {
    return "visual-forge";
  }
  if (
    normalized === "writing desk" ||
    normalized === "writing-desk" ||
    normalized === "writing" ||
    normalized.includes("xgc:writing-desk")
  ) {
    return "writing-desk";
  }
  if (
    normalized === "multimodal look" ||
    normalized === "multimodal-look" ||
    normalized.includes("xgc:multimodal-look")
  ) {
    return "multimodal-look";
  }
  if (
    normalized === "artistry studio" ||
    normalized === "artistry-studio" ||
    normalized === "artistry" ||
    normalized.includes("xgc:artistry-studio")
  ) {
    return "artistry-studio";
  }
  return null;
}

export function summarizeSpecialistFanoutPolicy(args: SpecialistFanoutPolicyInput): SpecialistFanoutPolicySummary {
  const promptText = args.promptText ?? "";
  const transcriptText = args.transcriptText ?? "";
  const evidenceText = args.evidenceText ?? "";
  const scopeText = resolveScopeText(args);
  const combinedText = [scopeText, evidenceText].join("\n");
  const largeProductBuildTaskObserved = detectLargeProductBuildTask(scopeText);
  const singleSessionScopeDeclared = singleSessionScopePattern.test(scopeText);

  const required = new Set<SpecialistAgentId>();
  const recommended = new Set<SpecialistAgentId>();
  const visualScopeObserved = visualScopePattern.test(scopeText);
  const writingScopeObserved = writingScopePattern.test(scopeText);
  const artistryScopeObserved = artistryScopePattern.test(scopeText);

  for (const specialistId of specialistOrder) {
    if (requiredDirectPatterns[specialistId].test(scopeText)) {
      required.add(specialistId);
    }
  }
  if (!largeProductBuildTaskObserved && visualScopeObserved) {
    required.add("visual-forge");
  }
  if (!largeProductBuildTaskObserved && writingScopeObserved) {
    required.add("writing-desk");
  }
  if (!largeProductBuildTaskObserved && artistryScopeObserved) {
    required.add("artistry-studio");
  }
  if (requiresMultimodalLook(scopeText)) {
    required.add("multimodal-look");
  }

  if (!required.has("visual-forge") && (largeProductBuildTaskObserved || visualScopeObserved)) {
    recommended.add("visual-forge");
  }
  if (!required.has("writing-desk") && (largeProductBuildTaskObserved || writingScopeObserved)) {
    recommended.add("writing-desk");
  }
  if (!required.has("artistry-studio") && artistryScopeObserved) {
    recommended.add("artistry-studio");
  }
  if (singleSessionScopeDeclared) {
    required.clear();
    recommended.clear();
  }
  const observed = new Set<SpecialistAgentId>();
  const specialistObservationAgents = args.executedRouteAgents ?? args.routeAgents;
  for (const agentName of specialistObservationAgents) {
    const specialistId = normalizeSpecialistLane(agentName);
    if (specialistId) observed.add(specialistId);
  }
  if (!args.executedRouteAgents) {
    for (const agentName of Object.keys(args.observedSubagentCounts ?? {})) {
      const specialistId = normalizeSpecialistLane(agentName);
      if (specialistId) observed.add(specialistId);
    }
  }

  const patchMasterFromRoute = args.routeAgents.filter((name) => name === "Patch Master").length;
  const patchMasterFromCounts = args.observedSubagentCounts?.["Patch Master"] ?? 0;
  const patchMasterSwarmCount = Math.max(args.patchMasterInvocationCount ?? 0, patchMasterFromCounts, patchMasterFromRoute);
  const patchMasterSwarmObserved = patchMasterSwarmCount >= 2;

  const requiredSpecialistLanes = sortSpecialist(required);
  const recommendedSpecialistLanes = sortSpecialist(recommended);
  const observedSpecialistLanes = sortSpecialist(observed);
  const missingRequiredSpecialistLanes = requiredSpecialistLanes.filter((lane) => !observed.has(lane));
  const missingRecommendedSpecialistLanes = recommendedSpecialistLanes.filter((lane) => !observed.has(lane));
  const specialistLaneExpected = requiredSpecialistLanes.length > 0 || recommendedSpecialistLanes.length > 0;
  const specialistFanoutCoveredByPatchMaster =
    patchMasterSwarmObserved && missingRequiredSpecialistLanes.length === 0 && missingRecommendedSpecialistLanes.length > 0;

  let specialistFanoutStatus: SpecialistFanoutStatus = "not_applicable";
  let specialistFanoutReason: string | null = null;
  if (!specialistLaneExpected) {
    specialistFanoutStatus = "not_applicable";
    specialistFanoutReason = singleSessionScopeDeclared ? "single_session_scope_declared" : "no_specialist_scope_detected";
  } else if (missingRequiredSpecialistLanes.length > 0) {
    specialistFanoutStatus = "missing_required";
    specialistFanoutReason = `missing required specialist lanes: ${missingRequiredSpecialistLanes.join(", ")}`;
  } else if (missingRecommendedSpecialistLanes.length === 0) {
    specialistFanoutStatus = "complete";
    specialistFanoutReason = null;
  } else if (specialistFanoutCoveredByPatchMaster) {
    specialistFanoutStatus = "covered_by_patch_master_swarm";
    specialistFanoutReason = "recommended specialist lanes were absent but Patch Master swarm coverage was observed";
  } else {
    specialistFanoutStatus = "partial";
    specialistFanoutReason = `recommended specialist lanes not observed: ${missingRecommendedSpecialistLanes.join(", ")}`;
  }
  const specialistFanoutObserved =
    specialistLaneExpected &&
    (observedSpecialistLanes.length > 0 || specialistFanoutCoveredByPatchMaster || patchMasterSwarmObserved);
  const specialistFanoutPartial = specialistFanoutStatus === "partial" || specialistFanoutStatus === "missing_required";

  return {
    largeProductBuildTaskObserved,
    specialistLaneExpected,
    requiredSpecialistLanes: orderedUnique(requiredSpecialistLanes),
    recommendedSpecialistLanes: orderedUnique(recommendedSpecialistLanes),
    observedSpecialistLanes: orderedUnique(observedSpecialistLanes),
    missingRequiredSpecialistLanes: orderedUnique(missingRequiredSpecialistLanes),
    missingRecommendedSpecialistLanes: orderedUnique(missingRecommendedSpecialistLanes),
    unobservedRecommendedSpecialistLanes: orderedUnique(missingRecommendedSpecialistLanes),
    specialistFanoutObserved,
    specialistFanoutPartial,
    patchMasterSwarmObserved,
    patchMasterSwarmCount,
    specialistFanoutCoveredByPatchMaster,
    specialistFanoutStatus,
    specialistFanoutReason
  };
}
