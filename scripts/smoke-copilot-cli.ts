import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveRepoRoot, syncRuntimeSurfaces } from "./lib/runtime-surfaces.js";
import {
  emptyGitHubProbeCache,
  observeGitHubProbeResults,
  resolveGitHubProbePolicy,
  resolveGitHubProbeRepoIdentity,
  type GitHubCapabilityCheck,
  type GitHubCapabilityCheckSource,
  type GitHubProbeCache,
  type GitHubProbeObservation
} from "./lib/github-probe-gating.js";
import {
  buildLspStates,
  buildMcpStates,
  classifyLspEvidence,
  classifyMcpEvidence,
  classifyModifiedFiles,
  captureWorkspaceSnapshot,
  countObservedNames,
  diffWorkspaceSnapshots,
  containsOrderedSubsequence,
  detectAgentIds,
  ensureDir,
  extractCliReportedUsage,
  extractObservedSubagentEvents,
  inspectInstalledPlugin,
  listCommittedFilesBetween,
  loadToolingEnv,
  loadSelectedTooling,
  pluginListedInOutput,
  readGitHead,
  readGitWorkingTreeChanged,
  readJsonIfExists,
  summarizeRouteObservations,
  withCommittedRepoFiles,
  type AgentDetection,
  type CapabilityPath,
  type CliReportedUsage,
  type FileChangeSummary,
  type KnownLspId,
  type LspServerState,
  type McpServerId,
  type McpServerState,
  type ExecutionGroundingObservation,
  type ProofStrength,
  type RouteObservationSummary,
  type ValidationStatus,
  writeText
} from "./lib/runtime-validation.js";
import {
  FRONT_DOOR_MODEL,
  GROUNDING_MODELS,
  MIN_VALIDATED_SCOUT_WAVE_SIZE,
  PLANNING_SCOUT_INITIAL_RANGE,
  PLANNING_SCOUT_WIDEN_TARGET
} from "./lib/runtime-routing-policy.js";
import { renderRuntimeSourceReportMarkdown, resolveRuntimeSourceReport, type RuntimeSourceReport } from "./lib/runtime-source-resolution.js";

type RuntimeCaseKind = "agent" | "mcp" | "lsp";
type RuntimeCaseStatus = "passed" | "failed" | "skipped" | "unproven";

type RuntimeCaseDefinition = {
  id: string;
  title: string;
  kind: RuntimeCaseKind;
  agentLane: AgentDetection["lane"];
  agentCandidates: string[];
  prompt: string;
  capabilityId?: McpServerId | KnownLspId;
  transcriptStem?: string;
  requiredSubagents?: string[];
  expectedSubagentOrder?: string[];
  forbiddenSubagents?: string[];
  minimumSubagentCounts?: Record<string, number>;
  expectedFile?: {
    relativePath: string;
    expectedSubstring: string;
  };
};

type RuntimeCaseResult = {
  id: string;
  title: string;
  kind: RuntimeCaseKind;
  agentLane: AgentDetection["lane"];
  agentId: string | null;
  capabilityId?: string;
  status: RuntimeCaseStatus;
  reason?: string;
  proofStrength: ProofStrength;
  capabilityPath: CapabilityPath;
  transcriptPath: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  hookLogPath: string | null;
  reportedUsage: CliReportedUsage | null;
  reportedChangeSummary: FileChangeSummary | null;
  observedWorkspaceChangeSummary: FileChangeSummary | null;
  executionClaimed: boolean;
  executionClaimWithoutObservedRepoDiff: boolean;
  observedTools: string[];
  observedSubagents: string[];
  observedSubagentCounts: Record<string, number>;
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
  backgroundExecutionAgentIds: string[];
  patchMasterHandoffWithoutCompletionObserved: boolean;
  executionHandoffWithoutObservedRepoDiff: boolean;
  malformedTaskPayloadObserved: boolean;
  postExecutionRootWriteObserved: boolean;
  postExecutionRootPatchObserved: boolean;
  postExecutionRootWriteCount: number;
  executionOwnerActiveRootWriteObserved: boolean;
  executionOwnerActiveRootWriteCount: number;
  executionOwnerActiveRootPatchObserved: boolean;
  integrationClassTaskObserved: boolean;
  largeProductBuildTaskObserved: boolean;
  specialistLaneExpected: boolean;
  requiredSpecialistLanes: string[];
  recommendedSpecialistLanes: string[];
  observedSpecialistLanes: string[];
  missingRequiredSpecialistLanes: string[];
  missingRecommendedSpecialistLanes: string[];
  unobservedRecommendedSpecialistLanes: string[];
  specialistFanoutObserved: boolean;
  specialistFanoutPartial: boolean;
  patchMasterSwarmObserved: boolean;
  patchMasterSwarmCount: number;
  specialistFanoutCoveredByPatchMaster: boolean;
  specialistFanoutStatus: string;
  specialistFanoutReason: string | null;
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
  routeConfidence: ProofStrength;
  observedRuntimeModels: string[];
  requestedRuntimeModel: string | null;
  sessionCurrentModel: string | null;
  mixedModelSessionObserved: boolean;
  nonRequestedModelUsageObserved: boolean;
  agentModelPolicyMismatchObserved: boolean;
  agentModelPolicyMismatchCount: number;
  agentModelPolicyMismatches: string[];
  sessionStartHead?: string | null;
  sessionEndHead?: string | null;
  evidenceNotes: string[];
  processLogPath: string | null;
};

type RuntimeValidationReport = {
  generatedAt: string;
  repoRoot: string;
  tempWorkspace: string | null;
  environment: {
    platform: NodeJS.Platform;
    nodeVersion: string;
    copilotBinary: string;
    copilotAvailable: boolean;
    copilotVersion: string | null;
  };
  structural: {
    status: ValidationStatus;
    notes: string[];
  };
  plugin: {
    name: string;
    installStatus: ValidationStatus;
    visibleInPluginList: boolean;
    registeredInCopilotConfig: boolean;
    cachedPluginPath: string | null;
    cachePathExists: boolean;
    copilotConfigPath: string | null;
    installStdoutPath: string | null;
    installStderrPath: string | null;
    pluginListStdoutPath: string | null;
    pluginListStderrPath: string | null;
    notes: string[];
  };
  runtimeSources: {
    jsonPath: string | null;
    mdPath: string | null;
    details: RuntimeSourceReport | null;
  };
  selections: {
    selectedToolingPath: string;
    selectedMcpServers: string[];
    selectedLspServers: string[];
  };
  localUsage: {
    casesWithReportedUsage: number;
    reportedPremiumRequests: number;
    reportedApiDurationMs: number;
    casesWithObservedRepoChanges: number;
    casesWithOnlySessionStateChanges: number;
    casesWithExecutionClaimWithoutObservedRepoDiff: number;
    notes: string[];
  };
  mcpServers: Array<McpServerState & { runtimeCaseId?: string }>;
  lspServers: Array<LspServerState & { runtimeCaseId?: string }>;
  agents: AgentDetection[];
  cases: RuntimeCaseResult[];
  overall: {
    status: ValidationStatus;
    summary: string;
  };
};

const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));
const copilotBin = process.env.COPILOT_BIN || "copilot";

function parseArgs(argv: string[]) {
  const args = { reportJson: "", reportMd: "" };
  const jsonIndex = argv.indexOf("--report");
  const mdIndex = argv.indexOf("--report-md");
  args.reportJson =
    jsonIndex >= 0 && argv[jsonIndex + 1]
      ? path.resolve(argv[jsonIndex + 1])
      : path.join(repoRoot, ".xgc", "validation", "runtime-validation.json");
  args.reportMd =
    mdIndex >= 0 && argv[mdIndex + 1]
      ? path.resolve(argv[mdIndex + 1])
      : path.join(repoRoot, ".xgc", "validation", "runtime-validation.md");
  return args;
}

function log(message: string) {
  console.log(message);
}

