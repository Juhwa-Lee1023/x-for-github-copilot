import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeText } from "./lib/runtime-validation.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sessionFinalizerPath = path.join(scriptsDir, "hooks", "finalize-session-summary.py");

type SessionBundleResult = {
  sessionId: string;
  workspaceYamlPath: string;
  workspaceTruthSource: string;
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
  sessionOutcome: string;
  sessionOutcomeDetail: string | null;
  summaryAuthority: string;
  summaryAuthorityReasons: string[];
  summaryFinalizationStatus: string;
  finalizationComplete: boolean | null;
  finalizationPartial: boolean | null;
  finalizationError: boolean | null;
  archiveCompleteness: string;
  archiveCompletenessReasons: string[];
  validationStatus: string;
  validationRawStatus: string | null;
  validationOverclaimObserved: boolean | null;
  validationCommandFailureCount: number;
  externalValidationStatus: string | null;
  externalValidationSource: string | null;
  externalValidationCommandFailureCount: number | null;
  externalValidationArtifactFileCount: number | null;
  validationStatusConflictObserved: boolean | null;
  workingTreeClean: boolean | null;
  repoWorkingTreeFileCount: number;
  committedRepoFileCount: number;
  sessionStateFileCount: number;
  validationArtifactFileCount: number;
  committedDiffSource: string | null;
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
  executionClaimWithoutObservedRepoDiff: boolean | null;
  executionHandoffWithoutObservedRepoDiff: boolean | null;
  patchMasterHandoffWithoutCompletionObserved: boolean | null;
  malformedTaskPayloadObserved: boolean | null;
  postExecutionOwnershipLeakObserved: boolean | null;
  postExecutionRootWriteObserved: boolean | null;
  postExecutionRootPatchObserved: boolean | null;
  postExecutionRootWriteCount: number | null;
  ownershipLeakAllowedReason: string | null;
  executionOwner: string | null;
  ownershipTransferredToExecution: boolean | null;
  integrationClassTaskObserved: boolean | null;
  foundationReadinessAssessed: boolean | null;
  foundationReadinessUnknown: boolean | null;
  foundationRiskRaised: boolean | null;
  repeatedFoundationFailureObserved: boolean | null;
  foundationFailureClasses: string[];
  foundationRecoveryReason: string | null;
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
  integrationOwnedSurfacesTouched: string[];
  sharedSurfaceChangeObserved: boolean | null;
  sharedSurfaceOwnerDeclared: boolean | null;
  sharedSurfaceConflictRisk: boolean | null;
  sharedSurfaceReviewRecommended: boolean | null;
  sharedSurfaceFinalIntegratorNeeded: boolean | null;
  foundationRecoverySuggested: boolean | null;
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
  missingFiles: string[];
};

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
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith(" ") || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    if (!key) continue;
    data[key.trim()] = parseFlatYamlValue(rest.join(":").trim());
  }
  return data;
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

function asArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function asNullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

type WorkspaceYamlCandidate = {
  filePath: string;
  summary: Record<string, unknown>;
  workspaceTruthSource: string;
  priority: number;
  mtimeMs: number;
};

type ExternalValidationSummary = {
  directory: string;
  status: "passed" | "failed" | "unknown";
  commandFailureCount: number;
  artifactFileCount: number;
};

function findExternalValidationLogDirs(root: string) {
  const results: string[] = [];
  const ignored = new Set([".git", "node_modules", ".next", "dist", "build"]);
  const walk = (current: string, depth: number) => {
    if (depth > 8 || !fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "validation-logs") {
          results.push(fullPath);
          continue;
        }
        walk(fullPath, depth + 1);
      }
    }
  };
  walk(root, 0);
  return results.sort();
}

function parseExternalValidationLogs(directory: string): ExternalValidationSummary {
  const exitCodes: number[] = [];
  let artifactFileCount = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(directory, entry.name);
    const isLogLike = entry.name.endsWith(".log") || entry.name === "summary.txt";
    if (!isLogLike) continue;
    artifactFileCount += 1;
    const text = fs.readFileSync(fullPath, "utf8");
    for (const match of text.matchAll(/\bEXIT_STATUS=(-?\d+)\b/g)) {
      exitCodes.push(Number.parseInt(match[1], 10));
    }
    for (const match of text.matchAll(/^## END .*\bexit=(-?\d+)\b/gm)) {
      exitCodes.push(Number.parseInt(match[1], 10));
    }
    if (entry.name === "summary.txt") {
      for (const line of text.split(/\r?\n/)) {
        const match = line.trim().match(/^\S+\s+(-?\d+)$/);
        if (match) exitCodes.push(Number.parseInt(match[1], 10));
      }
    }
  }
  const commandFailureCount = exitCodes.filter((exitCode) => exitCode !== 0).length;
  return {
    directory,
    status: exitCodes.length === 0 ? "unknown" : commandFailureCount > 0 ? "failed" : "passed",
    commandFailureCount,
    artifactFileCount
  };
}

