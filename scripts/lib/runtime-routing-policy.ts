import { DEFAULT_ROOT_MODEL } from "./model-policy.js";

export const FRONT_DOOR_MODEL = DEFAULT_ROOT_MODEL;
export const GROUNDING_MODELS = ["gpt-5.4-mini", "gpt-5-mini"] as const;

export const PLANNING_SCOUT_INITIAL_RANGE = [2, 4] as const;
export const PLANNING_SCOUT_WIDEN_TARGET = 10;
export const MIN_VALIDATED_SCOUT_WAVE_SIZE = 2;

export const LOCAL_CONTEXT_AGENT_IDS = [
  "repo-master",
  "repo-scout",
  "ref-index",
  "milestone",
  "triage",
  "patch-master",
  "required-check",
  "visual-forge",
  "writing-desk",
  "multimodal-look",
  "artistry-studio"
] as const;

export const GITHUB_CONTEXT_AGENT_IDS = ["merge-gate", "maintainer"] as const;

export function agentUsesLocalContextByDefault(agentId: string | null | undefined) {
  return Boolean(agentId && (LOCAL_CONTEXT_AGENT_IDS as readonly string[]).includes(agentId));
}

export function agentAllowsGitHubContextByDefault(agentId: string | null | undefined) {
  return Boolean(agentId && (GITHUB_CONTEXT_AGENT_IDS as readonly string[]).includes(agentId));
}