function commandAvailable(command: string) {
  return spawnSync("bash", ["-lc", `command -v '${command.replace(/'/g, `'\\''`)}'`], {
    encoding: "utf8"
  }).status === 0;
}

function resolveRepoIdentity(root: string) {
  const topLevel = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const repoPath = topLevel.status === 0 ? topLevel.stdout.trim() : path.resolve(root);
  const remote = spawnSync("git", ["-C", repoPath, "config", "--get", "remote.origin.url"], { encoding: "utf8" });
  const remoteUrl = remote.status === 0 ? remote.stdout.trim() : "";
  return resolveGitHubProbeRepoIdentity({ remoteUrl, repoPath });
}

function readTextIfExists(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function writeProcessArtifacts(
  artifactRoot: string,
  stem: string,
  result: SpawnSyncReturns<string>
) {
  ensureDir(artifactRoot);
  const stdoutPath = path.join(artifactRoot, `${stem}.stdout.txt`);
  const stderrPath = path.join(artifactRoot, `${stem}.stderr.txt`);
  writeText(stdoutPath, `${result.stdout ?? ""}`);
  writeText(stderrPath, `${result.stderr ?? ""}`);
  return { stdoutPath, stderrPath };
}

function emptyRouteSummary(): RouteObservationSummary {
  return {
    routeAgents: [],
    routeSummary: null,
    keyAgents: [],
    observedPlanningChain: [],
    routeSummarySource: "name_list_fallback",
    directToolExecutionObserved: false,
    toolExecutionCount: 0,
    writeToolCount: 0,
    bashToolCount: 0,
    sessionShutdownObserved: false,
    sessionShutdownCodeChangesObserved: false,
    sessionShutdownFilesModified: [],
    sessionShutdownLinesAdded: null,
    sessionShutdownLinesRemoved: null,
    observedFrontDoorHandledDirectly: null,
    observedScoutCount: 0,
    repoScoutInvocationCount: 0,
    triageInvocationCount: 0,
    patchMasterInvocationCount: 0,
    requiredCheckInvocationCount: 0,
    builtInGenericAgentInvocationCount: 0,
    triageDuplicateObserved: false,
    triageDuplicateAllowedReason: null,
    executionReadyHandoffSeenBeforeSecondTriage: false,
    observedPlannerBeforeExecutor: null,
    observedTriageBeforeExecutor: null,
    observedRefIndex: false,
    observedGroundingBeforeExecutor: "unproven",
    observedExecutionPhasePure: null,
    postExecutionPlannerReopenAgents: [],
    postExecutionGenericAgentObserved: false,
    postExecutionBuiltInAgentObserved: false,
    postExecutionGenericAgents: [],
    postExecutionBuiltInAgents: [],
    postExecutionOwnershipLeakObserved: false,
    ownershipLeakAllowedReason: null,
    executionOwner: null,
    ownershipTransferredToExecution: false,
    backgroundExecutionAgentObserved: false,
    backgroundExecutionAgentUnresolved: false,
    backgroundAgentUnresolvedObserved: false,
    backgroundAgentUnresolvedIds: [],
    backgroundExecutionAgentIds: [],
    backgroundAgentsStarted: [],
    backgroundAgentsCompleted: [],
    backgroundAgentsRead: [],
    blockingBackgroundAgentsUnresolved: [],
    executionOwnerAgentId: null,
    executionOwnerResultRead: false,
    executionOwnerBlockedObserved: false,
    finalizedBeforeExecutionOwnerRead: false,
    postExecutionCompletionGapObserved: false,
    patchMasterHandoffWithoutCompletionObserved: false,
    executionHandoffWithoutObservedRepoDiff: false,
    malformedTaskPayloadObserved: false,
    interactiveCommandHangObserved: false,
    interactiveCommandHangCommands: [],
    missingBuiltInAgentObserved: false,
    missingBuiltInAgentNames: [],
    postExecutionRootWriteObserved: false,
    postExecutionRootPatchObserved: false,
    postExecutionRootWriteCount: 0,
    executionOwnerActiveRootWriteObserved: false,
    executionOwnerActiveRootWriteCount: 0,
    executionOwnerActiveRootPatchObserved: false,
    integrationClassTaskObserved: false,
    largeProductBuildTaskObserved: false,
    specialistLaneExpected: false,
    requiredSpecialistLanes: [],
    recommendedSpecialistLanes: [],
    observedSpecialistLanes: [],
    missingRequiredSpecialistLanes: [],
    missingRecommendedSpecialistLanes: [],
    unobservedRecommendedSpecialistLanes: [],
    specialistFanoutObserved: false,
    specialistFanoutPartial: false,
    patchMasterSwarmObserved: false,
    patchMasterSwarmCount: 0,
    specialistFanoutCoveredByPatchMaster: false,
    specialistFanoutStatus: "not_applicable",
    specialistFanoutReason: null,
    foundationReadinessAssessed: false,
    foundationReadinessUnknown: false,
    foundationRiskRaised: false,
    repeatedFoundationFailureObserved: false,
    foundationRecoverySuggested: false,
    foundationFailureClasses: [],
    foundationRecoveryReason: null,
    bootstrapFailureObserved: false,
    runtimeConfigMismatchObserved: false,
    toolingMaterializationFailureObserved: false,
    legacyHookPluginConflictObserved: false,
    hookExecutionFailureObserved: false,
    copilotAuthFailureObserved: false,
    copilotModelListFailureObserved: false,
    copilotPolicyFailureObserved: false,
    preflightBlockerObserved: false,
    preflightBlockerKind: null,
    preflightBlockerReason: null,
    appFoundationFailureObserved: false,
    validationPortConflictObserved: false,
    validationServerReadinessFailureObserved: false,
    githubMemoryEnabledProbe: "unproven",
    githubMemoryPromptProbe: "unproven",
    prLookup: "unproven",
    githubMemoryEnabledCheck: "allowed_but_unobserved",
    githubMemoryEnabledCheckCached: false,
    githubMemoryEnabledCheckCount: 0,
    githubMemoryEnabledCheckSource: "policy_only",
    githubMemoryEnabledFreshAfterCacheObserved: false,
    prContextCheck: "allowed_but_unobserved",
    prContextCheckCached: false,
    prContextCheckCount: 0,
    prContextCheckSource: "policy_only",
    prContextFreshAfterCacheObserved: false,
    prLookupCheck: "allowed_but_unobserved",
    prLookupCheckCached: false,
    prLookupCheckSource: "policy_only",
    githubCapabilityCacheHits: 0,
    githubCapabilityCacheMisses: 0,
    githubRepoIdentityMissingObserved: false,
    githubRepoIdentitySource: "not-observed",
    githubMemorySuppressedForMissingRepoIdentity: false,
    observedMemoryProbeSuppressed: false,
    observedPrProbeSuppressed: false,
    providerRetryObserved: false,
    providerRetryActive: false,
    providerRetryState: "not-observed",
    providerRetryRecovered: null,
    providerRetryCount: 0,
    providerRetryReason: null,
    lastProviderTransportError: null,
    lastProviderRetryAt: null,
    activeAgentDuringRetry: null,
    providerRetryConfidence: "unproven",
    modelRateLimitObserved: false,
    modelRateLimitCount: 0,
    provider502Observed: false,
    provider502Count: 0,
    routeConfidence: "unproven",
    observedRuntimeModels: [],
    postPromptObservedRuntimeModels: [],
    observedAgentToolModels: [],
    observedModelMetricModels: [],
    requestedRuntimeModel: null,
    sessionCurrentModel: null,
    mixedModelSessionObserved: false,
    nonRequestedModelUsageObserved: false,
    agentModelPolicyMismatchObserved: false,
    agentModelPolicyMismatchCount: 0,
    agentModelPolicyMismatches: []
  };
}

function listProcessLogs(logRoot: string) {
  if (!fs.existsSync(logRoot)) return [];
  return fs
    .readdirSync(logRoot)
    .filter((entry) => entry.startsWith("process-") && entry.endsWith(".log"))
    .map((entry) => path.join(logRoot, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function copyWorkspace(source: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-runtime-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const ignored = new Set([".git", "node_modules", ".tmp", "coverage"]);
  const omitFromXgc = new Set(["logs", "validation"]);

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(workspaceRoot, entry.name);

    if (entry.name === ".xgc" && entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      for (const child of fs.readdirSync(sourcePath, { withFileTypes: true })) {
        if (omitFromXgc.has(child.name)) continue;
        fs.cpSync(path.join(sourcePath, child.name), path.join(targetPath, child.name), {
          recursive: true,
          force: true
        });
      }
      continue;
    }

    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
  }

  return { tempDir, workspaceRoot };
}

function createValidationFixtures(workspaceRoot: string) {
  const fixtureRoot = path.join(workspaceRoot, "validation-fixtures");
  ensureDir(path.join(fixtureRoot, "typescript"));
  ensureDir(path.join(fixtureRoot, "config"));
  ensureDir(path.join(fixtureRoot, "shell"));
  ensureDir(path.join(fixtureRoot, "python"));
  ensureDir(path.join(fixtureRoot, "go"));
  ensureDir(path.join(fixtureRoot, "rust"));

  writeText(
    path.join(fixtureRoot, "typescript", "user-types.ts"),
    `export type User = {\n  id: string;\n  name: string;\n  email?: string;\n};\n\nexport function formatUser(user: User) {\n  return \`\${user.id}:\${user.name}\`;\n}\n`
  );
  writeText(
    path.join(fixtureRoot, "typescript", "app.ts"),
    `import { formatUser, type User } from "./user-types";\n\nconst validUser: User = { id: "u1", name: "Ada" };\nconst brokenUser: User = { id: 42, name: "Lin" };\n\nconsole.log(formatUser(validUser));\nconsole.log(formatUser(brokenUser));\n`
  );
  writeText(
    path.join(fixtureRoot, "config", "service.json"),
    `{\n  "service": {\n    "name": "runtime-check",\n    "timeoutMs": "5000",\n    "features": {\n      "docs": true,\n      "search": true,\n      "shell": false\n    }\n  }\n}\n`
  );
  writeText(
    path.join(fixtureRoot, "config", "service.yaml"),
    `service:\n  name: runtime-check\n  timeoutMs: 5000\n  features:\n    docs: true\n    search: true\n    shell: true\n`
  );
  writeText(
    path.join(fixtureRoot, "shell", "common.sh"),
    `load_config() {\n  local channel=\"\${RELEASE_CHANNEL:-nightly}\"\n  printf '%s' \"$channel\"\n}\n`
  );
  writeText(
    path.join(fixtureRoot, "shell", "release.sh"),
    `#!/usr/bin/env bash\nset -euo pipefail\nsource \"$(dirname \"$0\")/common.sh\"\nCHANNEL=\"$(load_config)\"\nprintf 'release-%s\\n' \"$CHANNEL\"\n`
  );
  writeText(
    path.join(fixtureRoot, "python", "app.py"),
    `from typing import TypedDict\n\nclass User(TypedDict):\n    id: str\n    name: str\n\ndef format_user(user: User) -> str:\n    return f\"{user['id']}:{user['name']}\"\n\nbroken_user: User = {\"id\": 42, \"name\": \"Lin\"}\nprint(format_user(broken_user))\n`
  );
  writeText(
    path.join(fixtureRoot, "go", "main.go"),
    `package main\n\nimport "fmt"\n\nfunc formatUser(id string, name string) string {\n\treturn fmt.Sprintf(\"%s:%s\", id, name)\n}\n\nfunc main() {\n\tfmt.Println(formatUser(\"u1\", \"Ada\"))\n}\n`
  );
  writeText(
    path.join(fixtureRoot, "rust", "main.rs"),
    `fn format_user(id: &str, name: &str) -> String {\n    format!(\"{}:{}\", id, name)\n}\n\nfn main() {\n    let output = format_user(\"u1\", \"Ada\");\n    println!(\"{}\", output);\n}\n`
  );
}

function initializeGitBaseline(workspaceRoot: string) {
  if (fs.existsSync(path.join(workspaceRoot, ".git"))) {
    return readGitHead(workspaceRoot);
  }
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["add", "-A"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "runtime validation baseline"], { cwd: workspaceRoot, stdio: "ignore" });
  return readGitHead(workspaceRoot);
}

function runCopilot(
  workspaceRoot: string,
  copilotArgs: string[],
  hookLogRoot: string,
  env: NodeJS.ProcessEnv = {}
) {
  return spawnSync(
    "bash",
    [path.join(workspaceRoot, "scripts/use-xgc-env.sh"), copilotBin, ...copilotArgs],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        ...env,
        XGC_LOG_ROOT: hookLogRoot,
        COPILOT_HOME: path.join(workspaceRoot, ".xgc", "copilot-home")
      }
    }
  );
}

function authLikeFailure(stdout: string, stderr: string) {
  return /not authenticated|authentication required|authentication failed|login required|please log in|sign in|unauthorized|forbidden|\b401\b|\b403\b|gh auth/i.test(
    `${stdout}\n${stderr}`
  );
}

function buildCoreCases(agentMap: AgentDetection[]): RuntimeCaseDefinition[] {
  const byLane = Object.fromEntries(agentMap.map((entry) => [entry.lane, entry])) as Record<
    AgentDetection["lane"],
    AgentDetection
  >;

  return [
    {
      id: "front-door-routing",
      title: "front door can answer bounded repository orientation without execution",
      kind: "agent",
      agentLane: "front-door",
      agentCandidates: byLane["front-door"].candidates,
      prompt:
        "Answer this simple repo question directly if you already know it from the workspace: identify the MCP config file, the LSP config file, and the canonical source directories for agents and skills in this workspace. Return exactly four bullets. Do not edit files. Do not escalate into deep planning or execution unless that is clearly unnecessary to answer.",
      forbiddenSubagents: ["Patch Master", "Required Check"]
    },
    {
      id: "docs-heavy-entry",
      title: "front door can send docs-heavy questions through Ref Index before execution",
      kind: "agent",
      agentLane: "front-door",
      agentCandidates: byLane["front-door"].candidates,
      prompt:
        "This is a docs-heavy question. Before planning or coding, compress the runtime validation workflow in this repository into five bullets, with the exact docs or script files that matter most. Prefer the reference-compression lane if it is useful. Do not edit files.",
      requiredSubagents: ["Ref Index"],
      forbiddenSubagents: ["Milestone", "Triage", "Patch Master", "Required Check"]
    },
    {
      id: "planning-cold-start",
      title: "front door routes cold-start work through grounding before Milestone and Triage",
      kind: "agent",
      agentLane: "front-door",
      agentCandidates: byLane["front-door"].candidates,
      prompt:
        `I need to modify this unfamiliar repo but I do not yet know the right files. First ground the repo, then produce an execution-ready plan only for aligning the validation-fixtures TypeScript and config examples. Use ${PLANNING_SCOUT_INITIAL_RANGE[0]} to ${PLANNING_SCOUT_INITIAL_RANGE[1]} Repo Scout tasks when the work benefits from sharding, and widen toward ${PLANNING_SCOUT_WIDEN_TARGET} only if the search is still broad and shardable. Ground the repo before asking questions. Do not implement. Do not edit files.`,
      requiredSubagents: ["Milestone", "Repo Scout", "Triage"],
      expectedSubagentOrder: ["Repo Scout", "Milestone", "Triage"],
      forbiddenSubagents: ["Patch Master"],
      minimumSubagentCounts: {
        "Repo Scout": MIN_VALIDATED_SCOUT_WAVE_SIZE
      }
    },
    {
      id: "scout-discovery",
      title: "scout lane can do bounded repository discovery",
      kind: "agent",
      agentLane: "scout",
      agentCandidates: byLane.scout.candidates,
      prompt:
        "List the validation-fixtures files that matter for the TypeScript validation case and tell me where formatUser is defined. Keep it to four bullets. Do not edit files."
    },
    {
      id: "docs-reference",
      title: "docs/reference lane can summarize bootstrap records",
      kind: "agent",
      agentLane: "docs",
      agentCandidates: byLane.docs.candidates,
      prompt:
        "Summarize how this workspace records selected MCP and LSP bootstrap choices. Mention the exact file path and keep it to three bullets. Do not edit files."
    },
    {
      id: "deep-implementation",
      title: "deep implementation lane can perform a bounded patch",
      kind: "agent",
      agentLane: "deep",
      agentCandidates: byLane.deep.candidates,
      prompt:
        [
          "You are receiving a grounded execution packet.",
          "Objective: create validation-fixtures/notes/runtime-check.md containing exactly one line: patch-master validation complete.",
          "Constraints: edit only validation-fixtures/notes/runtime-check.md; do not touch source/, docs/, or scripts/.",
          "Candidate files: validation-fixtures/notes/runtime-check.md.",
          "References: follow the existing validation-fixtures folder layout and keep the change surgical.",
          "Acceptance criteria: the file exists, contains the exact required line, and no unrelated files change.",
          "Must-not-do: no extra lines, no unrelated edits, no planning detour.",
          "Verification expectations: confirm the exact file content and then stop."
        ].join(" "),
      expectedFile: {
        relativePath: "validation-fixtures/notes/runtime-check.md",
        expectedSubstring: "patch-master validation complete"
      }
    }
  ];
}

function buildMcpCases(mcpStates: McpServerState[], agentMap: AgentDetection[]): RuntimeCaseDefinition[] {
  const docsLane = agentMap.find((agent) => agent.lane === "docs")!;
  const scoutLane = agentMap.find((agent) => agent.lane === "scout")!;
  const frontDoor = agentMap.find((agent) => agent.lane === "front-door")!;
  const cases: RuntimeCaseDefinition[] = [];

  if (mcpStates.find((state) => state.id === "context7" && state.configured)) {
    cases.push({
      id: "mcp-context7",
      title: "documentation lookup capability",
      kind: "mcp",
      capabilityId: "context7",
      agentLane: "docs",
      agentCandidates: docsLane.candidates,
      prompt:
        "Explain what the typescript-language-server --stdio transport does and why an editor integration needs it. Use external documentation if it helps, and say which tool or source you actually used. Do not edit files."
    });
  }

  if (mcpStates.find((state) => state.id === "grep_app" && state.configured)) {
    cases.push({
      id: "mcp-grep-app",
      title: "public code search capability",
      kind: "mcp",
      capabilityId: "grep_app",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "Find two public open-source examples that run typescript-language-server with --stdio. Use external code search if it helps, and say which tool you actually used. Summarize the repository names and the command shape. Do not edit files."
    });
  }

  if (mcpStates.find((state) => state.id === "websearch" && state.configured)) {
    cases.push({
      id: "mcp-websearch",
      title: "recent external lookup capability",
      kind: "mcp",
      capabilityId: "websearch",
      agentLane: "front-door",
      agentCandidates: frontDoor.candidates,
      prompt:
        "Find one recent external reference about GitHub Copilot CLI hooks or plugin install behavior. Use external search if it helps, quote one concrete detail, and include the source URL. Do not edit files."
    });
  }

  return cases;
}

