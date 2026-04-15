import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectInstalledPlugin, writeText } from "./lib/runtime-validation.js";
import { resolveRepoRoot } from "./lib/runtime-surfaces.js";
import { findLegacyHookPluginConflicts, formatLegacyHookPluginConflict } from "./lib/hook-path-truth.js";
import {
  resolveRuntimeSourceReport,
  renderRuntimeSourceReportMarkdown,
  type LatestSessionTruth
} from "./lib/runtime-source-resolution.js";
import { resolveGlobalPaths } from "./lib/global-xgc.js";

// Operator-facing runtime surface report:
// - inspect which layer won at runtime
// - show declared names/models for winners
// - explain precedence for X for GitHub Copilot profile mode versus raw/default mode
// - link the latest repo-owned session truth summary when available

function parseFlatYamlValue(value: string): unknown {
  if (value === "true" || value === "false") return value === "true";
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (value.startsWith("[") || value.startsWith("{") || (value.startsWith('"') && value.endsWith('"'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function readFlatYaml(filePath: string) {
  const data: Record<string, unknown> = {};
  if (!fs.existsSync(filePath)) return data;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith(" ") || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    if (!key) continue;
    data[key.trim()] = parseFlatYamlValue(rest.join(":").trim());
  }
  return data;
}

function asArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asNullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function normalizeExistingPath(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return path.resolve(value);
}

function workspaceSummaryMatchesCurrentRepo(summary: Record<string, unknown>, roots: string[]) {
  const sessionRoots = [normalizeExistingPath(summary.git_root), normalizeExistingPath(summary.cwd)].filter(
    (value): value is string => Boolean(value)
  );
  return sessionRoots.some((sessionRoot) => roots.includes(sessionRoot));
}

type WorkspaceYamlCandidate = {
  filePath: string;
  summary: Record<string, unknown>;
  mtimeMs: number;
  truthSource: string;
  alternateWorkspaceYamlPath?: string | null;
  workspaceTruthFreshnessMismatchObserved?: boolean;
  workspaceTruthFreshnessReason?: string | null;
};

function findRepoOwnedWorkspaceYaml(opts: { repoRoot: string; workspaceRoot: string }): WorkspaceYamlCandidate | null {
  const roots = [...new Set([path.resolve(opts.repoRoot), path.resolve(opts.workspaceRoot)])];
  const candidates = roots
    .map((root) => path.join(root, ".xgc", "validation", "workspace.yaml"))
    .filter((filePath, index, all) => all.indexOf(filePath) === index)
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      filePath,
      summary: readFlatYaml(filePath),
      mtimeMs: fs.statSync(filePath).mtimeMs,
      truthSource: "repo-owned-validation-workspace"
    }))
    .filter((candidate) => workspaceSummaryMatchesCurrentRepo(candidate.summary, roots))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0] ?? null;
}

function candidateSessionId(candidate: WorkspaceYamlCandidate) {
  return asString(candidate.summary.id, path.basename(path.dirname(candidate.filePath)));
}

function freshnessMs(candidate: WorkspaceYamlCandidate) {
  const values = [candidate.summary.latest_event_at, candidate.summary.updated_at]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : candidate.mtimeMs;
}

function findSessionStateWorkspaceYaml(profileHome: string, opts: { repoRoot: string; workspaceRoot: string }): WorkspaceYamlCandidate | null {
  const sessionStateRoot = path.join(profileHome, "session-state");
  if (!fs.existsSync(sessionStateRoot)) return null;
  const roots = [...new Set([path.resolve(opts.repoRoot), path.resolve(opts.workspaceRoot)])];
  const candidates = fs
    .readdirSync(sessionStateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sessionStateRoot, entry.name, "workspace.yaml"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      filePath,
      summary: readFlatYaml(filePath),
      mtimeMs: fs.statSync(filePath).mtimeMs,
      truthSource: "session-state-workspace"
    }))
    .filter((candidate) => workspaceSummaryMatchesCurrentRepo(candidate.summary, roots))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0] ?? null;
}