function sessionIdFromValidationLogDir(directory: string) {
  const parent = path.basename(path.dirname(directory));
  const uuidMatch = parent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuidMatch?.[0] ?? parent;
}

function validationStatusConflict(validationStatus: string, externalStatus: string | null) {
  if (!externalStatus || externalStatus === "unknown") return false;
  if (!["passed", "failed"].includes(validationStatus)) return false;
  return validationStatus !== externalStatus;
}

function isValidationWorkspaceYaml(filePath: string) {
  const normalized = filePath.split(path.sep).join("/");
  return normalized.endsWith("/.xgc/validation/workspace.yaml");
}

function workspaceTruthSourceFor(filePath: string) {
  return isValidationWorkspaceYaml(filePath) ? "repo-owned-validation-workspace" : "session-state-workspace";
}

function workspacePriority(filePath: string) {
  return isValidationWorkspaceYaml(filePath) ? 0 : 1;
}

function workspaceFreshnessMs(candidate: WorkspaceYamlCandidate) {
  const values = [candidate.summary.latest_event_at, candidate.summary.updated_at]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : candidate.mtimeMs;
}

function latestEventTimestampMs(eventsPath: string) {
  let latest = Number.NaN;
  if (!fs.existsSync(eventsPath)) return latest;
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { timestamp?: unknown };
      if (typeof parsed.timestamp === "string") {
        const value = Date.parse(parsed.timestamp);
        if (Number.isFinite(value)) latest = Number.isFinite(latest) ? Math.max(latest, value) : value;
      }
    } catch {
      // Ignore malformed event rows; bundle reporting is best-effort.
    }
  }
  return latest;
}

function eventsContainTerminalShutdown(eventsPath: string) {
  if (!fs.existsSync(eventsPath)) return false;
  return fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).some((line) => {
    if (!line.trim()) return false;
    try {
      const parsed = JSON.parse(line) as { type?: unknown };
      return parsed.type === "session.shutdown";
    } catch {
      return false;
    }
  });
}

function normalizeStopReason(value: string) {
  const reason = value.trim();
  if (!reason) return null;
  const normalized = reason.toLowerCase();
  if (["routine", "normal", "completed", "complete", "success", "end_turn"].includes(normalized)) {
    return "end_turn";
  }
  if (["abort", "aborted", "cancelled", "canceled", "interrupted", "user_abort", "user-abort"].includes(normalized)) {
    return "abort";
  }
  if (["error", "failed", "failure", "crash", "timeout"].includes(normalized)) {
    return "error";
  }
  return reason;
}

function stringStopReason(value: unknown) {
  return typeof value === "string" && value.trim() ? normalizeStopReason(value) : null;
}

function stopReasonFromEvents(eventsPath: string) {
  let derived: string | null = null;
  if (!fs.existsSync(eventsPath)) return derived;
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown; stopReason?: unknown; stop_reason?: unknown; data?: unknown };
      const eventType = typeof parsed.type === "string" ? parsed.type : "";
      const data = parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : {};
      if (eventType === "abort" || eventType === "user.abort") {
        derived = "abort";
        continue;
      }
      if (eventType === "error" || eventType === "errorOccurred" || eventType === "session.error") {
        derived = stringStopReason(data.stopReason) ?? stringStopReason(data.stop_reason) ?? stringStopReason(data.reason) ?? "error";
        continue;
      }

      const explicitReason =
        stringStopReason(data.stopReason) ??
        stringStopReason(data.stop_reason) ??
        stringStopReason(parsed.stopReason) ??
        stringStopReason(parsed.stop_reason);
      if (explicitReason) {
        derived = explicitReason;
        continue;
      }

      if (eventType === "session.shutdown") {
        const shutdownReason =
          stringStopReason(data.shutdownType) ??
          stringStopReason(data.shutdownReason) ??
          stringStopReason(data.reason);
        if (shutdownReason && (shutdownReason !== "end_turn" || !derived)) {
          derived = shutdownReason;
        }
      }
    } catch {
      // Ignore malformed event rows; bundle reporting is best-effort.
    }
  }
  return derived;
}

function eventsContainTerminalStopHook(eventsPath: string) {
  if (!fs.existsSync(eventsPath)) return false;
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown; data?: unknown };
      if (parsed.type !== "hook.start" && parsed.type !== "hook.end") continue;
      const data = parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : {};
      if (data.hookType === "agentStop" || data.hookType === "subagentStop") return true;
    } catch {
      // Ignore malformed event rows; bundle reporting is best-effort.
    }
  }
  return false;
}

function eventsPathForWorkspace(filePath: string, summary: Record<string, unknown>) {
  const adjacent = path.join(path.dirname(filePath), "events.jsonl");
  if (fs.existsSync(adjacent)) return adjacent;
  const sourceWorkspaceYaml = asString(summary.source_session_workspace_yaml, "");
  if (sourceWorkspaceYaml) {
    const sourceEventsPath = path.join(path.dirname(sourceWorkspaceYaml), "events.jsonl");
    if (fs.existsSync(sourceEventsPath)) return sourceEventsPath;
  }
  return adjacent;
}