function buildLspCases(lspStates: LspServerState[], agentMap: AgentDetection[]): RuntimeCaseDefinition[] {
  const scoutLane = agentMap.find((agent) => agent.lane === "scout")!;
  const docsLane = agentMap.find((agent) => agent.lane === "docs")!;
  const cases: RuntimeCaseDefinition[] = [];

  if (lspStates.find((state) => state.id === "typescript-language-server" && state.configured)) {
    cases.push({
      id: "lsp-typescript",
      title: "TypeScript code-aware symbol and diagnostic probe",
      kind: "lsp",
      capabilityId: "typescript-language-server",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "Find the definition and uses of formatUser in validation-fixtures/typescript, then explain in four bullets why brokenUser violates the User type. Use code-aware navigation or diagnostics if helpful, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "vscode-json-language-server" && state.configured)) {
    cases.push({
      id: "lsp-json",
      title: "JSON config-shape probe",
      kind: "lsp",
      capabilityId: "vscode-json-language-server",
      agentLane: "docs",
      agentCandidates: docsLane.candidates,
      prompt:
        "Inspect validation-fixtures/config/service.json. Explain the shape of service, identify the timeoutMs value, and note any type inconsistencies you see. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "yaml-language-server" && state.configured)) {
    cases.push({
      id: "lsp-yaml",
      title: "YAML config-shape probe",
      kind: "lsp",
      capabilityId: "yaml-language-server",
      agentLane: "docs",
      agentCandidates: docsLane.candidates,
      prompt:
        "Inspect validation-fixtures/config/service.yaml. Explain the shape of service, identify the timeoutMs value, and note any feature flag differences from the JSON variant if relevant. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "bash-language-server" && state.configured)) {
    cases.push({
      id: "lsp-bash",
      title: "Bash shell-analysis probe",
      kind: "lsp",
      capabilityId: "bash-language-server",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "In validation-fixtures/shell/release.sh, explain where load_config is defined, how RELEASE_CHANNEL is resolved, and which command prints the final tag. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "pyright" && state.configured)) {
    cases.push({
      id: "lsp-pyright",
      title: "Python type-analysis probe",
      kind: "lsp",
      capabilityId: "pyright",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "Inspect validation-fixtures/python/app.py and explain why broken_user violates the User TypedDict. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "gopls" && state.configured)) {
    cases.push({
      id: "lsp-gopls",
      title: "Go symbol probe",
      kind: "lsp",
      capabilityId: "gopls",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "Inspect validation-fixtures/go/main.go, identify where formatUser is defined, and summarize its parameters and call site. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  if (lspStates.find((state) => state.id === "rust-analyzer" && state.configured)) {
    cases.push({
      id: "lsp-rust-analyzer",
      title: "Rust symbol probe",
      kind: "lsp",
      capabilityId: "rust-analyzer",
      agentLane: "scout",
      agentCandidates: scoutLane.candidates,
      prompt:
        "Inspect validation-fixtures/rust/main.rs, identify the signature of format_user and how main uses it. Use code-aware analysis if it helps, and say what you actually used. Do not edit files."
    });
  }

  return cases;
}

function renderMarkdown(report: RuntimeValidationReport) {
  const lines: string[] = [];
  const formatObservedFiles = (files: string[] | null) => {
    if (files === null) {
      return "unobserved";
    }
    return files.length > 0 ? files.join(", ") : "none";
  };

  lines.push("# Runtime Validation");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Repo root: ${report.repoRoot}`);
  lines.push(`- Temporary workspace: ${report.tempWorkspace ?? "n/a"}`);
  lines.push(`- Copilot binary: ${report.environment.copilotBinary}`);
  lines.push(`- Copilot available: ${report.environment.copilotAvailable ? "yes" : "no"}`);
  if (report.environment.copilotVersion) {
    lines.push(`- Copilot version: ${report.environment.copilotVersion}`);
  }
  lines.push(
    `- Model policy intent: Repo Master follows the active root model (default ${FRONT_DOOR_MODEL}); grounding lanes resolve through parent-aware policy (${GROUNDING_MODELS.join(" / ")})`
  );
  lines.push(`- Overall status: ${report.overall.status}`);
  lines.push(`- Summary: ${report.overall.summary}`);
  lines.push("");

  lines.push("## Plugin");
  lines.push("");
  lines.push(`- Install status: ${report.plugin.installStatus}`);
  lines.push(`- Visible in plugin list: ${report.plugin.visibleInPluginList ? "yes" : "no"}`);
  lines.push(`- Registered in active Copilot config: ${report.plugin.registeredInCopilotConfig ? "yes" : "no"}`);
  if (report.plugin.copilotConfigPath) {
    lines.push(`- Copilot config path: ${report.plugin.copilotConfigPath}`);
  }
  if (report.plugin.cachedPluginPath) {
    lines.push(`- Cached plugin path: ${report.plugin.cachedPluginPath}`);
    lines.push(`- Cached plugin path exists: ${report.plugin.cachePathExists ? "yes" : "no"}`);
  }
  if (report.plugin.notes.length > 0) {
    lines.push("- Plugin notes:");
    for (const note of report.plugin.notes) {
      lines.push(`  - ${note}`);
    }
  }
  lines.push("");

  lines.push("## Active Runtime Sources");
  lines.push("");
  if (report.runtimeSources.details) {
    lines.push(`- Active COPILOT_HOME: ${report.runtimeSources.details.copilotHome}`);
    lines.push(`- X for GitHub Copilot profile active: ${report.runtimeSources.details.xgcProfileActive ? "yes" : "no"}`);
    lines.push(`- Operator mode: ${report.runtimeSources.details.operatorModeExplanation}`);
    lines.push(`- Precedence: ${report.runtimeSources.details.precedenceSummary}`);
    if (report.runtimeSources.details.copilotConfigPath) {
      lines.push(`- Copilot config path: ${report.runtimeSources.details.copilotConfigPath}`);
    }
    if (report.runtimeSources.jsonPath) {
      lines.push(`- Surface report JSON: ${report.runtimeSources.jsonPath}`);
    }
    if (report.runtimeSources.mdPath) {
      lines.push(`- Surface report Markdown: ${report.runtimeSources.mdPath}`);
    }
    lines.push("");
    lines.push("| Type | Id | Winner | Winner name | Winner model | Winner path | Shadowed copies |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const entry of [...report.runtimeSources.details.agents, ...report.runtimeSources.details.skills]) {
      lines.push(
        `| ${entry.kind} | ${entry.id} | ${entry.winner?.layer ?? "missing"} | ${entry.winner?.displayName ?? "n/a"} | ${entry.winner?.model ?? "n/a"} | ${entry.winner?.path ?? "n/a"} | ${
          entry.shadowed.length > 0 ? entry.shadowed.map((item) => `${item.layer}: ${item.path}`).join("<br>") : "none"
        } |`
      );
    }
  } else {
    lines.push("- Runtime source resolution was unavailable for this run.");
  }
  lines.push("");

  lines.push("## MCP Servers");
  lines.push("");
  lines.push("| Server | Selected | Configured | Credential status | Runtime case |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const server of report.mcpServers) {
    lines.push(
      `| ${server.id} | ${server.selected ? "yes" : "no"} | ${server.configured ? "yes" : "no"} | ${server.credentialStatus} | ${server.runtimeCaseId ?? "n/a"} |`
    );
  }
  lines.push("");

  lines.push("## LSP Servers");
  lines.push("");
  lines.push("| Server | Selected | Configured | Binary status | Runtime case |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const server of report.lspServers) {
    lines.push(
      `| ${server.id} | ${server.selected ? "yes" : "no"} | ${server.configured ? "yes" : "no"} | ${server.binaryProbe.status} | ${server.runtimeCaseId ?? "n/a"} |`
    );
  }
  lines.push("");

  lines.push("## Local CLI Usage");
  lines.push("");
  lines.push(`- Cases with CLI-reported usage: ${report.localUsage.casesWithReportedUsage}`);
  lines.push(`- Summed CLI-reported premium requests: ${report.localUsage.reportedPremiumRequests}`);
  lines.push(`- Summed CLI-reported API duration: ${report.localUsage.reportedApiDurationMs} ms`);
  lines.push(`- Cases with observed repo working-tree changes: ${report.localUsage.casesWithObservedRepoChanges}`);
  lines.push(`- Cases with only session-state changes observed: ${report.localUsage.casesWithOnlySessionStateChanges}`);
  lines.push(
    `- Cases with execution claim but no observed repo diff: ${report.localUsage.casesWithExecutionClaimWithoutObservedRepoDiff}`
  );
  if (report.localUsage.notes.length > 0) {
    lines.push("- Notes:");
    for (const note of report.localUsage.notes) {
      lines.push(`  - ${note}`);
    }
  }
  lines.push("");

  lines.push("## Runtime Cases");
  lines.push("");
  for (const runtimeCase of report.cases) {
    lines.push(`### ${runtimeCase.id}`);
    lines.push("");
    lines.push(`- Title: ${runtimeCase.title}`);
    lines.push(`- Status: ${runtimeCase.status}`);
    lines.push(`- Proof strength: ${runtimeCase.proofStrength}`);
    lines.push(`- Capability path: ${runtimeCase.capabilityPath}`);
    lines.push(`- Route confidence: ${runtimeCase.routeConfidence}`);
    lines.push(`- Agent lane: ${runtimeCase.agentLane}`);
    lines.push(`- Agent id: ${runtimeCase.agentId ?? "missing"}`);
    if (runtimeCase.capabilityId) {
      lines.push(`- Capability: ${runtimeCase.capabilityId}`);
    }
    if (runtimeCase.reason) {
      lines.push(`- Reason: ${runtimeCase.reason}`);
    }
    if (runtimeCase.transcriptPath) {
      lines.push(`- Transcript: ${runtimeCase.transcriptPath}`);
    }
    if (runtimeCase.stdoutPath) {
      lines.push(`- Stdout: ${runtimeCase.stdoutPath}`);
    }
    if (runtimeCase.stderrPath) {
      lines.push(`- Stderr: ${runtimeCase.stderrPath}`);
    }
    if (runtimeCase.processLogPath) {
      lines.push(`- Process log: ${runtimeCase.processLogPath}`);
    }
    if (runtimeCase.hookLogPath) {
      lines.push(`- Hook log snapshot: ${runtimeCase.hookLogPath}`);
    }
    if (runtimeCase.observedTools.length > 0) {
      lines.push(`- Observed tools: ${runtimeCase.observedTools.join(", ")}`);
    }
    if (runtimeCase.observedRuntimeModels.length > 0) {
      lines.push(`- Observed runtime models: ${runtimeCase.observedRuntimeModels.join(" -> ")}`);
    }
    if (
      runtimeCase.requestedRuntimeModel ||
      runtimeCase.sessionCurrentModel ||
      runtimeCase.mixedModelSessionObserved ||
      runtimeCase.nonRequestedModelUsageObserved
    ) {
      lines.push(`- Requested runtime model: ${runtimeCase.requestedRuntimeModel ?? "not observed"}`);
      lines.push(`- Current runtime model: ${runtimeCase.sessionCurrentModel ?? "not observed"}`);
      lines.push(`- Mixed model session observed: ${runtimeCase.mixedModelSessionObserved ? "yes" : "no"}`);
      lines.push(
        `- Non-requested model usage observed: ${runtimeCase.nonRequestedModelUsageObserved ? "yes" : "no"}`
      );
      lines.push(
        `- Agent model policy mismatch observed: ${runtimeCase.agentModelPolicyMismatchObserved ? "yes" : "no"}`
      );
      if (runtimeCase.agentModelPolicyMismatches.length > 0) {
        lines.push(`- Agent model policy mismatches: ${runtimeCase.agentModelPolicyMismatches.join("; ")}`);
      }
    }
    if (runtimeCase.observedSubagents.length > 0) {
      lines.push(`- Observed subagents: ${runtimeCase.observedSubagents.join(" -> ")}`);
    }
    if (runtimeCase.routeAgents.length > 0) {
      lines.push(`- Route agents: ${runtimeCase.routeAgents.join(" -> ")}`);
    }
    if (runtimeCase.routeSummary) {
      lines.push(`- Route summary: ${runtimeCase.routeSummary}`);
    }
    if (runtimeCase.keyAgents.length > 0) {
      lines.push(`- Key agents: ${runtimeCase.keyAgents.join(" -> ")}`);
    }
    if (runtimeCase.observedPlanningChain.length > 0) {
      lines.push(`- Observed planning chain: ${runtimeCase.observedPlanningChain.join(" -> ")}`);
    }
    lines.push(`- Route summary source: ${runtimeCase.routeSummarySource}`);
    if (Object.keys(runtimeCase.observedSubagentCounts).length > 0) {
      lines.push(
        `- Observed subagent counts: ${Object.entries(runtimeCase.observedSubagentCounts)
          .map(([name, count]) => `${name}=${count}`)
          .join(", ")}`
      );
    }
    lines.push(
      `- Observed front door handled directly: ${
        runtimeCase.observedFrontDoorHandledDirectly === null ? "unproven" : runtimeCase.observedFrontDoorHandledDirectly ? "yes" : "no"
      }`
    );
    lines.push(`- Observed scout count: ${runtimeCase.observedScoutCount}`);
    lines.push(`- Repo Scout invocation count: ${runtimeCase.repoScoutInvocationCount}`);
    lines.push(`- Triage invocation count: ${runtimeCase.triageInvocationCount}`);
    lines.push(`- Patch Master invocation count: ${runtimeCase.patchMasterInvocationCount}`);
    lines.push(`- Required Check invocation count: ${runtimeCase.requiredCheckInvocationCount}`);
    lines.push(`- Built-in generic agent invocation count: ${runtimeCase.builtInGenericAgentInvocationCount}`);
    lines.push(`- Duplicate Triage observed: ${runtimeCase.triageDuplicateObserved ? "yes" : "no"}`);
    lines.push(
      `- Execution-ready handoff seen before second Triage: ${
        runtimeCase.executionReadyHandoffSeenBeforeSecondTriage ? "yes" : "no"
      }`
    );
    if (runtimeCase.triageDuplicateAllowedReason) {
      lines.push(`- Duplicate Triage allowed reason: ${runtimeCase.triageDuplicateAllowedReason}`);
    }
    lines.push(
      `- Observed planner before executor: ${
        runtimeCase.observedPlannerBeforeExecutor === null ? "n/a" : runtimeCase.observedPlannerBeforeExecutor ? "yes" : "no"
      }`
    );
    lines.push(
      `- Observed Triage before executor: ${
        runtimeCase.observedTriageBeforeExecutor === null ? "n/a" : runtimeCase.observedTriageBeforeExecutor ? "yes" : "no"
      }`
    );
    lines.push(`- Observed Ref Index: ${runtimeCase.observedRefIndex ? "yes" : "no"}`);
    lines.push(`- Observed grounding before executor: ${runtimeCase.observedGroundingBeforeExecutor}`);
    lines.push(
      `- Observed execution phase pure: ${
        runtimeCase.observedExecutionPhasePure === null ? "n/a" : runtimeCase.observedExecutionPhasePure ? "yes" : "no"
      }`
    );
    if (runtimeCase.postExecutionPlannerReopenAgents.length > 0) {
      lines.push(`- Post-execution planner/reference reopen: ${runtimeCase.postExecutionPlannerReopenAgents.join(", ")}`);
    }
    lines.push(`- Post-execution generic agent observed: ${runtimeCase.postExecutionGenericAgentObserved ? "yes" : "no"}`);
    lines.push(`- Post-execution built-in agent observed: ${runtimeCase.postExecutionBuiltInAgentObserved ? "yes" : "no"}`);
    if (runtimeCase.postExecutionGenericAgents.length > 0) {
      lines.push(`- Post-execution generic agents: ${runtimeCase.postExecutionGenericAgents.join(", ")}`);
    }
    lines.push(`- Post-execution ownership leak observed: ${runtimeCase.postExecutionOwnershipLeakObserved ? "yes" : "no"}`);
    lines.push(`- Execution owner: ${runtimeCase.executionOwner ?? "unobserved"}`);
    lines.push(`- Ownership transferred to execution: ${runtimeCase.ownershipTransferredToExecution ? "yes" : "no"}`);
    lines.push(`- Background execution agent observed: ${runtimeCase.backgroundExecutionAgentObserved ? "yes" : "no"}`);
    lines.push(`- Background execution agent unresolved: ${runtimeCase.backgroundExecutionAgentUnresolved ? "yes" : "no"}`);
    if (runtimeCase.backgroundExecutionAgentIds.length > 0) {
      lines.push(`- Background execution agent ids: ${runtimeCase.backgroundExecutionAgentIds.join(", ")}`);
    }
    if (runtimeCase.ownershipLeakAllowedReason) {
      lines.push(`- Ownership leak allowed reason: ${runtimeCase.ownershipLeakAllowedReason}`);
    }
    lines.push(`- Post-execution root write observed: ${runtimeCase.postExecutionRootWriteObserved ? "yes" : "no"}`);
    lines.push(`- Post-execution root patch observed: ${runtimeCase.postExecutionRootPatchObserved ? "yes" : "no"}`);
    lines.push(`- Post-execution root write count: ${runtimeCase.postExecutionRootWriteCount}`);
    lines.push(
      `- Execution-owner-active root write observed: ${runtimeCase.executionOwnerActiveRootWriteObserved ? "yes" : "no"}`
    );
    lines.push(`- Execution-owner-active root write count: ${runtimeCase.executionOwnerActiveRootWriteCount}`);
    lines.push(`- Integration-class task observed: ${runtimeCase.integrationClassTaskObserved ? "yes" : "no"}`);
    lines.push(`- Foundation readiness assessed: ${runtimeCase.foundationReadinessAssessed ? "yes" : "no"}`);
    lines.push(`- Foundation readiness unknown: ${runtimeCase.foundationReadinessUnknown ? "yes" : "no"}`);
    lines.push(`- Foundation risk raised: ${runtimeCase.foundationRiskRaised ? "yes" : "no"}`);
    lines.push(`- Repeated foundation failure observed: ${runtimeCase.repeatedFoundationFailureObserved ? "yes" : "no"}`);
    lines.push(`- Foundation recovery suggested: ${runtimeCase.foundationRecoverySuggested ? "yes" : "no"}`);
    lines.push(`- Validation port conflict observed: ${runtimeCase.validationPortConflictObserved ? "yes" : "no"}`);
    lines.push(`- Validation server readiness failure observed: ${runtimeCase.validationServerReadinessFailureObserved ? "yes" : "no"}`);
    if (runtimeCase.foundationFailureClasses.length > 0) {
      lines.push(`- Foundation failure classes: ${runtimeCase.foundationFailureClasses.join(", ")}`);
    }
    if (runtimeCase.foundationRecoveryReason) {
      lines.push(`- Foundation recovery reason: ${runtimeCase.foundationRecoveryReason}`);
    }
    lines.push(`- GitHub memory enabled probe: ${runtimeCase.githubMemoryEnabledProbe}`);
    lines.push(`- GitHub memory prompt probe: ${runtimeCase.githubMemoryPromptProbe}`);
    lines.push(`- PR lookup: ${runtimeCase.prLookup}`);
    lines.push(`- GitHub memory enabled check: ${runtimeCase.githubMemoryEnabledCheck}`);
    lines.push(`- GitHub memory enabled check cached: ${runtimeCase.githubMemoryEnabledCheckCached ? "yes" : "no"}`);
    lines.push(`- GitHub memory enabled check count: ${runtimeCase.githubMemoryEnabledCheckCount}`);
    lines.push(`- GitHub memory enabled check source: ${runtimeCase.githubMemoryEnabledCheckSource}`);
    lines.push(
      `- GitHub memory enabled fresh after cache observed: ${runtimeCase.githubMemoryEnabledFreshAfterCacheObserved ? "yes" : "no"}`
    );
    lines.push(`- PR context check: ${runtimeCase.prContextCheck}`);
    lines.push(`- PR context check cached: ${runtimeCase.prContextCheckCached ? "yes" : "no"}`);
    lines.push(`- PR context check count: ${runtimeCase.prContextCheckCount}`);
    lines.push(`- PR context check source: ${runtimeCase.prContextCheckSource}`);
    lines.push(`- PR context fresh after cache observed: ${runtimeCase.prContextFreshAfterCacheObserved ? "yes" : "no"}`);
    lines.push(`- PR lookup check: ${runtimeCase.prLookupCheck}`);
    lines.push(`- PR lookup check cached: ${runtimeCase.prLookupCheckCached ? "yes" : "no"}`);
    lines.push(`- PR lookup check source: ${runtimeCase.prLookupCheckSource}`);
    lines.push(`- GitHub capability cache hits: ${runtimeCase.githubCapabilityCacheHits}`);
    lines.push(`- GitHub capability cache misses: ${runtimeCase.githubCapabilityCacheMisses}`);
    lines.push(`- Observed memory probe suppressed: ${runtimeCase.observedMemoryProbeSuppressed ? "yes" : "no"}`);
    lines.push(`- Observed PR probe suppressed: ${runtimeCase.observedPrProbeSuppressed ? "yes" : "no"}`);
    lines.push(`- Provider retry observed: ${runtimeCase.providerRetryObserved ? "yes" : "no"}`);
    lines.push(`- Provider retry active: ${runtimeCase.providerRetryActive ? "yes" : "no"}`);
    lines.push(`- Provider retry state: ${runtimeCase.providerRetryState}`);
    lines.push(
      `- Provider retry recovered: ${
        runtimeCase.providerRetryRecovered === null ? "unproven" : runtimeCase.providerRetryRecovered ? "yes" : "no"
      }`
    );
    lines.push(`- Provider retry count: ${runtimeCase.providerRetryCount}`);
    if (runtimeCase.providerRetryReason) {
      lines.push(`- Provider retry reason: ${runtimeCase.providerRetryReason}`);
    }
    if (runtimeCase.lastProviderRetryAt) {
      lines.push(`- Last provider retry at: ${runtimeCase.lastProviderRetryAt}`);
    }
    if (runtimeCase.lastProviderTransportError) {
      lines.push(`- Last provider transport error: ${runtimeCase.lastProviderTransportError}`);
    }
    if (runtimeCase.activeAgentDuringRetry) {
      lines.push(`- Active agent during retry: ${runtimeCase.activeAgentDuringRetry}`);
    }
    lines.push(`- Model rate limit observed: ${runtimeCase.modelRateLimitObserved ? "yes" : "no"}`);
    lines.push(`- Model rate limit count: ${runtimeCase.modelRateLimitCount}`);
    lines.push(`- Provider 502 observed: ${runtimeCase.provider502Observed ? "yes" : "no"}`);
    lines.push(`- Provider 502 count: ${runtimeCase.provider502Count}`);
    if (runtimeCase.reportedUsage) {
      lines.push(`- CLI-reported premium requests: ${runtimeCase.reportedUsage.premiumRequests ?? "n/a"}`);
      lines.push(`- CLI-reported API duration: ${runtimeCase.reportedUsage.totalApiDurationMs ?? "n/a"} ms`);
      lines.push(`- CLI-reported session duration: ${runtimeCase.reportedUsage.sessionDurationMs ?? "n/a"} ms`);
      if (runtimeCase.reportedUsage.filesModified.length > 0) {
        lines.push(`- CLI-reported modified files (raw): ${runtimeCase.reportedUsage.filesModified.join(", ")}`);
      }
    }
    if (runtimeCase.reportedChangeSummary) {
      lines.push(
        `- CLI-reported repo working-tree files: ${
          runtimeCase.reportedChangeSummary.repoWorkingTreeFiles.length > 0
            ? runtimeCase.reportedChangeSummary.repoWorkingTreeFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- CLI-reported committed repo files: ${formatObservedFiles(runtimeCase.reportedChangeSummary.committedRepoFiles)}`
      );
      lines.push(
        `- CLI-reported session-state files: ${
          runtimeCase.reportedChangeSummary.sessionStateFiles.length > 0
            ? runtimeCase.reportedChangeSummary.sessionStateFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- CLI-reported validation/report files: ${
          runtimeCase.reportedChangeSummary.validationArtifactFiles.length > 0
            ? runtimeCase.reportedChangeSummary.validationArtifactFiles.join(", ")
            : "none"
        }`
      );
      if (runtimeCase.reportedChangeSummary.externalFiles.length > 0) {
        lines.push(`- CLI-reported external files: ${runtimeCase.reportedChangeSummary.externalFiles.join(", ")}`);
      }
      lines.push(
        `- CLI-reported working-tree-only diff observed: ${runtimeCase.reportedChangeSummary.workingTreeOnlyDiffObserved ? "yes" : "no"}`
      );
      lines.push(
        `- CLI-reported shared/integration surfaces: ${
          runtimeCase.reportedChangeSummary.integrationOwnedSurfacesTouched.length > 0
            ? runtimeCase.reportedChangeSummary.integrationOwnedSurfacesTouched.join(", ")
            : "none"
        }`
      );
    }
    if (runtimeCase.observedWorkspaceChangeSummary) {
      lines.push(
        `- Observed repo working-tree changed: ${runtimeCase.observedWorkspaceChangeSummary.repoWorkingTreeChanged ? "yes" : "no"}`
      );
      lines.push(
        `- Observed committed repo files changed: ${formatObservedFiles(runtimeCase.observedWorkspaceChangeSummary.committedRepoFiles)}`
      );
      lines.push(
        `- Observed working-tree-only diff: ${runtimeCase.observedWorkspaceChangeSummary.workingTreeOnlyDiffObserved ? "yes" : "no"}`
      );
      if (runtimeCase.sessionStartHead || runtimeCase.sessionEndHead) {
        lines.push(`- Session git heads: ${runtimeCase.sessionStartHead ?? "unknown"} -> ${runtimeCase.sessionEndHead ?? "unknown"}`);
      }
      lines.push(`- Observed repo code changed: ${runtimeCase.observedWorkspaceChangeSummary.repoCodeChanged ? "yes" : "no"}`);
      lines.push(`- Observed working tree clean: ${runtimeCase.observedWorkspaceChangeSummary.workingTreeClean ? "yes" : "no"}`);
      lines.push(
        `- Observed only session-state changes: ${runtimeCase.observedWorkspaceChangeSummary.sessionStateOnly ? "yes" : "no"}`
      );
      lines.push(
        `- Observed workspace repo files changed: ${
          runtimeCase.observedWorkspaceChangeSummary.repoWorkingTreeFiles.length > 0
            ? runtimeCase.observedWorkspaceChangeSummary.repoWorkingTreeFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- Observed workspace session-state files changed: ${
          runtimeCase.observedWorkspaceChangeSummary.sessionStateFiles.length > 0
            ? runtimeCase.observedWorkspaceChangeSummary.sessionStateFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- Observed workspace validation/report files changed: ${
          runtimeCase.observedWorkspaceChangeSummary.validationArtifactFiles.length > 0
            ? runtimeCase.observedWorkspaceChangeSummary.validationArtifactFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- Observed workspace external files changed: ${
          runtimeCase.observedWorkspaceChangeSummary.externalFiles.length > 0
            ? runtimeCase.observedWorkspaceChangeSummary.externalFiles.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- Observed shared/integration surfaces changed: ${
          runtimeCase.observedWorkspaceChangeSummary.integrationOwnedSurfacesTouched.length > 0
            ? runtimeCase.observedWorkspaceChangeSummary.integrationOwnedSurfacesTouched.join(", ")
            : "none"
        }`
      );
      lines.push(
        `- Shared-surface owner declared: ${runtimeCase.observedWorkspaceChangeSummary.sharedSurfaceOwnerDeclared ? "yes" : "no"}`
      );
      lines.push(
        `- Shared-surface conflict risk: ${runtimeCase.observedWorkspaceChangeSummary.sharedSurfaceConflictRisk ? "yes" : "no"}`
      );
      lines.push(
        `- Shared-surface review recommended: ${
          runtimeCase.observedWorkspaceChangeSummary.sharedSurfaceReviewRecommended ? "yes" : "no"
        }`
      );
      lines.push(
        `- Shared-surface final integrator needed: ${
          runtimeCase.observedWorkspaceChangeSummary.sharedSurfaceFinalIntegratorNeeded ? "yes" : "no"
        }`
      );
    }
    lines.push(`- Execution claim observed: ${runtimeCase.executionClaimed ? "yes" : "no"}`);
    lines.push(
      `- Execution claim without observed repo diff: ${runtimeCase.executionClaimWithoutObservedRepoDiff ? "yes" : "no"}`
    );
    lines.push(
      `- Execution handoff without observed repo diff: ${
        runtimeCase.executionHandoffWithoutObservedRepoDiff ? "yes" : "no"
      }`
    );
    lines.push(
      `- Patch Master handoff without completion: ${
        runtimeCase.patchMasterHandoffWithoutCompletionObserved ? "yes" : "no"
      }`
    );
    lines.push(`- Malformed task payload observed: ${runtimeCase.malformedTaskPayloadObserved ? "yes" : "no"}`);
    if (runtimeCase.evidenceNotes.length > 0) {
      lines.push("- Evidence:");
      for (const note of runtimeCase.evidenceNotes) {
        lines.push(`  - ${note}`);
      }
    }
    lines.push("");
  }

  lines.push("## Proof Model");
  lines.push("");
  lines.push("- `explicit`: transcript or stdout clearly names the selected MCP/LSP capability.");
  lines.push("- `strong-indirect`: transcript/stdout strongly implies the capability, or an alternate runtime tool clearly satisfied the same need.");
  lines.push("- `weak`: plausible use, but evidence is thin.");
  lines.push("- `unproven`: runtime success may have occurred, but actual MCP/LSP usage could not be proven.");
  lines.push("- Hook payloads alone are supporting evidence, not authoritative proof.");
  lines.push("- `Capability path` records whether evidence pointed at the selected server, an alternate tool path, or no attributable path.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactRoot = path.join(path.dirname(args.reportJson), "artifacts", new Date().toISOString().replace(/[:.]/g, "-"));
  ensureDir(path.dirname(args.reportJson));
  ensureDir(path.dirname(args.reportMd));
  ensureDir(artifactRoot);

  const report: RuntimeValidationReport = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    tempWorkspace: null,
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
      copilotBinary: copilotBin,
      copilotAvailable: false,
      copilotVersion: null
    },
    structural: {
      status: "passed",
      notes: []
    },
    plugin: {
      name: readJsonIfExists<{ name?: string }>(path.join(repoRoot, "plugin.json"))?.name ?? "xgc",
      installStatus: "skipped",
      visibleInPluginList: false,
      registeredInCopilotConfig: false,
      cachedPluginPath: null,
      cachePathExists: false,
      copilotConfigPath: null,
      installStdoutPath: null,
      installStderrPath: null,
      pluginListStdoutPath: null,
      pluginListStderrPath: null,
      notes: []
    },
    runtimeSources: {
      jsonPath: null,
      mdPath: null,
      details: null
    },
    selections: {
      selectedToolingPath: path.join(repoRoot, ".xgc", "bootstrap", "selected-tooling.json"),
      selectedMcpServers: loadSelectedTooling(repoRoot)?.selected?.mcpServers ?? [],
      selectedLspServers: loadSelectedTooling(repoRoot)?.selected?.lspServers ?? []
    },
    localUsage: {
      casesWithReportedUsage: 0,
      reportedPremiumRequests: 0,
      reportedApiDurationMs: 0,
      casesWithObservedRepoChanges: 0,
      casesWithOnlySessionStateChanges: 0,
      casesWithExecutionClaimWithoutObservedRepoDiff: 0,
      notes: [
        "These values come from Copilot CLI result events emitted in local runtime stdout.",
        "They are useful local evidence, not authoritative provider-side billing truth.",
        "Per-case summaries separate repo working-tree changes from session-state artifacts and validation/report artifacts."
      ]
    },
    mcpServers: [],
    lspServers: [],
    agents: detectAgentIds(repoRoot),
    cases: [],
    overall: {
      status: "skipped",
      summary: "Runtime validation did not run."
    }
  };

  try {
    await syncRuntimeSurfaces(repoRoot, { check: true });
    report.structural.notes.push("source-to-runtime mirror parity verified before live validation");
  } catch (error) {
    report.structural.status = "failed";
    report.structural.notes.push(error instanceof Error ? error.message : String(error));
  }

  const toolingEnv = loadToolingEnv(repoRoot);
  report.mcpServers = buildMcpStates(repoRoot, toolingEnv);
  report.lspServers = buildLspStates(repoRoot);

  const missingBootstrap = !fs.existsSync(report.selections.selectedToolingPath);
  if (missingBootstrap) {
    report.structural.status = report.structural.status === "failed" ? "failed" : "partial";
    report.structural.notes.push("selected-tooling.json is missing; runtime validation can still inspect live config, but bootstrap choices are unproven");
  }

  report.environment.copilotAvailable = commandAvailable(copilotBin);
  if (!report.environment.copilotAvailable) {
    report.overall = {
      status: report.structural.status === "failed" ? "failed" : "skipped",
      summary: `GitHub Copilot CLI binary not found on PATH: ${copilotBin}`
    };
    writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
    writeText(args.reportMd, renderMarkdown(report));
    log(report.overall.summary);
    return;
  }

  const versionProbe = spawnSync(copilotBin, ["--version"], { encoding: "utf8" });
  report.environment.copilotVersion = `${versionProbe.stdout ?? ""}`.trim() || `${versionProbe.stderr ?? ""}`.trim() || null;

  const { workspaceRoot } = copyWorkspace(repoRoot);
  report.tempWorkspace = workspaceRoot;
  createValidationFixtures(workspaceRoot);
  await syncRuntimeSurfaces(workspaceRoot);
  initializeGitBaseline(workspaceRoot);
  report.agents = detectAgentIds(workspaceRoot);
  ensureDir(path.join(workspaceRoot, ".xgc", "logs"));

  const install = runCopilot(workspaceRoot, ["plugin", "install", repoRoot], path.join(workspaceRoot, ".xgc", "logs"));
  const installArtifacts = writeProcessArtifacts(artifactRoot, "plugin-install", install);
  report.plugin.installStdoutPath = installArtifacts.stdoutPath;
  report.plugin.installStderrPath = installArtifacts.stderrPath;
  if (install.status !== 0) {
    report.plugin.installStatus = authLikeFailure(install.stdout ?? "", install.stderr ?? "") ? "skipped" : "failed";
    report.overall = {
      status: report.plugin.installStatus === "failed" ? "failed" : "skipped",
      summary: "Local plugin install failed; see plugin-install stderr artifact."
    };
    writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
    writeText(args.reportMd, renderMarkdown(report));
    log(report.overall.summary);
    return;
  }
  report.plugin.installStatus = "passed";

  const pluginList = runCopilot(workspaceRoot, ["plugin", "list"], path.join(workspaceRoot, ".xgc", "logs"));
  const pluginListArtifacts = writeProcessArtifacts(artifactRoot, "plugin-list", pluginList);
  report.plugin.pluginListStdoutPath = pluginListArtifacts.stdoutPath;
  report.plugin.pluginListStderrPath = pluginListArtifacts.stderrPath;
  report.plugin.visibleInPluginList =
    pluginList.status === 0 && pluginListedInOutput(pluginList.stdout ?? "", report.plugin.name);
  const pluginConfigEvidence = inspectInstalledPlugin(report.plugin.name, {
    homeDir: path.join(workspaceRoot, ".xgc", "copilot-home"),
    sourcePath: repoRoot
  });
  report.plugin.registeredInCopilotConfig = pluginConfigEvidence.registeredInConfig;
  report.plugin.cachedPluginPath = pluginConfigEvidence.cachedPluginPath;
  report.plugin.cachePathExists = pluginConfigEvidence.cachePathExists;
  report.plugin.copilotConfigPath = pluginConfigEvidence.configPath;
  report.plugin.notes.push(...pluginConfigEvidence.notes);
  const runtimeSurfaceJsonPath = path.join(path.dirname(args.reportJson), "runtime-surface-resolution.json");
  const runtimeSurfaceMdPath = path.join(path.dirname(args.reportMd), "runtime-surface-resolution.md");
  report.runtimeSources.details = resolveRuntimeSourceReport({
    repoRoot,
    workspaceRoot,
    copilotHome: path.join(workspaceRoot, ".xgc", "copilot-home"),
    copilotConfigPath: pluginConfigEvidence.configPath,
    pluginCachePath: pluginConfigEvidence.cachedPluginPath
  });
  report.runtimeSources.jsonPath = runtimeSurfaceJsonPath;
  report.runtimeSources.mdPath = runtimeSurfaceMdPath;
  writeText(runtimeSurfaceJsonPath, `${JSON.stringify(report.runtimeSources.details, null, 2)}\n`);
  writeText(runtimeSurfaceMdPath, renderRuntimeSourceReportMarkdown(report.runtimeSources.details));
  if (!report.plugin.visibleInPluginList && !report.plugin.registeredInCopilotConfig) {
    report.overall = {
      status: "failed",
      summary: "Copilot CLI did not expose the local X for GitHub Copilot plugin in plugin list or the active Copilot config after install."
    };
    writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
    writeText(args.reportMd, renderMarkdown(report));
    log(report.overall.summary);
    return;
  }
  if (!report.plugin.visibleInPluginList && report.plugin.registeredInCopilotConfig) {
    report.plugin.notes.push("plugin list did not show the plugin, but the active Copilot config recorded the install");
  }

  const coreCases = buildCoreCases(report.agents);
  const mcpCases = buildMcpCases(report.mcpServers, report.agents);
  const lspCases = buildLspCases(report.lspServers, report.agents);
  const allCases = [...coreCases, ...mcpCases, ...lspCases];

  const hookLogPath = path.join(workspaceRoot, ".xgc", "logs", "hooks.log");
  const copilotLogRoot = path.join(workspaceRoot, ".xgc", "copilot-home", "logs");
  const githubProbeScope = {
    repoIdentity: resolveRepoIdentity(repoRoot),
    sessionIdentity: path.basename(artifactRoot)
  };
  let githubProbeCache: GitHubProbeCache = emptyGitHubProbeCache(githubProbeScope);

  for (const caseDef of allCases) {
    const agent = report.agents.find((entry) => entry.lane === caseDef.agentLane)?.id ?? null;
    if (!agent) {
      report.cases.push({
        id: caseDef.id,
        title: caseDef.title,
        kind: caseDef.kind,
        agentLane: caseDef.agentLane,
        agentId: null,
        capabilityId: caseDef.capabilityId,
        status: "failed",
        reason: `No runtime agent found for lane ${caseDef.agentLane}`,
        proofStrength: "unproven",
        capabilityPath: "none",
        transcriptPath: null,
        stdoutPath: null,
        stderrPath: null,
        hookLogPath: null,
        reportedUsage: null,
        reportedChangeSummary: null,
        observedWorkspaceChangeSummary: null,
        executionClaimed: false,
        executionClaimWithoutObservedRepoDiff: false,
        observedTools: [],
        observedSubagents: [],
        observedSubagentCounts: {},
        ...emptyRouteSummary(),
        evidenceNotes: ["agent detection returned no matching custom agent id"],
        processLogPath: null
      });
      continue;
    }

    if (caseDef.kind === "mcp") {
      const server = report.mcpServers.find((entry) => entry.id === caseDef.capabilityId);
      if (!server?.configured) {
        report.cases.push({
          id: caseDef.id,
          title: caseDef.title,
          kind: caseDef.kind,
          agentLane: caseDef.agentLane,
          agentId: agent,
          capabilityId: caseDef.capabilityId,
          status: "skipped",
          reason: "MCP server is not enabled in current config",
          proofStrength: "unproven",
          capabilityPath: "none",
          transcriptPath: null,
          stdoutPath: null,
          stderrPath: null,
          hookLogPath: null,
          reportedUsage: null,
          reportedChangeSummary: null,
          observedWorkspaceChangeSummary: null,
          executionClaimed: false,
          executionClaimWithoutObservedRepoDiff: false,
          observedTools: [],
          observedSubagents: [],
          observedSubagentCounts: {},
          ...emptyRouteSummary(),
          evidenceNotes: [],
          processLogPath: null
        });
        continue;
      }
      if (server.credentialStatus === "configured-but-missing-credential") {
        report.cases.push({
          id: caseDef.id,
          title: caseDef.title,
          kind: caseDef.kind,
          agentLane: caseDef.agentLane,
          agentId: agent,
          capabilityId: caseDef.capabilityId,
          status: "skipped",
          reason: `MCP server ${server.id} is configured but missing credentials: ${server.missingEnv.join(", ")}`,
          proofStrength: "unproven",
          capabilityPath: "none",
          transcriptPath: null,
          stdoutPath: null,
          stderrPath: null,
          hookLogPath: null,
          reportedUsage: null,
          reportedChangeSummary: null,
          observedWorkspaceChangeSummary: null,
          executionClaimed: false,
          executionClaimWithoutObservedRepoDiff: false,
          observedTools: [],
          observedSubagents: [],
          observedSubagentCounts: {},
          ...emptyRouteSummary(),
          evidenceNotes: [],
          processLogPath: null
        });
        continue;
      }
    }

    if (caseDef.kind === "lsp") {
      const server = report.lspServers.find((entry) => entry.id === caseDef.capabilityId);
      if (!server?.configured) {
        report.cases.push({
          id: caseDef.id,
          title: caseDef.title,
          kind: caseDef.kind,
          agentLane: caseDef.agentLane,
          agentId: agent,
          capabilityId: caseDef.capabilityId,
          status: "skipped",
          reason: "LSP server is not enabled in current config",
          proofStrength: "unproven",
          capabilityPath: "none",
          transcriptPath: null,
          stdoutPath: null,
          stderrPath: null,
          hookLogPath: null,
          reportedUsage: null,
          reportedChangeSummary: null,
          observedWorkspaceChangeSummary: null,
          executionClaimed: false,
          executionClaimWithoutObservedRepoDiff: false,
          observedTools: [],
          observedSubagents: [],
          observedSubagentCounts: {},
          ...emptyRouteSummary(),
          evidenceNotes: [],
          processLogPath: null
        });
        continue;
      }
      if (server.binaryProbe.status !== "installed") {
        report.cases.push({
          id: caseDef.id,
          title: caseDef.title,
          kind: caseDef.kind,
          agentLane: caseDef.agentLane,
          agentId: agent,
          capabilityId: caseDef.capabilityId,
          status: "skipped",
          reason: `LSP server ${server.id} is configured but binary probe status is ${server.binaryProbe.status}`,
          proofStrength: "unproven",
          capabilityPath: "none",
          transcriptPath: null,
          stdoutPath: null,
          stderrPath: null,
          hookLogPath: null,
          reportedUsage: null,
          reportedChangeSummary: null,
          observedWorkspaceChangeSummary: null,
          executionClaimed: false,
          executionClaimWithoutObservedRepoDiff: false,
          observedTools: [],
          observedSubagents: [],
          observedSubagentCounts: {},
          ...emptyRouteSummary(),
          evidenceNotes: [],
          processLogPath: null
        });
        continue;
      }
    }

    const githubProbeCacheBefore = githubProbeCache;
    const githubProbePolicy = resolveGitHubProbePolicy({
      agentId: agent,
      caseId: caseDef.id,
      sessionCache: githubProbeCacheBefore
    });
    const processLogsBefore = new Set(listProcessLogs(copilotLogRoot));
    const transcriptPath = path.join(artifactRoot, `${caseDef.transcriptStem ?? caseDef.id}.transcript.md`);
    const sessionStartHead = readGitHead(workspaceRoot);
    const workspaceSnapshotBefore = captureWorkspaceSnapshot(workspaceRoot);
    const run = runCopilot(
      workspaceRoot,
      [
        ...(githubProbePolicy.disableBuiltinMcps ? ["--disable-builtin-mcps"] : []),
        ...githubProbePolicy.disableSpecificMcpServers.map((serverId) => `--disable-mcp-server=${serverId}`),
        ...(githubProbePolicy.disableExperimentalFeatures ? ["--no-experimental"] : []),
        "--agent",
        agent,
        "--prompt",
        caseDef.prompt,
        "--allow-all-tools",
        "--output-format",
        "json",
        "--share",
        transcriptPath,
        "--no-ask-user"
      ],
      path.join(workspaceRoot, ".xgc", "logs")
    );
    const processArtifacts = writeProcessArtifacts(artifactRoot, caseDef.id, run);
    const hookSnapshotPath = path.join(artifactRoot, `${caseDef.id}.hooks.log`);
    writeText(hookSnapshotPath, readTextIfExists(hookLogPath));
    const processLogSource =
      listProcessLogs(copilotLogRoot).find((entry) => !processLogsBefore.has(entry)) ??
      listProcessLogs(copilotLogRoot)[0] ??
      null;
    const processLogPath = processLogSource ? path.join(artifactRoot, `${caseDef.id}.process.log`) : null;
    const processLogText = processLogSource ? readTextIfExists(processLogSource) : "";
    if (processLogPath && processLogText) {
      writeText(processLogPath, processLogText);
    }
    const sessionEndHead = readGitHead(workspaceRoot);
    const committedRepoFiles = listCommittedFilesBetween(workspaceRoot, sessionStartHead, sessionEndHead);
    const workingTreeChangedAtEnd = readGitWorkingTreeChanged(workspaceRoot);
    const githubProbeLogText = [processLogText, run.stderr ?? "", run.stdout ?? ""].filter(Boolean).join("\n");
    githubProbeCache = observeGitHubProbeResults(githubProbeLogText, githubProbeCacheBefore, githubProbeScope);
    const stdout = readTextIfExists(processArtifacts.stdoutPath);
    const reportedUsage = extractCliReportedUsage(stdout);
    const hookLog = readTextIfExists(hookSnapshotPath);
    const transcript = readTextIfExists(transcriptPath);
    const sharedSurfaceOwnerDeclared = /\b(shared[-\s]surface|integration[-\s]owned surface) owner\s*:/i.test(
      [caseDef.prompt, transcript, stdout, processLogText].join("\n")
    );
    const observedSubagentEvents = extractObservedSubagentEvents(stdout, hookLog);
    const observedSubagents = observedSubagentEvents.map((event) => event.agentName);
    const observedSubagentCounts = countObservedNames(
      observedSubagentEvents
        .filter((event) => event.kind === "selected" || event.kind === "started")
        .map((event) => event.agentName)
    );
    const rawReportedChangeSummary = reportedUsage
      ? classifyModifiedFiles(reportedUsage.filesModified, {
          workspaceRoot,
          repoRoot,
          copilotHome: path.join(workspaceRoot, ".xgc", "copilot-home"),
          profileHome: process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot-xgc"),
          sharedSurfaceOwnerDeclared
        })
      : null;
    const workspaceSnapshotAfter = captureWorkspaceSnapshot(workspaceRoot);
    const rawObservedWorkspaceChangeSummary = classifyModifiedFiles(
      diffWorkspaceSnapshots(workspaceSnapshotBefore, workspaceSnapshotAfter),
      {
        workspaceRoot,
        repoRoot,
        copilotHome: path.join(workspaceRoot, ".xgc", "copilot-home"),
        profileHome: process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot-xgc"),
        sharedSurfaceOwnerDeclared
      }
    );
    const reportedChangeSummary = rawReportedChangeSummary
      ? withCommittedRepoFiles(rawReportedChangeSummary, committedRepoFiles, workingTreeChangedAtEnd)
      : null;
    const observedWorkspaceChangeSummary = withCommittedRepoFiles(
      rawObservedWorkspaceChangeSummary,
      committedRepoFiles,
      workingTreeChangedAtEnd
    );
    const sharedSurfaceChangeObserved =
      observedWorkspaceChangeSummary.sharedSurfaceChangeObserved ||
      reportedChangeSummary?.sharedSurfaceChangeObserved === true;
    const routeSummary: RouteObservationSummary = summarizeRouteObservations({
      agentId: agent,
      agentLane: caseDef.agentLane,
      caseId: caseDef.id,
      promptText: caseDef.prompt,
      transcriptText: transcript,
      observedSubagentEvents,
      observedSubagents,
      observedSubagentCounts,
      stdout,
      processLog: processLogText,
      sharedSurfaceChangeObserved,
      githubProbeCacheBefore,
      githubProbeCacheAfter: githubProbeCache,
      githubProbeLogText
    });
    const executionClaimed =
      observedSubagents.includes("Patch Master") ||
      routeSummary.observedPlanningChain.includes("Patch Master") ||
      /Custom agent "Patch Master" invoked/.test(processLogText);
    const executionClaimWithoutObservedRepoDiff =
      executionClaimed && !observedWorkspaceChangeSummary.repoCodeChanged;

    if (run.status !== 0) {
      const skipped = authLikeFailure(run.stdout ?? "", run.stderr ?? "");
      const failureNotes = [...githubProbePolicy.notes];
      if (routeSummary.providerRetryObserved) {
        failureNotes.push(
          routeSummary.providerRetryState === "terminal-failure-after-retry"
            ? "non-zero exit followed a retryable provider transport failure"
            : "non-zero exit occurred while provider retry evidence was present"
        );
      }
      report.cases.push({
        id: caseDef.id,
        title: caseDef.title,
        kind: caseDef.kind,
        agentLane: caseDef.agentLane,
        agentId: agent,
        capabilityId: caseDef.capabilityId,
        status: skipped ? "skipped" : "failed",
        reason: skipped
          ? "Copilot CLI appears installed but unable to run authenticated prompt sessions"
          : "Copilot CLI returned a non-zero status for this validation case",
        proofStrength: "unproven",
        capabilityPath: "none",
        transcriptPath: fs.existsSync(transcriptPath) ? transcriptPath : null,
        stdoutPath: processArtifacts.stdoutPath,
        stderrPath: processArtifacts.stderrPath,
        hookLogPath: hookSnapshotPath,
        reportedUsage,
        reportedChangeSummary,
        observedWorkspaceChangeSummary,
        executionClaimed,
        executionClaimWithoutObservedRepoDiff,
        observedTools: [],
        observedSubagents,
        observedSubagentCounts,
        routeAgents: routeSummary.routeAgents,
        routeSummary: routeSummary.routeSummary,
        keyAgents: routeSummary.keyAgents,
        observedPlanningChain: routeSummary.observedPlanningChain,
        routeSummarySource: routeSummary.routeSummarySource,
        directToolExecutionObserved: routeSummary.directToolExecutionObserved,
        toolExecutionCount: routeSummary.toolExecutionCount,
        writeToolCount: routeSummary.writeToolCount,
        bashToolCount: routeSummary.bashToolCount,
        sessionShutdownObserved: routeSummary.sessionShutdownObserved,
        sessionShutdownCodeChangesObserved: routeSummary.sessionShutdownCodeChangesObserved,
        sessionShutdownFilesModified: routeSummary.sessionShutdownFilesModified,
        sessionShutdownLinesAdded: routeSummary.sessionShutdownLinesAdded,
        sessionShutdownLinesRemoved: routeSummary.sessionShutdownLinesRemoved,
        observedFrontDoorHandledDirectly: routeSummary.observedFrontDoorHandledDirectly,
        observedScoutCount: routeSummary.observedScoutCount,
        repoScoutInvocationCount: routeSummary.repoScoutInvocationCount,
        triageInvocationCount: routeSummary.triageInvocationCount,
        patchMasterInvocationCount: routeSummary.patchMasterInvocationCount,
        requiredCheckInvocationCount: routeSummary.requiredCheckInvocationCount,
        builtInGenericAgentInvocationCount: routeSummary.builtInGenericAgentInvocationCount,
        triageDuplicateObserved: routeSummary.triageDuplicateObserved,
        triageDuplicateAllowedReason: routeSummary.triageDuplicateAllowedReason,
        executionReadyHandoffSeenBeforeSecondTriage: routeSummary.executionReadyHandoffSeenBeforeSecondTriage,
        observedPlannerBeforeExecutor: routeSummary.observedPlannerBeforeExecutor,
        observedTriageBeforeExecutor: routeSummary.observedTriageBeforeExecutor,
        observedRefIndex: routeSummary.observedRefIndex,
        observedGroundingBeforeExecutor: routeSummary.observedGroundingBeforeExecutor,
        observedExecutionPhasePure: routeSummary.observedExecutionPhasePure,
        postExecutionPlannerReopenAgents: routeSummary.postExecutionPlannerReopenAgents,
        postExecutionGenericAgentObserved: routeSummary.postExecutionGenericAgentObserved,
        postExecutionBuiltInAgentObserved: routeSummary.postExecutionBuiltInAgentObserved,
        postExecutionGenericAgents: routeSummary.postExecutionGenericAgents,
        postExecutionBuiltInAgents: routeSummary.postExecutionBuiltInAgents,
        postExecutionOwnershipLeakObserved: routeSummary.postExecutionOwnershipLeakObserved,
        ownershipLeakAllowedReason: routeSummary.ownershipLeakAllowedReason,
        executionOwner: routeSummary.executionOwner,
        ownershipTransferredToExecution: routeSummary.ownershipTransferredToExecution,
        backgroundExecutionAgentObserved: routeSummary.backgroundExecutionAgentObserved,
        backgroundExecutionAgentUnresolved: routeSummary.backgroundExecutionAgentUnresolved,
        backgroundExecutionAgentIds: routeSummary.backgroundExecutionAgentIds,
        patchMasterHandoffWithoutCompletionObserved: routeSummary.patchMasterHandoffWithoutCompletionObserved,
        executionHandoffWithoutObservedRepoDiff: routeSummary.executionHandoffWithoutObservedRepoDiff,
        malformedTaskPayloadObserved: routeSummary.malformedTaskPayloadObserved,
        postExecutionRootWriteObserved: routeSummary.postExecutionRootWriteObserved,
        postExecutionRootPatchObserved: routeSummary.postExecutionRootPatchObserved,
        postExecutionRootWriteCount: routeSummary.postExecutionRootWriteCount,
        executionOwnerActiveRootWriteObserved: routeSummary.executionOwnerActiveRootWriteObserved,
        executionOwnerActiveRootWriteCount: routeSummary.executionOwnerActiveRootWriteCount,
        executionOwnerActiveRootPatchObserved: routeSummary.executionOwnerActiveRootPatchObserved,
        integrationClassTaskObserved: routeSummary.integrationClassTaskObserved,
        largeProductBuildTaskObserved: routeSummary.largeProductBuildTaskObserved,
        specialistLaneExpected: routeSummary.specialistLaneExpected,
        requiredSpecialistLanes: routeSummary.requiredSpecialistLanes,
        recommendedSpecialistLanes: routeSummary.recommendedSpecialistLanes,
        observedSpecialistLanes: routeSummary.observedSpecialistLanes,
        missingRequiredSpecialistLanes: routeSummary.missingRequiredSpecialistLanes,
        missingRecommendedSpecialistLanes: routeSummary.missingRecommendedSpecialistLanes,
        unobservedRecommendedSpecialistLanes: routeSummary.unobservedRecommendedSpecialistLanes,
        specialistFanoutObserved: routeSummary.specialistFanoutObserved,
        specialistFanoutPartial: routeSummary.specialistFanoutPartial,
        patchMasterSwarmObserved: routeSummary.patchMasterSwarmObserved,
        patchMasterSwarmCount: routeSummary.patchMasterSwarmCount,
        specialistFanoutCoveredByPatchMaster: routeSummary.specialistFanoutCoveredByPatchMaster,
        specialistFanoutStatus: routeSummary.specialistFanoutStatus,
        specialistFanoutReason: routeSummary.specialistFanoutReason,
        foundationReadinessAssessed: routeSummary.foundationReadinessAssessed,
        foundationReadinessUnknown: routeSummary.foundationReadinessUnknown,
        foundationRiskRaised: routeSummary.foundationRiskRaised,
        repeatedFoundationFailureObserved: routeSummary.repeatedFoundationFailureObserved,
        foundationRecoverySuggested: routeSummary.foundationRecoverySuggested,
        foundationFailureClasses: routeSummary.foundationFailureClasses,
        foundationRecoveryReason: routeSummary.foundationRecoveryReason,
        bootstrapFailureObserved: routeSummary.bootstrapFailureObserved,
        runtimeConfigMismatchObserved: routeSummary.runtimeConfigMismatchObserved,
        toolingMaterializationFailureObserved: routeSummary.toolingMaterializationFailureObserved,
        legacyHookPluginConflictObserved: routeSummary.legacyHookPluginConflictObserved,
        hookExecutionFailureObserved: routeSummary.hookExecutionFailureObserved,
        appFoundationFailureObserved: routeSummary.appFoundationFailureObserved,
        validationPortConflictObserved: routeSummary.validationPortConflictObserved,
        validationServerReadinessFailureObserved: routeSummary.validationServerReadinessFailureObserved,
        githubMemoryEnabledProbe: routeSummary.githubMemoryEnabledProbe,
        githubMemoryPromptProbe: routeSummary.githubMemoryPromptProbe,
        prLookup: routeSummary.prLookup,
        githubMemoryEnabledCheck: routeSummary.githubMemoryEnabledCheck,
        githubMemoryEnabledCheckCached: routeSummary.githubMemoryEnabledCheckCached,
        githubMemoryEnabledCheckCount: routeSummary.githubMemoryEnabledCheckCount,
        githubMemoryEnabledCheckSource: routeSummary.githubMemoryEnabledCheckSource,
        githubMemoryEnabledFreshAfterCacheObserved: routeSummary.githubMemoryEnabledFreshAfterCacheObserved,
        prContextCheck: routeSummary.prContextCheck,
        prContextCheckCached: routeSummary.prContextCheckCached,
        prContextCheckCount: routeSummary.prContextCheckCount,
        prContextCheckSource: routeSummary.prContextCheckSource,
        prContextFreshAfterCacheObserved: routeSummary.prContextFreshAfterCacheObserved,
        prLookupCheck: routeSummary.prLookupCheck,
        prLookupCheckCached: routeSummary.prLookupCheckCached,
        prLookupCheckSource: routeSummary.prLookupCheckSource,
        githubCapabilityCacheHits: routeSummary.githubCapabilityCacheHits,
        githubCapabilityCacheMisses: routeSummary.githubCapabilityCacheMisses,
        githubRepoIdentityMissingObserved: routeSummary.githubRepoIdentityMissingObserved,
        githubRepoIdentitySource: routeSummary.githubRepoIdentitySource,
        githubMemorySuppressedForMissingRepoIdentity: routeSummary.githubMemorySuppressedForMissingRepoIdentity,
        observedMemoryProbeSuppressed: routeSummary.observedMemoryProbeSuppressed,
        observedPrProbeSuppressed: routeSummary.observedPrProbeSuppressed,
        providerRetryObserved: routeSummary.providerRetryObserved,
        providerRetryActive: routeSummary.providerRetryActive,
        providerRetryState: routeSummary.providerRetryState,
        providerRetryRecovered: routeSummary.providerRetryRecovered,
        providerRetryCount: routeSummary.providerRetryCount,
        providerRetryReason: routeSummary.providerRetryReason,
        lastProviderTransportError: routeSummary.lastProviderTransportError,
        lastProviderRetryAt: routeSummary.lastProviderRetryAt,
        activeAgentDuringRetry: routeSummary.activeAgentDuringRetry,
        providerRetryConfidence: routeSummary.providerRetryConfidence,
        modelRateLimitObserved: routeSummary.modelRateLimitObserved,
        modelRateLimitCount: routeSummary.modelRateLimitCount,
        provider502Observed: routeSummary.provider502Observed,
        provider502Count: routeSummary.provider502Count,
        routeConfidence: routeSummary.routeConfidence,
        observedRuntimeModels: routeSummary.observedRuntimeModels,
        requestedRuntimeModel: routeSummary.requestedRuntimeModel,
        sessionCurrentModel: routeSummary.sessionCurrentModel,
        mixedModelSessionObserved: routeSummary.mixedModelSessionObserved,
        nonRequestedModelUsageObserved: routeSummary.nonRequestedModelUsageObserved,
        agentModelPolicyMismatchObserved: routeSummary.agentModelPolicyMismatchObserved,
        agentModelPolicyMismatchCount: routeSummary.agentModelPolicyMismatchCount,
        agentModelPolicyMismatches: routeSummary.agentModelPolicyMismatches,
        sessionStartHead,
        sessionEndHead,
        evidenceNotes: failureNotes,
        processLogPath
      });
      if (skipped) {
        report.overall = {
          status: "skipped",
          summary: "Copilot CLI is installed, but authenticated non-interactive prompt execution was unavailable."
        };
        writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
        writeText(args.reportMd, renderMarkdown(report));
        log(report.overall.summary);
        return;
      }
      continue;
    }

    const evidence =
      caseDef.kind === "mcp" && caseDef.capabilityId
        ? classifyMcpEvidence(caseDef.capabilityId as McpServerId, transcript, stdout, hookLog)
        : caseDef.kind === "lsp" && caseDef.capabilityId
          ? classifyLspEvidence(caseDef.capabilityId as KnownLspId, transcript, stdout, hookLog)
          : {
              strength: transcript.length > 0 ? ("strong-indirect" as ProofStrength) : ("unproven" as ProofStrength),
              pathKind: transcript.length > 0 ? ("selected" as CapabilityPath) : ("none" as CapabilityPath),
              notes: transcript.length > 0 ? ["bounded run produced a transcript artifact"] : ["missing transcript artifact"],
              matchedTokens: [],
              observedTools: []
            };

    let status: RuntimeCaseStatus = evidence.strength === "unproven" && caseDef.kind !== "agent" ? "unproven" : "passed";
    const evidenceNotes = [...githubProbePolicy.notes, ...evidence.notes];

    if (!fs.existsSync(transcriptPath) || fs.statSync(transcriptPath).size === 0) {
      status = "failed";
      evidenceNotes.push("transcript export missing or empty");
    }

    if (caseDef.requiredSubagents?.length) {
      const missing = caseDef.requiredSubagents.filter((name) => !observedSubagents.includes(name));
      if (missing.length > 0) {
        status = "failed";
        evidenceNotes.push(`missing expected subagents: ${missing.join(", ")}`);
      } else {
        evidenceNotes.push(`observed expected subagents: ${caseDef.requiredSubagents.join(", ")}`);
      }
    }

    if (caseDef.expectedSubagentOrder?.length) {
      if (!containsOrderedSubsequence(observedSubagents, caseDef.expectedSubagentOrder)) {
        status = "failed";
        evidenceNotes.push(`expected subagent order not observed: ${caseDef.expectedSubagentOrder.join(" -> ")}`);
      } else {
        evidenceNotes.push(`observed subagent order: ${caseDef.expectedSubagentOrder.join(" -> ")}`);
      }
    }

    if (caseDef.forbiddenSubagents?.length) {
      const unexpected = caseDef.forbiddenSubagents.filter((name) => observedSubagents.includes(name));
      if (unexpected.length > 0) {
        status = "failed";
        evidenceNotes.push(`forbidden subagents observed: ${unexpected.join(", ")}`);
      }
    }

    if (caseDef.minimumSubagentCounts) {
      for (const [name, minimum] of Object.entries(caseDef.minimumSubagentCounts)) {
        const observed = observedSubagentCounts[name] ?? 0;
        if (observed < minimum) {
          status = "failed";
          evidenceNotes.push(`expected at least ${minimum} ${name} subagent events but observed ${observed}`);
        } else {
          evidenceNotes.push(`observed ${observed} ${name} subagent events (minimum ${minimum})`);
        }
      }
    }

    if (caseDef.expectedFile) {
      const expectedPath = path.join(workspaceRoot, caseDef.expectedFile.relativePath);
      if (!fs.existsSync(expectedPath)) {
        status = "failed";
        evidenceNotes.push(`expected file missing: ${caseDef.expectedFile.relativePath}`);
      } else {
        const content = fs.readFileSync(expectedPath, "utf8");
        if (!content.includes(caseDef.expectedFile.expectedSubstring)) {
          status = "failed";
          evidenceNotes.push(`expected file content mismatch: ${caseDef.expectedFile.relativePath}`);
        } else {
          evidenceNotes.push(`expected workspace file created: ${caseDef.expectedFile.relativePath}`);
        }
      }
    }

    if (
      routeSummary.observedExecutionPhasePure === false &&
      routeSummary.postExecutionPlannerReopenAgents.length > 0 &&
      !routeSummary.ownershipLeakAllowedReason
    ) {
      status = "failed";
      evidenceNotes.push(
        `planner/reference lanes reopened after Patch Master: ${routeSummary.postExecutionPlannerReopenAgents.join(", ")}`
      );
    }
    if (routeSummary.postExecutionOwnershipLeakObserved && !routeSummary.ownershipLeakAllowedReason) {
      status = "failed";
      const leakAgents = [
        ...routeSummary.postExecutionPlannerReopenAgents,
        ...routeSummary.postExecutionGenericAgents
      ].join(", ");
      evidenceNotes.push(`post-execution ownership leak observed after Patch Master: ${leakAgents || "unknown lane"}`);
    }
    if (routeSummary.backgroundExecutionAgentUnresolved) {
      status = "failed";
      evidenceNotes.push(
        `background execution owner remained unresolved after Patch Master handoff: ${
          routeSummary.backgroundExecutionAgentIds.length > 0 ? routeSummary.backgroundExecutionAgentIds.join(", ") : "unknown background agent"
        }`
      );
    }
    if (routeSummary.triageDuplicateObserved && !routeSummary.triageDuplicateAllowedReason) {
      status = "failed";
      evidenceNotes.push("duplicate Triage observed after an execution-ready Milestone handoff");
    }
    if (routeSummary.postExecutionRootWriteObserved) {
      status = "failed";
      evidenceNotes.push(
        routeSummary.postExecutionRootPatchObserved
          ? `root reopened write ownership after Patch Master with ${routeSummary.postExecutionRootWriteCount} root-level write tool call(s), including apply_patch`
          : `root reopened write ownership after Patch Master with ${routeSummary.postExecutionRootWriteCount} root-level write tool call(s)`
      );
    }

    if (reportedChangeSummary && observedWorkspaceChangeSummary.repoWorkingTreeFiles.length > 0 && !reportedChangeSummary.repoWorkingTreeChanged) {
      evidenceNotes.push("CLI-reported codeChanges omitted repo working-tree edits that were observed in the workspace snapshot");
    }
    if (reportedChangeSummary?.sessionStateOnly) {
      evidenceNotes.push("CLI-reported codeChanges were limited to session-state artifacts for this case");
    }
    if (routeSummary.githubMemoryEnabledCheck === "reused_from_cache") {
      evidenceNotes.push("reused cached GitHub memory enablement for this repo/session");
    } else if (routeSummary.githubMemoryEnabledCheck === "checked_fresh") {
      evidenceNotes.push("GitHub memory enablement was checked fresh in this case");
    }
    if (routeSummary.prLookupCheck === "reused_from_cache") {
      evidenceNotes.push("reused cached GitHub PR capability state for this repo/session");
    } else if (routeSummary.prLookupCheck === "checked_fresh") {
      evidenceNotes.push("GitHub PR capability was checked fresh in this case");
    }
    if (routeSummary.githubMemoryEnabledFreshAfterCacheObserved) {
      status = "failed";
      evidenceNotes.push("GitHub memory enablement was checked fresh even though the same repo/session already had cached success");
    }
    if (routeSummary.prContextFreshAfterCacheObserved) {
      status = "failed";
      evidenceNotes.push("GitHub PR context was checked fresh even though the same repo/session already had cached success");
    }
    if (executionClaimWithoutObservedRepoDiff) {
      evidenceNotes.push("executionClaimWithoutObservedRepoDiff: execution reached Patch Master but no repo working-tree diff was observed");
    }
    if (
      !observedWorkspaceChangeSummary.repoWorkingTreeChanged &&
      (
        observedWorkspaceChangeSummary.sessionStateFiles.length > 0 ||
        observedWorkspaceChangeSummary.validationArtifactFiles.length > 0 ||
        observedWorkspaceChangeSummary.externalFiles.length > 0
      )
    ) {
      evidenceNotes.push("no repo working-tree diff was observed; only session-state, validation/report, or external artifacts changed");
    }
    if (routeSummary.providerRetryObserved) {
      evidenceNotes.push(`provider retry state: ${routeSummary.providerRetryState}`);
    }
    if (routeSummary.validationPortConflictObserved) {
      evidenceNotes.push("validation startability evidence included a port conflict");
    } else if (routeSummary.validationServerReadinessFailureObserved) {
      evidenceNotes.push("validation startability evidence included a server readiness failure");
    }

    report.cases.push({
      id: caseDef.id,
      title: caseDef.title,
      kind: caseDef.kind,
      agentLane: caseDef.agentLane,
      agentId: agent,
      capabilityId: caseDef.capabilityId,
      status,
      proofStrength: evidence.strength,
      capabilityPath: evidence.pathKind,
      transcriptPath: fs.existsSync(transcriptPath) ? transcriptPath : null,
      stdoutPath: processArtifacts.stdoutPath,
      stderrPath: processArtifacts.stderrPath,
      hookLogPath: hookSnapshotPath,
      reportedUsage,
      reportedChangeSummary,
      observedWorkspaceChangeSummary,
      executionClaimed,
      executionClaimWithoutObservedRepoDiff,
      observedTools: evidence.observedTools,
      observedSubagents,
      observedSubagentCounts,
      routeAgents: routeSummary.routeAgents,
      routeSummary: routeSummary.routeSummary,
      keyAgents: routeSummary.keyAgents,
      observedPlanningChain: routeSummary.observedPlanningChain,
      routeSummarySource: routeSummary.routeSummarySource,
      directToolExecutionObserved: routeSummary.directToolExecutionObserved,
      toolExecutionCount: routeSummary.toolExecutionCount,
      writeToolCount: routeSummary.writeToolCount,
      bashToolCount: routeSummary.bashToolCount,
      sessionShutdownObserved: routeSummary.sessionShutdownObserved,
      sessionShutdownCodeChangesObserved: routeSummary.sessionShutdownCodeChangesObserved,
      sessionShutdownFilesModified: routeSummary.sessionShutdownFilesModified,
      sessionShutdownLinesAdded: routeSummary.sessionShutdownLinesAdded,
      sessionShutdownLinesRemoved: routeSummary.sessionShutdownLinesRemoved,
      observedFrontDoorHandledDirectly: routeSummary.observedFrontDoorHandledDirectly,
      observedScoutCount: routeSummary.observedScoutCount,
      repoScoutInvocationCount: routeSummary.repoScoutInvocationCount,
      triageInvocationCount: routeSummary.triageInvocationCount,
      patchMasterInvocationCount: routeSummary.patchMasterInvocationCount,
      requiredCheckInvocationCount: routeSummary.requiredCheckInvocationCount,
      builtInGenericAgentInvocationCount: routeSummary.builtInGenericAgentInvocationCount,
      triageDuplicateObserved: routeSummary.triageDuplicateObserved,
      triageDuplicateAllowedReason: routeSummary.triageDuplicateAllowedReason,
      executionReadyHandoffSeenBeforeSecondTriage: routeSummary.executionReadyHandoffSeenBeforeSecondTriage,
      observedPlannerBeforeExecutor: routeSummary.observedPlannerBeforeExecutor,
      observedTriageBeforeExecutor: routeSummary.observedTriageBeforeExecutor,
      observedRefIndex: routeSummary.observedRefIndex,
      observedGroundingBeforeExecutor: routeSummary.observedGroundingBeforeExecutor,
      observedExecutionPhasePure: routeSummary.observedExecutionPhasePure,
      postExecutionPlannerReopenAgents: routeSummary.postExecutionPlannerReopenAgents,
      postExecutionGenericAgentObserved: routeSummary.postExecutionGenericAgentObserved,
      postExecutionBuiltInAgentObserved: routeSummary.postExecutionBuiltInAgentObserved,
      postExecutionGenericAgents: routeSummary.postExecutionGenericAgents,
      postExecutionBuiltInAgents: routeSummary.postExecutionBuiltInAgents,
      postExecutionOwnershipLeakObserved: routeSummary.postExecutionOwnershipLeakObserved,
      ownershipLeakAllowedReason: routeSummary.ownershipLeakAllowedReason,
      executionOwner: routeSummary.executionOwner,
      ownershipTransferredToExecution: routeSummary.ownershipTransferredToExecution,
      backgroundExecutionAgentObserved: routeSummary.backgroundExecutionAgentObserved,
      backgroundExecutionAgentUnresolved: routeSummary.backgroundExecutionAgentUnresolved,
      backgroundExecutionAgentIds: routeSummary.backgroundExecutionAgentIds,
      patchMasterHandoffWithoutCompletionObserved: routeSummary.patchMasterHandoffWithoutCompletionObserved,
      executionHandoffWithoutObservedRepoDiff: routeSummary.executionHandoffWithoutObservedRepoDiff,
      malformedTaskPayloadObserved: routeSummary.malformedTaskPayloadObserved,
      postExecutionRootWriteObserved: routeSummary.postExecutionRootWriteObserved,
      postExecutionRootPatchObserved: routeSummary.postExecutionRootPatchObserved,
      postExecutionRootWriteCount: routeSummary.postExecutionRootWriteCount,
      executionOwnerActiveRootWriteObserved: routeSummary.executionOwnerActiveRootWriteObserved,
      executionOwnerActiveRootWriteCount: routeSummary.executionOwnerActiveRootWriteCount,
      executionOwnerActiveRootPatchObserved: routeSummary.executionOwnerActiveRootPatchObserved,
      integrationClassTaskObserved: routeSummary.integrationClassTaskObserved,
      largeProductBuildTaskObserved: routeSummary.largeProductBuildTaskObserved,
      specialistLaneExpected: routeSummary.specialistLaneExpected,
      requiredSpecialistLanes: routeSummary.requiredSpecialistLanes,
      recommendedSpecialistLanes: routeSummary.recommendedSpecialistLanes,
      observedSpecialistLanes: routeSummary.observedSpecialistLanes,
      missingRequiredSpecialistLanes: routeSummary.missingRequiredSpecialistLanes,
      missingRecommendedSpecialistLanes: routeSummary.missingRecommendedSpecialistLanes,
      unobservedRecommendedSpecialistLanes: routeSummary.unobservedRecommendedSpecialistLanes,
      specialistFanoutObserved: routeSummary.specialistFanoutObserved,
      specialistFanoutPartial: routeSummary.specialistFanoutPartial,
      patchMasterSwarmObserved: routeSummary.patchMasterSwarmObserved,
      patchMasterSwarmCount: routeSummary.patchMasterSwarmCount,
      specialistFanoutCoveredByPatchMaster: routeSummary.specialistFanoutCoveredByPatchMaster,
      specialistFanoutStatus: routeSummary.specialistFanoutStatus,
      specialistFanoutReason: routeSummary.specialistFanoutReason,
      foundationReadinessAssessed: routeSummary.foundationReadinessAssessed,
      foundationReadinessUnknown: routeSummary.foundationReadinessUnknown,
      foundationRiskRaised: routeSummary.foundationRiskRaised,
      repeatedFoundationFailureObserved: routeSummary.repeatedFoundationFailureObserved,
      foundationRecoverySuggested: routeSummary.foundationRecoverySuggested,
      foundationFailureClasses: routeSummary.foundationFailureClasses,
      foundationRecoveryReason: routeSummary.foundationRecoveryReason,
      bootstrapFailureObserved: routeSummary.bootstrapFailureObserved,
      runtimeConfigMismatchObserved: routeSummary.runtimeConfigMismatchObserved,
      toolingMaterializationFailureObserved: routeSummary.toolingMaterializationFailureObserved,
      legacyHookPluginConflictObserved: routeSummary.legacyHookPluginConflictObserved,
      hookExecutionFailureObserved: routeSummary.hookExecutionFailureObserved,
      appFoundationFailureObserved: routeSummary.appFoundationFailureObserved,
      validationPortConflictObserved: routeSummary.validationPortConflictObserved,
      validationServerReadinessFailureObserved: routeSummary.validationServerReadinessFailureObserved,
      githubMemoryEnabledProbe: routeSummary.githubMemoryEnabledProbe,
      githubMemoryPromptProbe: routeSummary.githubMemoryPromptProbe,
      prLookup: routeSummary.prLookup,
      githubMemoryEnabledCheck: routeSummary.githubMemoryEnabledCheck,
      githubMemoryEnabledCheckCached: routeSummary.githubMemoryEnabledCheckCached,
      githubMemoryEnabledCheckCount: routeSummary.githubMemoryEnabledCheckCount,
      githubMemoryEnabledCheckSource: routeSummary.githubMemoryEnabledCheckSource,
      githubMemoryEnabledFreshAfterCacheObserved: routeSummary.githubMemoryEnabledFreshAfterCacheObserved,
      prContextCheck: routeSummary.prContextCheck,
      prContextCheckCached: routeSummary.prContextCheckCached,
      prContextCheckCount: routeSummary.prContextCheckCount,
      prContextCheckSource: routeSummary.prContextCheckSource,
      prContextFreshAfterCacheObserved: routeSummary.prContextFreshAfterCacheObserved,
      prLookupCheck: routeSummary.prLookupCheck,
      prLookupCheckCached: routeSummary.prLookupCheckCached,
      prLookupCheckSource: routeSummary.prLookupCheckSource,
      githubCapabilityCacheHits: routeSummary.githubCapabilityCacheHits,
      githubCapabilityCacheMisses: routeSummary.githubCapabilityCacheMisses,
      githubRepoIdentityMissingObserved: routeSummary.githubRepoIdentityMissingObserved,
      githubRepoIdentitySource: routeSummary.githubRepoIdentitySource,
      githubMemorySuppressedForMissingRepoIdentity: routeSummary.githubMemorySuppressedForMissingRepoIdentity,
      observedMemoryProbeSuppressed: routeSummary.observedMemoryProbeSuppressed,
      observedPrProbeSuppressed: routeSummary.observedPrProbeSuppressed,
      providerRetryObserved: routeSummary.providerRetryObserved,
      providerRetryActive: routeSummary.providerRetryActive,
      providerRetryState: routeSummary.providerRetryState,
      providerRetryRecovered: routeSummary.providerRetryRecovered,
      providerRetryCount: routeSummary.providerRetryCount,
      providerRetryReason: routeSummary.providerRetryReason,
      lastProviderTransportError: routeSummary.lastProviderTransportError,
      lastProviderRetryAt: routeSummary.lastProviderRetryAt,
      activeAgentDuringRetry: routeSummary.activeAgentDuringRetry,
      providerRetryConfidence: routeSummary.providerRetryConfidence,
      modelRateLimitObserved: routeSummary.modelRateLimitObserved,
      modelRateLimitCount: routeSummary.modelRateLimitCount,
      provider502Observed: routeSummary.provider502Observed,
      provider502Count: routeSummary.provider502Count,
      routeConfidence: routeSummary.routeConfidence,
      observedRuntimeModels: routeSummary.observedRuntimeModels,
      requestedRuntimeModel: routeSummary.requestedRuntimeModel,
      sessionCurrentModel: routeSummary.sessionCurrentModel,
      mixedModelSessionObserved: routeSummary.mixedModelSessionObserved,
      nonRequestedModelUsageObserved: routeSummary.nonRequestedModelUsageObserved,
      agentModelPolicyMismatchObserved: routeSummary.agentModelPolicyMismatchObserved,
      agentModelPolicyMismatchCount: routeSummary.agentModelPolicyMismatchCount,
      agentModelPolicyMismatches: routeSummary.agentModelPolicyMismatches,
      sessionStartHead,
      sessionEndHead,
      evidenceNotes,
      processLogPath
    });
  }

  for (const server of report.mcpServers) {
    const runtimeCase = report.cases.find((entry) => entry.capabilityId === server.id);
    if (runtimeCase) server.runtimeCaseId = runtimeCase.id;
  }
  for (const server of report.lspServers) {
    const runtimeCase = report.cases.find((entry) => entry.capabilityId === server.id);
    if (runtimeCase) server.runtimeCaseId = runtimeCase.id;
  }

  const casesWithReportedUsage = report.cases.filter((entry) => entry.reportedUsage);
  report.localUsage.casesWithReportedUsage = casesWithReportedUsage.length;
  report.localUsage.reportedPremiumRequests = casesWithReportedUsage.reduce(
    (total, entry) => total + (entry.reportedUsage?.premiumRequests ?? 0),
    0
  );
  report.localUsage.reportedApiDurationMs = casesWithReportedUsage.reduce(
    (total, entry) => total + (entry.reportedUsage?.totalApiDurationMs ?? 0),
    0
  );
  report.localUsage.casesWithObservedRepoChanges = report.cases.filter(
    (entry) => entry.observedWorkspaceChangeSummary?.repoWorkingTreeChanged
  ).length;
  report.localUsage.casesWithOnlySessionStateChanges = report.cases.filter(
    (entry) => entry.observedWorkspaceChangeSummary?.sessionStateOnly
  ).length;
  report.localUsage.casesWithExecutionClaimWithoutObservedRepoDiff = report.cases.filter(
    (entry) => entry.executionClaimWithoutObservedRepoDiff
  ).length;

  const failedCases = report.cases.filter((entry) => entry.status === "failed");
  const passedCoreCases = report.cases.filter(
    (entry) =>
      [
        "front-door-routing",
        "docs-heavy-entry",
        "planning-cold-start",
        "scout-discovery",
        "docs-reference",
        "deep-implementation"
      ].includes(entry.id) &&
      entry.status === "passed"
  ).length;
  const strongOrExplicitRuntime = report.cases.filter(
    (entry) => entry.kind !== "agent" && (entry.proofStrength === "explicit" || entry.proofStrength === "strong-indirect")
  ).length;

  if (report.structural.status === "failed") {
    report.overall = {
      status: "failed",
      summary: "Structural validation failed before or during live runtime validation. Review structural notes and artifacts."
    };
  } else if (failedCases.length > 0) {
    report.overall = {
      status: "failed",
      summary: `${failedCases.length} runtime validation case(s) failed. Review runtime-validation.md and artifacts.`
    };
  } else if (passedCoreCases < 6) {
    report.overall = {
      status: "partial",
      summary: "Core planning or execution lanes did not all complete successfully."
    };
  } else if (strongOrExplicitRuntime === 0) {
    report.overall = {
      status: "partial",
      summary: "Bounded Copilot CLI runs succeeded, but MCP/LSP usage remained unproven or weakly proven."
    };
  } else {
    report.overall = {
      status: "passed",
      summary: `Core lanes completed and ${strongOrExplicitRuntime} capability case(s) produced explicit or strong-indirect runtime proof.`
    };
  }

  writeText(args.reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeText(args.reportMd, renderMarkdown(report));
  log(`Runtime validation ${report.overall.status}.`);
  log(`JSON report: ${args.reportJson}`);
  log(`Markdown report: ${args.reportMd}`);
  if (report.tempWorkspace) {
    log(`Temporary workspace: ${report.tempWorkspace}`);
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
