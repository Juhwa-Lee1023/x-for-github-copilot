import fs from "node:fs";
import path from "node:path";
import { AGENT_MODEL_POLICIES, normalizeRootModel, resolveAgentModelPolicy } from "./model-policy.js";
import { listCanonicalAgentIdsSync, listCanonicalSkillIdsSync } from "./runtime-surfaces.js";

export type RuntimeSurfaceLayer = "user-level-profile" | "project-level" | "plugin-installed";
export type RuntimeSurfaceKind = "agent" | "skill";

export type RuntimeSurfaceCandidate = {
  layer: RuntimeSurfaceLayer;
  path: string;
  exists: boolean;
  displayName: string | null;
  model: string | null;
};

export type RuntimeSurfaceResolution = {
  kind: RuntimeSurfaceKind;
  id: string;
  winner: RuntimeSurfaceCandidate | null;
  shadowed: RuntimeSurfaceCandidate[];
  checked: RuntimeSurfaceCandidate[];
  explanation: string;
};

export type LatestSessionTruth = {
  workspaceYamlPath: string;
  workspaceTruthSource: string;
  workspaceTruthFreshnessMismatchObserved: boolean | null;
  workspaceTruthFreshnessReason: string | null;
  alternateWorkspaceYamlPath: string | null;
  updatedAt: string | null;
  latestEventAt: string | null;
  sessionStartHead: string | null;
  sessionEndHead: string | null;
  routeSummary: string | null;
  routeAgents: string[];
  routeSummaryAvailable: boolean | null;
  routeSummaryDerivedFromRawEvents: boolean | null;
  routeSummaryHeuristic: boolean | null;
  routeSummarySource: string;
  summaryRouteHeuristicMismatch: boolean | null;
  summaryTimestampStale: boolean | null;
  directToolExecutionObserved: boolean | null;
  summaryAuthority: string;
  summaryAuthorityReasons: string[];
  archiveCompleteness: string;
  archiveCompletenessReasons: string[];
  sessionOutcome: string;
  sessionOutcomeDetail: string | null;
  summaryFinalizationStatus: string;
  finalizationComplete: boolean | null;
  finalizationPartial: boolean | null;
  finalizationError: boolean | null;
  validationStatus: string;
  validationRawStatus: string | null;
  validationOverclaimObserved: boolean | null;
  validationCommandFailureCount: number;
  validationRecoveredAfterFailuresObserved: boolean | null;
  validationRecoverySource: string | null;
  validationRecoveredCommandFailureCount: number;
  workingTreeClean: boolean | null;
  committedDiffSource: string | null;
  repoWorkingTreeFileCount: number;
  committedRepoFileCount: number;
  sessionStateFileCount: number;
  validationArtifactFileCount: number;
  keyAgents: string[];
  repoScoutInvocationCount: number | null;
  triageInvocationCount: number | null;
  patchMasterInvocationCount: number | null;
  requiredCheckInvocationCount: number | null;
  builtInGenericAgentInvocationCount: number | null;
  postExecutionPlannerReopenAgents: string[];
  postExecutionGenericAgentObserved: boolean | null;
  postExecutionBuiltInAgentObserved: boolean | null;
  postExecutionGenericAgents: string[];
  postExecutionBuiltInAgents: string[];
  postExecutionOwnershipLeakObserved: boolean | null;
  postExecutionRootWriteObserved: boolean | null;
  postExecutionRootPatchObserved: boolean | null;
  postExecutionRootWriteCount: number | null;
  executionOwnerActiveRootWriteObserved: boolean | null;
  executionOwnerActiveRootWriteCount: number | null;
  executionOwnerActiveRootPatchObserved: boolean | null;
  executionClaimWithoutObservedRepoDiff: boolean | null;
  executionHandoffWithoutObservedRepoDiff: boolean | null;
  patchMasterHandoffWithoutCompletionObserved: boolean | null;
  malformedTaskPayloadObserved: boolean | null;
  executionOwner: string | null;
  ownershipTransferredToExecution: boolean | null;
  backgroundExecutionAgentObserved: boolean | null;
  backgroundExecutionAgentUnresolved: boolean | null;
  backgroundAgentUnresolvedObserved: boolean | null;
  backgroundAgentUnresolvedIds: string[];
  integrationClassTaskObserved: boolean | null;
  foundationReadinessAssessed: boolean | null;
  foundationReadinessUnknown: boolean | null;
  foundationRiskRaised: boolean | null;
  repeatedFoundationFailureObserved: boolean | null;
  foundationFailureClasses: string[];
  foundationRecoveryReason: string | null;
  sharedSurfaceChangeObserved: boolean | null;
  sharedSurfaceOwnerDeclared: boolean | null;
  sharedSurfaceConflictRisk: boolean | null;
  sharedSurfaceReviewRecommended: boolean | null;
  sharedSurfaceFinalIntegratorNeeded: boolean | null;
  integrationOwnedSurfacesTouched: string[];
  foundationRecoverySuggested: boolean | null;
  bootstrapFailureObserved: boolean | null;
  runtimeConfigMismatchObserved: boolean | null;
  toolingMaterializationFailureObserved: boolean | null;
  legacyHookPluginConflictObserved: boolean | null;
  hookExecutionFailureObserved: boolean | null;
  copilotAuthFailureObserved: boolean | null;
  copilotModelListFailureObserved: boolean | null;
  copilotPolicyFailureObserved: boolean | null;
  preflightBlockerObserved: boolean | null;
  preflightBlockerKind: string | null;
  preflightBlockerReason: string | null;
  validationPortConflictObserved: boolean | null;
  validationServerReadinessFailureObserved: boolean | null;
  appFoundationFailureObserved: boolean | null;
  githubMemoryEnabledCheck: string | null;
  githubMemoryEnabledCheckCached: boolean | null;
  githubMemoryEnabledCheckCount: number | null;
  githubMemoryEnabledSuccessCount: number | null;
  prContextCheck: string | null;
  prContextCheckCached: boolean | null;
  prContextCheckCount: number | null;
  githubPrLookupSuccessCount: number | null;
  githubCapabilityCacheHits: number | null;
  githubCapabilityCacheMisses: number | null;
  githubMemoryEnabledFreshAfterCacheObserved: boolean | null;
  prContextFreshAfterCacheObserved: boolean | null;
  probeCacheSummary: string[];
  providerRetryObserved: boolean | null;
  providerRetryState: string | null;
  providerRetryCount: number | null;
  providerRetryReason: string | null;
  userAbortObserved: boolean | null;
  subagentFailureObserved: boolean | null;
  terminalProviderFailureObserved: boolean | null;
  modelRateLimitObserved: boolean | null;
  modelRateLimitCount: number | null;
  provider502Observed: boolean | null;
  provider502Count: number | null;
  requestedRuntimeModel: string | null;
  sessionCurrentModel: string | null;
  observedRuntimeModels: string[];
  postPromptObservedRuntimeModels: string[];
  observedAgentToolModels: string[];
  observedModelMetricModels: string[];
  mixedModelSessionObserved: boolean | null;
  nonRequestedModelUsageObserved: boolean | null;
  modelIdentityMismatchObserved: boolean | null;
  agentModelPolicyMismatchObserved: boolean | null;
  agentModelPolicyMismatchCount: number | null;
  agentModelPolicyMismatches: string[];
  specialistLaneExpected: boolean | null;
  requiredSpecialistLanes: string[];
  recommendedSpecialistLanes: string[];
  observedSpecialistLanes: string[];
  missingRequiredSpecialistLanes: string[];
  unobservedRecommendedSpecialistLanes: string[];
  specialistFanoutObserved: boolean | null;
  specialistFanoutPartial: boolean | null;
  specialistFanoutCoveredByPatchMaster: boolean | null;
  specialistFanoutStatus: string | null;
  specialistFanoutReason: string | null;
  patchMasterSwarmObserved: boolean | null;
  patchMasterSwarmCount: number | null;
  githubRepoIdentityMissingObserved: boolean | null;
  githubRepoIdentitySource: string | null;
  githubMemorySuppressedForMissingRepoIdentity: boolean | null;
  summaryRouteCountMismatch: boolean | null;
  summaryCapabilityCountMismatch: boolean | null;
};