function refreshStaleSessionWorkspace(filePath: string, summary: Record<string, unknown>) {
  if (!fs.existsSync(sessionFinalizerPath)) return summary;
  const eventsPath = eventsPathForWorkspace(filePath, summary);
  if (!eventsContainTerminalShutdown(eventsPath)) return summary;

  const latestEventMs = latestEventTimestampMs(eventsPath);
  const summaryLatestMs = typeof summary.latest_event_at === "string" ? Date.parse(summary.latest_event_at) : Number.NaN;
  const finalizationStatus = asString(summary.summary_finalization_status, "");
  const stale =
    summary.session_shutdown_observed !== true ||
    summary.final_status === "in_progress" ||
    finalizationStatus === "partial" ||
    finalizationStatus === "heuristic" ||
    (Number.isFinite(latestEventMs) && (!Number.isFinite(summaryLatestMs) || summaryLatestMs < latestEventMs));

  if (!stale) return summary;

  const sessionId = asString(summary.id, path.basename(path.dirname(filePath)));
  const cwd = asString(summary.cwd, path.dirname(filePath));
  const stopReason = stopReasonFromEvents(eventsPath) ?? stringStopReason(summary.stop_reason);
  const payload: Record<string, unknown> = {
    sessionId,
    timestamp: Number.isFinite(latestEventMs) ? latestEventMs : Date.now(),
    cwd,
    transcriptPath: eventsPath
  };
  if (stopReason) payload.stopReason = stopReason;
  const finalizerEvent = eventsContainTerminalStopHook(eventsPath) ? "agentStop" : "sessionShutdownRecovery";
  const result = spawnSync("python3", [sessionFinalizerPath, finalizerEvent], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: process.env
  });
  if (result.status !== 0) return summary;
  try {
    return readFlatYaml(filePath);
  } catch {
    return summary;
  }
}

function findWorkspaceYamlCandidates(root: string) {
  const results: WorkspaceYamlCandidate[] = [];
  const ignored = new Set([".git", "node_modules", ".next", "dist", "build"]);

  const walk = (current: string, depth: number) => {
    if (depth > 6 || !fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.name === "workspace.yaml") {
        const summary = refreshStaleSessionWorkspace(fullPath, readFlatYaml(fullPath));
        results.push({
          filePath: fullPath,
          summary,
          workspaceTruthSource: workspaceTruthSourceFor(fullPath),
          priority: workspacePriority(fullPath),
          mtimeMs: fs.statSync(fullPath).mtimeMs
        });
      }
    }
  };

  walk(root, 0);
  const bySessionId = new Map<string, WorkspaceYamlCandidate>();
  for (const candidate of results.sort(
    (left, right) => workspaceFreshnessMs(right) - workspaceFreshnessMs(left) || left.priority - right.priority
  )) {
    const sessionId = asString(candidate.summary.id, path.basename(path.dirname(candidate.filePath)));
    if (!bySessionId.has(sessionId)) {
      bySessionId.set(sessionId, candidate);
    }
  }

  return [...bySessionId.values()].sort(
    (left, right) => workspaceFreshnessMs(right) - workspaceFreshnessMs(left) || left.priority - right.priority || left.filePath.localeCompare(right.filePath)
  );
}

function sessionIdForWorkspaceSummary(summary: Record<string, unknown>, workspaceYamlPath: string) {
  return asString(summary.id, path.basename(path.dirname(workspaceYamlPath)));
}

function findWorkspaceEvidenceDirsForSession(root: string, sessionId: string) {
  const dirs = new Set<string>();
  const ignored = new Set([".git", "node_modules", ".next", "dist", "build"]);

  const walk = (current: string, depth: number) => {
    if (depth > 8 || !fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.name === "workspace.yaml") {
        try {
          const summary = readFlatYaml(fullPath);
          if (sessionIdForWorkspaceSummary(summary, fullPath) === sessionId) {
            dirs.add(path.resolve(path.dirname(fullPath)));
          }
        } catch {
          // Ignore malformed sibling summaries; archive grading should remain best-effort.
        }
      }
    }
  };

  walk(root, 0);
  return dirs;
}

function evidenceDirsFor(summary: Record<string, unknown>, workspaceYamlPath: string, bundleRoot: string) {
  const workspaceDir = path.resolve(path.dirname(workspaceYamlPath));
  const dirs = new Set<string>([workspaceDir]);
  const sessionId = sessionIdForWorkspaceSummary(summary, workspaceYamlPath);
  const sourceWorkspaceYaml = asString(summary.source_session_workspace_yaml, "");
  if (sourceWorkspaceYaml) {
    dirs.add(path.resolve(path.dirname(sourceWorkspaceYaml)));
  }

  for (const dir of findWorkspaceEvidenceDirsForSession(bundleRoot, sessionId)) {
    dirs.add(dir);
  }

  return [...dirs];
}

