import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  emptyGitHubProbeCache,
  resolveGitHubProbePolicy,
  scanGitHubProbeLog,
  summarizeGitHubCapabilityCheck,
  type GitHubCapabilityCheck,
  type GitHubCapabilityCheckSource,
  type GitHubProbeCache,
  type GitHubProbeObservation
} from "./github-probe-gating.js";
import { AGENT_MODEL_POLICIES, resolveAgentModelPolicy } from "./model-policy.js";
import { summarizeSpecialistFanoutPolicy, type SpecialistAgentId, type SpecialistFanoutStatus } from "./specialist-fanout-policy.js";

export type ValidationStatus = "passed" | "failed" | "skipped" | "partial";
export type ProofStrength = "explicit" | "strong-indirect" | "weak" | "unproven";
export type SummaryAuthority = "authoritative" | "finalized_with_gaps" | "partial" | "heuristic" | "failed";
export type CapabilityPath = "selected" | "alternate" | "none";
export type CredentialStatus =
  | "disabled"
  | "selected-but-not-configured"
  | "configured"
  | "configured-but-missing-credential"
  | "enabled-and-credentialed";
export type ToolRuntimeStatus = "configured" | "installed" | "missing" | "disabled";

export type McpServerId = "context7" | "grep_app" | "websearch";

export type KnownLspId =
  | "typescript-language-server"
  | "vscode-json-language-server"
  | "yaml-language-server"
  | "bash-language-server"
  | "pyright"
  | "gopls"
  | "rust-analyzer";

export type SelectedTooling = {
  generatedAt?: string;
  selected?: {
    mcpServers?: string[];
    lspServers?: string[];
  };
};

export type McpConfig = {
  mcpServers?: Record<string, McpServerConfig>;
};

export type McpServerConfig = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
};

export type LspServerConfig = {
  command?: string;
  args?: string[];
  fileExtensions?: Record<string, string>;
};

export type LspConfig = {
  lspServers?: Record<string, LspServerConfig>;
};

export type McpServerState = {
  id: McpServerId;
  selected: boolean;
  configured: boolean;
  credentialStatus: CredentialStatus;
  requiredEnv: string[];
  presentEnv: string[];
  missingEnv: string[];
  configPath: string;
  notes: string[];
};

export type LspBinaryProbe = {
  status: ToolRuntimeStatus;
  binary: string;
  resolvedPath: string | null;
  probeCommand: string[];
  outputSnippet: string | null;
};

export type LspServerState = {
  id: KnownLspId;
  selected: boolean;
  configured: boolean;
  configPath: string;
  binaryProbe: LspBinaryProbe;
  notes: string[];
};

export type AgentLane =
  | "front-door"
  | "planner"
  | "scout"
  | "docs"
  | "deep"
  | "triage"
  | "gate"
  | "specialist";

export type AgentDetection = {
  lane: AgentLane;
  id: string | null;
  candidates: string[];
};

export type ObservedSubagentEvent = {
  agentName: string;
  kind: "selected" | "started" | "completed";
  source: "stdout" | "hook";
  timestampMs?: number;
};

export type ValidationEvidence = {
  strength: ProofStrength;
  pathKind: CapabilityPath;
  notes: string[];
  matchedTokens: string[];
  observedTools: string[];
};

export type CliReportedUsage = {
  premiumRequests: number | null;
  totalApiDurationMs: number | null;
  sessionDurationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  filesModified: string[];
};

export type FileChangeSummary = {
  repoWorkingTreeFiles: string[];
  committedRepoFiles: string[] | null;
  sessionStateFiles: string[];
  stateArtifactFiles: string[];
  validationArtifactFiles: string[];
  externalFiles: string[];
  integrationOwnedSurfacesTouched: string[];
  sharedSurfaceChangeObserved: boolean;
  sharedSurfaceOwnerDeclared: boolean;
  sharedSurfaceConflictRisk: boolean;
  sharedSurfaceReviewRecommended: boolean;
  sharedSurfaceFinalIntegratorNeeded: boolean;
  repoWorkingTreeChanged: boolean;
  committedRepoChanged: boolean | null;
  repoCodeChanged: boolean;
  workingTreeClean: boolean;
  repoChangesCommitted: boolean | null;
  repoChangesUncommitted: boolean;
  workingTreeOnlyDiffObserved: boolean;
  committedDiffSource?: "git-head-range" | "git-log-since" | "session-shutdown-codeChanges" | "working-tree" | "unavailable";
  sessionStateOnly: boolean;
  stateArtifactOnly: boolean;
};

export type ExecutionGroundingObservation =
  | "grounded-before-executor"
  | "executor-before-grounding"
  | "no-executor-observed"
  | "unproven";

export type ProviderRetrySummary = {
  providerRetryObserved: boolean;
  providerRetryActive: boolean;
  providerRetryState: "not-observed" | "retry-in-progress" | "recovered-after-retry" | "terminal-failure-after-retry";
  providerRetryRecovered: boolean | null;
  providerRetryCount: number;
  providerRetryReason: string | null;
  lastProviderTransportError: string | null;
  lastProviderRetryAt: string | null;
  activeAgentDuringRetry: string | null;
  providerRetryConfidence: ProofStrength;
  modelRateLimitObserved: boolean;
  modelRateLimitCount: number;
  provider502Observed: boolean;
  provider502Count: number;
};

export type RouteObservationSummary = {
  routeAgents: string[];
  routeSummary: string | null;
  keyAgents: string[];
  observedPlanningChain: string[];
  routeSummarySource:
    | "started_with_fallbacks"
    | "name_list_fallback"
    | "raw_tool_events_fallback"
    | "session_shutdown_code_changes_fallback";
  directToolExecutionObserved: boolean;
  toolExecutionCount: number;
  writeToolCount: number;
  bashToolCount: number;
  sessionShutdownObserved: boolean;
  sessionShutdownCodeChangesObserved: boolean;
  sessionShutdownFilesModified: string[];
  sessionShutdownLinesAdded: number | null;
  sessionShutdownLinesRemoved: number | null;
  observedFrontDoorHandledDirectly: boolean | null;
  observedScoutCount: number;
  repoScoutInvocationCount: number;
  triageInvocationCount: number;
  patchMasterInvocationCount: number;
  requiredCheckInvocationCount: number;
  builtInGenericAgentInvocationCount: number;
  triageDuplicateObserved: boolean;
  triageDuplicateAllowedReason: string | null;
  executionReadyHandoffSeenBeforeSecondTriage: boolean;
  observedPlannerBeforeExecutor: boolean | null;
  observedTriageBeforeExecutor: boolean | null;
  observedRefIndex: boolean;
  observedGroundingBeforeExecutor: ExecutionGroundingObservation;
  observedExecutionPhasePure: boolean | null;
  postExecutionPlannerReopenAgents: string[];
  postExecutionGenericAgentObserved: boolean;
  postExecutionBuiltInAgentObserved: boolean;
  postExecutionGenericAgents: string[];
  postExecutionBuiltInAgents: string[];
  postExecutionOwnershipLeakObserved: boolean;
  ownershipLeakAllowedReason: string | null;
  executionOwner: "Patch Master" | null;
  ownershipTransferredToExecution: boolean;
  backgroundExecutionAgentObserved: boolean;
  backgroundExecutionAgentUnresolved: boolean;
  backgroundAgentUnresolvedObserved: boolean;
  backgroundAgentUnresolvedIds: string[];
  backgroundExecutionAgentIds: string[];
  backgroundAgentsStarted: string[];
  backgroundAgentsCompleted: string[];
  backgroundAgentsRead: string[];
  blockingBackgroundAgentsUnresolved: string[];
  executionOwnerAgentId: string | null;
  executionOwnerResultRead: boolean;
  executionOwnerBlockedObserved: boolean;
  finalizedBeforeExecutionOwnerRead: boolean;
  postExecutionCompletionGapObserved: boolean;
  patchMasterHandoffWithoutCompletionObserved: boolean;
  executionHandoffWithoutObservedRepoDiff: boolean;
  malformedTaskPayloadObserved: boolean;
  interactiveCommandHangObserved: boolean;
  interactiveCommandHangCommands: string[];
  missingBuiltInAgentObserved: boolean;
  missingBuiltInAgentNames: string[];
  postExecutionRootWriteObserved: boolean;
  postExecutionRootPatchObserved: boolean;
  postExecutionRootWriteCount: number;
  executionOwnerActiveRootWriteObserved: boolean;
  executionOwnerActiveRootWriteCount: number;
  executionOwnerActiveRootPatchObserved: boolean;
  integrationClassTaskObserved: boolean;
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
  specialistFanoutCoveredByPatchMaster: boolean;
  specialistFanoutStatus: SpecialistFanoutStatus;
  specialistFanoutReason: string | null;
  patchMasterSwarmObserved: boolean;
  patchMasterSwarmCount: number;
  foundationReadinessAssessed: boolean;
  foundationReadinessUnknown: boolean;
  foundationRiskRaised: boolean;
  repeatedFoundationFailureObserved: boolean;
  foundationRecoverySuggested: boolean;
  foundationFailureClasses: string[];
  foundationRecoveryReason: string | null;
  bootstrapFailureObserved: boolean;
  runtimeConfigMismatchObserved: boolean;
  toolingMaterializationFailureObserved: boolean;
  legacyHookPluginConflictObserved: boolean;
  hookExecutionFailureObserved: boolean;
  copilotAuthFailureObserved: boolean;
  copilotModelListFailureObserved: boolean;
  copilotPolicyFailureObserved: boolean;
  preflightBlockerObserved: boolean;
  preflightBlockerKind: string | null;
  preflightBlockerReason: string | null;
  appFoundationFailureObserved: boolean;
  validationPortConflictObserved: boolean;
  validationServerReadinessFailureObserved: boolean;
  githubMemoryEnabledProbe: GitHubProbeObservation;
  githubMemoryPromptProbe: GitHubProbeObservation;
  prLookup: GitHubProbeObservation;
  githubMemoryEnabledCheck: GitHubCapabilityCheck;
  githubMemoryEnabledCheckCached: boolean;
  githubMemoryEnabledCheckCount: number;
  githubMemoryEnabledCheckSource: GitHubCapabilityCheckSource;
  githubMemoryEnabledFreshAfterCacheObserved: boolean;
  prContextCheck: GitHubCapabilityCheck;
  prContextCheckCached: boolean;
  prContextCheckCount: number;
  prContextCheckSource: GitHubCapabilityCheckSource;
  prContextFreshAfterCacheObserved: boolean;
  prLookupCheck: GitHubCapabilityCheck;
  prLookupCheckCached: boolean;
  prLookupCheckSource: GitHubCapabilityCheckSource;
  githubCapabilityCacheHits: number;
  githubCapabilityCacheMisses: number;
  githubRepoIdentityMissingObserved: boolean;
  githubRepoIdentitySource: "process_log" | "stdout" | "local_repo_without_github_remote" | "unknown" | "not-observed";
  githubMemorySuppressedForMissingRepoIdentity: boolean;
  observedMemoryProbeSuppressed: boolean;
  observedPrProbeSuppressed: boolean;
  routeConfidence: ProofStrength;
  observedRuntimeModels: string[];
  postPromptObservedRuntimeModels: string[];
  observedAgentToolModels: string[];
  observedModelMetricModels: string[];
  requestedRuntimeModel: string | null;
  sessionCurrentModel: string | null;
  mixedModelSessionObserved: boolean;
  nonRequestedModelUsageObserved: boolean;
  modelIdentity?: {
    requestedRuntimeModel: string | null;
    selectedRuntimeModel: string | null;
    observedToolModels: string[];
    observedModelMetricModels?: string[];
  };
  modelMismatch?: {
    observed: boolean;
    selectedRuntimeModel: string | null;
    observedToolModels: string[];
    mismatchedToolModels: string[];
  };
  agentModelPolicyMismatchObserved: boolean;
  agentModelPolicyMismatchCount: number;
  agentModelPolicyMismatches: string[];
  providerRetryObserved: boolean;
  providerRetryActive: boolean;
  providerRetryState: "not-observed" | "retry-in-progress" | "recovered-after-retry" | "terminal-failure-after-retry";
  providerRetryRecovered: boolean | null;
  providerRetryCount: number;
  providerRetryReason: string | null;
  lastProviderTransportError: string | null;
  lastProviderRetryAt: string | null;
  activeAgentDuringRetry: string | null;
  providerRetryConfidence: ProofStrength;
  modelRateLimitObserved: boolean;
  modelRateLimitCount: number;
  provider502Observed: boolean;
  provider502Count: number;
};

export type CopilotInstalledPluginEvidence = {
  configPath: string;
  registeredInConfig: boolean;
  cachedPluginPath: string | null;
  cachePathExists: boolean;
  notes: string[];
};

export const knownMcpServerIds: McpServerId[] = ["context7", "grep_app", "websearch"];

export const knownLspServerIds: KnownLspId[] = [
  "typescript-language-server",
  "vscode-json-language-server",
  "yaml-language-server",
  "bash-language-server",
  "pyright",
  "gopls",
  "rust-analyzer"
];

const lspProbeArgs: Record<KnownLspId, string[]> = {
  "typescript-language-server": ["--help"],
  "vscode-json-language-server": ["--help"],
  "yaml-language-server": ["--help"],
  "bash-language-server": ["--help"],
  pyright: ["--help"],
  gopls: ["version"],
  "rust-analyzer": ["--version"]
};

const mcpProofTokens: Record<McpServerId, string[]> = {
  context7: ["context7", "mcp.context7.com", "CONTEXT7_API_KEY"],
  grep_app: ["grep_app", "grep.app", "mcp.grep.app"],
  websearch: ["web_search_exa", "mcp.exa.ai", "mcp.tavily.com", "tavily search", "exa search"]
};

const lspProofTokens: Record<KnownLspId, string[]> = {
  "typescript-language-server": ["typescript-language-server", "typescript language server"],
  "vscode-json-language-server": ["vscode-json-language-server", "json language server", "json schema"],
  "yaml-language-server": ["yaml-language-server", "yaml language server"],
  "bash-language-server": ["bash-language-server", "bash language server"],
  pyright: ["pyright", "python language server"],
  gopls: ["gopls", "go language server"],
  "rust-analyzer": ["rust-analyzer", "rust language server"]
};