export type RuntimeSourceReport = {
  generatedAt: string;
  workspaceRoot: string;
  copilotHome: string;
  copilotConfigPath: string | null;
  xgcProfileActive: boolean;
  operatorModeExplanation: string;
  precedenceSummary: string;
  latestSessionTruth: LatestSessionTruth | null;
  notes: string[];
  coreAgents: RuntimeSurfaceResolution[];
  agents: RuntimeSurfaceResolution[];
  skills: RuntimeSurfaceResolution[];
};

type ResolveRuntimeSourceReportOptions = {
  repoRoot: string;
  workspaceRoot: string;
  copilotHome: string;
  copilotConfigPath?: string | null;
  pluginCachePath?: string | null;
  xgcProfileHome?: string | null;
};

function cleanFrontmatterValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function readFrontmatterMetadata(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return { displayName: null, model: null };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { displayName: null, model: null };
  }

  const frontmatter = frontmatterMatch[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const modelMatch = frontmatter.match(/^model:\s*(.+)$/m);

  return {
    displayName: nameMatch ? cleanFrontmatterValue(nameMatch[1]) : null,
    model: modelMatch ? cleanFrontmatterValue(modelMatch[1]) : null
  };
}

function readCopilotRootModel(configPath: string | null | undefined) {
  if (!configPath || !fs.existsSync(configPath)) return normalizeRootModel(null);
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as { model?: unknown };
    return normalizeRootModel(parsed.model);
  } catch {
    return normalizeRootModel(null);
  }
}