function findExternalValidationForWorkspace(
  summary: Record<string, unknown>,
  workspaceYamlPath: string,
  bundleRoot: string
) {
  const sessionId = sessionIdForWorkspaceSummary(summary, workspaceYamlPath);
  const evidenceDirs = evidenceDirsFor(summary, workspaceYamlPath, bundleRoot).map((dir) => path.resolve(dir));
  const validationDirs = findExternalValidationLogDirs(bundleRoot);
  const workspaceDir = path.resolve(path.dirname(workspaceYamlPath));
  const candidates = validationDirs.filter((directory) => {
    const parent = path.resolve(path.dirname(directory));
    if (parent === workspaceDir || evidenceDirs.includes(parent)) return true;
    if (parent.includes(sessionId) || path.basename(parent).includes(sessionId)) return true;
    return evidenceDirs.some((dir) => {
      const relative = path.relative(dir, directory);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  });
  return candidates[0] ? parseExternalValidationLogs(candidates[0]) : null;
}

function siblingExists(evidenceDirs: string[], fileName: string) {
  return evidenceDirs.some((dir) => fs.existsSync(path.join(dir, fileName)));
}

function bundledProcessLogExists(evidenceDirs: string[], processLog: unknown) {
  if (typeof processLog !== "string" || !processLog) return false;

  const candidatePath = path.resolve(processLog);
  const isInsideEvidence = evidenceDirs.some((sessionDir) => {
    const relativeToSession = path.relative(sessionDir, candidatePath);
    return relativeToSession !== "" && !relativeToSession.startsWith("..") && !path.isAbsolute(relativeToSession);
  });

  if (isInsideEvidence && fs.existsSync(candidatePath)) {
    return true;
  }

  if (
    evidenceDirs.some(
      (sessionDir) =>
        fs.existsSync(path.join(sessionDir, path.basename(processLog))) ||
        fs.existsSync(path.join(sessionDir, "logs", path.basename(processLog)))
    )
  ) {
    return true;
  }

  return false;
}

function bundleContainsHookLog(bundleRoot: string, evidenceDirs: string[]) {
  if (evidenceDirs.some((dir) => fs.existsSync(path.join(dir, "hooks.log")) || fs.existsSync(path.join(dir, ".xgc", "logs", "hooks.log")))) {
    return true;
  }

  const ignored = new Set([".git", "node_modules", ".next", "dist", "build"]);
  const walk = (current: string, depth: number): boolean => {
    if (depth > 8 || !fs.existsSync(current)) return false;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (walk(fullPath, depth + 1)) return true;
        continue;
      }
      if (entry.name !== "hooks.log") continue;
      const normalized = fullPath.split(path.sep).join("/");
      if (normalized.endsWith("/.xgc/logs/hooks.log") || normalized.endsWith("/hooks.log")) {
        return true;
      }
    }
    return false;
  };

  return walk(bundleRoot, 0);
}

function hookLogExpected(summary: Record<string, unknown>) {
  return asStringArray(summary.session_state_files).some((file) => {
    const normalized = file.split("\\").join("/");
    return normalized === ".xgc/logs/hooks.log" || normalized.endsWith("/.xgc/logs/hooks.log") || normalized.endsWith("/hooks.log");
  });
}

function deriveArchiveCompleteness(summary: Record<string, unknown>, workspaceYamlPath: string, bundleRoot: string) {
  const existing = asString(summary.archive_completeness, "");
  const existingReasons = asStringArray(summary.archive_completeness_reasons);
  const evidenceDirs = evidenceDirsFor(summary, workspaceYamlPath, bundleRoot);
  const missingFiles: string[] = [];
  if (!siblingExists(evidenceDirs, "events.jsonl")) missingFiles.push("events.jsonl");
  if (!siblingExists(evidenceDirs, "workspace.yaml")) missingFiles.push("workspace.yaml");
  if (!bundledProcessLogExists(evidenceDirs, summary.process_log)) {
    missingFiles.push("process_log");
  }
  if (hookLogExpected(summary) && !bundleContainsHookLog(bundleRoot, evidenceDirs)) {
    missingFiles.push("hooks_log");
  }

  const derivedReasons: string[] = [];
  if (missingFiles.includes("events.jsonl")) {
    derivedReasons.push("raw events were unavailable");
  }
  if (!asString(summary.route_summary, "")) {
    derivedReasons.push("route summary was unavailable");
  }
  if (missingFiles.includes("process_log")) {
    derivedReasons.push("matching process log was unavailable");
  }
  if (missingFiles.includes("hooks_log")) {
    derivedReasons.push("hook log was unavailable");
  }
  if (
    asNullableBoolean(summary.validation_observed) === true &&
    asArrayLength(summary.validation_command_failures) === 0 &&
    asString(summary.validation_status, "") === "observed-unknown"
  ) {
    derivedReasons.push("validation was observed but could not be classified");
  }
  const summaryFinalizationStatus = asString(summary.summary_finalization_status, "");
  if (summaryFinalizationStatus === "error") {
    derivedReasons.push("terminal error hook was observed");
  }
  if (summaryFinalizationStatus === "partial" || summaryFinalizationStatus === "heuristic") {
    derivedReasons.push(`summary finalization status is ${summaryFinalizationStatus}`);
  }
  for (const file of missingFiles.filter((file) => file !== "events.jsonl" && file !== "process_log")) {
    derivedReasons.push(`${file} was unavailable`);
  }

  const derivedArchiveCompleteness =
    summaryFinalizationStatus === "failed-finalization"
      ? "failed-finalization"
      : missingFiles.includes("events.jsonl")
        ? "incomplete"
        : derivedReasons.length > 0
          ? "partial"
          : "complete";
  const rank: Record<string, number> = {
    "failed-finalization": 0,
    incomplete: 1,
    partial: 2,
    complete: 3
  };

  if (!existing || !(existing in rank)) {
    return {
      archiveCompleteness: derivedArchiveCompleteness,
      archiveCompletenessReasons: derivedReasons,
      missingFiles
    };
  }

  const archiveCompleteness =
    rank[existing] <= rank[derivedArchiveCompleteness] ? existing : derivedArchiveCompleteness;
  const archiveCompletenessReasons =
    archiveCompleteness === existing ? existingReasons : [...new Set([...existingReasons, ...derivedReasons])];

  return { archiveCompleteness, archiveCompletenessReasons, missingFiles };
}

