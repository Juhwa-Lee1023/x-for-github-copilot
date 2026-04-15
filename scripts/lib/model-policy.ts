export const DEFAULT_ROOT_MODEL = "claude-sonnet-4.6";

export const ROOT_MODEL_IDS = [
  "gpt-5.4",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "gpt-5-mini",
  "gpt-4.1"
] as const;

export const MODEL_POLICY_IDS = [
  "root-selected",
  "claude-follow-opus",
  "fixed-gpt54",
  "mini-follow-cheap-root",
  "fixed-gemini31-pro",
  "fixed-gemini3-flash"
] as const;

export type KnownRootModel = (typeof ROOT_MODEL_IDS)[number];
export type ModelPolicyId = (typeof MODEL_POLICY_IDS)[number];

const knownRootModelSet = new Set<string>(ROOT_MODEL_IDS);
const modelPolicySet = new Set<string>(MODEL_POLICY_IDS);

export const AGENT_MODEL_POLICIES: Record<string, ModelPolicyId> = {
  "repo-master": "root-selected",
  milestone: "claude-follow-opus",
  triage: "claude-follow-opus",
  maintainer: "claude-follow-opus",
  "patch-master": "fixed-gpt54",
  "merge-gate": "fixed-gpt54",
  "required-check": "fixed-gpt54",
  "multimodal-look": "fixed-gpt54",
  "repo-scout": "mini-follow-cheap-root",
  "ref-index": "mini-follow-cheap-root",
  "visual-forge": "fixed-gemini31-pro",
  "artistry-studio": "fixed-gemini31-pro",
  "writing-desk": "fixed-gemini3-flash"
};

export function normalizeRootModel(value: unknown) {
  if (typeof value !== "string") return DEFAULT_ROOT_MODEL;
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || DEFAULT_ROOT_MODEL;
}

function normalizeKnownRootModel(value: unknown): KnownRootModel {
  const normalized = normalizeRootModel(value);
  return knownRootModelSet.has(normalized) ? (normalized as KnownRootModel) : DEFAULT_ROOT_MODEL;
}

export function normalizeAgentModelPolicy(value: unknown): ModelPolicyId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return modelPolicySet.has(normalized) ? (normalized as ModelPolicyId) : null;
}

export function expectedAgentModelPolicy(agentId: string) {
  return AGENT_MODEL_POLICIES[agentId] ?? null;
}

export function resolveAgentModelPolicy(opts: {
  agentId: string;
  modelPolicy?: string | null;
  rootModel?: string | null;
}) {
  const policy = normalizeAgentModelPolicy(opts.modelPolicy) ?? expectedAgentModelPolicy(opts.agentId);
  const rootModel = normalizeRootModel(opts.rootModel);
  const knownRootModel = normalizeKnownRootModel(rootModel);

  switch (policy) {
    case "root-selected":
      return rootModel;
    case "claude-follow-opus":
      return knownRootModel === "claude-opus-4.6" ? "claude-opus-4.6" : "claude-sonnet-4.6";
    case "fixed-gpt54":
      return "gpt-5.4";
    case "mini-follow-cheap-root":
      return knownRootModel === "gpt-5-mini" || knownRootModel === "gpt-4.1" ? "gpt-5-mini" : "gpt-5.4-mini";
    case "fixed-gemini31-pro":
      return "google/gemini-3.1-pro";
    case "fixed-gemini3-flash":
      return "google/gemini-3-flash";
    default:
      return null;
  }
}

export function resolveDefaultRuntimeModel(agentId: string) {
  return resolveAgentModelPolicy({ agentId, rootModel: DEFAULT_ROOT_MODEL });
}