function buildCandidates(
  kind: RuntimeSurfaceKind,
  id: string,
  options: ResolveRuntimeSourceReportOptions
): RuntimeSurfaceCandidate[] {
  const relativePath =
    kind === "agent" ? path.join("agents", `${id}.agent.md`) : path.join("skills", id, "SKILL.md");
  const projectRelativePath =
    kind === "agent" ? path.join(".github", "agents", `${id}.agent.md`) : path.join(".github", "skills", id, "SKILL.md");
  const userPath = path.join(options.copilotHome, relativePath);
  const projectPath = path.join(options.workspaceRoot, projectRelativePath);
  const pluginPath = options.pluginCachePath
    ? path.join(options.pluginCachePath, relativePath)
    : path.join("<plugin-cache-unavailable>", relativePath);

  return [
    { layer: "user-level-profile" as const, path: userPath, exists: fs.existsSync(userPath), ...readFrontmatterMetadata(userPath) },
    { layer: "project-level" as const, path: projectPath, exists: fs.existsSync(projectPath), ...readFrontmatterMetadata(projectPath) },
    {
      layer: "plugin-installed" as const,
      path: pluginPath,
      exists: options.pluginCachePath ? fs.existsSync(pluginPath) : false,
      ...readFrontmatterMetadata(pluginPath)
    }
  ];
}

function explainResolution(id: string, winner: RuntimeSurfaceCandidate | null, shadowed: RuntimeSurfaceCandidate[]) {
  if (!winner) {
    return `No runtime-visible copy of ${id} was found in the user-level, project-level, or installed-plugin layers.`;
  }

  const winnerReason =
    winner.layer === "user-level-profile"
      ? "user-level copies win before project-level and plugin-installed copies"
      : winner.layer === "project-level"
        ? "project-level copies win before plugin-installed copies when no user-level copy exists"
        : "plugin-installed copies are only used when no higher-precedence user-level or project-level copy exists";

  if (shadowed.length === 0) {
    return `${winner.layer} won because ${winnerReason}. No lower-precedence copies were detected.`;
  }

  return `${winner.layer} won because ${winnerReason}. Lower-precedence copies were also found in: ${shadowed.map((entry) => entry.layer).join(", ")}.`;
}

function resolveRuntimeSurface(kind: RuntimeSurfaceKind, id: string, options: ResolveRuntimeSourceReportOptions): RuntimeSurfaceResolution {
  const checked = buildCandidates(kind, id, options);
  const existing = checked.filter((entry) => entry.exists);
  const winner = existing[0] ?? null;
  const shadowed = winner ? existing.slice(1) : [];

  return {
    kind,
    id,
    winner,
    shadowed,
    checked,
    explanation: explainResolution(id, winner, shadowed)
  };
}

function renderNullableBoolean(value: boolean | null) {
  return value === null ? "unknown" : value ? "yes" : "no";
}