export function extractObservedToolNames(transcript: string, hookLog: string) {
  const observed = new Set<string>();

  for (const match of transcript.matchAll(/### ✅ `([^`]+)`/g)) {
    observed.add(match[1]);
  }

  for (const match of hookLog.matchAll(/"toolName":"([^"]+)"/g)) {
    observed.add(match[1]);
  }

  return [...observed];
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function extractObservedSubagentEvents(stdout: string, hookLog: string): ObservedSubagentEvent[] {
  const events: ObservedSubagentEvent[] = [];

  for (const line of stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (!line.startsWith("{")) continue;
    const parsed = safeJsonParse<{
      type?: string;
      timestamp?: string;
      data?: { agentName?: string; agentDisplayName?: string };
    }>(line);
    if (!parsed?.type?.startsWith("subagent.")) continue;
    const agentName = parsed.data?.agentDisplayName ?? parsed.data?.agentName;
    if (!agentName) continue;

    const kind =
      parsed.type === "subagent.selected"
        ? "selected"
        : parsed.type === "subagent.started"
          ? "started"
          : parsed.type === "subagent.completed"
            ? "completed"
            : null;
    if (!kind) continue;
    const timestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : undefined;
    events.push({ agentName, kind, source: "stdout", timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined });
  }

  for (const match of hookLog.matchAll(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+preToolUse (\{.+\})$/gm)) {
    const timestampMs = Date.parse(match[1]);
    const payload = safeJsonParse<{ toolName?: string; toolArgs?: string }>(match[2]);
    if (payload?.toolName !== "task" || !payload.toolArgs) continue;
    const args = safeJsonParse<{ agent_type?: string }>(payload.toolArgs);
    if (!args?.agent_type) continue;
    events.push({
      agentName: args.agent_type,
      kind: "started",
      source: "hook",
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined
    });
  }

  for (const match of hookLog.matchAll(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+subagentStop (\{.+\})$/gm)) {
    const timestampMs = Date.parse(match[1]);
    const payload = safeJsonParse<{ agentDisplayName?: string; agentName?: string }>(match[2]);
    const agentName = payload?.agentDisplayName ?? payload?.agentName;
    if (!agentName) continue;
    events.push({
      agentName,
      kind: "completed",
      source: "hook",
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined
    });
  }

  return events.sort((left, right) => {
    const leftTs = left.timestampMs ?? Number.POSITIVE_INFINITY;
    const rightTs = right.timestampMs ?? Number.POSITIVE_INFINITY;
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    return 0;
  });
}

export function extractObservedSubagentNames(stdout: string, hookLog: string) {
  return extractObservedSubagentEvents(stdout, hookLog).map((event) => event.agentName);
}

export function collapseConsecutiveNames(values: string[]) {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

export type ObservedSessionModelSummary = {
  requestedRuntimeModel: string | null;
  sessionCurrentModel: string | null;
  observedRuntimeModels: string[];
  postPromptObservedRuntimeModels: string[];
  observedAgentToolModels: string[];
  observedModelMetricModels: string[];
  mixedModelSessionObserved: boolean;
  nonRequestedModelUsageObserved: boolean;
  modelIdentity: {
    requestedRuntimeModel: string | null;
    selectedRuntimeModel: string | null;
    observedToolModels: string[];
    observedModelMetricModels: string[];
  };
  modelMismatch: {
    observed: boolean;
    selectedRuntimeModel: string | null;
    observedToolModels: string[];
    mismatchedToolModels: string[];
  };
};

function expectedRuntimeToolModelsForRoot(rootModel: string | null) {
  const models = new Set<string>();
  for (const agentId of Object.keys(AGENT_MODEL_POLICIES)) {
    const resolved = resolveAgentModelPolicy({ agentId, rootModel });
    if (resolved) models.add(resolved);
  }
  if (rootModel) models.add(rootModel);
  return models;
}

function isModelControlUserEvent(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : typeof record.text === "string" ? record.text : "";
  return /^\s*\/model(?:\s+|$)/.test(content);
}

export function summarizeObservedSessionModels(stdout: string): ObservedSessionModelSummary {
  const sessionModels: string[] = [];
  const toolModels: string[] = [];
  const modelMetricModels: string[] = [];
  const postPromptModels: string[] = [];
  const modelChanges: Array<{ index: number; model: string }> = [];
  let latestSelectedRuntimeModel: string | null = null;
  let sessionCurrentModel: string | null = null;
  let firstUserEventIndex: number | null = null;

  const lines = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("{")) continue;
    const parsed = safeJsonParse<{
      type?: string;
      data?: {
        model?: string;
        previousModel?: string;
        newModel?: string;
        currentModel?: string;
        modelMetrics?: Record<string, unknown>;
      };
    }>(line);
    if (!parsed?.type || !parsed.data) continue;
    if (
      firstUserEventIndex === null &&
      ["user.message", "prompt.submitted", "prompt_submitted", "user_message"].includes(parsed.type) &&
      !isModelControlUserEvent(parsed.data)
    ) {
      firstUserEventIndex = index;
    }
    if (parsed.type === "session.model_change" && typeof parsed.data.newModel === "string") {
      modelChanges.push({ index, model: parsed.data.newModel });
      latestSelectedRuntimeModel = parsed.data.newModel;
      sessionModels.push(parsed.data.newModel);
      if (firstUserEventIndex !== null && index >= firstUserEventIndex) {
        postPromptModels.push(parsed.data.newModel);
      }
      continue;
    }
    if (parsed.type === "tool.execution_complete" || parsed.type === "tool.execution_start") {
      const toolModel = extractNestedString(parsed.data, [
        ["model"],
        ["properties", "model"],
        ["toolTelemetry", "properties", "model"]
      ]);
      if (toolModel) {
        toolModels.push(toolModel);
      }
      continue;
    }
    if (parsed.type === "session.tools_updated" && typeof parsed.data.model === "string") {
      sessionModels.push(parsed.data.model);
      if (firstUserEventIndex !== null && index >= firstUserEventIndex) {
        postPromptModels.push(parsed.data.model);
      }
      continue;
    }
    if (parsed.type === "session.shutdown") {
      if (
        parsed.data.modelMetrics &&
        typeof parsed.data.modelMetrics === "object" &&
        !Array.isArray(parsed.data.modelMetrics)
      ) {
        modelMetricModels.push(...Object.keys(parsed.data.modelMetrics));
      }
      if (typeof parsed.data.currentModel === "string") {
        sessionCurrentModel = parsed.data.currentModel;
        sessionModels.push(parsed.data.currentModel);
        if (firstUserEventIndex !== null && index >= firstUserEventIndex) {
          postPromptModels.push(parsed.data.currentModel);
        }
      }
    }
  }

  const observedRuntimeModels = orderedUnique(collapseConsecutiveNames(sessionModels));
  const requestedRuntimeModel =
    firstUserEventIndex !== null
      ? (modelChanges.filter((change) => change.index < firstUserEventIndex).at(-1)?.model ??
        modelChanges.at(-1)?.model ??
        null)
      : (modelChanges.at(-1)?.model ?? null);
  const effectiveRequestedModel = requestedRuntimeModel ?? observedRuntimeModels[0] ?? null;
  const observedToolModels = orderedUnique(collapseConsecutiveNames(toolModels));
  const observedModelMetricModels = orderedUnique(collapseConsecutiveNames(modelMetricModels));
  const postPromptObservedRuntimeModels = orderedUnique(collapseConsecutiveNames(postPromptModels));
  const runtimeModelsForMismatch =
    postPromptObservedRuntimeModels.length > 0
      ? postPromptObservedRuntimeModels
      : firstUserEventIndex !== null && effectiveRequestedModel
        ? [effectiveRequestedModel]
        : observedRuntimeModels;
  const policyAllowedToolModels = expectedRuntimeToolModelsForRoot(effectiveRequestedModel ?? sessionCurrentModel);
  const mismatchedToolModels = orderedUnique(observedToolModels.filter((model) => !policyAllowedToolModels.has(model)));
  const mixedModelSessionObserved =
    runtimeModelsForMismatch.length > 1 ||
    Boolean(effectiveRequestedModel && sessionCurrentModel && sessionCurrentModel !== effectiveRequestedModel);
  const nonRequestedModelUsageObserved = Boolean(
    effectiveRequestedModel && runtimeModelsForMismatch.some((model) => model !== effectiveRequestedModel)
  );

  return {
    requestedRuntimeModel: effectiveRequestedModel,
    sessionCurrentModel,
    observedRuntimeModels,
    postPromptObservedRuntimeModels,
    observedAgentToolModels: observedToolModels,
    observedModelMetricModels,
    mixedModelSessionObserved,
    nonRequestedModelUsageObserved,
    modelIdentity: {
      requestedRuntimeModel: effectiveRequestedModel,
      selectedRuntimeModel: latestSelectedRuntimeModel ?? effectiveRequestedModel,
      observedToolModels,
      observedModelMetricModels
    },
    modelMismatch: {
      observed: mismatchedToolModels.length > 0,
      selectedRuntimeModel: latestSelectedRuntimeModel ?? effectiveRequestedModel,
      observedToolModels,
      mismatchedToolModels
    }
  };
}

export function extractObservedSessionModels(stdout: string) {
  return summarizeObservedSessionModels(stdout).observedRuntimeModels;
}

const agentPolicyIdByDisplayName = new Map<string, string>([
  ["Repo Master", "repo-master"],
  ["Repo Scout", "repo-scout"],
  ["Ref Index", "ref-index"],
  ["Milestone", "milestone"],
  ["Triage", "triage"],
  ["Patch Master", "patch-master"],
  ["Required Check", "required-check"],
  ["Merge Gate", "merge-gate"],
  ["Maintainer", "maintainer"],
  ["Visual Forge", "visual-forge"],
  ["Writing Desk", "writing-desk"],
  ["Multimodal Look", "multimodal-look"],
  ["Artistry Studio", "artistry-studio"]
]);

function normalizeAgentPolicyId(agentName: string) {
  const trimmed = agentName.trim();
  const displayMatch = agentPolicyIdByDisplayName.get(trimmed);
  if (displayMatch) return displayMatch;
  return trimmed.toLowerCase().replace(/^xgc:/, "");
}