function findLatestWorkspaceYaml(profileHome: string, opts: { repoRoot: string; workspaceRoot: string }): WorkspaceYamlCandidate | null {
  const repoOwnedWorkspaceYaml = findRepoOwnedWorkspaceYaml(opts);
  const sessionStateWorkspaceYaml = findSessionStateWorkspaceYaml(profileHome, opts);
  if (!repoOwnedWorkspaceYaml) return sessionStateWorkspaceYaml;
  if (!sessionStateWorkspaceYaml) return repoOwnedWorkspaceYaml;

  const repoOwnedSessionId = candidateSessionId(repoOwnedWorkspaceYaml);
  const sessionStateSessionId = candidateSessionId(sessionStateWorkspaceYaml);
  const repoOwnedFreshness = freshnessMs(repoOwnedWorkspaceYaml);
  const sessionStateFreshness = freshnessMs(sessionStateWorkspaceYaml);
  if (repoOwnedSessionId === sessionStateSessionId && sessionStateFreshness > repoOwnedFreshness) {
    return {
      ...sessionStateWorkspaceYaml,
      alternateWorkspaceYamlPath: repoOwnedWorkspaceYaml.filePath,
      workspaceTruthFreshnessMismatchObserved: true,
      workspaceTruthFreshnessReason: "session-state workspace.yaml was fresher than repo-owned validation workspace.yaml"
    };
  }

  return {
    ...repoOwnedWorkspaceYaml,
    alternateWorkspaceYamlPath:
      repoOwnedSessionId === sessionStateSessionId ? sessionStateWorkspaceYaml.filePath : null,
    workspaceTruthFreshnessMismatchObserved:
      repoOwnedSessionId === sessionStateSessionId && sessionStateFreshness !== repoOwnedFreshness,
    workspaceTruthFreshnessReason:
      repoOwnedSessionId === sessionStateSessionId && sessionStateFreshness !== repoOwnedFreshness
        ? "repo-owned validation workspace.yaml was at least as fresh as session-state workspace.yaml"
        : null
  };
}