export function renderRuntimeSourceReportMarkdown(report: RuntimeSourceReport) {
  const lines: string[] = [];
  lines.push("# Runtime Surface Resolution");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Workspace root: ${report.workspaceRoot}`);
  lines.push(`- Active COPILOT_HOME: ${report.copilotHome}`);
  lines.push(`- X for GitHub Copilot profile active: ${report.xgcProfileActive ? "yes" : "no"}`);
  lines.push(`- Operator mode: ${report.operatorModeExplanation}`);
  if (report.copilotConfigPath) {
    lines.push(`- Copilot config path: ${report.copilotConfigPath}`);
  }
  lines.push(`- Precedence: ${report.precedenceSummary}`);
  if (report.latestSessionTruth) {
    const truth = report.latestSessionTruth;
    lines.push("");
    lines.push("## Latest Session Truth");
    lines.push("");
    lines.push(`- Workspace summary: ${truth.workspaceYamlPath}`);
    lines.push(`- Workspace truth source: ${truth.workspaceTruthSource}`);
    lines.push(
      `- Workspace truth freshness mismatch: ${renderNullableBoolean(truth.workspaceTruthFreshnessMismatchObserved)}`
    );
    if (truth.workspaceTruthFreshnessReason) {
      lines.push(`- Workspace truth freshness reason: ${truth.workspaceTruthFreshnessReason}`);
    }
    if (truth.alternateWorkspaceYamlPath) {
      lines.push(`- Alternate workspace summary: ${truth.alternateWorkspaceYamlPath}`);
    }
    lines.push(`- Updated at: ${truth.updatedAt ?? "unknown"}`);
    lines.push(`- Latest event at: ${truth.latestEventAt ?? "unknown"}`);
    lines.push(`- Session start HEAD: ${truth.sessionStartHead ?? "unknown"}`);
    lines.push(`- Session end HEAD: ${truth.sessionEndHead ?? "unknown"}`);
    lines.push(`- Route: ${truth.routeSummary ?? "unobserved"}`);
    lines.push(`- Route summary available: ${renderNullableBoolean(truth.routeSummaryAvailable)}`);
    lines.push(`- Route summary heuristic: ${renderNullableBoolean(truth.routeSummaryHeuristic)}`);
    lines.push(`- Route summary source: ${truth.routeSummarySource}`);
    lines.push(`- Route summary derived from raw events: ${renderNullableBoolean(truth.routeSummaryDerivedFromRawEvents)}`);
    lines.push(`- Route summary heuristic mismatch: ${renderNullableBoolean(truth.summaryRouteHeuristicMismatch)}`);
    lines.push(`- Summary timestamp stale: ${renderNullableBoolean(truth.summaryTimestampStale)}`);
    lines.push(`- Direct tool execution observed: ${renderNullableBoolean(truth.directToolExecutionObserved)}`);
    lines.push(`- Summary authority: ${truth.summaryAuthority}`);
    if (truth.summaryAuthorityReasons.length > 0) {
      lines.push(`- Authority reasons: ${truth.summaryAuthorityReasons.join("; ")}`);
    }
    lines.push(`- Outcome: ${truth.sessionOutcome}`);
    lines.push(`- Outcome detail: ${truth.sessionOutcomeDetail ?? "unknown"}`);
    lines.push(`- Finalization: ${truth.summaryFinalizationStatus}`);
    lines.push(`- Finalization complete: ${renderNullableBoolean(truth.finalizationComplete)}`);
    lines.push(`- Finalization partial: ${renderNullableBoolean(truth.finalizationPartial)}`);
    lines.push(`- Finalization error: ${renderNullableBoolean(truth.finalizationError)}`);
    lines.push(`- Archive completeness: ${truth.archiveCompleteness}`);
    if (truth.archiveCompletenessReasons.length > 0) {
      lines.push(`- Archive completeness reasons: ${truth.archiveCompletenessReasons.join("; ")}`);
    }
    lines.push(`- Validation: ${truth.validationStatus}`);
    lines.push(`- Validation raw status: ${truth.validationRawStatus ?? "unknown"}`);
    lines.push(`- Validation overclaim observed: ${renderNullableBoolean(truth.validationOverclaimObserved)}`);
    lines.push(`- Validation command failures: ${truth.validationCommandFailureCount}`);
    lines.push(`- Working tree clean: ${renderNullableBoolean(truth.workingTreeClean)}`);
    lines.push(`- Committed diff source: ${truth.committedDiffSource ?? "unknown"}`);
    lines.push(`- Repo working-tree files: ${truth.repoWorkingTreeFileCount}`);
    lines.push(`- Committed repo files: ${truth.committedRepoFileCount}`);
    lines.push(`- Session-state files: ${truth.sessionStateFileCount}`);
    lines.push(`- Validation artifact files: ${truth.validationArtifactFileCount}`);
    lines.push(`- Key agents: ${truth.keyAgents.length > 0 ? truth.keyAgents.join(", ") : "none"}`);
    lines.push(`- Repo Scout invocation count: ${truth.repoScoutInvocationCount ?? "unknown"}`);
    lines.push(`- Triage invocation count: ${truth.triageInvocationCount ?? "unknown"}`);
    lines.push(`- Patch Master invocation count: ${truth.patchMasterInvocationCount ?? "unknown"}`);
    lines.push(`- Required Check invocation count: ${truth.requiredCheckInvocationCount ?? "unknown"}`);
    lines.push(
      `- Built-in generic agent invocation count: ${truth.builtInGenericAgentInvocationCount ?? "unknown"}`
    );
    lines.push(
      `- Post-execution planner reopen agents: ${
        truth.postExecutionPlannerReopenAgents.length > 0 ? truth.postExecutionPlannerReopenAgents.join(", ") : "none"
      }`
    );
    lines.push(`- Post-execution generic agent observed: ${renderNullableBoolean(truth.postExecutionGenericAgentObserved)}`);
    lines.push(`- Post-execution built-in agent observed: ${renderNullableBoolean(truth.postExecutionBuiltInAgentObserved)}`);
    lines.push(
      `- Post-execution generic agents: ${
        truth.postExecutionGenericAgents.length > 0 ? truth.postExecutionGenericAgents.join(", ") : "none"
      }`
    );
    lines.push(
      `- Post-execution built-in agents: ${
        truth.postExecutionBuiltInAgents.length > 0 ? truth.postExecutionBuiltInAgents.join(", ") : "none"
      }`
    );
    lines.push(`- Post-execution ownership leak: ${renderNullableBoolean(truth.postExecutionOwnershipLeakObserved)}`);
    lines.push(`- Post-execution root write observed: ${renderNullableBoolean(truth.postExecutionRootWriteObserved)}`);
    lines.push(`- Post-execution root patch observed: ${renderNullableBoolean(truth.postExecutionRootPatchObserved)}`);
    lines.push(`- Post-execution root write count: ${truth.postExecutionRootWriteCount ?? "unknown"}`);
    lines.push(`- Execution without observed repo diff: ${renderNullableBoolean(truth.executionClaimWithoutObservedRepoDiff)}`);
    lines.push(`- Execution handoff without observed repo diff: ${renderNullableBoolean(truth.executionHandoffWithoutObservedRepoDiff)}`);
    lines.push(`- Patch Master handoff without completion: ${renderNullableBoolean(truth.patchMasterHandoffWithoutCompletionObserved)}`);
    lines.push(`- Malformed task payload observed: ${renderNullableBoolean(truth.malformedTaskPayloadObserved)}`);
    lines.push(`- Execution owner: ${truth.executionOwner ?? "unknown"}`);
    lines.push(`- Ownership transferred to execution: ${renderNullableBoolean(truth.ownershipTransferredToExecution)}`);
    lines.push(`- Background execution observed: ${renderNullableBoolean(truth.backgroundExecutionAgentObserved)}`);
    lines.push(`- Background execution unresolved: ${renderNullableBoolean(truth.backgroundExecutionAgentUnresolved)}`);
    lines.push(`- Background agent unresolved: ${renderNullableBoolean(truth.backgroundAgentUnresolvedObserved)}`);
    lines.push(`- Background agent unresolved ids: ${truth.backgroundAgentUnresolvedIds.join(", ") || "none"}`);
    lines.push(`- Integration-class task observed: ${renderNullableBoolean(truth.integrationClassTaskObserved)}`);
    lines.push(`- Foundation readiness assessed: ${renderNullableBoolean(truth.foundationReadinessAssessed)}`);
    lines.push(`- Foundation readiness unknown: ${renderNullableBoolean(truth.foundationReadinessUnknown)}`);
    lines.push(`- Foundation risk raised: ${renderNullableBoolean(truth.foundationRiskRaised)}`);
    lines.push(
      `- Repeated foundation failure observed: ${renderNullableBoolean(truth.repeatedFoundationFailureObserved)}`
    );
    lines.push(
      `- Foundation failure classes: ${
        truth.foundationFailureClasses.length > 0 ? truth.foundationFailureClasses.join(", ") : "none"
      }`
    );
    lines.push(`- Foundation recovery reason: ${truth.foundationRecoveryReason ?? "none"}`);
    lines.push(`- Shared-surface change observed: ${renderNullableBoolean(truth.sharedSurfaceChangeObserved)}`);
    lines.push(`- Shared-surface owner declared: ${renderNullableBoolean(truth.sharedSurfaceOwnerDeclared)}`);
    lines.push(`- Shared-surface conflict risk: ${renderNullableBoolean(truth.sharedSurfaceConflictRisk)}`);
    lines.push(`- Shared-surface review recommended: ${renderNullableBoolean(truth.sharedSurfaceReviewRecommended)}`);
    lines.push(`- Shared-surface final integrator needed: ${renderNullableBoolean(truth.sharedSurfaceFinalIntegratorNeeded)}`);
    lines.push(
      `- Integration-owned surfaces touched: ${
        truth.integrationOwnedSurfacesTouched.length > 0 ? truth.integrationOwnedSurfacesTouched.join(", ") : "none"
      }`
    );
    lines.push(`- Foundation recovery suggested: ${renderNullableBoolean(truth.foundationRecoverySuggested)}`);
    lines.push(`- Bootstrap failure observed: ${renderNullableBoolean(truth.bootstrapFailureObserved)}`);
    lines.push(`- Runtime config mismatch observed: ${renderNullableBoolean(truth.runtimeConfigMismatchObserved)}`);
    lines.push(
      `- Tooling materialization failure observed: ${renderNullableBoolean(truth.toolingMaterializationFailureObserved)}`
    );
    lines.push(`- Legacy hook plugin conflict observed: ${renderNullableBoolean(truth.legacyHookPluginConflictObserved)}`);
    lines.push(`- Hook execution failure observed: ${renderNullableBoolean(truth.hookExecutionFailureObserved)}`);
    lines.push(`- Copilot auth failure observed: ${renderNullableBoolean(truth.copilotAuthFailureObserved)}`);
    lines.push(`- Copilot model-list failure observed: ${renderNullableBoolean(truth.copilotModelListFailureObserved)}`);
    lines.push(`- Copilot policy failure observed: ${renderNullableBoolean(truth.copilotPolicyFailureObserved)}`);
    lines.push(`- Preflight blocker observed: ${renderNullableBoolean(truth.preflightBlockerObserved)}`);
    lines.push(`- Preflight blocker kind: ${truth.preflightBlockerKind ?? "none"}`);
    lines.push(`- Preflight blocker reason: ${truth.preflightBlockerReason ?? "none"}`);
    lines.push(`- Validation port conflict observed: ${renderNullableBoolean(truth.validationPortConflictObserved)}`);
    lines.push(
      `- Validation server readiness failure observed: ${renderNullableBoolean(truth.validationServerReadinessFailureObserved)}`
    );
    lines.push(`- App foundation failure observed: ${renderNullableBoolean(truth.appFoundationFailureObserved)}`);
    lines.push(`- GitHub memory enabled check: ${truth.githubMemoryEnabledCheck ?? "unknown"}`);
    lines.push(
      `- GitHub memory enabled check cached: ${renderNullableBoolean(truth.githubMemoryEnabledCheckCached)}`
    );
    lines.push(`- GitHub memory enabled check count: ${truth.githubMemoryEnabledCheckCount ?? "unknown"}`);
    lines.push(`- GitHub memory enabled success count: ${truth.githubMemoryEnabledSuccessCount ?? "unknown"}`);
    lines.push(`- PR context check: ${truth.prContextCheck ?? "unknown"}`);
    lines.push(`- PR context check cached: ${renderNullableBoolean(truth.prContextCheckCached)}`);
    lines.push(`- PR context check count: ${truth.prContextCheckCount ?? "unknown"}`);
    lines.push(`- GitHub PR lookup success count: ${truth.githubPrLookupSuccessCount ?? "unknown"}`);
    lines.push(`- GitHub capability cache hits: ${truth.githubCapabilityCacheHits ?? "unknown"}`);
    lines.push(`- GitHub capability cache misses: ${truth.githubCapabilityCacheMisses ?? "unknown"}`);
    lines.push(
      `- GitHub memory enabled fresh after cache observed: ${renderNullableBoolean(
        truth.githubMemoryEnabledFreshAfterCacheObserved
      )}`
    );
    lines.push(
      `- PR context fresh after cache observed: ${renderNullableBoolean(truth.prContextFreshAfterCacheObserved)}`
    );
    lines.push(`- Probe cache summary: ${truth.probeCacheSummary.length > 0 ? truth.probeCacheSummary.join(", ") : "none"}`);
    lines.push(`- Provider retry observed: ${renderNullableBoolean(truth.providerRetryObserved)}`);
    lines.push(`- Provider retry state: ${truth.providerRetryState ?? "unknown"}`);
    lines.push(`- Provider retry count: ${truth.providerRetryCount ?? "unknown"}`);
    lines.push(`- Provider retry reason: ${truth.providerRetryReason ?? "unknown"}`);
    lines.push(`- Model rate limit observed: ${renderNullableBoolean(truth.modelRateLimitObserved)}`);
    lines.push(`- Model rate limit count: ${truth.modelRateLimitCount ?? "unknown"}`);
    lines.push(`- Provider 502 observed: ${renderNullableBoolean(truth.provider502Observed)}`);
    lines.push(`- Provider 502 count: ${truth.provider502Count ?? "unknown"}`);
    lines.push(`- Requested runtime model: ${truth.requestedRuntimeModel ?? "unknown"}`);
    lines.push(`- Session current model: ${truth.sessionCurrentModel ?? "unknown"}`);
    lines.push(
      `- Observed runtime models: ${
        truth.observedRuntimeModels.length > 0 ? truth.observedRuntimeModels.join(", ") : "none"
      }`
    );
    lines.push(
      `- Observed agent tool models: ${
        truth.observedAgentToolModels.length > 0 ? truth.observedAgentToolModels.join(", ") : "none"
      }`
    );
    lines.push(
      `- Observed model metric models: ${
        truth.observedModelMetricModels.length > 0 ? truth.observedModelMetricModels.join(", ") : "none"
      }`
    );
    lines.push(`- Mixed-model session observed: ${renderNullableBoolean(truth.mixedModelSessionObserved)}`);
    lines.push(`- Non-requested model usage observed: ${renderNullableBoolean(truth.nonRequestedModelUsageObserved)}`);
    lines.push(`- Agent model policy mismatch observed: ${renderNullableBoolean(truth.agentModelPolicyMismatchObserved)}`);
    lines.push(`- Agent model policy mismatch count: ${truth.agentModelPolicyMismatchCount ?? "unknown"}`);
    lines.push(
      `- Agent model policy mismatches: ${
        truth.agentModelPolicyMismatches.length > 0 ? truth.agentModelPolicyMismatches.join("; ") : "none"
      }`
    );
    lines.push(`- Specialist lane expected: ${renderNullableBoolean(truth.specialistLaneExpected)}`);
    lines.push(
      `- Required specialist lanes: ${
        truth.requiredSpecialistLanes.length > 0 ? truth.requiredSpecialistLanes.join(", ") : "none"
      }`
    );
    lines.push(
      `- Recommended specialist lanes: ${
        truth.recommendedSpecialistLanes.length > 0 ? truth.recommendedSpecialistLanes.join(", ") : "none"
      }`
    );
    lines.push(
      `- Observed specialist lanes: ${
        truth.observedSpecialistLanes.length > 0 ? truth.observedSpecialistLanes.join(", ") : "none"
      }`
    );
    lines.push(
      `- Missing required specialist lanes: ${
        truth.missingRequiredSpecialistLanes.length > 0 ? truth.missingRequiredSpecialistLanes.join(", ") : "none"
      }`
    );
    lines.push(
      `- Unobserved recommended specialist lanes: ${
        truth.unobservedRecommendedSpecialistLanes.length > 0
          ? truth.unobservedRecommendedSpecialistLanes.join(", ")
          : "none"
      }`
    );
    lines.push(`- Specialist fanout observed: ${renderNullableBoolean(truth.specialistFanoutObserved)}`);
    lines.push(`- Specialist fanout partial: ${renderNullableBoolean(truth.specialistFanoutPartial)}`);
    lines.push(
      `- Specialist fanout covered by Patch Master: ${renderNullableBoolean(truth.specialistFanoutCoveredByPatchMaster)}`
    );
    lines.push(`- Specialist fanout status: ${truth.specialistFanoutStatus ?? "unknown"}`);
    lines.push(`- Specialist fanout reason: ${truth.specialistFanoutReason ?? "none"}`);
    lines.push(`- Patch Master swarm observed: ${renderNullableBoolean(truth.patchMasterSwarmObserved)}`);
    lines.push(`- Patch Master swarm count: ${truth.patchMasterSwarmCount ?? "unknown"}`);
    lines.push(
      `- GitHub repo identity missing observed: ${renderNullableBoolean(truth.githubRepoIdentityMissingObserved)}`
    );
    lines.push(`- GitHub repo identity source: ${truth.githubRepoIdentitySource ?? "unknown"}`);
    lines.push(
      `- GitHub memory suppressed for missing repo identity: ${renderNullableBoolean(
        truth.githubMemorySuppressedForMissingRepoIdentity
      )}`
    );
    lines.push(`- Summary route count mismatch: ${renderNullableBoolean(truth.summaryRouteCountMismatch)}`);
    lines.push(`- Summary capability count mismatch: ${renderNullableBoolean(truth.summaryCapabilityCountMismatch)}`);
    lines.push("");
  }
  if (report.notes.length > 0) {
    lines.push("- Notes:");
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
    }
  }
  lines.push("");

  lines.push("## Core Lane Winners");
  lines.push("");
  lines.push("| Id | Winner layer | Winner name | Winner model | Winner path | Shadowed copies | Why it won |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of report.coreAgents) {
    lines.push(
      `| ${entry.id} | ${entry.winner?.layer ?? "missing"} | ${entry.winner?.displayName ?? "n/a"} | ${entry.winner?.model ?? "n/a"} | ${entry.winner?.path ?? "n/a"} | ${
        entry.shadowed.length > 0 ? entry.shadowed.map((item) => `${item.layer}: ${item.path}`).join("<br>") : "none"
      } | ${entry.explanation} |`
    );
  }
  lines.push("");

  const renderSection = (title: string, entries: RuntimeSurfaceResolution[]) => {
    lines.push(`## ${title}`);
    lines.push("");
    lines.push("| Id | Winner | Winner name | Winner model | Winner path | Shadowed copies |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of entries) {
      lines.push(
        `| ${entry.id} | ${entry.winner?.layer ?? "missing"} | ${entry.winner?.displayName ?? "n/a"} | ${entry.winner?.model ?? "n/a"} | ${entry.winner?.path ?? "n/a"} | ${
          entry.shadowed.length > 0 ? entry.shadowed.map((item) => `${item.layer}: ${item.path}`).join("<br>") : "none"
        } |`
      );
    }
    lines.push("");
    for (const entry of entries) {
      lines.push(`### ${entry.id}`);
      lines.push("");
      lines.push(`- Explanation: ${entry.explanation}`);
      if (entry.winner) {
        lines.push(`- Winning display name: ${entry.winner.displayName ?? "n/a"}`);
        lines.push(`- Winning model: ${entry.winner.model ?? "n/a"}`);
      }
      lines.push("- Checked layers:");
      for (const candidate of entry.checked) {
        lines.push(
          `  - ${candidate.layer}: ${candidate.exists ? "present" : "missing"} at ${candidate.path}` +
            `${candidate.displayName || candidate.model ? ` (name: ${candidate.displayName ?? "n/a"}, model: ${candidate.model ?? "n/a"})` : ""}`
        );
      }
      lines.push("");
    }
  };

  renderSection("Agents", report.agents);
  renderSection("Skills", report.skills);

  return `${lines.join("\n")}\n`;
}