function summarizeWorkspaceYaml(candidate: WorkspaceYamlCandidate, bundleRoot: string): SessionBundleResult {
  const { filePath: workspaceYamlPath, summary, workspaceTruthSource } = candidate;
  const archive = deriveArchiveCompleteness(summary, workspaceYamlPath, bundleRoot);
  const externalValidation = findExternalValidationForWorkspace(summary, workspaceYamlPath, bundleRoot);
  const validationStatus = asString(summary.validation_status, "unknown");
  return {
    sessionId: asString(summary.id, path.basename(path.dirname(workspaceYamlPath))),
    workspaceYamlPath,
    workspaceTruthSource,
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
    sessionOutcome: asString(summary.session_outcome, "unknown"),
    sessionOutcomeDetail: asNullableString(summary.session_outcome_detail),
    summaryAuthority: asString(summary.summary_authority, "unknown"),
    summaryAuthorityReasons: asStringArray(summary.summary_authority_reasons),
    summaryFinalizationStatus: asString(summary.summary_finalization_status, "unknown"),
    finalizationComplete: asNullableBoolean(summary.finalization_complete),
    finalizationPartial: asNullableBoolean(summary.finalization_partial),
    finalizationError: asNullableBoolean(summary.finalization_error),
    archiveCompleteness: archive.archiveCompleteness,
    archiveCompletenessReasons: archive.archiveCompletenessReasons,
    validationStatus,
    validationRawStatus: asNullableString(summary.validation_raw_status),
    validationOverclaimObserved: asNullableBoolean(summary.validation_overclaim_observed),
    validationCommandFailureCount: asArrayLength(summary.validation_command_failures),
    externalValidationStatus: externalValidation?.status ?? null,
    externalValidationSource: externalValidation?.directory ?? null,
    externalValidationCommandFailureCount: externalValidation?.commandFailureCount ?? null,
    externalValidationArtifactFileCount: externalValidation?.artifactFileCount ?? null,
    validationStatusConflictObserved: validationStatusConflict(validationStatus, externalValidation?.status ?? null),
    workingTreeClean: asNullableBoolean(summary.working_tree_clean),
    repoWorkingTreeFileCount: asArrayLength(summary.repo_working_tree_files),
    committedRepoFileCount: asArrayLength(summary.committed_repo_files),
    sessionStateFileCount: asArrayLength(summary.session_state_files),
    validationArtifactFileCount: asArrayLength(summary.validation_artifact_files),
    committedDiffSource: asNullableString(summary.committed_diff_source),
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
    executionClaimWithoutObservedRepoDiff: asNullableBoolean(summary.execution_claim_without_observed_repo_diff),
    executionHandoffWithoutObservedRepoDiff: asNullableBoolean(summary.execution_handoff_without_observed_repo_diff),
    patchMasterHandoffWithoutCompletionObserved: asNullableBoolean(summary.patch_master_handoff_without_completion_observed),
    malformedTaskPayloadObserved: asNullableBoolean(summary.malformed_task_payload_observed),
    postExecutionOwnershipLeakObserved: asNullableBoolean(summary.post_execution_ownership_leak_observed),
    postExecutionRootWriteObserved: asNullableBoolean(summary.post_execution_root_write_observed),
    postExecutionRootPatchObserved: asNullableBoolean(summary.post_execution_root_patch_observed),
    postExecutionRootWriteCount: asNullableNumber(summary.post_execution_root_write_count),
    ownershipLeakAllowedReason: asNullableString(summary.ownership_leak_allowed_reason),
    executionOwner: asNullableString(summary.execution_owner),
    ownershipTransferredToExecution: asNullableBoolean(summary.ownership_transferred_to_execution),
    integrationClassTaskObserved: asNullableBoolean(summary.integration_class_task_observed),
    foundationReadinessAssessed: asNullableBoolean(summary.foundation_readiness_assessed),
    foundationReadinessUnknown: asNullableBoolean(summary.foundation_readiness_unknown),
    foundationRiskRaised: asNullableBoolean(summary.foundation_risk_raised),
    repeatedFoundationFailureObserved: asNullableBoolean(summary.repeated_foundation_failure_observed),
    foundationFailureClasses: asStringArray(summary.foundation_failure_classes),
    foundationRecoveryReason: asNullableString(summary.foundation_recovery_reason),
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
    integrationOwnedSurfacesTouched: asStringArray(summary.integration_owned_surfaces_touched),
    sharedSurfaceChangeObserved: asNullableBoolean(summary.shared_surface_change_observed),
    sharedSurfaceOwnerDeclared: asNullableBoolean(summary.shared_surface_owner_declared),
    sharedSurfaceConflictRisk: asNullableBoolean(summary.shared_surface_conflict_risk),
    sharedSurfaceReviewRecommended: asNullableBoolean(summary.shared_surface_review_recommended),
    sharedSurfaceFinalIntegratorNeeded: asNullableBoolean(summary.shared_surface_final_integrator_needed),
    foundationRecoverySuggested: asNullableBoolean(summary.foundation_recovery_suggested),
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
    summaryCapabilityCountMismatch: asNullableBoolean(summary.summary_capability_count_mismatch),
    missingFiles: archive.missingFiles
  };
}