function extractNestedString(value: unknown, paths: string[][]) {
  for (const pathParts of paths) {
    let current = value;
    for (const part of pathParts) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return null;
}

export function summarizeAgentModelPolicyMismatches(stdout: string, rootModel: string | null) {
  const mismatches: string[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (!line.startsWith("{")) continue;
    const parsed = safeJsonParse<{ type?: string; data?: unknown }>(line);
    if (!parsed?.type || !parsed.data) continue;

    const agentName = extractNestedString(parsed.data, [
      ["restrictedProperties", "agent_name"],
      ["restrictedProperties", "agentName"],
      ["toolTelemetry", "restrictedProperties", "agent_name"],
      ["toolTelemetry", "restrictedProperties", "agentName"],
      ["toolTelemetry", "restrictedProperties", "agentDisplayName"]
    ]);
    const observedModel = extractNestedString(parsed.data, [
      ["properties", "model"],
      ["toolTelemetry", "properties", "model"]
    ]);
    if (!agentName || !observedModel) continue;

    const agentId = normalizeAgentPolicyId(agentName);
    const expectedModel = resolveAgentModelPolicy({ agentId, rootModel });
    if (!expectedModel || expectedModel === observedModel) continue;

    const message = `${agentName} expected ${expectedModel} observed ${observedModel}`;
    if (seen.has(message)) continue;
    seen.add(message);
    mismatches.push(message);
  }

  return {
    agentModelPolicyMismatchObserved: mismatches.length > 0,
    agentModelPolicyMismatchCount: mismatches.length,
    agentModelPolicyMismatches: mismatches
  };
}

export function countObservedNames(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

const knownXgcAgentNames = new Set([
  "Repo Master",
  "Repo Scout",
  "Ref Index",
  "Milestone",
  "Triage",
  "Patch Master",
  "Required Check",
  "Merge Gate",
  "Maintainer",
  "Visual Forge",
  "Writing Desk",
  "Multimodal Look",
  "Artistry Studio"
]);

const postExecutionPlannerReopenAgentNames = new Set(["Repo Scout", "Ref Index", "Milestone", "Triage"]);
const builtInGenericAgentNames = new Set(["Explore Agent", "General Purpose Agent", "explore", "general-purpose"]);

function isBuiltInGenericAgent(agentName: string) {
  const normalized = agentName.trim().toLowerCase();
  return (
    builtInGenericAgentNames.has(agentName) ||
    normalized === "explore" ||
    normalized === "explore agent" ||
    normalized === "general purpose agent" ||
    normalized === "general-purpose" ||
    normalized === "general-purpose agent"
  );
}

function orderedUnique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeAllowedReason(value: string | undefined) {
  const reason = value?.trim();
  if (!reason) return null;
  if (/^(none|no|n\/a|na|null|false|not applicable|no blocker|no blockers|no named blocker|no explicit blocker)\b/i.test(reason)) {
    return null;
  }
  return reason;
}

function extractExplicitOwnershipLeakAllowedReason(text: string) {
  const match = text.match(/\bownership leak allowed reason\s*:\s*([^\n\r]+)/i);
  const explicitReason = normalizeAllowedReason(match?.[1]);
  if (explicitReason) return explicitReason;
  const blockerEvidenceText = text.replace(/\b(?:not|never|no longer)\s+blocked by\s+[^\n\r.;]+/gi, "");
  if (
    /\b(named|explicit)\s+blocker(?:\s*[:=-]\s*|\s+)(?!\s*(?:none|no|n\/a|na|null|false|not applicable)\b)[^\n\r.;]+/i.test(
      blockerEvidenceText
    ) ||
    /\bblocker\s*:\s*(?!\s*(?:none|no|n\/a|na|null|false|not applicable|no blocker|no blockers)\b)[^\n\r]+/i.test(
      blockerEvidenceText
    ) ||
    /\bblocked by\s+(?!\s*(?:none|no|n\/a|na|null|false|not applicable)\b)[^\n\r.;]+/i.test(blockerEvidenceText) ||
    /\bunresolved blocker(?:\s*[:=-]\s*|\s+)(?!\s*(?:none|no|n\/a|na|null|false|not applicable)\b)[^\n\r.;]+/i.test(
      blockerEvidenceText
    )
  ) {
    return "named_blocker";
  }
  if (/\bnarrow (follow-?up|context|clarification)\b|\bbounded follow-?up\b|\btargeted (context|clarification|read|search)\b/i.test(text)) {
    return "narrow_follow_up";
  }
  if (/\buser (requested|asked)\b.*\b(review|double check|recheck)\b|\brequired check requested\b/i.test(text)) {
    return "user_requested_review";
  }
  return null;
}

function extractBackgroundExecutionAgentIds(text: string) {
  return sortedUnique(
    [...text.matchAll(/\bagent_id:\s*([A-Za-z0-9._:-]+)/g)]
      .map((match) => match[1])
      .filter(Boolean)
      .map((agentId) => agentId.replace(/[.。]+$/g, ""))
  );
}

function extractCompletedBackgroundAgentIds(text: string) {
  const ids = [
    ...[...text.matchAll(/\bBackground agent\s+[`"]?([A-Za-z0-9._:-]+)[`"]?\s+(?:has\s+)?completed(?:\s+successfully)?\b/gi)].map(
      (match) => match[1]
    ),
    ...[...text.matchAll(/\bBackground agent\s+[`"]?([A-Za-z0-9._:-]+)[`"]?\s+finished\b/gi)].map((match) => match[1]),
    ...[...text.matchAll(/\bagent\s+[`"]?([A-Za-z0-9._:-]+)[`"]?\s+(?:has\s+)?completed(?:\s+successfully)?\b/gi)].map((match) => match[1]),
    ...[...text.matchAll(/\bagent\s+[`"]?([A-Za-z0-9._:-]+)[`"]?\s+finished\b/gi)].map((match) => match[1])
  ];
  return sortedUnique(ids.filter(Boolean).map((agentId) => agentId.replace(/[.。]+$/g, "")));
}

function extractReadBackgroundAgentIds(text: string) {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/\bUse\s+`?read_agent\b|\bto retrieve\b/i.test(line)) continue;
    ids.push(...[...line.matchAll(/\bread_agent\(\s*["'`]([A-Za-z0-9._:-]+)["'`]\s*\)/gi)].map((match) => match[1]));
    ids.push(
      ...[...line.matchAll(/\b(?:read|retrieved|consumed)\s+(?:the\s+)?(?:full\s+)?(?:results?|output|message)\s+(?:from|for)\s+(?:background\s+agent\s+)?["'`]?([A-Za-z0-9._:-]+)["'`]?/gi)].map(
        (match) => match[1]
      )
    );
  }
  return sortedUnique(ids.filter(Boolean).map((agentId) => agentId.replace(/[.。]+$/g, "")));
}

function isExecutionStatusEvidenceLine(line: string) {
  const normalized = line.trim();
  if (!normalized) return false;
  if (isPromptOrRequirementLine(normalized) || isPlanningOrAdvisoryLine(normalized)) return false;
  if (/\bExecution status:\s*ready_for_return\b/i.test(normalized) && /\bExecution status:\s*blocked\b/i.test(normalized)) {
    return false;
  }
  return true;
}

function hasExecutionStatusClosure(text: string) {
  return text
    .split(/\r?\n/)
    .some(
      (line) =>
        isExecutionStatusEvidenceLine(line) &&
        /\bExecution status:\s*(ready_for_return|completed|complete|success)\b/i.test(line)
    );
}

function hasExecutionStatusBlocked(text: string) {
  return text
    .split(/\r?\n/)
    .some((line) => isExecutionStatusEvidenceLine(line) && /\bExecution status:\s*blocked\b/i.test(line));
}

function isMalformedTaskPayloadLine(line: string) {
  const normalized = line.trim();
  if (!normalized || isPromptOrRequirementLine(normalized) || isPlanningOrAdvisoryLine(normalized)) {
    return false;
  }
  return /\bExpected\s+['"][,}]['"]\s+or\s+['"][,}]['"]\s+after property value in JSON\b|\bUnexpected token\b.*\bJSON\b|\bJSON\.parse\b.*\b(error|failed|unexpected|malformed|SyntaxError)\b|\bmalformed (?:task|json|payload)\b/i.test(
    normalized
  );
}

function isCodeOrExampleLine(line: string) {
  const normalized = line.trim();
  if (!normalized) return false;
  return /^(?:>\s*)?(?:\d+\s*\|\s*)?(?:const|let|var|function|import|export|return|if|for|class|type|interface|enum|model)\b|^\s*(?:[{}[\],;]|\.\.\.|\/\/)/i.test(
    normalized
  );
}

function isFoundationNoiseLine(line: string) {
  return (
    /\bStarted MCP client for remote server\b|\bMCP client for .* connected\b/i.test(line) ||
    /\bMCP server .* provided deferred instructions\b/i.test(line) ||
    /\bMCP transport for .* closed\b|\bTransient error connecting to HTTP server .*\bfetch failed\b|\bRetrying connection to HTTP server\b|\bFailed to load memories for prompt:\s*Error:\s*GitHub repository name is required\b|\b(Command failed with exit code 128:\s*)?git rev-parse HEAD\b|\bFailed to get current commit hash\b|\bGitHub MCP server configured after authentication\b/i.test(
      line
    ) ||
    (/\bLSP .*server\b/i.test(line) &&
      /\/node_modules\//i.test(line) &&
      /\b(warning|error while parsing|unexpected token)\b/i.test(line))
  );
}

function isPlanningOrAdvisoryLine(line: string) {
  const normalized = line.trim();
  if (/^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\d+[.)]\s*)?(?:\*\*)?(?:Acceptance|Acceptance criteria|Next steps?|Handoff|Plan|Implementation plan|Recommended|Recommendation|Notes?|Risks?|Validation requirements?|Confirmed|Verdict|Blocking gaps?|Hidden assumptions?|Missing constraints?|Weak acceptance criteria|What must be fixed before handoff)(?:\s*:\s*\*\*|\*\*\s*:|\s*:)/i.test(normalized)) {
    return true;
  }
  if (/^(?:\d{4}-\d{2}-\d{2}T|\[?ERROR\]?|Error:|Command failed|npm|npx|pnpm|yarn|bun|vitest|playwright|next\s+(?:build|dev|start|lint|info|telemetry)\b|prisma)\b/i.test(normalized)) {
    return false;
  }
  if (/^(?:[✗✖]\s*)?(?:Unable to load available models list|Authorization error|Access denied by policy settings)\b/i.test(normalized)) {
    return false;
  }
  return /\b(plan|Patch Master|should|would|could|will|assumption|risk|missing constraint|acceptance criteria)\b/i.test(normalized);
}

function isPromptOrRequirementLine(line: string) {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:Build|Create|Implement|Use this exact prompt|Product vision|Routing intent|Stack requirements|Core product areas|UX and design requirements|Implementation quality|Validation|README|Deliverables|Assumptions|Test Plan|Single Copilot Prompt)\b/i.test(normalized)) {
    return true;
  }
  if (/^(?:[-*]|\d+[.)])\s+\S+/u.test(normalized)) {
    return true;
  }
  if (/^(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b.*(?:→|->)\s*(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b/i.test(normalized)) {
    return true;
  }
  return /\b(prompt|requirements|vision|deliverables|assumptions|walkthrough|architecture|microcopy|brand tone)\b/i.test(normalized) &&
    !/^(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b/i.test(normalized);
}

function isValidationEvidenceLine(line: string) {
  const normalized = line.trim();
  if (
    !normalized ||
    isFoundationNoiseLine(normalized) ||
    isPromptOrRequirementLine(normalized) ||
    (!isValidationCheckmarkResultLine(normalized) && isPlanningOrAdvisoryLine(normalized))
  ) {
    return false;
  }

  return (
    /^(?:[$>#]\s*)?(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b/i.test(normalized) ||
    /\b(validation_exit\s*[:=]\s*\d+|validation_state\s*[:=]\s*done|state=done)\b/i.test(normalized) ||
    /^(?:Running\s+\d+\s+(?:tests?|workers?)|Test Files?\s+\d+\s+(?:passed|failed)|No ESLint warnings or errors|Compiled successfully|build passed|validation passed|smoke test passed|\d+\s+passed|\d+\s+failed)\b/i.test(
      normalized
    ) ||
    /\b(AssertionError|ReferenceError|SyntaxError|TimeoutError|failed to compile|tests?\s+failed|test files?\s+\d+\s+failed|command failed|returned non-zero|exit code\s+[1-9]|npm ERR!|ELIFECYCLE|EADDRINUSE|address already in use|ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|page\.goto:\s*net::ERR_CONNECTION_REFUSED|playwright web server did not become ready)\b/i.test(
      normalized
    ) ||
    /\b(?:error|failed|failure|non-zero)\b.*\b(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma|eslint|typescript|tsc|seed|seeding|db push|db seed|build|compile)\b/i.test(
      normalized
    ) ||
    /\b(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma|eslint|typescript|tsc|seed|seeding|db push|db seed|build|compile)\b.*\b(?:error|failed|failure|non-zero)\b/i.test(
      normalized
    )
  );
}

function isRuntimeToolingIssueLine(line: string) {
  const normalized = line.trim().replace(/\s+/g, " ");
  if (!normalized || isPromptOrRequirementLine(normalized) || isPlanningOrAdvisoryLine(normalized)) {
    return false;
  }
  return /^(?:[$>#]\s*)?(?:view\s+\/tmp\/|(?:vi|vim|less|more|nano)\s+\S+|(?:npm|pnpm|yarn|bun)\s+create\s+vite\b)|^<exited with error:\s*posix_spawn failed\b|^Error:.*\bposix_spawn failed\b|\bposix_spawn failed\b/i.test(
    normalized
  );
}

function summarizeRuntimeToolingIssues(text: string) {
  const interactiveCommandHangCommands = sortedUnique(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => isRuntimeToolingIssueLine(line))
      .map((line) => line.replace(/\s+/g, " ").slice(0, 240))
  );
  const missingBuiltInAgentNames = sortedUnique(
    [
      ...[...text.matchAll(/\bFailed to load built-in agent\s+["'`]([^"'`]+)["'`]/gi)].map((match) => match[1]),
      ...[...text.matchAll(/definitions\/([A-Za-z0-9._:-]+)\.agent\.ya?ml/gi)].map((match) => match[1])
    ].filter(Boolean)
  );
  return {
    interactiveCommandHangObserved: interactiveCommandHangCommands.length > 0,
    interactiveCommandHangCommands,
    missingBuiltInAgentObserved: missingBuiltInAgentNames.length > 0,
    missingBuiltInAgentNames
  };
}

function summarizeIntegrationClassSignals(text: string, opts: { sharedSurfaceChangeObserved?: boolean } = {}) {
  const integrationClassTaskObserved =
    opts.sharedSurfaceChangeObserved === true ||
    /\bintegration[-\s]class\b|\bintegration[-\s]scale\b|\bmulti[-\s]session\b|\bmulti[-\s]surface\b|\bcross[-\s]surface\b|\bshared[-\s]surface\b|foundation readiness\b|foundation freeze\b/i.test(
      text
    );
  const foundationReadinessAssessed =
    /foundation readiness\s*:\s*(assessed|known|ready|checked|passed)\b|\bfoundation readiness assessed\b|\bfoundation gate\b|\bbaseline checks?\s*:\s*(known|passed|ready|checked)\b/i.test(
      text
    );
  const foundationRiskRaised =
    /\bfoundation risk\b|foundation readiness\s*:\s*(unknown|blocked|risky|not ready)\b|\bfoundation not ready\b|\bbaseline unknown\b|\bunstable foundation\b/i.test(
      text
    );

  return {
    integrationClassTaskObserved,
    foundationReadinessAssessed,
    foundationRiskRaised,
    foundationReadinessUnknown: integrationClassTaskObserved && (!foundationReadinessAssessed || foundationRiskRaised)
  };
}

function classifyFoundationFailureLine(line: string) {
  if (isFoundationNoiseLine(line) || isPlanningOrAdvisoryLine(line) || isCodeOrExampleLine(line)) {
    return null;
  }
  if (/\bUnable to load available models list\b/i.test(line)) {
    return "copilot-model-list";
  }
  if (
    /\bAccess denied by policy settings\b|\bCopilot CLI policy setting\b|\borganization has restricted Copilot access\b|\bCopilot subscription does not include this feature\b|\bsubscription does not include this feature\b|\brequired policies have not been enabled\b|\bCopilot Pro trials have been temporarily paused\b|\bupgrade your account\b|\brevert to Copilot Free\b/i.test(
      line
    )
  ) {
    return "copilot-policy";
  }
  if (/\bAuthorization error,\s*you may need to run\s+\/login\b|\byou may need to run\s+\/login\b/i.test(line)) {
    return "copilot-auth";
  }
  if (
    /\b(copilot|github copilot|provider|model list|prompt generation)\b/i.test(line) &&
    /\bnot authenticated\b|\bauthentication required\b|\bauthentication failed\b|\blogin required\b|\bplease log in\b|\bsign in\b|\bunauthorized\b|\bforbidden\b|\b401\b|\b403\b/i.test(
      line
    )
  ) {
    return "copilot-auth";
  }
  // Missing GitHub repository identity is tracked via dedicated GitHub observability fields.
  if (/\bGitHub repository name is required\b|\bFailed to load memories for prompt: Error:\s*GitHub repository name is required\b/i.test(line)) {
    return null;
  }
  if (/\borchestra-dual-runtime\b|\bcopilot-cli-plugin\b|legacy hook plugin|stale legacy hook/i.test(line)) {
    return "legacy-plugin-conflict";
  }
  if (/\bscripts\/(?:pre-tool-use|session-start|session-end|prompt-submitted|agent-stop|subagent-stop|error-occurred)\.mjs\b|Cannot find module .*scripts\/[^ \n'"]+\.mjs|node\s+\.\/scripts\/[^ \t"'`]+\.mjs\b/i.test(line)) {
    return "bootstrap-hook-path";
  }
  if (/\b(?:bash|zsh|sh):\s+(?:\.\/)?scripts\/(?:hooks\/)?(?:pre-tool-use|session-start|agent-stop|subagent-stop|error-occurred)\.sh:\s+No such file or directory\b/i.test(line)) {
    return "bootstrap-hook-path";
  }
  if (/\b(runtime config mismatch|hook path mismatch|hooks\/hooks\.json.*mismatch|xgc-hooks\.json.*mismatch|generated hook.*drift)\b/i.test(line)) {
    return "runtime-config-mismatch";
  }
  if (/\b(write EPIPE|EPIPE|broken pipe)\b/i.test(line)) {
    return "runtime-transport";
  }
  if (isMalformedTaskPayloadLine(line)) {
    return "task-payload";
  }
  if (/\bFailed to load built-in agent\b|definitions\/[A-Za-z0-9._:-]+\.agent\.ya?ml\b/i.test(line)) {
    return "runtime-tool-execution";
  }
  if (isRuntimeToolingIssueLine(line)) {
    return "runtime-tool-execution";
  }
  if (!/\b(error|failed|failure|panic|exception|invalid|cannot|unable|timeout|timed out|retry)\b/i.test(line)) {
    return null;
  }
  if (/\b(materializ(?:e|ation).*failed|profile materialization failed|copy.*hooks.*failed|install.*plugin.*failed)\b/i.test(line)) {
    return "tooling-materialization";
  }
  if (
    /\b(hook\.end|hook execution|preToolUse|sessionStart|agentStop|errorOccurred|finalizeSessionSummary)\b.*\b(failed|error|Cannot find module|deferred_finalizer_error)\b/i.test(
      line
    )
  ) {
    return "hook-execution";
  }
  if (/\b(EADDRINUSE|address already in use|port\s+\d+\s+.*in use)\b/i.test(line)) {
    return "startability-port-conflict";
  }
  if (/\b(ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|page\.goto:\s*net::ERR_CONNECTION_REFUSED|playwright web server did not become ready)\b/i.test(line)) {
    return "startability";
  }
  if (/\b(seed|seeding|db seed|prisma db seed)\b/i.test(line)) {
    return "seed-data";
  }
  if (/\b(prisma|schema|migration|migrate|db push|database|sqlite|datasource)\b/i.test(line)) {
    return "schema-db";
  }
  if (/\b(npm install|pnpm install|yarn install|bun install|dependency|dependencies|package-lock|package\.json|ERESOLVE|ENOENT)\b/i.test(line)) {
    return "dependency-tooling";
  }
  if (/\b(next build|build|compile|compiled|type error|typescript|tsc|lint|eslint)\b/i.test(line)) {
    return "build-typecheck";
  }
  if (
    /\b(auth|authentication|authorization|middleware|NEXTAUTH|AUTH_SECRET|credentials)\b|\bsession\s+(?:token|cookie|secret|auth|credential|expired|invalid)\b|\b(?:auth|login)\s+session\b/i.test(
      line
    )
  ) {
    return "auth-session";
  }
  if (/\b(validation harness|validation_exit|validation state|strict mode violation|locator resolved to|expected to receive|got:)\b/i.test(line)) {
    return "validation-harness";
  }
  if (/\b(playwright|browser|dev server|localhost|startability|startable|server did not become ready|server)\b/i.test(line)) {
    return "browser-smoke";
  }
  return null;
}

function summarizeFoundationFailureSignals(text: string) {
  const counts = new Map<string, number>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isPromptOrRequirementLine(line) && !isPlanningOrAdvisoryLine(line) && !isFoundationNoiseLine(line));
  const validationPortConflictObserved = lines.some((line) => /\b(EADDRINUSE|address already in use|port\s+\d+\s+.*in use)\b/i.test(line));
  const validationServerReadinessFailureObserved =
    validationPortConflictObserved ||
    lines.some((line) =>
      /\b(ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|page\.goto:\s*net::ERR_CONNECTION_REFUSED|playwright web server did not become ready)\b/i.test(
        line
      )
    );
  for (const line of lines) {
    const failureClass = classifyFoundationFailureLine(line);
    if (!failureClass) continue;
    counts.set(failureClass, (counts.get(failureClass) ?? 0) + 1);
  }

  const foundationFailureClasses = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([failureClass]) => failureClass)
    .sort();
  const repeatedFailureClasses = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([failureClass]) => failureClass)
    .sort();
  const repeatedFoundationFailureObserved = repeatedFailureClasses.length > 0;
  const bootstrapClasses = new Set([
    "bootstrap-hook-path",
    "runtime-config-mismatch",
    "tooling-materialization",
    "legacy-plugin-conflict",
    "hook-execution",
    "copilot-auth",
    "copilot-model-list",
    "copilot-policy",
    "runtime-transport",
    "task-payload",
    "runtime-tool-execution"
  ]);
  const copilotAuthFailureObserved = foundationFailureClasses.includes("copilot-auth");
  const copilotModelListFailureObserved = foundationFailureClasses.includes("copilot-model-list");
  const copilotPolicyFailureObserved = foundationFailureClasses.includes("copilot-policy");
  const preflightBlockerObserved = copilotAuthFailureObserved || copilotModelListFailureObserved || copilotPolicyFailureObserved;
  const preflightBlockerKind =
    copilotAuthFailureObserved && copilotModelListFailureObserved && copilotPolicyFailureObserved
      ? "auth-and-model-and-policy"
      : copilotAuthFailureObserved && copilotModelListFailureObserved
        ? "auth-and-model"
        : copilotAuthFailureObserved && copilotPolicyFailureObserved
          ? "auth-and-policy"
          : copilotModelListFailureObserved && copilotPolicyFailureObserved
            ? "model-and-policy"
            : copilotAuthFailureObserved
              ? "auth"
              : copilotModelListFailureObserved
                ? "model-list"
                : copilotPolicyFailureObserved
                  ? "policy"
                  : null;
  const preflightBlockerReason = preflightBlockerObserved
    ? text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => {
          const failureClass = classifyFoundationFailureLine(line);
          return failureClass === "copilot-auth" || failureClass === "copilot-model-list" || failureClass === "copilot-policy";
        })
        ?.slice(0, 240) ?? null
    : null;
  const bootstrapFailureObserved = foundationFailureClasses.some((failureClass) => bootstrapClasses.has(failureClass));
  const runtimeConfigMismatchObserved = foundationFailureClasses.includes("runtime-config-mismatch");
  const toolingMaterializationFailureObserved = foundationFailureClasses.includes("tooling-materialization");
  const legacyHookPluginConflictObserved = foundationFailureClasses.includes("legacy-plugin-conflict");
  const hookExecutionFailureObserved = foundationFailureClasses.includes("hook-execution") || foundationFailureClasses.includes("bootstrap-hook-path");
  const appFoundationFailureObserved = foundationFailureClasses.some((failureClass) => !bootstrapClasses.has(failureClass));
  const foundationRecoverySuggested = repeatedFoundationFailureObserved || validationServerReadinessFailureObserved;
  const foundationRecoveryReason = repeatedFoundationFailureObserved
    ? `repeated foundation failure class(es): ${repeatedFailureClasses.join(", ")}`
    : validationPortConflictObserved
      ? "validation startability failed because the requested port was already in use"
      : validationServerReadinessFailureObserved
        ? "validation startability failed because the dev server was not reachable"
        : null;

  return {
    repeatedFoundationFailureObserved,
    foundationRecoverySuggested,
    foundationFailureClasses,
    foundationRecoveryReason,
    bootstrapFailureObserved,
    runtimeConfigMismatchObserved,
    toolingMaterializationFailureObserved,
    legacyHookPluginConflictObserved,
    hookExecutionFailureObserved,
    copilotAuthFailureObserved,
    copilotModelListFailureObserved,
    copilotPolicyFailureObserved,
    preflightBlockerObserved,
    preflightBlockerKind,
    preflightBlockerReason,
    appFoundationFailureObserved,
    validationPortConflictObserved,
    validationServerReadinessFailureObserved
  };
}

function summarizeGitHubRepoIdentitySignals(
  args: {
    processLogText?: string | null;
    evidenceText?: string | null;
    repoIdentity?: string | null;
    memoryProbeSuppressed: boolean;
  }
): {
  githubRepoIdentityMissingObserved: boolean;
  githubRepoIdentitySource: RouteObservationSummary["githubRepoIdentitySource"];
  githubMemorySuppressedForMissingRepoIdentity: boolean;
} {
  const explicitMissingInProcessLog = /\bGitHub repository name is required\b|\brepository name is required\b/i.test(
    args.processLogText ?? ""
  );
  // Prompts and assistant prose may quote this runtime error. Only process/log
  // channels should turn it into a repo-identity missing signal.
  const explicitMissingInEvidence = false;
  const repoIdentity = args.repoIdentity?.trim() ?? "";
  const localRepoIdentity = /^local-repo-[a-f0-9]{12}$/i.test(repoIdentity);
  const unknownRepoIdentity = repoIdentity === "" || repoIdentity === "unknown-repo";
  const githubRepoIdentityMissingObserved =
    explicitMissingInProcessLog || explicitMissingInEvidence || localRepoIdentity || unknownRepoIdentity;
  const githubRepoIdentitySource = explicitMissingInProcessLog
    ? "process_log"
    : explicitMissingInEvidence
      ? "stdout"
    : localRepoIdentity
      ? "local_repo_without_github_remote"
      : unknownRepoIdentity
        ? "unknown"
        : "not-observed";

  return {
    githubRepoIdentityMissingObserved,
    githubRepoIdentitySource,
    githubMemorySuppressedForMissingRepoIdentity: githubRepoIdentityMissingObserved && args.memoryProbeSuppressed
  };
}

type ObservedAgentInvocation = {
  agentName: string;
  timestampMs: number | null;
};

function deriveObservedAgentInvocations(args: {
  observedSubagentEvents?: ObservedSubagentEvent[];
  fallbackNames?: string[];
}) {
  const events = args.observedSubagentEvents ?? [];
  if (events.length === 0) {
    const fallbackNames = args.fallbackNames ?? [];
    return {
      invocationOrder: [...fallbackNames],
      invocationCounts: countObservedNames(fallbackNames),
      invocations: fallbackNames.map((agentName) => ({ agentName, timestampMs: null })),
      routeSummarySource: "name_list_fallback" as const
    };
  }

  const invocations: ObservedAgentInvocation[] = [];
  const invocationCounts: Record<string, number> = {};
  const activeInvocations = new Set<string>();
  const pendingSelected = new Map<string, number | null>();

  const recordInvocation = (agentName: string, timestampMs: number | null) => {
    invocations.push({ agentName, timestampMs });
    invocationCounts[agentName] = (invocationCounts[agentName] ?? 0) + 1;
  };

  for (const event of events) {
    const timestampMs = event.timestampMs ?? null;
    if (event.kind === "selected") {
      if (!activeInvocations.has(event.agentName) && !pendingSelected.has(event.agentName)) {
        recordInvocation(event.agentName, timestampMs);
        pendingSelected.set(event.agentName, timestampMs);
      }
      continue;
    }

    if (event.kind === "started") {
      if (pendingSelected.has(event.agentName)) {
        pendingSelected.delete(event.agentName);
        activeInvocations.add(event.agentName);
        continue;
      }
      if (!activeInvocations.has(event.agentName)) {
        recordInvocation(event.agentName, timestampMs);
        activeInvocations.add(event.agentName);
      }
      continue;
    }

    if (pendingSelected.has(event.agentName)) {
      pendingSelected.delete(event.agentName);
      continue;
    }
    if (!activeInvocations.has(event.agentName)) {
      recordInvocation(event.agentName, pendingSelected.get(event.agentName) ?? timestampMs);
    }
    activeInvocations.delete(event.agentName);
    pendingSelected.delete(event.agentName);
  }

  return {
    invocationOrder: invocations.map((entry) => entry.agentName),
    invocationCounts,
    invocations,
    routeSummarySource: "started_with_fallbacks" as const
  };
}

function summarizeTriageDuplicateState(args: { observedSubagentEvents?: ObservedSubagentEvent[]; invocations: ObservedAgentInvocation[] }) {
  const triageInvocations = args.invocations.filter((entry) => entry.agentName === "Triage");
  const triageInvocationCount = triageInvocations.length;
  const triageDuplicateObserved = triageInvocationCount > 1;
  if (!triageDuplicateObserved) {
    return {
      triageInvocationCount,
      triageDuplicateObserved,
      triageDuplicateAllowedReason: null,
      executionReadyHandoffSeenBeforeSecondTriage: false
    };
  }

  const secondTriageTimestamp = triageInvocations[1]?.timestampMs ?? null;
  const firstTriageTimestamp = triageInvocations[0]?.timestampMs ?? null;
  const milestoneCompletionTimestamps = (args.observedSubagentEvents ?? [])
    .filter((event) => event.kind === "completed" && event.agentName === "Milestone")
    .map((event) => event.timestampMs)
    .filter((value): value is number => typeof value === "number");

  let executionReadyHandoffSeenBeforeSecondTriage = false;
  if (secondTriageTimestamp !== null) {
    executionReadyHandoffSeenBeforeSecondTriage = milestoneCompletionTimestamps.some(
      (timestamp) => timestamp < secondTriageTimestamp && (firstTriageTimestamp === null || timestamp > firstTriageTimestamp)
    );
  }

  return {
    triageInvocationCount,
    triageDuplicateObserved,
    triageDuplicateAllowedReason: executionReadyHandoffSeenBeforeSecondTriage
      ? null
      : "no_post_triage_milestone_completion_observed_before_second_triage",
    executionReadyHandoffSeenBeforeSecondTriage
  };
}

export function summarizePostExecutionRootWrites(stdout: string) {
  let patchMasterStartedAtMs: number | null = null;
  let patchMasterCompletedAtMs: number | null = null;
  let activePatchMasterRuns = 0;
  let postExecutionRootWriteCount = 0;
  let postExecutionRootPatchObserved = false;
  let executionOwnerActiveRootWriteCount = 0;
  let executionOwnerActiveRootPatchObserved = false;
  const writeLikeTools = new Set(["apply_patch", "write", "edit", "multi_edit", "create", "create_file", "write_file", "replace"]);

  for (const line of stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (!line.startsWith("{")) continue;
    const parsed = safeJsonParse<{
      type?: string;
      timestamp?: string;
      data?: {
        agentName?: string;
        agentDisplayName?: string;
        parentToolCallId?: string;
        toolName?: string;
      };
    }>(line);
    if (!parsed?.type) continue;

    const timestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN;
    const eventTimestampMs = Number.isFinite(timestampMs) ? timestampMs : null;

    if (parsed.type === "subagent.started") {
      const agentName = parsed.data?.agentDisplayName ?? parsed.data?.agentName;
      if (agentName === "Patch Master" && eventTimestampMs !== null) {
        activePatchMasterRuns += 1;
        patchMasterCompletedAtMs = null;
        patchMasterStartedAtMs = patchMasterStartedAtMs === null ? eventTimestampMs : Math.min(patchMasterStartedAtMs, eventTimestampMs);
      }
      continue;
    }

    if (parsed.type === "subagent.completed") {
      const agentName = parsed.data?.agentDisplayName ?? parsed.data?.agentName;
      if (agentName === "Patch Master" && eventTimestampMs !== null) {
        activePatchMasterRuns = Math.max(0, activePatchMasterRuns - 1);
        patchMasterCompletedAtMs = eventTimestampMs;
      }
      continue;
    }

    if (parsed.type !== "tool.execution_start" || patchMasterStartedAtMs === null || eventTimestampMs === null) {
      continue;
    }
    if (eventTimestampMs < patchMasterStartedAtMs) {
      continue;
    }

    const toolName = parsed.data?.toolName;
    if (!toolName || !writeLikeTools.has(toolName)) {
      continue;
    }
    if (parsed.data?.parentToolCallId) {
      continue;
    }

    if (activePatchMasterRuns > 0) {
      executionOwnerActiveRootWriteCount += 1;
      if (toolName === "apply_patch") {
        executionOwnerActiveRootPatchObserved = true;
      }
    } else if (patchMasterCompletedAtMs !== null && eventTimestampMs >= patchMasterCompletedAtMs) {
      postExecutionRootWriteCount += 1;
      if (toolName === "apply_patch") {
        postExecutionRootPatchObserved = true;
      }
    }
  }

  return {
    patchMasterCompletedAt: patchMasterCompletedAtMs !== null ? new Date(patchMasterCompletedAtMs).toISOString() : null,
    postExecutionRootWriteObserved: postExecutionRootWriteCount > 0,
    postExecutionRootPatchObserved,
    postExecutionRootWriteCount,
    executionOwnerActiveRootWriteObserved: executionOwnerActiveRootWriteCount > 0,
    executionOwnerActiveRootWriteCount,
    executionOwnerActiveRootPatchObserved
  };
}

function summarizeDirectToolExecution(stdout: string) {
  let toolExecutionCount = 0;
  let writeToolCount = 0;
  let bashToolCount = 0;
  let sessionShutdownObserved = false;
  let sessionShutdownCodeChangesObserved = false;
  let sessionShutdownLinesAdded: number | null = null;
  let sessionShutdownLinesRemoved: number | null = null;
  const sessionShutdownFilesModified = new Set<string>();
  const writeLikeTools = new Set(["apply_patch", "write", "edit", "multi_edit", "create", "create_file", "write_file", "replace"]);

  for (const line of stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (!line.startsWith("{")) continue;
    const parsed = safeJsonParse<{
      type?: string;
      data?: {
        toolName?: string;
        codeChanges?: {
          linesAdded?: number;
          linesRemoved?: number;
          filesModified?: string[];
        };
      };
    }>(line);
    if (!parsed?.type) continue;

    if (parsed.type === "tool.execution_start") {
      toolExecutionCount += 1;
      const toolName = parsed.data?.toolName;
      if (toolName === "bash") {
        bashToolCount += 1;
      }
      if (toolName && writeLikeTools.has(toolName)) {
        writeToolCount += 1;
      }
      continue;
    }

    if (parsed.type === "session.shutdown") {
      sessionShutdownObserved = true;
      const codeChanges = parsed.data?.codeChanges;
      if (codeChanges) {
        sessionShutdownCodeChangesObserved = true;
        sessionShutdownLinesAdded = typeof codeChanges.linesAdded === "number" ? codeChanges.linesAdded : null;
        sessionShutdownLinesRemoved = typeof codeChanges.linesRemoved === "number" ? codeChanges.linesRemoved : null;
        for (const filePath of codeChanges.filesModified ?? []) {
          if (typeof filePath === "string" && filePath) {
            sessionShutdownFilesModified.add(filePath);
          }
        }
      }
    }
  }

  return {
    directToolExecutionObserved: toolExecutionCount > 0 || sessionShutdownCodeChangesObserved,
    toolExecutionCount,
    writeToolCount,
    bashToolCount,
    sessionShutdownObserved,
    sessionShutdownCodeChangesObserved,
    sessionShutdownFilesModified: sortedUnique([...sessionShutdownFilesModified]),
    sessionShutdownLinesAdded,
    sessionShutdownLinesRemoved
  };
}

function extractExplicitProviderRetryCount(line: string) {
  const retriedTimes = line.match(/\bretried\s+(\d+)\s+times\b/i);
  if (retriedTimes) return Number(retriedTimes[1]);

  const retryAttempt = line.match(/\b(?:retry|attempt)\s+(\d+)\s*(?:\/|of)\s*\d+\b/i);
  if (retryAttempt) return Number(retryAttempt[1]);

  const retryCount = line.match(/\bretry(?:\s+count)?\s*[:=]\s*(\d+)\b/i);
  if (retryCount) return Number(retryCount[1]);

  return null;
}

export function summarizeProviderRetries(logText: string): ProviderRetrySummary {
  let providerRetryCount = 0;
  let providerRetryReason: string | null = null;
  let lastProviderTransportError: string | null = null;
  let lastProviderRetryAt: string | null = null;
  let activeAgentDuringRetry: string | null = null;
  let currentAgent: string | null = null;
  let lastRetryLine = -1;
  let recoveredAfterRetry = false;
  let terminalFailureAfterRetry = false;
  let modelRateLimitCount = 0;
  let provider502Count = 0;

  const lines = logText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const agentMatch = line.match(/Custom agent "([^"]+)"/);
    if (agentMatch) {
      currentAgent = agentMatch[1];
    }

    const timestamp = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/)?.[1] ?? null;
    const retryWarning = /Detected HTTP\/2 GOAWAY error, resetting global dispatcher and retrying the request/i.test(line);
    const retryableTransport =
      /503 .*connection_error/i.test(line) ||
      /HTTP\/2 GOAWAY connection terminated/i.test(line) ||
      /SocketError: HTTP\/2: "GOAWAY"/i.test(line);
    const terminalRetryFailure = /Failed to get response from the AI model; retried \d+ times/i.test(line);
    const rateLimitFailure = /\b(user_model_rate_limited|rate limit(?:ed)?|status["']?:\s*429|\b429\b)/i.test(line);
    const provider502Failure = /\b(status["']?:\s*502|\b502\b|unicorn|bad gateway)\b/i.test(line);

    if (rateLimitFailure) {
      modelRateLimitCount += 1;
      providerRetryCount += 1;
      providerRetryReason = providerRetryReason ?? "model rate limit / 429";
      lastProviderTransportError = line.trim();
      lastProviderRetryAt = timestamp ?? lastProviderRetryAt;
      activeAgentDuringRetry = currentAgent ?? activeAgentDuringRetry;
      lastRetryLine = index;
      recoveredAfterRetry = false;
    }

    if (provider502Failure) {
      provider502Count += 1;
      providerRetryCount += 1;
      providerRetryReason = providerRetryReason ?? "provider 502 / gateway error";
      lastProviderTransportError = line.trim();
      lastProviderRetryAt = timestamp ?? lastProviderRetryAt;
      activeAgentDuringRetry = currentAgent ?? activeAgentDuringRetry;
      lastRetryLine = index;
      recoveredAfterRetry = false;
    }

    if (retryWarning) {
      providerRetryCount += 1;
      providerRetryReason = "HTTP/2 GOAWAY / 503 connection_error";
      lastProviderTransportError = line.trim();
      lastProviderRetryAt = timestamp;
      activeAgentDuringRetry = currentAgent;
      lastRetryLine = index;
      recoveredAfterRetry = false;
      terminalFailureAfterRetry = false;
    } else if (retryableTransport && lastRetryLine >= 0) {
      providerRetryReason = providerRetryReason ?? "retryable provider transport error";
      lastProviderTransportError = line.trim();
      lastProviderRetryAt = timestamp ?? lastProviderRetryAt;
      activeAgentDuringRetry = currentAgent ?? activeAgentDuringRetry;
    }

    const explicitRetryCount = line.match(/retried (\d+) times/i)?.[1];
    if (explicitRetryCount) {
      providerRetryCount = Math.max(providerRetryCount, Number.parseInt(explicitRetryCount, 10));
      providerRetryReason = providerRetryReason ?? "retryable provider transport error";
      lastProviderTransportError = line.trim();
      lastProviderRetryAt = timestamp ?? lastProviderRetryAt;
      activeAgentDuringRetry = currentAgent ?? activeAgentDuringRetry;
      if (lastRetryLine < 0) {
        lastRetryLine = index;
      }
    }

    if (terminalRetryFailure) {
      terminalFailureAfterRetry = true;
    }

    if (lastRetryLine >= 0 && index > lastRetryLine) {
      const explicitRetryCount = extractExplicitProviderRetryCount(line);
      if (explicitRetryCount !== null) {
        providerRetryCount = Math.max(providerRetryCount, explicitRetryCount);
      }

      if (/--- End of group ---/.test(line)) {
        recoveredAfterRetry = true;
      }
      if (/Failed to get response from the AI model; retried \d+ times/i.test(line) || /Request was aborted/i.test(line)) {
        terminalFailureAfterRetry = true;
      }
    }
  }

  const providerRetryObserved = providerRetryCount > 0;
  const providerRetryState = !providerRetryObserved
    ? "not-observed"
    : terminalFailureAfterRetry
      ? "terminal-failure-after-retry"
      : recoveredAfterRetry
        ? "recovered-after-retry"
        : "retry-in-progress";
  return {
    providerRetryObserved,
    providerRetryActive: providerRetryState === "retry-in-progress",
    providerRetryState,
    providerRetryRecovered:
      providerRetryObserved ? (terminalFailureAfterRetry ? false : recoveredAfterRetry ? true : null) : null,
    providerRetryCount,
    providerRetryReason,
    lastProviderTransportError,
    lastProviderRetryAt,
    activeAgentDuringRetry,
    providerRetryConfidence: providerRetryObserved ? "explicit" : "unproven",
    modelRateLimitObserved: modelRateLimitCount > 0,
    modelRateLimitCount,
    provider502Observed: provider502Count > 0,
    provider502Count
  };
}

export type ValidationLogSummary = {
  validationObserved: boolean;
  validationStatus: "not-observed" | "passed" | "failed" | "observed-unknown";
  validationRawStatus: "not-observed" | "passed" | "failed" | "observed-unknown";
  validationOverclaimObserved: boolean;
  validationCommandFailures: string[];
  validationRecoveredAfterFailuresObserved: boolean;
  validationRecoverySource: string | null;
  validationRecoveredCommandFailures: string[];
};

export function summarizeValidationLog(text: string): ValidationLogSummary {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        (!isPromptOrRequirementLine(line) || isValidationCheckmarkResultLine(line)) &&
        (!isPlanningOrAdvisoryLine(line) || isValidationCheckmarkResultLine(line))
    );
  const validationObserved = lines.some((line) => isValidationEvidenceLine(line));
  if (!validationObserved) {
    return {
      validationObserved: false,
      validationStatus: "not-observed",
      validationRawStatus: "not-observed",
      validationOverclaimObserved: false,
      validationCommandFailures: [],
      validationRecoveredAfterFailuresObserved: false,
      validationRecoverySource: null,
      validationRecoveredCommandFailures: []
    };
  }

  const failurePatterns = [
    /\b(failed to compile|tests?\s+failed|test files?\s+\d+\s+failed|command failed|returned non-zero|exit code\s+[1-9]|npm ERR!|ELIFECYCLE)\b/i,
    /\b(\d+\s+failed\b|1 failed\b|strict mode violation|locator resolved to|ERR_CONNECTION_REFUSED|page\.goto:\s*net::ERR_CONNECTION_REFUSED)\b/i,
    /\b(AssertionError|TypeError|ReferenceError|SyntaxError|TimeoutError|test timeout|timed out waiting|expected .* received)\b/i,
    /\b(prisma|seed|seeding|typecheck|typescript|eslint|playwright|vitest|next build)\b.*\b(error|failed|failure|non-zero)\b/i,
    /\b(error|failed|failure|non-zero)\b.*\b(prisma|seed|seeding|typecheck|typescript|eslint|playwright|vitest|next build)\b/i
  ];
  const strongPassPatterns = [
    /\b(no eslint warnings or errors|npm test passed|tests?\s+\d+\s+passed|test files?\s+\d+\s+passed|compiled successfully|build passed|validation passed|smoke test passed|playwright.*\bpassed|all required validation commands passed)\b/i,
    /^\s*(?:✓\s*)?\d+\s+passed\b/i,
    /^\s*(?:\d+[\.)]\s*)?`?(?:npm install|npx prisma generate|npx prisma db push --force-reset|npm run seed|npm run lint|npm test|npm run build|npx playwright test)`?\s*(?:✅|passed)\s*$/i,
    /^\s*all passed\.?\s*$/i
  ];
  const passPatterns = [
    ...strongPassPatterns,
    /\b(validation_exit\s*[:=]\s*0|validation_state\s*[:=]\s*done|state=done)\b/i
  ];
  const isValidationSignalNoise = (line: string) =>
    !isValidationCheckmarkResultLine(line) &&
    (isPlanningOrAdvisoryLine(line) ||
      isCodeOrExampleLine(line) ||
      isRetrospectiveValidationFailureNote(line) ||
    /\bAgent is still running after waiting\b/i.test(line) ||
    (/\bagent_id:\s*[^,\s]+/i.test(line) && /\bstatus:\s*running\b/i.test(line) && /\btool_calls_completed\b/i.test(line)) ||
    /\bMCP transport for .* closed\b/i.test(line) ||
    /\bTransient error connecting to HTTP server .*\bfetch failed\b/i.test(line) ||
    /\bRetrying connection to HTTP server\b/i.test(line) ||
    /\bFailed to load memories for prompt:\s*Error:\s*GitHub repository name is required\b/i.test(line) ||
    /\b(Command failed with exit code 128:\s*)?git rev-parse HEAD\b/i.test(line) ||
    /\bFailed to get current commit hash\b/i.test(line) ||
    /\b(Starting|Creating|Connecting) MCP client for\b/i.test(line) ||
    /\bMCP client for .* connected\b/i.test(line) ||
    /\bStarted MCP client for remote server\b/i.test(line) ||
      /\bGitHub MCP server configured after authentication\b/i.test(line));
  const failureSignals = lines
    .map((line, index) => ({ line, index }))
    .filter(
      (entry) =>
        entry.line.length > 0 &&
        !isValidationSignalNoise(entry.line) &&
        failurePatterns.some((pattern) => pattern.test(entry.line))
    );
  const passSignals = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.length > 0 && passPatterns.some((pattern) => pattern.test(entry.line)));
  const strongPassSignals = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.length > 0 && strongPassPatterns.some((pattern) => pattern.test(entry.line)));
  const validationCommandFailures = sortedUnique(failureSignals.map((entry) => entry.line.slice(0, 240)));
  const failed = validationCommandFailures.length > 0;
  const passed = passSignals.length > 0;
  const lastFailureIndex = Math.max(-1, ...failureSignals.map((entry) => entry.index));
  const lastStrongPassIndex = Math.max(-1, ...strongPassSignals.map((entry) => entry.index));
  const hardFailureObserved = failureSignals.some((entry) =>
    /\b(\d+\s+failed\b|strict mode violation|locator resolved to|AssertionError)\b/i.test(entry.line)
  );
  const hardRecoveryObserved = strongPassSignals.some(
    (entry) =>
      entry.index > lastFailureIndex &&
      /\b(npm test passed|tests?\s+\d+\s+passed|test files?\s+\d+\s+passed|playwright.*\bpassed|smoke test passed|all required validation commands passed)\b|^\s*(?:✓\s*)?\d+\s+passed\b|^\s*all passed\.?\s*$/i.test(
        entry.line
      )
  );
  const recoveredByLaterValidation =
    failed && lastStrongPassIndex > lastFailureIndex && (!hardFailureObserved || hardRecoveryObserved);

  if (failed && !recoveredByLaterValidation) {
    return {
      validationObserved: true,
      validationStatus: "failed",
      validationRawStatus: "failed",
      validationOverclaimObserved: passed,
      validationCommandFailures,
      validationRecoveredAfterFailuresObserved: false,
      validationRecoverySource: null,
      validationRecoveredCommandFailures: []
    };
  }
  if (passed || recoveredByLaterValidation) {
    const recovered = recoveredByLaterValidation;
    return {
      validationObserved: true,
      validationStatus: "passed",
      validationRawStatus: recovered ? "failed" : "passed",
      validationOverclaimObserved: false,
      validationCommandFailures: [],
      validationRecoveredAfterFailuresObserved: recovered,
      validationRecoverySource: recovered ? "raw-later-validation-pass" : null,
      validationRecoveredCommandFailures: recovered ? validationCommandFailures : []
    };
  }
  return {
    validationObserved: true,
    validationStatus: "observed-unknown",
    validationRawStatus: "observed-unknown",
    validationOverclaimObserved: false,
    validationCommandFailures: [],
    validationRecoveredAfterFailuresObserved: false,
    validationRecoverySource: null,
    validationRecoveredCommandFailures: []
  };
}

function isValidationCheckmarkResultLine(line: string): boolean {
  return /^\s*(?:\d+[\.)]\s*)?`?(?:npm install|npx prisma generate|npx prisma db push --force-reset|npm run seed|npm run lint|npm test|npm run build|npx playwright test)`?\s*(?:✅|passed)\s*$/i.test(
    line
  );
}

function isRetrospectiveValidationFailureNote(line: string): boolean {
  const retrospectiveHeader =
    /^\s*(?:[-*]\s*)?(?:raw validation notes?|known limitations?|known limitation \/ remaining uncertainty|remaining uncertainty|what remains uncertain)\b/i.test(
      line
    );
  const retrospectiveRecoveryNote =
    /\b(initial|earlier|previous|prior|proven blocker|recovered|resolved via|resolved by|replaced with|narrowed include|narrowed exclude)\b/i.test(
      line
    ) &&
    /\b(failed|failure|failures|error|errors|blocker|rejected)\b/i.test(line) &&
    /\b(validation|prisma|schema-engine|lint|eslint|vitest|playwright|build|test|db push)\b/i.test(line);
  const succeedsAfterWorkaround =
    /\bso\b.*\b(succeeds|passes|is stabilized)\b/i.test(line) &&
    /\b(prisma|validation|command|wrapper|workaround)\b/i.test(line);
  return retrospectiveHeader || retrospectiveRecoveryNote || succeedsAfterWorkaround;
}

export function summarizeRouteObservations(args: {
  agentId: string | null;
  agentLane: AgentLane;
  caseId?: string | null;
  promptText?: string;
  transcriptText?: string;
  observedSubagentEvents?: ObservedSubagentEvent[];
  observedSubagents: string[];
  observedSubagentCounts: Record<string, number>;
  stdout: string;
  processLog?: string;
  sharedSurfaceChangeObserved?: boolean;
  githubProbeCache?: GitHubProbeCache;
  githubProbeCacheBefore?: GitHubProbeCache;
  githubProbeCacheAfter?: GitHubProbeCache;
  githubProbeLogText?: string;
}) {
  const invocationSummary = deriveObservedAgentInvocations({
    observedSubagentEvents: args.observedSubagentEvents,
    fallbackNames: args.observedSubagents
  });
  const routeAgents = invocationSummary.invocationOrder;
  const executedRouteAgents = args.observedSubagentEvents
    ? orderedUnique(
        args.observedSubagentEvents
          .filter((event) => event.kind === "started" || event.kind === "completed")
          .map((event) => event.agentName)
      )
    : undefined;
  const directToolSummary = summarizeDirectToolExecution(args.stdout);
  const observedPlanningChain = routeAgents.filter((name) => knownXgcAgentNames.has(name));
  const triageDuplicateSummary = summarizeTriageDuplicateState({
    observedSubagentEvents: args.observedSubagentEvents,
    invocations: invocationSummary.invocations
  });
  const observedRuntimeModelSummary = summarizeObservedSessionModels(args.stdout);
  const observedRuntimeModels = observedRuntimeModelSummary.observedRuntimeModels;

  const patchIndex = observedPlanningChain.indexOf("Patch Master");
  const patchRouteIndex = routeAgents.indexOf("Patch Master");
  const milestoneIndex = observedPlanningChain.indexOf("Milestone");
  const triageIndex = observedPlanningChain.indexOf("Triage");
  const groundingIndex = observedPlanningChain.findIndex((name) => name === "Repo Scout" || name === "Ref Index");
  const evidenceText = [args.caseId ?? "", args.promptText ?? "", args.transcriptText ?? "", args.stdout, args.processLog ?? ""].join(
    "\n"
  );
  const integrationSignals = summarizeIntegrationClassSignals(evidenceText, {
    sharedSurfaceChangeObserved: args.sharedSurfaceChangeObserved
  });
  const foundationFailureSignals = summarizeFoundationFailureSignals(evidenceText);
  const specialistFanoutSummary = summarizeSpecialistFanoutPolicy({
    promptText: args.promptText,
    transcriptText: args.transcriptText,
    evidenceText,
    routeAgents,
    executedRouteAgents,
    observedSubagentCounts: args.observedSubagentCounts,
    patchMasterInvocationCount: invocationSummary.invocationCounts["Patch Master"] ?? 0
  });

  let observedGroundingBeforeExecutor: ExecutionGroundingObservation = "unproven";
  if (patchIndex === -1) {
    observedGroundingBeforeExecutor =
      observedPlanningChain.length > 0 || observedRuntimeModels.length > 0 ? "no-executor-observed" : "unproven";
  } else {
    observedGroundingBeforeExecutor =
      groundingIndex >= 0 && groundingIndex < patchIndex ? "grounded-before-executor" : "executor-before-grounding";
  }

  let routeConfidence: ProofStrength = "unproven";
  if (observedPlanningChain.length > 0 || observedRuntimeModels.length > 0) {
    routeConfidence = "explicit";
  } else if (directToolSummary.directToolExecutionObserved) {
    routeConfidence = "strong-indirect";
  } else if (args.agentLane === "front-door") {
    routeConfidence = "strong-indirect";
  }

  const githubProbeCacheBefore = args.githubProbeCacheBefore ?? args.githubProbeCache ?? emptyGitHubProbeCache();
  const githubProbeCacheAfter = args.githubProbeCacheAfter ?? args.githubProbeCache ?? emptyGitHubProbeCache();
  const githubProbePolicyBefore = resolveGitHubProbePolicy({
    agentId: args.agentId,
    caseId: args.caseId,
    sessionCache: githubProbeCacheBefore
  });
  const githubProbePolicyAfter = resolveGitHubProbePolicy({
    agentId: args.agentId,
    caseId: args.caseId,
    sessionCache: githubProbeCacheAfter
  });
  const githubProbeObservation = scanGitHubProbeLog(args.githubProbeLogText ?? args.processLog ?? "");
  const githubMemoryEnabledCheck = summarizeGitHubCapabilityCheck({
    allowedForRoute: githubProbePolicyBefore.githubMemoryEnabledProbe !== "skipped_for_route",
    cachedAvailable: githubProbeCacheBefore.memoryEnabledAvailable,
    cachedUnavailable: githubProbeCacheBefore.memoryEnabledUnavailable,
    observedSuccessCount: githubProbeObservation.memoryEnabledSuccessCount,
    observedFailureCount: githubProbeObservation.memoryEnabled404Count
  });
  const prLookupCheck = summarizeGitHubCapabilityCheck({
    allowedForRoute: githubProbePolicyBefore.prLookup !== "skipped_for_route",
    cachedAvailable: githubProbeCacheBefore.prAvailable,
    cachedUnavailable: githubProbeCacheBefore.prUnavailable,
    observedSuccessCount: githubProbeObservation.prSuccessCount,
    observedFailureCount: githubProbeObservation.pr404Count
  });
  const observedScoutCount = invocationSummary.invocationCounts["Repo Scout"] ?? args.observedSubagentCounts["Repo Scout"] ?? 0;
  const observedRefIndex = observedPlanningChain.includes("Ref Index");
  const postExecutionPlannerReopenAgents =
    patchIndex >= 0
      ? collapseConsecutiveNames(
          observedPlanningChain
            .slice(patchIndex + 1)
            .filter((name) => postExecutionPlannerReopenAgentNames.has(name))
        )
      : [];
  const postExecutionGenericAgents =
    patchRouteIndex >= 0 ? collapseConsecutiveNames(routeAgents.slice(patchRouteIndex + 1).filter(isBuiltInGenericAgent)) : [];
  const postExecutionBuiltInAgents = postExecutionGenericAgents;
  const executionOwner = patchRouteIndex >= 0 ? ("Patch Master" as const) : null;
  const ownershipTransferredToExecution = executionOwner === "Patch Master";
  const backgroundAgentsStarted = extractBackgroundExecutionAgentIds(evidenceText);
  const backgroundAgentsCompleted = extractCompletedBackgroundAgentIds(evidenceText);
  const backgroundAgentsRead = extractReadBackgroundAgentIds(evidenceText);
  const backgroundExecutionAgentIds = sortedUnique([...backgroundAgentsStarted, ...backgroundAgentsCompleted]);
  const backgroundExecutionAgentObserved =
    backgroundExecutionAgentIds.length > 0 ||
    /\bAgent started in background\b|\btrack progress with\s+\/tasks\b/i.test(evidenceText) ||
    hasExecutionStatusClosure(evidenceText);
  const patchMasterStartedCount = (args.observedSubagentEvents ?? []).filter(
    (event) => event.kind === "started" && event.agentName === "Patch Master"
  ).length;
  const patchMasterCompletedCount = (args.observedSubagentEvents ?? []).filter(
    (event) => event.kind === "completed" && event.agentName === "Patch Master"
  ).length;
  const executionStatusClosureObserved = hasExecutionStatusClosure(evidenceText);
  const executionOwnerBlockedObserved = hasExecutionStatusBlocked(evidenceText);
  const patchMasterCompletionObserved =
    patchMasterCompletedCount > 0 || /\bPatch Master\b[\s\S]{0,120}\bcompleted\b/i.test(evidenceText) || executionStatusClosureObserved;
  const executionOwnerAgentId =
    backgroundAgentsStarted.find((agentId) => /patch|execution|implement|build|commit/i.test(agentId)) ??
    backgroundAgentsCompleted.find((agentId) => /patch|execution|implement|build|commit/i.test(agentId)) ??
    (backgroundAgentsStarted.length === 1 ? backgroundAgentsStarted[0] : null);
  const executionOwnerCompleted =
    Boolean(executionOwnerAgentId && backgroundAgentsCompleted.includes(executionOwnerAgentId)) || patchMasterCompletionObserved;
  const executionOwnerResultRead = Boolean(executionOwnerAgentId && backgroundAgentsRead.includes(executionOwnerAgentId));
  const finalizedBeforeExecutionOwnerRead =
    ownershipTransferredToExecution &&
    Boolean(executionOwnerAgentId) &&
    executionOwnerCompleted &&
    !executionOwnerResultRead &&
    !executionStatusClosureObserved &&
    !executionOwnerBlockedObserved;
  const backgroundAgentUnresolvedIds = sortedUnique(
    backgroundAgentsStarted.filter((agentId) => !backgroundAgentsCompleted.includes(agentId) && !backgroundAgentsRead.includes(agentId))
  );
  const backgroundAgentUnresolvedObserved = backgroundAgentUnresolvedIds.length > 0;
  const blockingBackgroundAgentsUnresolved = sortedUnique(
    backgroundAgentsStarted.filter((agentId) => {
      const looksBlocking = /patch|execution|implement|build|commit|visual|writing|artistry|multimodal/i.test(agentId);
      if (!looksBlocking) return false;
      if (agentId === executionOwnerAgentId && (executionStatusClosureObserved || executionOwnerResultRead || executionOwnerBlockedObserved)) {
        return false;
      }
      if (!backgroundAgentsCompleted.includes(agentId)) return true;
      if (agentId === executionOwnerAgentId && !executionOwnerResultRead && !executionStatusClosureObserved) return true;
      return false;
    })
  );
  const postExecutionCompletionGapObserved = finalizedBeforeExecutionOwnerRead || blockingBackgroundAgentsUnresolved.length > 0;
  const backgroundExecutionAgentUnresolved =
    backgroundExecutionAgentObserved &&
    ownershipTransferredToExecution &&
    (blockingBackgroundAgentsUnresolved.length > 0 ||
      (!executionStatusClosureObserved &&
        !executionOwnerBlockedObserved &&
        !executionOwnerCompleted &&
        (patchMasterStartedCount === 0 || patchMasterCompletedCount < patchMasterStartedCount)));
  const patchMasterHandoffWithoutCompletionObserved =
    ownershipTransferredToExecution &&
    patchMasterStartedCount > 0 &&
    patchMasterCompletedCount < patchMasterStartedCount &&
    !executionOwnerCompleted &&
    !executionOwnerBlockedObserved &&
    !directToolSummary.sessionShutdownCodeChangesObserved &&
    directToolSummary.sessionShutdownFilesModified.length === 0;
  const executionHandoffWithoutObservedRepoDiff =
    ownershipTransferredToExecution &&
    !directToolSummary.sessionShutdownCodeChangesObserved &&
    directToolSummary.sessionShutdownFilesModified.length === 0;
  const malformedTaskPayloadObserved = evidenceText.split(/\r?\n/).some((line) => isMalformedTaskPayloadLine(line));
  const runtimeToolingIssueSummary = summarizeRuntimeToolingIssues(evidenceText);
  const postExecutionRootWrites = summarizePostExecutionRootWrites(args.stdout);
  const postExecutionOwnershipLeakObserved =
    postExecutionPlannerReopenAgents.length > 0 ||
    postExecutionGenericAgents.length > 0 ||
    postExecutionRootWrites.postExecutionRootWriteObserved ||
    postExecutionRootWrites.executionOwnerActiveRootWriteObserved;
  const ownershipLeakAllowedReason = postExecutionOwnershipLeakObserved
    ? extractExplicitOwnershipLeakAllowedReason(evidenceText)
    : null;
  const providerRetrySummary = summarizeProviderRetries(args.processLog ?? "");
  const agentModelPolicyMismatchSummary = summarizeAgentModelPolicyMismatches(
    args.stdout,
    observedRuntimeModelSummary.requestedRuntimeModel
  );
  const memoryFreshProbeObserved = githubMemoryEnabledCheck.check === "checked_fresh";
  const prFreshProbeObserved = prLookupCheck.check === "checked_fresh";
  const memoryProbeSuppressed =
    !memoryFreshProbeObserved &&
    (githubProbePolicyBefore.githubMemoryEnabledProbe === "skipped_for_route" ||
      githubProbePolicyBefore.githubMemoryEnabledProbe === "disabled_after_404");
  const memoryProbeSuppressedForMissingRepoIdentity =
    !memoryFreshProbeObserved &&
    (memoryProbeSuppressed ||
      githubProbePolicyAfter.githubMemoryEnabledProbe === "skipped_for_route" ||
      githubProbePolicyAfter.githubMemoryEnabledProbe === "disabled_after_404" ||
      githubMemoryEnabledCheck.check === "skipped" ||
      githubMemoryEnabledCheck.check === "disabled_after_404");
  const prProbeSuppressed =
    !prFreshProbeObserved &&
    (githubProbePolicyBefore.prLookup === "skipped_for_route" || githubProbePolicyBefore.prLookup === "disabled_after_404");
  const githubRepoIdentitySignals = summarizeGitHubRepoIdentitySignals({
    processLogText: args.githubProbeLogText ?? args.processLog ?? "",
    evidenceText,
    repoIdentity: githubProbeCacheBefore.repoIdentity,
    memoryProbeSuppressed: memoryProbeSuppressedForMissingRepoIdentity
  });

  const routeSummarySource =
    routeAgents.length > 0
      ? invocationSummary.routeSummarySource
      : directToolSummary.toolExecutionCount > 0
        ? ("raw_tool_events_fallback" as const)
        : directToolSummary.sessionShutdownCodeChangesObserved
          ? ("session_shutdown_code_changes_fallback" as const)
        : invocationSummary.routeSummarySource;
  const routeSummary =
    routeAgents.length > 0
      ? routeAgents.join(" -> ")
      : directToolSummary.directToolExecutionObserved
        ? "Direct Copilot Session"
        : null;

  return {
    routeAgents,
    routeSummary,
    keyAgents: orderedUnique(routeAgents),
    observedPlanningChain,
    routeSummarySource,
    ...directToolSummary,
    observedFrontDoorHandledDirectly:
      args.agentLane === "front-door"
        ? observedPlanningChain.length > 0
          ? observedPlanningChain.every((name) => name === "Repo Master")
          : null
        : null,
    observedScoutCount,
    repoScoutInvocationCount: invocationSummary.invocationCounts["Repo Scout"] ?? 0,
    triageInvocationCount: triageDuplicateSummary.triageInvocationCount,
    patchMasterInvocationCount: invocationSummary.invocationCounts["Patch Master"] ?? 0,
    requiredCheckInvocationCount: invocationSummary.invocationCounts["Required Check"] ?? 0,
    builtInGenericAgentInvocationCount: routeAgents.filter(isBuiltInGenericAgent).length,
    triageDuplicateObserved: triageDuplicateSummary.triageDuplicateObserved,
    triageDuplicateAllowedReason: triageDuplicateSummary.triageDuplicateAllowedReason,
    executionReadyHandoffSeenBeforeSecondTriage: triageDuplicateSummary.executionReadyHandoffSeenBeforeSecondTriage,
    observedPlannerBeforeExecutor: patchIndex >= 0 ? (milestoneIndex >= 0 ? milestoneIndex < patchIndex : false) : null,
    observedTriageBeforeExecutor: patchIndex >= 0 ? (triageIndex >= 0 ? triageIndex < patchIndex : false) : null,
    observedRefIndex,
    observedGroundingBeforeExecutor,
    observedExecutionPhasePure: patchIndex >= 0 ? !postExecutionOwnershipLeakObserved : null,
    postExecutionPlannerReopenAgents,
    postExecutionGenericAgentObserved: postExecutionGenericAgents.length > 0,
    postExecutionBuiltInAgentObserved: postExecutionBuiltInAgents.length > 0,
    postExecutionGenericAgents,
    postExecutionBuiltInAgents,
    postExecutionOwnershipLeakObserved,
    ownershipLeakAllowedReason,
    executionOwner,
    ownershipTransferredToExecution,
    backgroundExecutionAgentObserved,
    backgroundExecutionAgentUnresolved,
    backgroundAgentUnresolvedObserved,
    backgroundAgentUnresolvedIds,
    backgroundExecutionAgentIds,
    backgroundAgentsStarted,
    backgroundAgentsCompleted,
    backgroundAgentsRead,
    blockingBackgroundAgentsUnresolved,
    executionOwnerAgentId,
    executionOwnerResultRead,
    executionOwnerBlockedObserved,
    finalizedBeforeExecutionOwnerRead,
    postExecutionCompletionGapObserved,
    patchMasterHandoffWithoutCompletionObserved,
    executionHandoffWithoutObservedRepoDiff,
    malformedTaskPayloadObserved,
    ...runtimeToolingIssueSummary,
    postExecutionRootWriteObserved: postExecutionRootWrites.postExecutionRootWriteObserved,
    postExecutionRootPatchObserved: postExecutionRootWrites.postExecutionRootPatchObserved,
    postExecutionRootWriteCount: postExecutionRootWrites.postExecutionRootWriteCount,
    executionOwnerActiveRootWriteObserved: postExecutionRootWrites.executionOwnerActiveRootWriteObserved,
    executionOwnerActiveRootWriteCount: postExecutionRootWrites.executionOwnerActiveRootWriteCount,
    executionOwnerActiveRootPatchObserved: postExecutionRootWrites.executionOwnerActiveRootPatchObserved,
    integrationClassTaskObserved: integrationSignals.integrationClassTaskObserved,
    foundationReadinessAssessed: integrationSignals.foundationReadinessAssessed,
    foundationReadinessUnknown:
      integrationSignals.foundationReadinessUnknown ||
      foundationFailureSignals.repeatedFoundationFailureObserved ||
      foundationFailureSignals.validationServerReadinessFailureObserved ||
      foundationFailureSignals.preflightBlockerObserved,
    foundationRiskRaised:
      integrationSignals.foundationRiskRaised ||
      foundationFailureSignals.repeatedFoundationFailureObserved ||
      foundationFailureSignals.validationServerReadinessFailureObserved ||
      foundationFailureSignals.preflightBlockerObserved,
    ...specialistFanoutSummary,
    repeatedFoundationFailureObserved: foundationFailureSignals.repeatedFoundationFailureObserved,
    foundationRecoverySuggested: foundationFailureSignals.foundationRecoverySuggested,
    foundationFailureClasses: foundationFailureSignals.foundationFailureClasses,
    foundationRecoveryReason: foundationFailureSignals.foundationRecoveryReason,
    bootstrapFailureObserved: foundationFailureSignals.bootstrapFailureObserved,
    runtimeConfigMismatchObserved: foundationFailureSignals.runtimeConfigMismatchObserved,
    toolingMaterializationFailureObserved: foundationFailureSignals.toolingMaterializationFailureObserved,
    legacyHookPluginConflictObserved: foundationFailureSignals.legacyHookPluginConflictObserved,
    hookExecutionFailureObserved: foundationFailureSignals.hookExecutionFailureObserved,
    copilotAuthFailureObserved: foundationFailureSignals.copilotAuthFailureObserved,
    copilotModelListFailureObserved: foundationFailureSignals.copilotModelListFailureObserved,
    copilotPolicyFailureObserved: foundationFailureSignals.copilotPolicyFailureObserved,
    preflightBlockerObserved: foundationFailureSignals.preflightBlockerObserved,
    preflightBlockerKind: foundationFailureSignals.preflightBlockerKind,
    preflightBlockerReason: foundationFailureSignals.preflightBlockerReason,
    appFoundationFailureObserved: foundationFailureSignals.appFoundationFailureObserved,
    validationPortConflictObserved: foundationFailureSignals.validationPortConflictObserved,
    validationServerReadinessFailureObserved: foundationFailureSignals.validationServerReadinessFailureObserved,
    githubMemoryEnabledProbe: githubProbePolicyAfter.githubMemoryEnabledProbe,
    githubMemoryPromptProbe: githubProbePolicyAfter.githubMemoryPromptProbe,
    prLookup: githubProbePolicyAfter.prLookup,
    githubMemoryEnabledCheck: githubMemoryEnabledCheck.check,
    githubMemoryEnabledCheckCached: githubMemoryEnabledCheck.cached,
    githubMemoryEnabledCheckCount: githubProbeObservation.memoryEnabledSuccessCount + githubProbeObservation.memoryEnabled404Count,
    githubMemoryEnabledCheckSource: githubMemoryEnabledCheck.source,
    githubMemoryEnabledFreshAfterCacheObserved:
      githubProbeCacheBefore.memoryEnabledAvailable && githubProbeObservation.memoryEnabledSuccessCount > 0,
    prContextCheck: prLookupCheck.check,
    prContextCheckCached: prLookupCheck.cached,
    prContextCheckCount: githubProbeObservation.prSuccessCount + githubProbeObservation.pr404Count,
    prContextCheckSource: prLookupCheck.source,
    prContextFreshAfterCacheObserved: githubProbeCacheBefore.prAvailable && githubProbeObservation.prSuccessCount > 0,
    prLookupCheck: prLookupCheck.check,
    prLookupCheckCached: prLookupCheck.cached,
    prLookupCheckSource: prLookupCheck.source,
    githubCapabilityCacheHits: Number(githubMemoryEnabledCheck.cacheHit) + Number(prLookupCheck.cacheHit),
    githubCapabilityCacheMisses: Number(githubMemoryEnabledCheck.cacheMiss) + Number(prLookupCheck.cacheMiss),
    ...githubRepoIdentitySignals,
    observedMemoryProbeSuppressed: memoryProbeSuppressed,
    observedPrProbeSuppressed: prProbeSuppressed,
    routeConfidence,
    ...observedRuntimeModelSummary,
    ...agentModelPolicyMismatchSummary,
    ...providerRetrySummary
  } satisfies RouteObservationSummary;
}

function normalizeFilePathForComparison(filePath: string, roots: Array<string | null | undefined>) {
  if (!filePath) return null;
  const candidateRoots = roots.filter((value): value is string => Boolean(value)).map((value) => path.resolve(value));
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  for (const root of candidateRoots) {
    return path.resolve(root, filePath);
  }
  return path.resolve(filePath);
}

const integrationOwnedSurfacePatterns = [
  /(^|\/)(prisma\/schema\.prisma|schema\.(prisma|sql))$/i,
  /(^|\/)(migrations|db|database)\//i,
  /(^|\/)(prisma\/seed\.[^/]+|seed\.[^/]+|setup\.[^/]+|init\.[^/]+)$/i,
  /(^|\/)(auth|session|middleware)(\.|\/)/i,
  /(^|\/)(\.env[^/]*|next\.config\.[^/]+|vite\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|tailwind\.config\.[^/]+|postcss\.config\.[^/]+|components\.json)$/i,
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig[^/]*\.json)$/i,
  /(^|\/)(app\/(layout|page|globals)\.[^/]+|src\/app\/(layout|page|globals)\.[^/]+|components\/(shell|app-shell|navigation|nav|sidebar)(\/|\.))\/?/i,
  /(^|\/)(src\/)?components\/(shell|app-shell|navigation|nav|sidebar)(\/|\.)/i,
  /(^|\/)(src\/)?components\/ui\/(badge|status-badge|data-table)\.[^/]+$/i,
  /(^|\/)(src\/)?lib\/(data|queries|seed|mocks|fixtures|test-utils|navigation|nav|routes|status|badges?|domain|domains|demo|demo-data)(\/|\.)/i,
  /(^|\/)(src\/)?tests?\/(helpers|fixtures|mocks|setup|e2e|smoke)(\/|\.)/i,
  /(^|\/)(e2e|playwright|cypress)\/(fixtures|setup|helpers|smoke|specs?)(\/|\.)/i,
  /(^|\/)(README\.md|docs\/[^/]+\.md)$/i,
  /(^|\/)(hooks\/hooks\.json|\.github\/hooks\/xgc-hooks\.json|lsp\.json|\.github\/mcp\.json)$/i,
  /(^|\/)(source\/agents|agents|\.github\/agents|source\/skills|skills|\.github\/skills)\//i,
  /(^|\/)scripts\/(lib\/runtime-|hooks\/finalize-session-summary\.py|smoke-copilot-cli\.ts|validate-global-xgc\.ts|xgc-shell\.sh|install-global-xgc\.sh)/i
];

export function classifyIntegrationOwnedSurfaces(files: string[]) {
  return sortedUnique(
    files
      .map((filePath) => filePath.replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter((filePath) => integrationOwnedSurfacePatterns.some((pattern) => pattern.test(filePath)))
  );
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

function isRepoCodePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return Boolean(normalized) && !normalized.startsWith(".xgc/");
}

function isValidationArtifactPath(filePath: string | null | undefined) {
  const normalized = (filePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    normalized.startsWith(".xgc/validation/") ||
    normalized.startsWith(".xgc/live-smoke/") ||
    normalized.startsWith("test-results/") ||
    normalized.startsWith("playwright-report/")
  );
}

export function classifyModifiedFiles(
  filesModified: string[],
  opts: {
    workspaceRoot?: string | null;
    repoRoot?: string | null;
    copilotHome?: string | null;
    profileHome?: string | null;
    sharedSurfaceOwnerDeclared?: boolean;
  } = {}
): FileChangeSummary {
  const repoWorkingTreeFiles = new Set<string>();
  const sessionStateFiles = new Set<string>();
  const stateArtifactFiles = new Set<string>();
  const validationArtifactFiles = new Set<string>();
  const externalFiles = new Set<string>();
  const workspaceRoot = opts.workspaceRoot ? path.resolve(opts.workspaceRoot) : null;
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : null;
  const copilotHome = opts.copilotHome ? path.resolve(opts.copilotHome) : null;
  const profileHome = opts.profileHome ? path.resolve(opts.profileHome) : null;
  const roots = [workspaceRoot, repoRoot];

  for (const originalFile of filesModified) {
    const normalized = normalizeFilePathForComparison(originalFile, roots);
    if (!normalized) continue;
    const normalizedDisplay = path.isAbsolute(originalFile) ? normalized : originalFile;

    const underWorkspace = workspaceRoot ? normalized.startsWith(`${workspaceRoot}${path.sep}`) : false;
    const underRepo = repoRoot ? normalized.startsWith(`${repoRoot}${path.sep}`) : false;
    const underCopilotHome = copilotHome ? normalized.startsWith(`${copilotHome}${path.sep}`) : false;
    const underProfileHome = profileHome ? normalized.startsWith(`${profileHome}${path.sep}`) : false;

    const relativeWorkspace = underWorkspace && workspaceRoot ? path.relative(workspaceRoot, normalized) : null;
    const relativeRepo = underRepo && repoRoot ? path.relative(repoRoot, normalized) : null;
    const relativeProfile = underProfileHome && profileHome ? path.relative(profileHome, normalized) : null;
    const preferredRelative =
      relativeWorkspace ??
      relativeRepo ??
      (relativeProfile ? path.join(path.basename(profileHome ?? ".copilot-xgc"), relativeProfile) : null) ??
      normalizedDisplay;

    const workspaceXgcPath = relativeWorkspace?.startsWith(`.xgc${path.sep}`) ?? false;
    const repoXgcPath = relativeRepo?.startsWith(`.xgc${path.sep}`) ?? false;
    const validationPath =
      isValidationArtifactPath(relativeWorkspace) ||
      isValidationArtifactPath(relativeRepo) ||
      normalized.includes(`${path.sep}.xgc${path.sep}validation${path.sep}`) ||
      normalized.includes(`${path.sep}.xgc${path.sep}live-smoke${path.sep}`);
    const copilotStatePath =
      underCopilotHome &&
      (
        normalized.includes(`${path.sep}session-state${path.sep}`) ||
        normalized.includes(`${path.sep}logs${path.sep}`) ||
        normalized.includes(`${path.sep}rewind-snapshots${path.sep}`)
      );
    const stateArtifactPath =
      normalized.includes(`${path.sep}session-state${path.sep}`) ||
      normalized.includes(`${path.sep}rewind-snapshots${path.sep}`);
    const profileStatePath =
      underProfileHome &&
      (
        normalized.includes(`${path.sep}session-state${path.sep}`) ||
        normalized.includes(`${path.sep}logs${path.sep}`) ||
        normalized.includes(`${path.sep}rewind-snapshots${path.sep}`)
      );

    if (validationPath) {
      validationArtifactFiles.add(preferredRelative);
      continue;
    }

    if (workspaceXgcPath || repoXgcPath || copilotStatePath || profileStatePath) {
      sessionStateFiles.add(preferredRelative);
      if (stateArtifactPath) {
        stateArtifactFiles.add(preferredRelative);
      }
      continue;
    }

    if (underWorkspace || underRepo || !path.isAbsolute(originalFile)) {
      repoWorkingTreeFiles.add(preferredRelative);
      continue;
    }

    externalFiles.add(normalizedDisplay);
  }

  const repoFiles = sortedUnique([...repoWorkingTreeFiles]);
  const integrationOwnedSurfacesTouched = classifyIntegrationOwnedSurfaces(repoFiles);
  const sharedSurfaceChangeObserved = integrationOwnedSurfacesTouched.length > 0;
  const sharedSurfaceOwnerDeclared = Boolean(opts.sharedSurfaceOwnerDeclared);
  const sharedSurfaceConflictRisk = sharedSurfaceChangeObserved && !sharedSurfaceOwnerDeclared;
  const sharedSurfaceFinalIntegratorNeeded = sharedSurfaceChangeObserved;

  return {
    repoWorkingTreeFiles: repoFiles,
    committedRepoFiles: null,
    sessionStateFiles: sortedUnique([...sessionStateFiles]),
    stateArtifactFiles: sortedUnique([...stateArtifactFiles]),
    validationArtifactFiles: sortedUnique([...validationArtifactFiles]),
    externalFiles: sortedUnique([...externalFiles]),
    integrationOwnedSurfacesTouched,
    sharedSurfaceChangeObserved,
    sharedSurfaceOwnerDeclared,
    sharedSurfaceConflictRisk,
    sharedSurfaceReviewRecommended: sharedSurfaceChangeObserved,
    sharedSurfaceFinalIntegratorNeeded,
    repoWorkingTreeChanged: repoWorkingTreeFiles.size > 0,
    committedRepoChanged: null,
    repoCodeChanged: repoWorkingTreeFiles.size > 0,
    workingTreeClean: repoWorkingTreeFiles.size === 0,
    repoChangesCommitted: null,
    repoChangesUncommitted: repoWorkingTreeFiles.size > 0,
    workingTreeOnlyDiffObserved: repoWorkingTreeFiles.size > 0,
    committedDiffSource: repoWorkingTreeFiles.size > 0 ? "working-tree" : "unavailable",
    sessionStateOnly:
      repoWorkingTreeFiles.size === 0 &&
      sessionStateFiles.size > 0 &&
      validationArtifactFiles.size === 0 &&
      externalFiles.size === 0,
    stateArtifactOnly:
      repoWorkingTreeFiles.size === 0 &&
      stateArtifactFiles.size > 0 &&
      sessionStateFiles.size === stateArtifactFiles.size &&
      validationArtifactFiles.size === 0 &&
      externalFiles.size === 0
  };
}

export function readGitHead(repoRoot: string) {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export function listCommittedFilesBetween(repoRoot: string, startHead: string | null, endHead: string | null) {
  if (!startHead || !endHead) return null;
  if (startHead === endHead) return [];
  const result = spawnSync("git", ["-C", repoRoot, "diff", "--name-only", `${startHead}..${endHead}`], {
    encoding: "utf8"
  });
  if (result.status !== 0) return null;
  return sortedUnique(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export function readGitWorkingTreeChanged(repoRoot: string) {
  const result = spawnSync("git", ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().length > 0 : null;
}

export function withCommittedRepoFiles(
  summary: FileChangeSummary,
  committedRepoFiles: string[] | null,
  workingTreeChangedAtEnd: boolean | null = null
): FileChangeSummary {
  const committedFiles = committedRepoFiles ? sortedUnique(committedRepoFiles.filter(isRepoCodePath)) : null;
  const committedRepoChanged = committedFiles === null ? null : committedFiles.length > 0;
  const repoChangesUncommitted = workingTreeChangedAtEnd ?? summary.repoWorkingTreeChanged;
  const repoCodeChanged = summary.repoWorkingTreeChanged || committedRepoChanged === true;
  return {
    ...summary,
    committedRepoFiles: committedFiles,
    committedRepoChanged,
    repoCodeChanged,
    repoChangesCommitted: committedRepoChanged,
    repoChangesUncommitted,
    workingTreeClean: !repoChangesUncommitted,
    workingTreeOnlyDiffObserved: repoChangesUncommitted && committedRepoChanged === false,
    committedDiffSource:
      committedFiles !== null
        ? "git-head-range"
        : repoChangesUncommitted
          ? "working-tree"
          : summary.committedDiffSource ?? "unavailable",
    sharedSurfaceFinalIntegratorNeeded: summary.sharedSurfaceFinalIntegratorNeeded,
    sessionStateOnly:
      !repoCodeChanged &&
      summary.sessionStateFiles.length > 0 &&
      summary.validationArtifactFiles.length === 0 &&
      summary.externalFiles.length === 0,
    stateArtifactOnly:
      !repoCodeChanged &&
      summary.stateArtifactFiles.length > 0 &&
      summary.sessionStateFiles.length === summary.stateArtifactFiles.length &&
      summary.validationArtifactFiles.length === 0 &&
      summary.externalFiles.length === 0
  };
}

export function captureWorkspaceSnapshot(root: string) {
  const snapshot = new Map<string, string>();
  const ignored = new Set([".git", "node_modules", "coverage", ".tmp"]);
  const ignoredRelativePrefixes = [
    path.join(".xgc", "copilot-home", "installed-plugins"),
    path.join(".xgc", "copilot-home", "agents"),
    path.join(".xgc", "copilot-home", "skills")
  ];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (ignoredRelativePrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}${path.sep}`))) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const digest = createHash("sha1").update(fs.readFileSync(fullPath)).digest("hex");
        snapshot.set(relativePath, digest);
      }
    }
  };

  walk(root);
  return snapshot;
}

export function diffWorkspaceSnapshots(before: Map<string, string>, after: Map<string, string>) {
  const changed = new Set<string>();
  for (const [filePath, digest] of before.entries()) {
    if (after.get(filePath) !== digest) {
      changed.add(filePath);
    }
  }
  for (const [filePath, digest] of after.entries()) {
    if (before.get(filePath) !== digest) {
      changed.add(filePath);
    }
  }
  return [...changed].sort();
}

export function containsOrderedSubsequence(values: string[], expected: string[]) {
  let cursor = 0;

  for (const value of values) {
    if (value === expected[cursor]) {
      cursor += 1;
      if (cursor === expected.length) return true;
    }
  }

  return expected.length === 0;
}

export function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function ensureDir(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
}

export function writeText(targetPath: string, content: string) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content);
}

export function commandAvailable(command: string) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellEscape(command)}`], {
    encoding: "utf8"
  });
  return result.status === 0;
}

export function resolveBinary(command: string) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellEscape(command)}`], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function loadToolingEnv(repoRoot: string) {
  const envFiles = [
    process.env.XGC_ENV_FILE || path.join(process.env.HOME || "", ".config", "xgc", "env.sh"),
    process.env.XGC_SESSION_ENV_FILE || path.join(repoRoot, ".xgc", "bootstrap", "session-env.sh")
  ].filter(Boolean);

  const command = [
    "set -a",
    ...envFiles.map((file) => `[[ -f ${shellEscape(file)} ]] && source ${shellEscape(file)}`),
    "env -0"
  ].join("; ");

  const result = spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0 || !result.stdout) {
    return { ...process.env };
  }

  const merged = { ...process.env } as NodeJS.ProcessEnv;
  for (const entry of result.stdout.split("\u0000")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    merged[key] = value;
  }
  return merged;
}

function extractEnvNames(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/\$([A-Z0-9_]+)/g) ?? [];
  return [...new Set(matches.map((entry) => entry.slice(1)))];
}

export function loadSelectedTooling(repoRoot: string) {
  return readJsonIfExists<SelectedTooling>(path.join(repoRoot, ".xgc", "bootstrap", "selected-tooling.json"));
}

export function loadMcpConfig(repoRoot: string) {
  return readJsonIfExists<McpConfig>(path.join(repoRoot, ".github", "mcp.json")) ?? { mcpServers: {} };
}

export function loadLspConfig(repoRoot: string) {
  return readJsonIfExists<LspConfig>(path.join(repoRoot, "lsp.json")) ?? { lspServers: {} };
}

export function buildMcpStates(repoRoot: string, env: NodeJS.ProcessEnv): McpServerState[] {
  const selectedTooling = loadSelectedTooling(repoRoot);
  const selected = new Set(selectedTooling?.selected?.mcpServers ?? []);
  const mcpConfig = loadMcpConfig(repoRoot);
  const configuredServers = mcpConfig.mcpServers ?? {};

  return knownMcpServerIds.map((id) => {
    const server = configuredServers[id];
    const configured = Boolean(server);
    const selectedByBootstrap = selected.has(id);
    const requiredEnv = server?.headers
      ? [...new Set(Object.values(server.headers).flatMap((value) => extractEnvNames(value)))]
      : [];
    const presentEnv = requiredEnv.filter((name) => Boolean(env[name]));
    const missingEnv = requiredEnv.filter((name) => !env[name]);
    let credentialStatus: CredentialStatus = "disabled";

    if (!configured && selectedByBootstrap) {
      credentialStatus = "selected-but-not-configured";
    } else if (configured || selectedByBootstrap) {
      if (requiredEnv.length === 0) {
        credentialStatus = "configured";
      } else if (missingEnv.length > 0) {
        credentialStatus = "configured-but-missing-credential";
      } else {
        credentialStatus = "enabled-and-credentialed";
      }
    }

    const notes: string[] = [];
    if (selectedByBootstrap && !configured) {
      notes.push("selected in bootstrap record but missing from .github/mcp.json");
    }
    if (!selectedByBootstrap && configured) {
      notes.push("present in .github/mcp.json but missing from selected-tooling.json");
    }

    return {
      id,
      selected: selectedByBootstrap,
      configured,
      credentialStatus,
      requiredEnv,
      presentEnv,
      missingEnv,
      configPath: path.join(repoRoot, ".github", "mcp.json"),
      notes
    };
  });
}

function probeBinary(id: KnownLspId, command: string[]): LspBinaryProbe {
  const binary = command[0];
  const resolvedPath = resolveBinary(binary);

  if (!resolvedPath) {
    return {
      status: "missing",
      binary,
      resolvedPath: null,
      probeCommand: [binary, ...lspProbeArgs[id]],
      outputSnippet: null
    };
  }

  const args = lspProbeArgs[id];
  const probe = spawnSync(binary, args, {
    encoding: "utf8",
    timeout: 10_000
  });

  const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim();

  return {
    status: "installed",
    binary,
    resolvedPath,
    probeCommand: [binary, ...args],
    outputSnippet: output ? output.split(/\r?\n/).slice(0, 4).join("\n") : null
  };
}

export function buildLspStates(repoRoot: string): LspServerState[] {
  const selectedTooling = loadSelectedTooling(repoRoot);
  const selected = new Set(selectedTooling?.selected?.lspServers ?? []);
  const lspConfig = loadLspConfig(repoRoot);
  const configuredServers = lspConfig.lspServers ?? {};

  return knownLspServerIds.map((id) => {
    const server = configuredServers[id];
    const configured = Boolean(server);
    const selectedByBootstrap = selected.has(id);
    const notes: string[] = [];

    if (selectedByBootstrap && !configured) {
      notes.push('selected in bootstrap record but missing from lsp.json:lspServers');
    }
    if (!selectedByBootstrap && configured) {
      notes.push('present in lsp.json:lspServers but missing from selected-tooling.json');
    }

    const binaryProbe = configured && typeof server?.command === "string" && server.command
      ? probeBinary(id, [server.command, ...(server.args ?? [])])
      : {
          status: selectedByBootstrap ? ("missing" as const) : ("disabled" as const),
          binary: typeof server?.command === "string" && server.command ? server.command : id,
          resolvedPath: null,
          probeCommand: [],
          outputSnippet: null
        };

    return {
      id,
      selected: selectedByBootstrap,
      configured,
      configPath: path.join(repoRoot, "lsp.json"),
      binaryProbe,
      notes
    };
  });
}

export function detectAgentIds(repoRoot: string): AgentDetection[] {
  const agentsDir = path.join(repoRoot, "agents");
  const available = new Set(
    fs.existsSync(agentsDir)
      ? fs
          .readdirSync(agentsDir)
          .filter((entry) => entry.endsWith(".agent.md"))
          .map((entry) => entry.replace(/\.agent\.md$/, ""))
      : []
  );

  const lanes: Array<Omit<AgentDetection, "id">> = [
    { lane: "front-door", candidates: ["repo-master"] },
    { lane: "planner", candidates: ["milestone"] },
    { lane: "scout", candidates: ["repo-scout"] },
    { lane: "triage", candidates: ["triage"] },
    { lane: "deep", candidates: ["patch-master"] },
    { lane: "docs", candidates: ["ref-index"] },
    { lane: "gate", candidates: ["required-check"] }
  ];

  return lanes.map((lane) => ({
    ...lane,
    id: lane.candidates.find((candidate) => available.has(candidate)) ?? null
  }));
}

export function classifyProof(opts: {
  transcript: string;
  stdout: string;
  hookLog: string;
  explicitTokens: string[];
  strongUniqueTokens: string[];
  strongSupportTokens: string[];
  alternateToolTokens: string[];
}): ValidationEvidence {
  const primaryHaystacks = [
    { label: "transcript", text: opts.transcript },
    { label: "stdout", text: opts.stdout }
  ];
  const supportingHaystacks = [{ label: "hook", text: opts.hookLog }];
  const observedTools = extractObservedToolNames(opts.transcript, opts.hookLog);

  const matchesIn = (tokens: string[], haystacks: Array<{ label: string; text: string }>) =>
    tokens.filter((token) => haystacks.some(({ text }) => text.toLowerCase().includes(token.toLowerCase())));

  const explicitPrimary = matchesIn(opts.explicitTokens, primaryHaystacks);
  if (explicitPrimary.length > 0) {
    return {
      strength: "explicit",
      pathKind: "selected",
      notes: [`matched explicit proof tokens in transcript/stdout evidence: ${explicitPrimary.join(", ")}`],
      matchedTokens: explicitPrimary,
      observedTools
    };
  }

  const explicitHookOnly = matchesIn(opts.explicitTokens, supportingHaystacks);
  const strongUniquePrimary = matchesIn(opts.strongUniqueTokens, primaryHaystacks);
  const strongSupportPrimary = matchesIn(opts.strongSupportTokens, primaryHaystacks);
  const alternatePrimary = matchesIn(opts.alternateToolTokens, primaryHaystacks);
  const strongUniqueHook = matchesIn(opts.strongUniqueTokens, supportingHaystacks);
  const strongSupportHook = matchesIn(opts.strongSupportTokens, supportingHaystacks);
  const alternateHook = matchesIn(opts.alternateToolTokens, supportingHaystacks);

  if (strongUniquePrimary.length > 0 && strongUniquePrimary.length + strongSupportPrimary.length >= 2) {
    return {
      strength: "strong-indirect",
      pathKind: "selected",
      notes: [
        `matched strong indirect indicators with at least one capability-unique token: ${[
          ...strongUniquePrimary,
          ...strongSupportPrimary
        ].join(", ")}`
      ],
      matchedTokens: [...strongUniquePrimary, ...strongSupportPrimary],
      observedTools
    };
  }

  if (alternatePrimary.length > 0 && (strongUniquePrimary.length > 0 || strongSupportPrimary.length > 0)) {
    return {
      strength: "strong-indirect",
      pathKind: "alternate",
      notes: [
        `selected capability was not directly named; transcript/stdout instead shows alternate tool path: ${alternatePrimary.join(", ")}`,
        `task-specific support markers: ${[...strongUniquePrimary, ...strongSupportPrimary].join(", ")}`
      ],
      matchedTokens: [...alternatePrimary, ...strongUniquePrimary, ...strongSupportPrimary],
      observedTools
    };
  }

  if (
    explicitHookOnly.length > 0 ||
    strongUniqueHook.length > 0 ||
    strongSupportHook.length > 0 ||
    alternateHook.length > 0
  ) {
    return {
      strength: "weak",
      pathKind:
        explicitHookOnly.length > 0 || strongUniqueHook.length > 0
          ? "selected"
          : alternateHook.length > 0
            ? "alternate"
            : "none",
      notes: [
        `hook evidence alone is supporting but not authoritative proof: ${[
          ...explicitHookOnly,
          ...alternateHook,
          ...strongUniqueHook,
          ...strongSupportHook
        ].join(", ")}`
      ],
      matchedTokens: [...explicitHookOnly, ...alternateHook, ...strongUniqueHook, ...strongSupportHook],
      observedTools
    };
  }

  if (alternatePrimary.length > 0 || strongUniquePrimary.length > 0 || strongSupportPrimary.length > 0) {
    return {
      strength: "weak",
      pathKind:
        alternatePrimary.length > 0 ? "alternate" : strongUniquePrimary.length > 0 ? "selected" : "none",
      notes: [
        `matched only weak indirect indicators: ${[
          ...alternatePrimary,
          ...strongUniquePrimary,
          ...strongSupportPrimary
        ].join(", ")}`
      ],
      matchedTokens: [...alternatePrimary, ...strongUniquePrimary, ...strongSupportPrimary],
      observedTools
    };
  }

  return {
    strength: "unproven",
    pathKind: "none",
    notes: ["no direct or strong indirect proof found in transcript/stdout evidence"],
    matchedTokens: [],
    observedTools
  };
}

export function classifyMcpEvidence(id: McpServerId, transcript: string, stdout: string, hookLog: string) {
  const strongUniqueTokens: Record<McpServerId, string[]> = {
    context7: ["context7", "mcp.context7.com"],
    grep_app: ["grep.app", "grep_app", "mcp.grep.app"],
    websearch: ["web_search_exa", "mcp.exa.ai", "mcp.tavily.com", "tavily search", "exa search"]
  };
  const strongSupportTokens: Record<McpServerId, string[]> = {
    context7: ["official docs", "documentation", "--stdio", "typescript-language-server"],
    grep_app: ["public code", "open-source", "repository names", "external examples"],
    websearch: ["recent external reference", "source url", "published", "updated", "official announcement"]
  };
  const alternateToolTokens: Record<McpServerId, string[]> = {
    context7: ["web_search", "github-mcp-server-get_file_contents"],
    grep_app: ["github-mcp-server-search_code", "github-mcp-server-get_file_contents", "web_search"],
    websearch: ["web_search", "github-mcp-server-get_file_contents"]
  };

  return classifyProof({
    transcript,
    stdout,
    hookLog,
    explicitTokens: mcpProofTokens[id],
    strongUniqueTokens: strongUniqueTokens[id],
    strongSupportTokens: strongSupportTokens[id],
    alternateToolTokens: alternateToolTokens[id]
  });
}

export function classifyLspEvidence(id: KnownLspId, transcript: string, stdout: string, hookLog: string) {
  const strongUniqueTokens: Record<KnownLspId, string[]> = {
    "typescript-language-server": [
      "validation-fixtures/typescript",
      "validation-fixtures/typescript/app.ts",
      "formatUser",
      "brokenUser"
    ],
    "vscode-json-language-server": ["vscode-json-language-server", "validation-fixtures/config/service.json"],
    "yaml-language-server": ["yaml-language-server", "validation-fixtures/config/service.yaml"],
    "bash-language-server": ["bash-language-server", "validation-fixtures/shell/release.sh"],
    pyright: ["pyright", "validation-fixtures/python"],
    gopls: ["gopls", "validation-fixtures/go"],
    "rust-analyzer": ["rust-analyzer", "validation-fixtures/rust"]
  };
  const strongSupportTokens: Record<KnownLspId, string[]> = {
    "typescript-language-server": ["definition", "references", "User type", "type mismatch", "diagnostic", "tsc --noemit"],
    "vscode-json-language-server": ["timeoutMs", "features", "type inconsistencies"],
    "yaml-language-server": ["timeoutMs", "feature flag differences", "service shape"],
    "bash-language-server": ["load_config", "RELEASE_CHANNEL", "final tag"],
    pyright: ["type mismatch", "python", "diagnostic"],
    gopls: ["package", "symbol", "references"],
    "rust-analyzer": ["borrow", "trait", "references"]
  };
  const alternateToolTokens: Record<KnownLspId, string[]> = {
    "typescript-language-server": ["tsc --noemit", "view", "bash"],
    "vscode-json-language-server": ["view", "bash"],
    "yaml-language-server": ["view", "bash"],
    "bash-language-server": ["view", "bash"],
    pyright: ["pyright", "view", "bash"],
    gopls: ["gopls", "view", "bash"],
    "rust-analyzer": ["rust-analyzer", "view", "bash"]
  };

  return classifyProof({
    transcript,
    stdout,
    hookLog,
    explicitTokens: lspProofTokens[id],
    strongUniqueTokens: strongUniqueTokens[id],
    strongSupportTokens: strongSupportTokens[id],
    alternateToolTokens: alternateToolTokens[id]
  });
}

export function pluginListedInOutput(output: string, pluginName: string) {
  const normalizedName = pluginName.trim().toLowerCase();
  if (!normalizedName) return false;

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      const normalizedLine = line.replace(/^[•*-]\s*/, "").toLowerCase();
      if (normalizedLine === normalizedName) return true;
      return normalizedLine.startsWith(`${normalizedName} `) || normalizedLine.startsWith(`${normalizedName} (`);
    });
}

export function extractCliReportedUsage(stdout: string): CliReportedUsage | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        usage?: {
          premiumRequests?: number;
          totalApiDurationMs?: number;
          sessionDurationMs?: number;
          codeChanges?: {
            linesAdded?: number;
            linesRemoved?: number;
            filesModified?: string[];
          };
        };
      };

      if (parsed.type !== "result" || !parsed.usage) continue;

      return {
        premiumRequests: typeof parsed.usage.premiumRequests === "number" ? parsed.usage.premiumRequests : null,
        totalApiDurationMs:
          typeof parsed.usage.totalApiDurationMs === "number" ? parsed.usage.totalApiDurationMs : null,
        sessionDurationMs:
          typeof parsed.usage.sessionDurationMs === "number" ? parsed.usage.sessionDurationMs : null,
        linesAdded:
          typeof parsed.usage.codeChanges?.linesAdded === "number" ? parsed.usage.codeChanges.linesAdded : null,
        linesRemoved:
          typeof parsed.usage.codeChanges?.linesRemoved === "number" ? parsed.usage.codeChanges.linesRemoved : null,
        filesModified: Array.isArray(parsed.usage.codeChanges?.filesModified)
          ? parsed.usage.codeChanges?.filesModified ?? []
          : []
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function inspectInstalledPlugin(pluginName: string, opts: { homeDir?: string; sourcePath?: string } = {}): CopilotInstalledPluginEvidence {
  const homeDir = opts.homeDir ?? process.env.HOME ?? "";
  const notes: string[] = [];

  if (!homeDir) {
    notes.push("No Copilot config directory was available for inspection");
    return {
      configPath: path.join(".copilot", "config.json"),
      registeredInConfig: false,
      cachedPluginPath: null,
      cachePathExists: false,
      notes
    };
  }

  const candidateConfigPaths = [
    path.join(homeDir, "config.json"),
    path.join(homeDir, ".copilot", "config.json")
  ];
  const configPath = candidateConfigPaths.find((candidate) => fs.existsSync(candidate)) ?? candidateConfigPaths[0];

  const config = readJsonIfExists<{
    installed_plugins?: Array<{
      name?: string;
      source?: { source_path?: string };
      cache_path?: string;
    }>;
  }>(configPath);

  if (!config) {
    notes.push(`Copilot config file is missing at ${configPath}`);
    return {
      configPath,
      registeredInConfig: false,
      cachedPluginPath: null,
      cachePathExists: false,
      notes
    };
  }

  const matchingEntry =
    config.installed_plugins?.find((entry) => {
      if (entry.name === pluginName) return true;
      if (opts.sourcePath && entry.source?.source_path) {
        return path.resolve(entry.source.source_path) === path.resolve(opts.sourcePath);
      }
      return false;
    }) ?? null;

  if (!matchingEntry) {
    notes.push(`plugin was not found in installed_plugins for ${configPath}`);
    return {
      configPath,
      registeredInConfig: false,
      cachedPluginPath: null,
      cachePathExists: false,
      notes
    };
  }

  const cachedPluginPath = matchingEntry.cache_path ? path.resolve(matchingEntry.cache_path) : null;
  const cachePathExists = Boolean(cachedPluginPath && fs.existsSync(cachedPluginPath));
  if (cachedPluginPath && !cachePathExists) {
    notes.push(`installed plugin cache path is recorded but missing on disk: ${cachedPluginPath}`);
  }

  return {
    configPath,
    registeredInConfig: true,
    cachedPluginPath,
    cachePathExists,
    notes
  };
}