export function resolveRuntimeSourceReport(options: ResolveRuntimeSourceReportOptions): RuntimeSourceReport {
  const resolvedCopilotHome = path.resolve(options.copilotHome);
  const resolvedXgcProfileHome = options.xgcProfileHome ? path.resolve(options.xgcProfileHome) : null;
  const notes: string[] = [];
  if (!options.pluginCachePath) {
    notes.push("Installed plugin cache path was unavailable, so plugin-installed layer checks are informational only.");
  }

  const agents = listCanonicalAgentIdsSync(options.repoRoot).map((id) => resolveRuntimeSurface("agent", id, options));
  const skills = listCanonicalSkillIdsSync(options.repoRoot).map((id) => resolveRuntimeSurface("skill", id, options));
  const coreAgentIds = [
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
  ];
  const coreAgents = coreAgentIds
    .map((id) => agents.find((entry) => entry.id === id))
    .filter((entry): entry is RuntimeSurfaceResolution => Boolean(entry));
  const repoMaster = agents.find((entry) => entry.id === "repo-master");
  const rootModel = readCopilotRootModel(options.copilotConfigPath);
  if (repoMaster?.winner && !repoMaster.winner.model) {
    notes.push(`Repo Master omits static model frontmatter and inherits the active root model: ${rootModel}.`);
  } else if (repoMaster?.winner?.model === rootModel) {
    notes.push(`Repo Master currently resolves to the active root model: ${rootModel}.`);
  } else if (repoMaster?.winner?.model) {
    notes.push(`Repo Master currently resolves to ${repoMaster.winner.model}, not the active root model ${rootModel}.`);
  }

  for (const laneId of Object.keys(AGENT_MODEL_POLICIES)) {
    if (laneId === "repo-master") continue;
    const lane = agents.find((entry) => entry.id === laneId);
    const expectedModel = resolveAgentModelPolicy({ agentId: laneId, rootModel });
    if (lane?.winner?.model && expectedModel && lane.winner.model !== expectedModel) {
      notes.push(`${laneId} currently resolves to ${lane.winner.model}, not the parent-aware policy model ${expectedModel}.`);
    }
  }

  if (resolvedXgcProfileHome && resolvedCopilotHome !== resolvedXgcProfileHome) {
    notes.push("This report was generated outside X for GitHub Copilot global profile mode, so winning surfaces may reflect the raw/default Copilot profile instead of the X profile.");
  }

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: path.resolve(options.workspaceRoot),
    copilotHome: resolvedCopilotHome,
    copilotConfigPath: options.copilotConfigPath ?? null,
    xgcProfileActive: resolvedXgcProfileHome ? resolvedCopilotHome === resolvedXgcProfileHome : resolvedCopilotHome.endsWith(".copilot-xgc"),
    operatorModeExplanation:
      resolvedXgcProfileHome && resolvedCopilotHome === resolvedXgcProfileHome
        ? "running in X for GitHub Copilot global profile mode"
        : "running outside X for GitHub Copilot global profile mode",
    precedenceSummary: "user-level profile > project-level .github > plugin-installed copy",
    latestSessionTruth: null,
    notes,
    coreAgents,
    agents,
    skills
  };
}