function summarizeExternalValidationOnly(directory: string): SessionBundleResult {
  const externalValidation = parseExternalValidationLogs(directory);
  const sessionId = sessionIdFromValidationLogDir(directory);
  return {
    sessionId,
    workspaceYamlPath: "",
    workspaceTruthSource: "external-validation-logs",
    updatedAt: null,
    latestEventAt: null,
    sessionStartHead: null,
    sessionEndHead: null,
    routeSummary: null,
    routeAgents: [],
    routeSummaryAvailable: false,
    routeSummaryDerivedFromRawEvents: false,
    routeSummaryHeuristic: true,
    routeSummarySource: "missing-workspace",
    summaryRouteHeuristicMismatch: null,
    summaryTimestampStale: null,
    directToolExecutionObserved: null,
    sessionOutcome: "unknown",
    sessionOutcomeDetail: "validation_logs_without_workspace_summary",
    summaryAuthority: "partial",
    summaryAuthorityReasons: ["workspace.yaml was unavailable; only external validation logs were found"],
    summaryFinalizationStatus: "partial",
    finalizationComplete: false,
    finalizationPartial: true,
    finalizationError: null,
    archiveCompleteness: "incomplete",
    archiveCompletenessReasons: ["workspace.yaml was unavailable", "raw events were unavailable", "matching process log was unavailable"],
    validationStatus: "not-observed",
    validationRawStatus: null,
    validationOverclaimObserved: null,
    validationCommandFailureCount: 0,
    externalValidationStatus: externalValidation.status,
    externalValidationSource: externalValidation.directory,
    externalValidationCommandFailureCount: externalValidation.commandFailureCount,
    externalValidationArtifactFileCount: externalValidation.artifactFileCount,
    validationStatusConflictObserved: false,
    workingTreeClean: null,
    repoWorkingTreeFileCount: 0,
    committedRepoFileCount: 0,
    sessionStateFileCount: 0,
    validationArtifactFileCount: externalValidation.artifactFileCount,
    committedDiffSource: null,
    keyAgents: [],
    repoScoutInvocationCount: null,
    triageInvocationCount: null,
    patchMasterInvocationCount: null,
    requiredCheckInvocationCount: null,
    builtInGenericAgentInvocationCount: null,
    postExecutionPlannerReopenAgents: [],
    postExecutionGenericAgentObserved: null,
    postExecutionBuiltInAgentObserved: null,
    postExecutionGenericAgents: [],
    postExecutionBuiltInAgents: [],
    executionClaimWithoutObservedRepoDiff: null,
    executionHandoffWithoutObservedRepoDiff: null,
    patchMasterHandoffWithoutCompletionObserved: null,
    malformedTaskPayloadObserved: null,
    postExecutionOwnershipLeakObserved: null,
    postExecutionRootWriteObserved: null,
    postExecutionRootPatchObserved: null,
    postExecutionRootWriteCount: null,
    ownershipLeakAllowedReason: null,
    executionOwner: null,
    ownershipTransferredToExecution: null,
    integrationClassTaskObserved: null,
    foundationReadinessAssessed: null,
    foundationReadinessUnknown: null,
    foundationRiskRaised: null,
    repeatedFoundationFailureObserved: null,
    foundationFailureClasses: [],
    foundationRecoveryReason: null,
    bootstrapFailureObserved: null,
    runtimeConfigMismatchObserved: null,
    toolingMaterializationFailureObserved: null,
    legacyHookPluginConflictObserved: null,
    hookExecutionFailureObserved: null,
    copilotAuthFailureObserved: null,
    copilotModelListFailureObserved: null,
    copilotPolicyFailureObserved: null,
    preflightBlockerObserved: null,
    preflightBlockerKind: null,
    preflightBlockerReason: null,
    validationPortConflictObserved: null,
    validationServerReadinessFailureObserved: null,
    appFoundationFailureObserved: null,
    integrationOwnedSurfacesTouched: [],
    sharedSurfaceChangeObserved: null,
    sharedSurfaceOwnerDeclared: null,
    sharedSurfaceConflictRisk: null,
    sharedSurfaceReviewRecommended: null,
    sharedSurfaceFinalIntegratorNeeded: null,
    foundationRecoverySuggested: null,
    githubMemoryEnabledCheck: null,
    githubMemoryEnabledCheckCached: null,
    githubMemoryEnabledCheckCount: null,
    githubMemoryEnabledSuccessCount: null,
    prContextCheck: null,
    prContextCheckCached: null,
    prContextCheckCount: null,
    githubPrLookupSuccessCount: null,
    githubCapabilityCacheHits: null,
    githubCapabilityCacheMisses: null,
    githubMemoryEnabledFreshAfterCacheObserved: null,
    prContextFreshAfterCacheObserved: null,
    probeCacheSummary: [],
    providerRetryObserved: null,
    providerRetryState: null,
    providerRetryCount: null,
    providerRetryReason: null,
    userAbortObserved: null,
    subagentFailureObserved: null,
    terminalProviderFailureObserved: null,
    modelRateLimitObserved: null,
    modelRateLimitCount: null,
    provider502Observed: null,
    provider502Count: null,
    requestedRuntimeModel: null,
    sessionCurrentModel: null,
    observedRuntimeModels: [],
    mixedModelSessionObserved: null,
    nonRequestedModelUsageObserved: null,
    modelIdentityMismatchObserved: null,
    agentModelPolicyMismatchObserved: null,
    agentModelPolicyMismatchCount: null,
    agentModelPolicyMismatches: [],
    specialistLaneExpected: null,
    requiredSpecialistLanes: [],
    recommendedSpecialistLanes: [],
    observedSpecialistLanes: [],
    missingRequiredSpecialistLanes: [],
    unobservedRecommendedSpecialistLanes: [],
    specialistFanoutObserved: null,
    specialistFanoutPartial: null,
    specialistFanoutCoveredByPatchMaster: null,
    specialistFanoutStatus: null,
    specialistFanoutReason: null,
    patchMasterSwarmObserved: null,
    patchMasterSwarmCount: null,
    githubRepoIdentityMissingObserved: null,
    githubRepoIdentitySource: null,
    githubMemorySuppressedForMissingRepoIdentity: null,
    summaryRouteCountMismatch: null,
    summaryCapabilityCountMismatch: null,
    missingFiles: ["workspace.yaml", "events.jsonl", "process_log"]
  };
}