function buildLatestSessionTruth(profileHome: string, opts: { repoRoot: string; workspaceRoot: string }): LatestSessionTruth | null {
  const workspaceYaml = findLatestWorkspaceYaml(profileHome, opts);
  if (!workspaceYaml) return null;

  const summary = workspaceYaml.summary;
  return {
    workspaceYamlPath: workspaceYaml.filePath,
    workspaceTruthSource: workspaceYaml.truthSource,
    workspaceTruthFreshnessMismatchObserved: workspaceYaml.workspaceTruthFreshnessMismatchObserved ?? false,
    workspaceTruthFreshnessReason: workspaceYaml.workspaceTruthFreshnessReason ?? null,
    alternateWorkspaceYamlPath: workspaceYaml.alternateWorkspaceYamlPath ?? null,
    updatedAt: asNullableString(summary.updated_at),
    latestEventAt: asNullableString(summary.latest_event_at),
    sessionStartHead: asNullableString(summary.session_start_head),
    sessionEndHead: asNullableString(summary.session_end_head),
    routeSummary: asNullableString(summary.route_summary),
    routeAgents: asStringArray(summary.route_agents),
    routeSummaryAvailable: asNullableBoolean(summary.route_summary_available),
    routeSummaryDerivedFromRawEvents: asNullableBoolean(summary.route_summary_derived_from_raw_events),
    routeSummaryHeuristic: asNullableBoolean(summary.route_summary_heuristic),
    routeSummarySource: asString(summary.route_summary_source, "unknown"),
    summaryRouteHeuristicMismatch: asNullableBoolean(summary.summary_route_heuristic_mismatch),
    summaryTimestampStale: asNullableBoolean(summary.summary_timestamp_stale),
    directToolExecutionObserved: asNullableBoolean(summary.direct_tool_execution_observed),
    summaryAuthority: asString(summary.summary_authority, "unknown"),
    summaryAuthorityReasons: asStringArray(summary.summary_authority_reasons),
    archiveCompleteness: asString(summary.archive_completeness, "unknown"),
    archiveCompletenessReasons: asStringArray(summary.archive_completeness_reasons),
    sessionOutcome: asString(summary.session_outcome, "unknown"),
    sessionOutcomeDetail: asNullableString(summary.session_outcome_detail),
    summaryFinalizationStatus: asString(summary.summary_finalization_status, "unknown"),
    finalizationComplete: asNullableBoolean(summary.finalization_complete),
    finalizationPartial: asNullableBoolean(summary.finalization_partial),
    finalizationError: asNullableBoolean(summary.finalization_error),
    validationStatus: asString(summary.validation_status, "unknown"),
    validationRawStatus: asNullableString(summary.validation_raw_status),
    validationOverclaimObserved: asNullableBoolean(summary.validation_overclaim_observed),
    validationCommandFailureCount: asArrayLength(summary.validation_command_failures),
    validationRecoveredAfterFailuresObserved: asNullableBoolean(summary.validation_recovered_after_failures_observed),
    validationRecoverySource: asNullableString(summary.validation_recovery_source),
    validationRecoveredCommandFailureCount: asArrayLength(summary.validation_recovered_command_failures),
    workingTreeClean: asNullableBoolean(summary.working_tree_clean),
    committedDiffSource: asNullableString(summary.committed_diff_source),
    repoWorkingTreeFileCount: asArrayLength(summary.repo_working_tree_files),
    committedRepoFileCount: asArrayLength(summary.committed_repo_files),
    sessionStateFileCount: asArrayLength(summary.session_state_files),
    validationArtifactFileCount: asArrayLength(summary.validation_artifact_files),
    keyAgents: asStringArray(summary.key_agents),
    repoScoutInvocationCount: asNullableNumber(summary.repo_scout_invocation_count),
    triageInvocationCount: asNullableNumber(summary.triage_invocation_count),
    patchMasterInvocationCount: asNullableNumber(summary.patch_master_invocation_count),
    requiredCheckInvocationCount: asNullableNumber(summary.required_check_invocation_count),
    builtInGenericAgentInvocationCount: asNullableNumber(summary.built_in_generic_agent_invocation_count),
    postExecutionPlannerReopenAgents: asStringArray(summary.post_execution_planner_reopen_agents),
    postExecutionGenericAgentObserved: asNullableBoolean(summary.post_execution_generic_agent_observed),
    postExecutionBuiltInAgentObserved: asNullableBoolean(summary.post_execution_built_in_agent_observed),
    postExecutionGenericAgents: asStringArray(summary.post_execution_generic_agents),
    postExecutionBuiltInAgents: asStringArray(summary.post_execution_built_in_agents),
    postExecutionOwnershipLeakObserved: asNullableBoolean(summary.post_execution_ownership_leak_observed),
    postExecutionRootWriteObserved: asNullableBoolean(summary.post_execution_root_write_observed),
    postExecutionRootPatchObserved: asNullableBoolean(summary.post_execution_root_patch_observed),
    postExecutionRootWriteCount: asNullableNumber(summary.post_execution_root_write_count),
    executionOwnerActiveRootWriteObserved: asNullableBoolean(summary.execution_owner_active_root_write_observed),
    executionOwnerActiveRootWriteCount: asNullableNumber(summary.execution_owner_active_root_write_count),
    executionOwnerActiveRootPatchObserved: asNullableBoolean(summary.execution_owner_active_root_patch_observed),
    executionClaimWithoutObservedRepoDiff: asNullableBoolean(summary.execution_claim_without_observed_repo_diff),
    executionHandoffWithoutObservedRepoDiff: asNullableBoolean(summary.execution_handoff_without_observed_repo_diff),
    patchMasterHandoffWithoutCompletionObserved: asNullableBoolean(summary.patch_master_handoff_without_completion_observed),
    malformedTaskPayloadObserved: asNullableBoolean(summary.malformed_task_payload_observed),
    executionOwner: asNullableString(summary.execution_owner),
    ownershipTransferredToExecution: asNullableBoolean(summary.ownership_transferred_to_execution),
    backgroundExecutionAgentObserved: asNullableBoolean(summary.background_execution_agent_observed),
    backgroundExecutionAgentUnresolved: asNullableBoolean(summary.background_execution_agent_unresolved),
    backgroundAgentUnresolvedObserved: asNullableBoolean(summary.background_agent_unresolved_observed),
    backgroundAgentUnresolvedIds: asStringArray(summary.background_agent_unresolved_ids),
    integrationClassTaskObserved: asNullableBoolean(summary.integration_class_task_observed),
    foundationReadinessAssessed: asNullableBoolean(summary.foundation_readiness_assessed),
    foundationReadinessUnknown: asNullableBoolean(summary.foundation_readiness_unknown),
    foundationRiskRaised: asNullableBoolean(summary.foundation_risk_raised),
    repeatedFoundationFailureObserved: asNullableBoolean(summary.repeated_foundation_failure_observed),
    foundationFailureClasses: asStringArray(summary.foundation_failure_classes),
    foundationRecoveryReason: asNullableString(summary.foundation_recovery_reason),
    sharedSurfaceChangeObserved: asNullableBoolean(summary.shared_surface_change_observed),
    sharedSurfaceOwnerDeclared: asNullableBoolean(summary.shared_surface_owner_declared),
    sharedSurfaceConflictRisk: asNullableBoolean(summary.shared_surface_conflict_risk),
    sharedSurfaceReviewRecommended: asNullableBoolean(summary.shared_surface_review_recommended),
    sharedSurfaceFinalIntegratorNeeded: asNullableBoolean(summary.shared_surface_final_integrator_needed),
    integrationOwnedSurfacesTouched: asStringArray(summary.integration_owned_surfaces_touched),
    foundationRecoverySuggested: asNullableBoolean(summary.foundation_recovery_suggested),
    bootstrapFailureObserved: asNullableBoolean(summary.bootstrap_failure_observed),
    runtimeConfigMismatchObserved: asNullableBoolean(summary.runtime_config_mismatch_observed),
    toolingMaterializationFailureObserved: asNullableBoolean(summary.tooling_materialization_failure_observed),
    legacyHookPluginConflictObserved: asNullableBoolean(summary.legacy_hook_plugin_conflict_observed),
    hookExecutionFailureObserved: asNullableBoolean(summary.hook_execution_failure_observed),
    copilotAuthFailureObserved: asNullableBoolean(summary.copilot_auth_failure_observed),
    copilotModelListFailureObserved: asNullableBoolean(summary.copilot_model_list_failure_observed),
    copilotPolicyFailureObserved: asNullableBoolean(summary.copilot_policy_failure_observed),
    preflightBlockerObserved: asNullableBoolean(summary.preflight_blocker_observed),
    preflightBlockerKind: asNullableString(summary.preflight_blocker_kind),
    preflightBlockerReason: asNullableString(summary.preflight_blocker_reason),
    validationPortConflictObserved: asNullableBoolean(summary.validation_port_conflict_observed),
    validationServerReadinessFailureObserved: asNullableBoolean(summary.validation_server_readiness_failure_observed),
    appFoundationFailureObserved: asNullableBoolean(summary.app_foundation_failure_observed),
    githubMemoryEnabledCheck: asNullableString(summary.github_memory_enabled_check),
    githubMemoryEnabledCheckCached: asNullableBoolean(summary.github_memory_enabled_check_cached),
    githubMemoryEnabledCheckCount: asNullableNumber(summary.github_memory_enabled_check_count),
    githubMemoryEnabledSuccessCount: asNullableNumber(summary.github_memory_enabled_success_count),
    prContextCheck: asNullableString(summary.pr_context_check),
    prContextCheckCached: asNullableBoolean(summary.pr_context_check_cached),
    prContextCheckCount: asNullableNumber(summary.pr_context_check_count),
    githubPrLookupSuccessCount: asNullableNumber(summary.github_pr_lookup_success_count),
    githubCapabilityCacheHits: asNullableNumber(summary.github_capability_cache_hits),
    githubCapabilityCacheMisses: asNullableNumber(summary.github_capability_cache_misses),
    githubMemoryEnabledFreshAfterCacheObserved: asNullableBoolean(summary.github_memory_enabled_fresh_after_cache_observed),
    prContextFreshAfterCacheObserved: asNullableBoolean(summary.pr_context_fresh_after_cache_observed),
    probeCacheSummary: asStringArray(summary.probe_cache_summary),
    providerRetryObserved: asNullableBoolean(summary.provider_retry_observed),
    providerRetryState: asNullableString(summary.provider_retry_state),
    providerRetryCount: asNullableNumber(summary.provider_retry_count),
    providerRetryReason: asNullableString(summary.provider_retry_reason),
    userAbortObserved: asNullableBoolean(summary.user_abort_observed),
    subagentFailureObserved: asNullableBoolean(summary.subagent_failure_observed),
    terminalProviderFailureObserved: asNullableBoolean(summary.terminal_provider_failure_observed),
    modelRateLimitObserved: asNullableBoolean(summary.model_rate_limit_observed),
    modelRateLimitCount: asNullableNumber(summary.model_rate_limit_count),
    provider502Observed: asNullableBoolean(summary.provider_502_observed),
    provider502Count: asNullableNumber(summary.provider_502_count),
    requestedRuntimeModel: asNullableString(summary.requested_runtime_model),
    sessionCurrentModel: asNullableString(summary.session_current_model),
    observedRuntimeModels: asStringArray(summary.observed_runtime_models),
    postPromptObservedRuntimeModels: asStringArray(summary.post_prompt_observed_runtime_models),
    observedAgentToolModels: asStringArray(summary.observed_agent_tool_models),
    observedModelMetricModels: asStringArray(summary.observed_model_metric_models),
    mixedModelSessionObserved: asNullableBoolean(summary.mixed_model_session_observed),
    nonRequestedModelUsageObserved: asNullableBoolean(summary.non_requested_model_usage_observed),
    modelIdentityMismatchObserved: asNullableBoolean(summary.model_identity_mismatch_observed),
    agentModelPolicyMismatchObserved: asNullableBoolean(summary.agent_model_policy_mismatch_observed),
    agentModelPolicyMismatchCount: asNullableNumber(summary.agent_model_policy_mismatch_count),
    agentModelPolicyMismatches: asStringArray(summary.agent_model_policy_mismatches),
    specialistLaneExpected: asNullableBoolean(summary.specialist_lane_expected),
    requiredSpecialistLanes: asStringArray(summary.required_specialist_lanes),
    recommendedSpecialistLanes: asStringArray(summary.recommended_specialist_lanes),
    observedSpecialistLanes: asStringArray(summary.observed_specialist_lanes),
    missingRequiredSpecialistLanes: asStringArray(summary.missing_required_specialist_lanes),
    unobservedRecommendedSpecialistLanes: asStringArray(summary.unobserved_recommended_specialist_lanes),
    specialistFanoutObserved: asNullableBoolean(summary.specialist_fanout_observed),
    specialistFanoutPartial: asNullableBoolean(summary.specialist_fanout_partial),
    specialistFanoutCoveredByPatchMaster: asNullableBoolean(summary.specialist_fanout_covered_by_patch_master),
    specialistFanoutStatus: asNullableString(summary.specialist_fanout_status),
    specialistFanoutReason: asNullableString(summary.specialist_fanout_reason),
    patchMasterSwarmObserved: asNullableBoolean(summary.patch_master_swarm_observed),
    patchMasterSwarmCount: asNullableNumber(summary.patch_master_swarm_count),
    githubRepoIdentityMissingObserved: asNullableBoolean(summary.github_repo_identity_missing_observed),
    githubRepoIdentitySource: asNullableString(summary.github_repo_identity_source),
    githubMemorySuppressedForMissingRepoIdentity: asNullableBoolean(
      summary.github_memory_suppressed_for_missing_repo_identity
    ),
    summaryRouteCountMismatch: asNullableBoolean(summary.summary_route_count_mismatch),
    summaryCapabilityCountMismatch: asNullableBoolean(summary.summary_capability_count_mismatch)
  };
}

function formatNullableBoolean(value: boolean | null) {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function buildLatestSessionTruthNote(truth: LatestSessionTruth) {
  const route = truth.routeSummary ?? "unobserved";
  const workingTreeClean = formatNullableBoolean(truth.workingTreeClean);
  const postExecutionOwnershipLeak = formatNullableBoolean(truth.postExecutionOwnershipLeakObserved);
  const executionOwnerActiveRootWrite = formatNullableBoolean(truth.executionOwnerActiveRootWriteObserved);
  const backgroundExecutionUnresolved = formatNullableBoolean(truth.backgroundExecutionAgentUnresolved);
  const backgroundAgentUnresolved = formatNullableBoolean(truth.backgroundAgentUnresolvedObserved);
  const executionWithoutObservedRepoDiff = formatNullableBoolean(truth.executionClaimWithoutObservedRepoDiff);
  const executionHandoffWithoutObservedRepoDiff = formatNullableBoolean(truth.executionHandoffWithoutObservedRepoDiff);
  const patchMasterHandoffWithoutCompletion = formatNullableBoolean(truth.patchMasterHandoffWithoutCompletionObserved);
  const malformedTaskPayloadObserved = formatNullableBoolean(truth.malformedTaskPayloadObserved);
  const agentModelPolicyMismatchObserved = formatNullableBoolean(truth.agentModelPolicyMismatchObserved);
  const sharedSurfaceConflictRisk = formatNullableBoolean(truth.sharedSurfaceConflictRisk);
  const sharedSurfaceOwnerDeclared = formatNullableBoolean(truth.sharedSurfaceOwnerDeclared);
  const sharedSurfaceFinalIntegratorNeeded = formatNullableBoolean(truth.sharedSurfaceFinalIntegratorNeeded);
  const integrationClassTaskObserved = formatNullableBoolean(truth.integrationClassTaskObserved);
  const foundationReadinessUnknown = formatNullableBoolean(truth.foundationReadinessUnknown);
  const foundationRecoverySuggested = formatNullableBoolean(truth.foundationRecoverySuggested);
  const bootstrapFailureObserved = formatNullableBoolean(truth.bootstrapFailureObserved);
  const hookExecutionFailureObserved = formatNullableBoolean(truth.hookExecutionFailureObserved);
  const preflightBlockerObserved = formatNullableBoolean(truth.preflightBlockerObserved);
  const githubRepoIdentityMissingObserved = formatNullableBoolean(truth.githubRepoIdentityMissingObserved);
  const githubMemorySuppressedForMissingRepoIdentity = formatNullableBoolean(
    truth.githubMemorySuppressedForMissingRepoIdentity
  );
  const legacyHookPluginConflictObserved = formatNullableBoolean(truth.legacyHookPluginConflictObserved);
  const validationOverclaimObserved = formatNullableBoolean(truth.validationOverclaimObserved);
  const validationRecoveredAfterFailures = formatNullableBoolean(truth.validationRecoveredAfterFailuresObserved);
  const modelIdentityMismatchObserved = formatNullableBoolean(truth.modelIdentityMismatchObserved);
  const userAbortObserved = formatNullableBoolean(truth.userAbortObserved);
  const subagentFailureObserved = formatNullableBoolean(truth.subagentFailureObserved);
  const terminalProviderFailureObserved = formatNullableBoolean(truth.terminalProviderFailureObserved);
  const summaryRouteCountMismatch = formatNullableBoolean(truth.summaryRouteCountMismatch);
  const summaryCapabilityCountMismatch = formatNullableBoolean(truth.summaryCapabilityCountMismatch);
  return `Latest session truth from ${truth.workspaceYamlPath}: truthSource=${truth.workspaceTruthSource}; updatedAt=${truth.updatedAt ?? "unknown"}; latestEventAt=${truth.latestEventAt ?? "unknown"}; sessionStartHead=${truth.sessionStartHead ?? "unknown"}; sessionEndHead=${truth.sessionEndHead ?? "unknown"}; route=${route}; routeSource=${truth.routeSummarySource}; directToolExecution=${formatNullableBoolean(truth.directToolExecutionObserved)}; outcome=${truth.sessionOutcome}; outcomeDetail=${truth.sessionOutcomeDetail ?? "unknown"}; authority=${truth.summaryAuthority}; archiveCompleteness=${truth.archiveCompleteness}; finalization=${truth.summaryFinalizationStatus}; userAbort=${userAbortObserved}; subagentFailure=${subagentFailureObserved}; terminalProviderFailure=${terminalProviderFailureObserved}; validation=${truth.validationStatus}; validationRaw=${truth.validationRawStatus ?? "unknown"}; validationOverclaim=${validationOverclaimObserved}; validationRecoveredAfterFailures=${validationRecoveredAfterFailures}; validationRecoverySource=${truth.validationRecoverySource ?? "none"}; requestedRuntimeModel=${truth.requestedRuntimeModel ?? "unknown"}; sessionCurrentModel=${truth.sessionCurrentModel ?? "unknown"}; observedRuntimeModels=${truth.observedRuntimeModels.length > 0 ? truth.observedRuntimeModels.join(",") : "none"}; postPromptObservedRuntimeModels=${truth.postPromptObservedRuntimeModels.length > 0 ? truth.postPromptObservedRuntimeModels.join(",") : "none"}; observedAgentToolModels=${truth.observedAgentToolModels.length > 0 ? truth.observedAgentToolModels.join(",") : "none"}; observedModelMetricModels=${truth.observedModelMetricModels.length > 0 ? truth.observedModelMetricModels.join(",") : "none"}; mixedModelSession=${formatNullableBoolean(truth.mixedModelSessionObserved)}; nonRequestedModelUsage=${formatNullableBoolean(truth.nonRequestedModelUsageObserved)}; modelIdentityMismatch=${modelIdentityMismatchObserved}; agentModelPolicyMismatch=${agentModelPolicyMismatchObserved}; agentModelPolicyMismatchCount=${truth.agentModelPolicyMismatchCount ?? "unknown"}; workingTreeClean=${workingTreeClean}; committedDiffSource=${truth.committedDiffSource ?? "unknown"}; postExecutionOwnershipLeak=${postExecutionOwnershipLeak}; executionOwnerActiveRootWrite=${executionOwnerActiveRootWrite}; backgroundExecutionUnresolved=${backgroundExecutionUnresolved}; backgroundAgentUnresolved=${backgroundAgentUnresolved}; backgroundAgentUnresolvedIds=${truth.backgroundAgentUnresolvedIds.length > 0 ? truth.backgroundAgentUnresolvedIds.join(",") : "none"}; executionWithoutObservedRepoDiff=${executionWithoutObservedRepoDiff}; executionHandoffWithoutObservedRepoDiff=${executionHandoffWithoutObservedRepoDiff}; patchMasterHandoffWithoutCompletion=${patchMasterHandoffWithoutCompletion}; malformedTaskPayloadObserved=${malformedTaskPayloadObserved}; repoWorkingTreeFiles=${truth.repoWorkingTreeFileCount}; committedRepoFiles=${truth.committedRepoFileCount}; sessionStateFiles=${truth.sessionStateFileCount}; validationArtifactFiles=${truth.validationArtifactFileCount}; integrationClassTask=${integrationClassTaskObserved}; foundationReadinessUnknown=${foundationReadinessUnknown}; preflightBlocker=${preflightBlockerObserved}; preflightBlockerKind=${truth.preflightBlockerKind ?? "none"}; sharedSurfaceOwnerDeclared=${sharedSurfaceOwnerDeclared}; sharedSurfaceConflictRisk=${sharedSurfaceConflictRisk}; sharedSurfaceFinalIntegratorNeeded=${sharedSurfaceFinalIntegratorNeeded}; specialistFanoutStatus=${truth.specialistFanoutStatus ?? "unknown"}; missingRequiredSpecialistLanes=${truth.missingRequiredSpecialistLanes.length}; patchMasterSwarmObserved=${formatNullableBoolean(truth.patchMasterSwarmObserved)}; foundationRecoverySuggested=${foundationRecoverySuggested}; bootstrapFailureObserved=${bootstrapFailureObserved}; hookExecutionFailureObserved=${hookExecutionFailureObserved}; legacyHookPluginConflictObserved=${legacyHookPluginConflictObserved}; githubMemoryEnabledCheck=${truth.githubMemoryEnabledCheck ?? "unknown"}; prContextCheck=${truth.prContextCheck ?? "unknown"}; githubRepoIdentityMissingObserved=${githubRepoIdentityMissingObserved}; githubRepoIdentitySource=${truth.githubRepoIdentitySource ?? "unknown"}; githubMemorySuppressedForMissingRepoIdentity=${githubMemorySuppressedForMissingRepoIdentity}; summaryRouteCountMismatch=${summaryRouteCountMismatch}; summaryCapabilityCountMismatch=${summaryCapabilityCountMismatch}.`;
}

function parseArgs(argv: string[]) {
  const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));
  const args = {
    repoRoot,
    workspaceRoot: repoRoot,
    homeDir: process.env.HOME || os.homedir(),
    copilotHome: process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"),
    reportJson: "",
    reportMd: ""
  };
  let reportJsonExplicit = false;
  let reportMdExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--repo-root" && argv[index + 1]) {
      args.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--workspace-root" && argv[index + 1]) {
      args.workspaceRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--home-dir" && argv[index + 1]) {
      args.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--copilot-home" && argv[index + 1]) {
      args.copilotHome = path.resolve(argv[index + 1]);
      index += 1;
    } else if ((current === "--report" || current === "--report-json") && argv[index + 1]) {
      args.reportJson = path.resolve(argv[index + 1]);
      reportJsonExplicit = true;
      index += 1;
    } else if (current === "--report-md" && argv[index + 1]) {
      args.reportMd = path.resolve(argv[index + 1]);
      reportMdExplicit = true;
      index += 1;
    }
  }

  if (!reportJsonExplicit) {
    args.reportJson = path.join(args.repoRoot, ".xgc", "validation", "surface-resolution.json");
  }
  if (!reportMdExplicit) {
    args.reportMd = path.join(args.repoRoot, ".xgc", "validation", "surface-resolution.md");
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pluginEvidence = inspectInstalledPlugin("xgc", {
    homeDir: args.copilotHome,
    sourcePath: args.repoRoot
  });
  const xgcPaths = resolveGlobalPaths(args.homeDir);
  const report = resolveRuntimeSourceReport({
    repoRoot: args.repoRoot,
    workspaceRoot: args.workspaceRoot,
    copilotHome: args.copilotHome,
    copilotConfigPath: pluginEvidence.configPath,
    pluginCachePath: pluginEvidence.cachedPluginPath,
    xgcProfileHome: xgcPaths.profileHome
  });
  const latestSessionTruth = buildLatestSessionTruth(xgcPaths.profileHome, {
    repoRoot: args.repoRoot,
    workspaceRoot: args.workspaceRoot
  });
  const rawProfileHookConflicts = findLegacyHookPluginConflicts({ homeDir: args.homeDir });
  if (rawProfileHookConflicts.length > 0) {
    report.notes.push(
      `Raw/default Copilot profile has stale hook plugin conflicts; fresh raw copilot runs may execute old .mjs hooks or unsafe workspace-relative .sh hooks. Repair with \`npm run repair:raw-hooks\` or disable the stale raw/default plugin: ${rawProfileHookConflicts
        .map(formatLegacyHookPluginConflict)
        .join(" | ")}`
    );
  }
  report.latestSessionTruth = latestSessionTruth;
  if (latestSessionTruth) {
    report.notes.push(buildLatestSessionTruthNote(latestSessionTruth));
  } else {
    report.notes.push(
      `No repo-owned .xgc/validation/workspace.yaml or fallback session-state workspace.yaml for the current repo/workspace was found; route/session truth remains available only after a matching Copilot session is finalized. Fallback session-state search root: ${path.join(xgcPaths.profileHome, "session-state")}.`
    );
  }

  writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeText(args.reportMd, renderRuntimeSourceReportMarkdown(report));

  console.log(`Surface resolution JSON: ${args.reportJson}`);
  console.log(`Surface resolution Markdown: ${args.reportMd}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