function renderBoolean(value: boolean | null) {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function renderMatrix(sessions: SessionBundleResult[]) {
  const header =
    "| Session | Truth Source | Updated At | Latest Event At | Start HEAD | End HEAD | Outcome | Outcome Detail | Authority | Finalization | User Abort | Subagent Failure | Terminal Provider Failure | Archive | Validation | External Validation | Validation Conflict | Route | Route Source | Requested Model | Current Model | Observed Models | Mixed Model | Non-Requested Model | Model Identity Mismatch | Agent Model Mismatch | Agent Model Mismatch Count | Repo WT | Committed | Diff Source | Working Tree Clean | Execution Owner | Ownership Leak | Allowed Reason | Transfer | Handoff No Diff | Handoff No Completion | Malformed Payload | Integration | Foundation Assessed | Foundation Unknown | Foundation Risk | Preflight Blocker | Preflight Kind | Bootstrap Failure | Hook Exec Failure | Legacy Hook Conflict | App Foundation Failure | Foundation Classes | Shared Change | Shared Owner | Shared Risk | Shared Review | Final Integrator | Specialist Fanout | Missing Required Specialists | Patch Master Swarm | GitHub Memory Check | PR Context Check | GitHub Repo Identity Missing | GitHub Repo Identity Source | GitHub Memory Suppressed For Missing Identity | Overclaim | Route Mismatch | Capability Mismatch | Missing |";
  const separator = `| ${header
    .split("|")
    .slice(1, -1)
    .map(() => "---")
    .join(" | ")} |`;
  const lines = [
    "# Session Matrix",
    "",
    header,
    separator
  ];
  for (const session of sessions) {
    lines.push(
      `| ${session.sessionId} | ${session.workspaceTruthSource} | ${session.updatedAt ?? "unknown"} | ${session.latestEventAt ?? "unknown"} | ${session.sessionStartHead ?? "unknown"} | ${session.sessionEndHead ?? "unknown"} | ${session.sessionOutcome} | ${session.sessionOutcomeDetail ?? "unknown"} | ${session.summaryAuthority} | ${session.summaryFinalizationStatus} | ${renderBoolean(session.userAbortObserved)} | ${renderBoolean(session.subagentFailureObserved)} | ${renderBoolean(session.terminalProviderFailureObserved)} | ${session.archiveCompleteness} | ${session.validationStatus} | ${session.externalValidationStatus ?? "unknown"} | ${renderBoolean(session.validationStatusConflictObserved)} | ${session.routeSummary ?? "unobserved"} | ${session.routeSummarySource} | ${session.requestedRuntimeModel ?? "unknown"} | ${session.sessionCurrentModel ?? "unknown"} | ${session.observedRuntimeModels.length > 0 ? session.observedRuntimeModels.join(", ") : "none"} | ${renderBoolean(session.mixedModelSessionObserved)} | ${renderBoolean(session.nonRequestedModelUsageObserved)} | ${renderBoolean(session.modelIdentityMismatchObserved)} | ${renderBoolean(session.agentModelPolicyMismatchObserved)} | ${session.agentModelPolicyMismatchCount ?? "unknown"} | ${session.repoWorkingTreeFileCount} | ${session.committedRepoFileCount} | ${session.committedDiffSource ?? "unknown"} | ${renderBoolean(session.workingTreeClean)} | ${session.executionOwner ?? "unknown"} | ${renderBoolean(session.postExecutionOwnershipLeakObserved)} | ${session.ownershipLeakAllowedReason ?? "none"} | ${renderBoolean(session.ownershipTransferredToExecution)} | ${renderBoolean(session.executionHandoffWithoutObservedRepoDiff)} | ${renderBoolean(session.patchMasterHandoffWithoutCompletionObserved)} | ${renderBoolean(session.malformedTaskPayloadObserved)} | ${renderBoolean(session.integrationClassTaskObserved)} | ${renderBoolean(session.foundationReadinessAssessed)} | ${renderBoolean(session.foundationReadinessUnknown)} | ${renderBoolean(session.foundationRiskRaised)} | ${renderBoolean(session.preflightBlockerObserved)} | ${session.preflightBlockerKind ?? "none"} | ${renderBoolean(session.bootstrapFailureObserved)} | ${renderBoolean(session.hookExecutionFailureObserved)} | ${renderBoolean(session.legacyHookPluginConflictObserved)} | ${renderBoolean(session.appFoundationFailureObserved)} | ${session.foundationFailureClasses.length > 0 ? session.foundationFailureClasses.join(", ") : "none"} | ${renderBoolean(session.sharedSurfaceChangeObserved)} | ${renderBoolean(session.sharedSurfaceOwnerDeclared)} | ${renderBoolean(session.sharedSurfaceConflictRisk)} | ${renderBoolean(session.sharedSurfaceReviewRecommended)} | ${renderBoolean(session.sharedSurfaceFinalIntegratorNeeded)} | ${session.specialistFanoutStatus ?? "unknown"} | ${session.missingRequiredSpecialistLanes.length > 0 ? session.missingRequiredSpecialistLanes.join(", ") : "none"} | ${session.patchMasterSwarmCount ?? "unknown"} | ${session.githubMemoryEnabledCheck ?? "unknown"} | ${session.prContextCheck ?? "unknown"} | ${renderBoolean(session.githubRepoIdentityMissingObserved)} | ${session.githubRepoIdentitySource ?? "unknown"} | ${renderBoolean(session.githubMemorySuppressedForMissingRepoIdentity)} | ${renderBoolean(session.validationOverclaimObserved)} | ${renderBoolean(session.summaryRouteCountMismatch)} | ${renderBoolean(session.summaryCapabilityCountMismatch)} | ${session.missingFiles.length > 0 ? session.missingFiles.join(", ") : "none"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv: string[]) {
  const args = { bundleRoot: "", resultsPath: "", matrixPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--bundle-root" && argv[index + 1]) {
      args.bundleRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--results" && argv[index + 1]) {
      args.resultsPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--matrix" && argv[index + 1]) {
      args.matrixPath = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  if (!args.bundleRoot) {
    throw new Error("Usage: tsx scripts/report-session-bundle.ts --bundle-root <path> [--results SESSION_RESULTS.json] [--matrix SESSION_MATRIX.md]");
  }
  args.resultsPath ||= path.join(args.bundleRoot, "SESSION_RESULTS.json");
  args.matrixPath ||= path.join(args.bundleRoot, "SESSION_MATRIX.md");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceFiles = findWorkspaceYamlCandidates(args.bundleRoot);
  const sessions = workspaceFiles.map((workspaceFile) => summarizeWorkspaceYaml(workspaceFile, args.bundleRoot));
  const usedExternalValidationSources = new Set(
    sessions
      .map((session) => session.externalValidationSource)
      .filter((source): source is string => typeof source === "string" && source.length > 0)
  );
  for (const validationDir of findExternalValidationLogDirs(args.bundleRoot)) {
    if (!usedExternalValidationSources.has(validationDir)) {
      sessions.push(summarizeExternalValidationOnly(validationDir));
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    bundleRoot: args.bundleRoot,
    sessionCount: sessions.length,
    sessions
  };
  writeText(args.resultsPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeText(args.matrixPath, renderMatrix(sessions));
  console.log(`Session results JSON: ${args.resultsPath}`);
  console.log(`Session matrix Markdown: ${args.matrixPath}`);
}

main();
