import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exists, repoRoot } from "./helpers.js";

for (const script of [
  "scripts/bootstrap-xgc-stack.sh",
  "scripts/generate-runtime-surfaces.sh",
  "scripts/install-global-xgc.sh",
  "scripts/uninstall-global-xgc.sh",
  "scripts/xgc-shell.sh",
  "scripts/use-xgc-env.sh",
  "scripts/setup-copilot-cli.sh",
  "scripts/setup-workspace.sh",
  "scripts/validate-plugin.sh",
  "scripts/smoke-test.sh",
  "scripts/sync-agents.sh",
  "scripts/hooks/common.sh"
]) {
  test(`script parses: ${script}`, () => {
    assert.ok(exists(script));
    execFileSync("bash", ["-n", path.join(repoRoot, script)]);
  });
}

test("TypeScript script entrypoints exist", () => {
  for (const script of [
    "scripts/generate-runtime-surfaces.ts",
    "scripts/generate-release-manifest.ts",
    "scripts/materialize-global-xgc.ts",
    "scripts/report-session-bundle.ts",
    "scripts/report-runtime-surfaces.ts",
    "scripts/render-tooling-config.ts",
    "scripts/validate-global-xgc.ts",
    "scripts/validate-plugin.ts",
    "scripts/smoke-copilot-cli.ts",
    "scripts/lib/global-xgc.ts",
    "scripts/lib/update-policy.ts",
    "scripts/lib/runtime-surfaces.ts",
    "scripts/lib/tooling-config.ts"
  ]) {
    assert.ok(exists(script));
  }
  assert.ok(exists("scripts/xgc-update.mjs"));
  execFileSync("node", ["--check", path.join(repoRoot, "scripts", "xgc-update.mjs")]);
});

test("session bundle report synthesizes SESSION_RESULTS and SESSION_MATRIX without packaging", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-report-"));
  const sessionDir = path.join(bundleRoot, "session-1");
  const incompleteSessionDir = path.join(bundleRoot, "session-2");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(incompleteSessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-1",
      "route_summary: Repo Master -> Patch Master",
      "session_outcome: success",
      "summary_authority: finalized_with_gaps",
      "archive_completeness: partial",
      'archive_completeness_reasons: ["matching process log was unavailable"]',
      "validation_status: failed",
      "validation_overclaim_observed: true",
      'repo_working_tree_files: ["app.ts"]',
      'committed_repo_files: ["src/page.tsx"]',
      "integration_class_task_observed: true",
      "foundation_readiness_unknown: true",
      "shared_surface_change_observed: true",
      "shared_surface_owner_declared: false",
      "shared_surface_conflict_risk: true",
      "shared_surface_review_recommended: true",
      "foundation_recovery_suggested: false",
      ""
    ].join("\n")
  );
  fs.writeFileSync(path.join(sessionDir, "events.jsonl"), "{}\n");
  const validationTruthDir = path.join(bundleRoot, ".xgc", "validation");
  fs.mkdirSync(validationTruthDir, { recursive: true });
  fs.writeFileSync(
    path.join(validationTruthDir, "workspace.yaml"),
    [
      "id: session-1",
      "operator_truth_source: repo-owned-validation-workspace",
      `source_session_workspace_yaml: ${path.join(sessionDir, "workspace.yaml")}`,
      "route_summary: Repo Master -> Validation Snapshot",
      "route_summary_source: started_with_fallbacks",
      "session_outcome: success",
      "session_outcome_detail: completed_with_validation_passed",
      "summary_authority: authoritative",
      "summary_finalization_status: finalized",
      "finalization_complete: true",
      "finalization_partial: false",
      "finalization_error: false",
      "archive_completeness: complete",
      `process_log: ${path.join(sessionDir, "process-1.log")}`,
      "validation_status: passed",
      "validation_overclaim_observed: false",
      "validation_raw_status: passed",
      "working_tree_clean: true",
      "route_summary_available: true",
      "route_summary_derived_from_raw_events: true",
      "route_summary_heuristic: false",
      "direct_tool_execution_observed: false",
      "summary_route_heuristic_mismatch: false",
      "summary_timestamp_stale: false",
      "repo_working_tree_files: []",
      'committed_repo_files: ["src/page.tsx"]',
      'key_agents: ["Repo Master", "Patch Master"]',
      "repo_scout_invocation_count: 1",
      "triage_invocation_count: 0",
      "patch_master_invocation_count: 2",
      "required_check_invocation_count: 0",
      "built_in_generic_agent_invocation_count: 0",
      "post_execution_planner_reopen_agents: []",
      "post_execution_generic_agent_observed: false",
      "post_execution_built_in_agent_observed: false",
      "post_execution_generic_agents: []",
      "post_execution_built_in_agents: []",
      "committed_diff_source: git-head-range",
      "execution_claim_without_observed_repo_diff: false",
      "post_execution_ownership_leak_observed: false",
      "post_execution_root_write_observed: false",
      "post_execution_root_patch_observed: false",
      "post_execution_root_write_count: 0",
      "ownership_leak_allowed_reason: null",
      "execution_owner: Patch Master",
      "ownership_transferred_to_execution: true",
      "integration_class_task_observed: true",
      "foundation_readiness_assessed: true",
      "foundation_readiness_unknown: false",
      "foundation_risk_raised: false",
      "repeated_foundation_failure_observed: false",
      'foundation_failure_classes: ["runtime-transport"]',
      "foundation_recovery_reason: null",
      "bootstrap_failure_observed: true",
      "runtime_config_mismatch_observed: false",
      "tooling_materialization_failure_observed: false",
      "legacy_hook_plugin_conflict_observed: false",
      "hook_execution_failure_observed: false",
      "validation_port_conflict_observed: false",
      "validation_server_readiness_failure_observed: false",
      "app_foundation_failure_observed: false",
      "integration_owned_surfaces_touched: []",
      "shared_surface_change_observed: true",
      "shared_surface_owner_declared: true",
      "shared_surface_conflict_risk: false",
      "shared_surface_review_recommended: true",
      "shared_surface_final_integrator_needed: false",
      "foundation_recovery_suggested: false",
      "github_memory_enabled_check: disabled_after_404",
      "github_memory_enabled_check_cached: true",
      "github_memory_enabled_check_count: 0",
      "github_memory_enabled_success_count: 0",
      "pr_context_check: disabled_after_404",
      "pr_context_check_cached: true",
      "pr_context_check_count: 0",
      "github_pr_lookup_success_count: 0",
      "github_capability_cache_hits: 2",
      "github_capability_cache_misses: 0",
      "github_memory_enabled_fresh_after_cache_observed: false",
      "pr_context_fresh_after_cache_observed: false",
      'probe_cache_summary: ["memory-enabled", "memory-prompt", "pr-lookup"]',
      "provider_retry_observed: true",
      "provider_retry_state: recovered",
      "provider_retry_count: 1",
      "provider_retry_reason: http2_goaway",
      "user_abort_observed: false",
      "subagent_failure_observed: false",
      "terminal_provider_failure_observed: false",
      "model_rate_limit_observed: false",
      "model_rate_limit_count: 0",
      "provider_502_observed: false",
      "provider_502_count: 0",
      "requested_runtime_model: claude-sonnet-4.6",
      "session_current_model: gpt-5.4",
      'observed_runtime_models: ["claude-sonnet-4.6", "gpt-5.4"]',
      "mixed_model_session_observed: true",
      "non_requested_model_usage_observed: true",
      "model_identity_mismatch_observed: false",
      "specialist_lane_expected: true",
      "required_specialist_lanes: []",
      'recommended_specialist_lanes: ["visual-forge", "writing-desk"]',
      "observed_specialist_lanes: []",
      "missing_required_specialist_lanes: []",
      'unobserved_recommended_specialist_lanes: ["visual-forge", "writing-desk"]',
      "specialist_fanout_observed: true",
      "specialist_fanout_partial: false",
      "specialist_fanout_covered_by_patch_master: true",
      "specialist_fanout_status: covered_by_patch_master_swarm",
      "specialist_fanout_reason: patch master swarm covered specialist work",
      "patch_master_swarm_observed: true",
      "patch_master_swarm_count: 13",
      "github_repo_identity_missing_observed: true",
      "github_repo_identity_source: local_repo_without_github_remote",
      "github_memory_suppressed_for_missing_repo_identity: true",
      "summary_route_count_mismatch: false",
      "summary_capability_count_mismatch: false",
      ""
    ].join("\n")
  );
  fs.writeFileSync(path.join(sessionDir, "process-1.log"), `2026-04-14T09:00:00.000Z [INFO] ${sessionDir}\n`);
  fs.writeFileSync(
    path.join(incompleteSessionDir, "workspace.yaml"),
    [
      "id: session-2",
      "operator_truth_source: repo-owned-validation-workspace",
      "summary_authority: authoritative",
      "archive_completeness: complete",
      "validation_status: passed",
      "process_log: /original/machine/process-123.log",
      ""
    ].join("\n")
  );

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const resultsPath = path.join(bundleRoot, "SESSION_RESULTS.json");
  const matrixPath = path.join(bundleRoot, "SESSION_MATRIX.md");
  assert.ok(fs.existsSync(resultsPath));
  assert.ok(fs.existsSync(matrixPath));
  const results = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as {
    sessionCount: number;
    sessions: Array<{
      sessionId: string;
      archiveCompleteness: string;
      sessionOutcomeDetail: string | null;
      validationOverclaimObserved: boolean | null;
      externalValidationStatus: string | null;
      externalValidationCommandFailureCount: number | null;
      externalValidationArtifactFileCount: number | null;
      validationStatusConflictObserved: boolean | null;
      repoWorkingTreeFileCount: number;
      committedRepoFileCount: number;
      workspaceTruthSource: string;
      workspaceYamlPath: string;
      routeSummary: string | null;
      routeSummaryAvailable: boolean | null;
      routeSummaryDerivedFromRawEvents: boolean | null;
      routeSummaryHeuristic: boolean | null;
      routeSummarySource: string;
      summaryRouteHeuristicMismatch: boolean | null;
      summaryTimestampStale: boolean | null;
      directToolExecutionObserved: boolean | null;
      summaryFinalizationStatus: string;
      finalizationComplete: boolean | null;
      workingTreeClean: boolean | null;
      committedDiffSource: string | null;
      keyAgents: string[];
      repoScoutInvocationCount: number | null;
      patchMasterInvocationCount: number | null;
      executionClaimWithoutObservedRepoDiff: boolean | null;
      postExecutionOwnershipLeakObserved: boolean | null;
      postExecutionRootWriteObserved: boolean | null;
      postExecutionRootWriteCount: number | null;
      ownershipLeakAllowedReason: string | null;
      executionOwner: string | null;
      ownershipTransferredToExecution: boolean | null;
      integrationClassTaskObserved: boolean | null;
      foundationReadinessAssessed: boolean | null;
      foundationReadinessUnknown: boolean | null;
      foundationRiskRaised: boolean | null;
      foundationFailureClasses: string[];
      bootstrapFailureObserved: boolean | null;
      runtimeConfigMismatchObserved: boolean | null;
      toolingMaterializationFailureObserved: boolean | null;
      legacyHookPluginConflictObserved: boolean | null;
      hookExecutionFailureObserved: boolean | null;
      appFoundationFailureObserved: boolean | null;
      sharedSurfaceChangeObserved: boolean | null;
      sharedSurfaceOwnerDeclared: boolean | null;
      sharedSurfaceConflictRisk: boolean | null;
      sharedSurfaceReviewRecommended: boolean | null;
      sharedSurfaceFinalIntegratorNeeded: boolean | null;
      githubMemoryEnabledCheck: string | null;
      prContextCheck: string | null;
      providerRetryObserved: boolean | null;
      userAbortObserved: boolean | null;
      subagentFailureObserved: boolean | null;
      terminalProviderFailureObserved: boolean | null;
      requestedRuntimeModel: string | null;
      sessionCurrentModel: string | null;
      observedRuntimeModels: string[];
      mixedModelSessionObserved: boolean | null;
      nonRequestedModelUsageObserved: boolean | null;
      modelIdentityMismatchObserved: boolean | null;
      specialistFanoutStatus: string | null;
      patchMasterSwarmCount: number | null;
      githubRepoIdentityMissingObserved: boolean | null;
      githubRepoIdentitySource: string | null;
      githubMemorySuppressedForMissingRepoIdentity: boolean | null;
    }>;
  };
  assert.equal(results.sessionCount, 2);
  const session1 = results.sessions.find((session) => session.sessionId === "session-1");
  const session2 = results.sessions.find((session) => session.sessionId === "session-2");
  assert.ok(session1);
  assert.ok(session2);
  assert.equal(session1.workspaceTruthSource, "repo-owned-validation-workspace");
  assert.equal(session1.workspaceYamlPath, path.join(validationTruthDir, "workspace.yaml"));
  assert.equal(session1.routeSummary, "Repo Master -> Validation Snapshot");
  assert.equal(session1.routeSummaryAvailable, true);
  assert.equal(session1.routeSummaryDerivedFromRawEvents, true);
  assert.equal(session1.routeSummaryHeuristic, false);
  assert.equal(session1.routeSummarySource, "started_with_fallbacks");
  assert.equal(session1.summaryRouteHeuristicMismatch, false);
  assert.equal(session1.summaryTimestampStale, false);
  assert.equal(session1.directToolExecutionObserved, false);
  assert.equal(session1.summaryFinalizationStatus, "finalized");
  assert.equal(session1.finalizationComplete, true);
  assert.equal(session1.workingTreeClean, true);
  assert.equal(session1.committedDiffSource, "git-head-range");
  assert.deepEqual(session1.keyAgents, ["Repo Master", "Patch Master"]);
  assert.equal(session1.repoScoutInvocationCount, 1);
  assert.equal(session1.patchMasterInvocationCount, 2);
  assert.equal(session1.executionClaimWithoutObservedRepoDiff, false);
  assert.equal(session1.postExecutionOwnershipLeakObserved, false);
  assert.equal(session1.postExecutionRootWriteObserved, false);
  assert.equal(session1.postExecutionRootWriteCount, 0);
  assert.equal(session1.ownershipLeakAllowedReason, null);
  assert.equal(session1.executionOwner, "Patch Master");
  assert.equal(session1.ownershipTransferredToExecution, true);
  assert.equal(session1.integrationClassTaskObserved, true);
  assert.equal(session1.foundationReadinessAssessed, true);
  assert.equal(session1.foundationReadinessUnknown, false);
  assert.equal(session1.foundationRiskRaised, false);
  assert.deepEqual(session1.foundationFailureClasses, ["runtime-transport"]);
  assert.equal(session1.bootstrapFailureObserved, true);
  assert.equal(session1.runtimeConfigMismatchObserved, false);
  assert.equal(session1.toolingMaterializationFailureObserved, false);
  assert.equal(session1.legacyHookPluginConflictObserved, false);
  assert.equal(session1.hookExecutionFailureObserved, false);
  assert.equal(session1.appFoundationFailureObserved, false);
  assert.equal(session1.sharedSurfaceChangeObserved, true);
  assert.equal(session1.sharedSurfaceOwnerDeclared, true);
  assert.equal(session1.sharedSurfaceConflictRisk, false);
  assert.equal(session1.sharedSurfaceReviewRecommended, true);
  assert.equal(session1.sharedSurfaceFinalIntegratorNeeded, false);
  assert.equal(session1.githubMemoryEnabledCheck, "disabled_after_404");
  assert.equal(session1.prContextCheck, "disabled_after_404");
  assert.equal(session1.providerRetryObserved, true);
  assert.equal(session1.userAbortObserved, false);
  assert.equal(session1.subagentFailureObserved, false);
  assert.equal(session1.terminalProviderFailureObserved, false);
  assert.equal(session1.specialistFanoutStatus, "covered_by_patch_master_swarm");
  assert.equal(session1.patchMasterSwarmCount, 13);
  assert.equal(session1.githubRepoIdentityMissingObserved, true);
  assert.equal(session1.githubRepoIdentitySource, "local_repo_without_github_remote");
  assert.equal(session1.githubMemorySuppressedForMissingRepoIdentity, true);
  assert.equal(session1.archiveCompleteness, "complete");
  assert.equal(session1.sessionOutcomeDetail, "completed_with_validation_passed");
  assert.equal(session1.validationOverclaimObserved, false);
  assert.equal(session1.externalValidationStatus, null);
  assert.equal(session1.validationStatusConflictObserved, false);
  assert.equal(session1.requestedRuntimeModel, "claude-sonnet-4.6");
  assert.equal(session1.sessionCurrentModel, "gpt-5.4");
  assert.deepEqual(session1.observedRuntimeModels, ["claude-sonnet-4.6", "gpt-5.4"]);
  assert.equal(session1.mixedModelSessionObserved, true);
  assert.equal(session1.nonRequestedModelUsageObserved, true);
  assert.equal(session1.modelIdentityMismatchObserved, false);
  assert.equal(session1.repoWorkingTreeFileCount, 0);
  assert.equal(session1.committedRepoFileCount, 1);
  assert.equal(session2.workspaceTruthSource, "session-state-workspace");
  assert.equal(session2.archiveCompleteness, "incomplete");
  const matrix = fs.readFileSync(matrixPath, "utf8");
  assert.match(matrix, /Session Matrix/);
  assert.match(matrix, /session-1/);
  assert.match(matrix, /repo-owned-validation-workspace/);
  assert.match(matrix, /session-2/);
  assert.match(matrix, /incomplete/);
  assert.match(matrix, /Foundation Unknown/);
  assert.match(matrix, /Foundation Risk/);
  assert.match(matrix, /Shared Change/);
  assert.match(matrix, /Shared Owner/);
  assert.match(matrix, /Shared Review/);
  assert.match(matrix, /Final Integrator/);
  assert.match(matrix, /Execution Owner/);
  assert.match(matrix, /Ownership Leak/);
  assert.match(matrix, /Diff Source/);
  assert.match(matrix, /User Abort/);
  assert.match(matrix, /Subagent Failure/);
  assert.match(matrix, /Terminal Provider Failure/);
  assert.match(matrix, /External Validation/);
  assert.match(matrix, /Validation Conflict/);
  assert.match(matrix, /Specialist Fanout/);
  assert.match(matrix, /Patch Master Swarm/);
  assert.match(matrix, /GitHub Memory Check/);
  assert.match(matrix, /GitHub Repo Identity Missing/);
  assert.match(matrix, /GitHub Repo Identity Source/);
  assert.match(matrix, /GitHub Memory Suppressed For Missing Identity/);
  assert.match(matrix, /Requested Model/);
  assert.match(matrix, /Current Model/);
  assert.match(matrix, /Mixed Model/);
  assert.match(matrix, /Model Identity Mismatch/);
  assert.match(matrix, /Foundation Classes/);
  assert.match(matrix, /local_repo_without_github_remote/);
  assert.match(matrix, /covered_by_patch_master_swarm/);
  assert.match(matrix, /runtime-transport/);
  const matrixLines = matrix.split("\n").filter((line) => line.startsWith("| "));
  const headerCells = matrixLines[0].split("|").slice(1, -1).map((cell) => cell.trim());
  const session1Cells = matrixLines.find((line) => line.startsWith("| session-1 |"))?.split("|").slice(1, -1).map((cell) => cell.trim());
  assert.ok(session1Cells);
  assert.equal(session1Cells.length, headerCells.length);
  const matrixValue = (columnName: string) => {
    const columnIndex = headerCells.indexOf(columnName);
    assert.notEqual(columnIndex, -1, `missing matrix column ${columnName}`);
    return session1Cells[columnIndex];
  };
  assert.equal(matrixValue("Foundation Classes"), "runtime-transport");
  assert.equal(matrixValue("Shared Change"), "yes");
  assert.equal(matrixValue("Shared Owner"), "yes");
  assert.equal(matrixValue("Shared Review"), "yes");
  assert.equal(matrixValue("GitHub Repo Identity Missing"), "yes");
  assert.equal(matrixValue("GitHub Repo Identity Source"), "local_repo_without_github_remote");
  assert.equal(matrixValue("GitHub Memory Suppressed For Missing Identity"), "yes");
  assert.equal(matrixValue("Requested Model"), "claude-sonnet-4.6");
  assert.equal(matrixValue("Current Model"), "gpt-5.4");
  assert.equal(matrixValue("Observed Models"), "claude-sonnet-4.6, gpt-5.4");
  assert.equal(matrixValue("Mixed Model"), "yes");
  assert.equal(matrixValue("Model Identity Mismatch"), "no");
  assert.equal(matrixValue("User Abort"), "no");
  assert.equal(matrixValue("Subagent Failure"), "no");
  assert.equal(matrixValue("Terminal Provider Failure"), "no");
});

test("session bundle report refreshes stale session workspace from terminal events", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-refresh-"));
  const workspaceRoot = path.join(bundleRoot, "workspace");
  const sessionDir = path.join(bundleRoot, "copilot-session-state", "session-stale");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-stale",
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Build AtlasField Command",
      "created_at: 2026-04-15T08:00:00.000Z",
      "updated_at: 2026-04-15T08:01:00.000Z",
      "latest_event_at: 2026-04-15T08:01:00.000Z",
      "final_status: in_progress",
      "summary_finalization_status: partial",
      "archive_completeness: partial",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(sessionDir, "events.jsonl"),
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T08:00:00.000Z" }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-15T08:00:05.000Z", data: { content: "Build AtlasField Command" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T08:00:10.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T08:00:20.000Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T08:00:30.000Z",
        data: {
          text: "Confirmed: Playwright requires `npx playwright install chromium` before `npx playwright test` or it errors with \"browser not found.\" This step is not in `package.json` scripts."
        }
      }),
      JSON.stringify({ type: "abort", timestamp: "2026-04-15T08:02:00.000Z", data: { reason: "user initiated" } }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-15T08:02:10.000Z",
        data: { shutdownType: "routine", codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] } }
      })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(path.join(sessionDir, "process-1.log"), "process log\n");

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessions: Array<{
      sessionId: string;
      summaryFinalizationStatus: string;
      userAbortObserved: boolean;
      sessionOutcome: string;
      foundationRiskRaised: boolean;
      foundationFailureClasses: string[];
      latestEventAt: string;
    }>;
  };
  assert.equal(results.sessions.length, 1);
  assert.equal(results.sessions[0].sessionId, "session-stale");
  assert.equal(results.sessions[0].summaryFinalizationStatus, "stopped");
  assert.equal(results.sessions[0].userAbortObserved, true);
  assert.equal(results.sessions[0].sessionOutcome, "incomplete");
  assert.equal(results.sessions[0].foundationRiskRaised, false);
  assert.deepEqual(results.sessions[0].foundationFailureClasses, []);
  assert.equal(results.sessions[0].latestEventAt, "2026-04-15T08:02:10.000Z");
  const refreshedWorkspaceYaml = fs.readFileSync(path.join(sessionDir, "workspace.yaml"), "utf8");
  assert.match(refreshedWorkspaceYaml, /^stop_reason: "?abort"?$/m);
  assert.doesNotMatch(refreshedWorkspaceYaml, /^stop_reason: "?end_turn"?$/m);
});

test("session bundle report surfaces external validation logs without workspace summaries", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-external-validation-"));
  const validationDir = path.join(bundleRoot, "cycle-07-gpt-5.4-3b9b9324-6578-46be-b2c4-de10a9067322", "validation-logs");
  fs.mkdirSync(validationDir, { recursive: true });
  fs.writeFileSync(path.join(validationDir, "summary.txt"), ["01-npm-install 0", "02-test 0", "03-build 0", ""].join("\n"));
  fs.writeFileSync(path.join(validationDir, "02-test.log"), ["npm test", "EXIT_STATUS=0", ""].join("\n"));

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessionCount: number;
    sessions: Array<{
      sessionId: string;
      workspaceTruthSource: string;
      externalValidationStatus: string | null;
      externalValidationCommandFailureCount: number | null;
      externalValidationArtifactFileCount: number | null;
      missingFiles: string[];
    }>;
  };
  assert.equal(results.sessionCount, 1);
  assert.equal(results.sessions[0].sessionId, "3b9b9324-6578-46be-b2c4-de10a9067322");
  assert.equal(results.sessions[0].workspaceTruthSource, "external-validation-logs");
  assert.equal(results.sessions[0].externalValidationStatus, "passed");
  assert.equal(results.sessions[0].externalValidationCommandFailureCount, 0);
  assert.equal(results.sessions[0].externalValidationArtifactFileCount, 2);
  assert.deepEqual(results.sessions[0].missingFiles, ["workspace.yaml", "events.jsonl", "process_log"]);
});

test("session bundle report flags workspace and external validation conflicts", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-validation-conflict-"));
  const sessionDir = path.join(bundleRoot, "cycle-07-gpt-5.4-session-conflict");
  const validationDir = path.join(sessionDir, "validation-logs");
  fs.mkdirSync(validationDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    ["id: session-conflict", "validation_status: failed", "archive_completeness: complete", ""].join("\n")
  );
  fs.writeFileSync(path.join(sessionDir, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(sessionDir, "process.log"), "done\n");
  fs.writeFileSync(path.join(validationDir, "summary.txt"), ["01-npm-install 0", "02-test 0", ""].join("\n"));

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessions: Array<{
      sessionId: string;
      validationStatus: string;
      externalValidationStatus: string | null;
      validationStatusConflictObserved: boolean | null;
    }>;
  };
  const session = results.sessions.find((entry) => entry.sessionId === "session-conflict");
  assert.ok(session);
  assert.equal(session.validationStatus, "failed");
  assert.equal(session.externalValidationStatus, "passed");
  assert.equal(session.validationStatusConflictObserved, true);
});

test("session bundle report uses bundled same-session evidence when source_session_workspace_yaml is stale", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-stale-source-"));
  const bundledSessionDir = path.join(bundleRoot, "copilot-session-state", "session-extracted");
  const validationTruthDir = path.join(bundleRoot, ".xgc", "validation");
  fs.mkdirSync(bundledSessionDir, { recursive: true });
  fs.mkdirSync(validationTruthDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundledSessionDir, "workspace.yaml"),
    [
      "id: session-extracted",
      "updated_at: 2026-04-14T10:00:00.000Z",
      "latest_event_at: 2026-04-14T09:59:30.000Z",
      "summary_authority: authoritative",
      ""
    ].join("\n")
  );
  fs.writeFileSync(path.join(bundledSessionDir, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(bundledSessionDir, "process-123.log"), "process log\n");
  fs.writeFileSync(
    path.join(validationTruthDir, "workspace.yaml"),
    [
      "id: session-extracted",
      "operator_truth_source: repo-owned-validation-workspace",
      "source_session_workspace_yaml: /Users/original/.copilot-xgc/session-state/session-extracted/workspace.yaml",
      "updated_at: 2026-04-14T10:01:00.000Z",
      "latest_event_at: 2026-04-14T10:00:30.000Z",
      "route_summary: Repo Master -> Patch Master",
      "summary_authority: authoritative",
      "archive_completeness: complete",
      "process_log: /Users/original/.copilot-xgc/session-state/session-extracted/process-123.log",
      "validation_status: passed",
      ""
    ].join("\n")
  );

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessions: Array<{ sessionId: string; archiveCompleteness: string; missingFiles: string[]; workspaceTruthSource: string }>;
  };
  assert.equal(results.sessions.length, 1);
  assert.equal(results.sessions[0].sessionId, "session-extracted");
  assert.equal(results.sessions[0].workspaceTruthSource, "repo-owned-validation-workspace");
  assert.equal(results.sessions[0].archiveCompleteness, "complete");
  assert.deepEqual(results.sessions[0].missingFiles, []);
});

test("session bundle report does not treat an unbundled absolute process log as complete evidence", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-unbundled-process-"));
  const bundledSessionDir = path.join(bundleRoot, "copilot-session-state", "session-extracted");
  const validationTruthDir = path.join(bundleRoot, ".xgc", "validation");
  fs.mkdirSync(bundledSessionDir, { recursive: true });
  fs.mkdirSync(validationTruthDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundledSessionDir, "workspace.yaml"),
    [
      "id: session-extracted",
      "updated_at: 2026-04-14T10:00:00.000Z",
      "latest_event_at: 2026-04-14T09:59:30.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(path.join(bundledSessionDir, "events.jsonl"), "{}\n");
  fs.writeFileSync(
    path.join(validationTruthDir, "workspace.yaml"),
    [
      "id: session-extracted",
      "operator_truth_source: repo-owned-validation-workspace",
      "source_session_workspace_yaml: /Users/original/.copilot-xgc/session-state/session-extracted/workspace.yaml",
      "updated_at: 2026-04-14T10:01:00.000Z",
      "latest_event_at: 2026-04-14T10:00:30.000Z",
      "route_summary: Repo Master -> Patch Master",
      "summary_authority: authoritative",
      "archive_completeness: complete",
      "process_log: /Users/original/.copilot-xgc/logs/process-missing.log",
      "validation_status: passed",
      ""
    ].join("\n")
  );

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessions: Array<{ archiveCompleteness: string; missingFiles: string[] }>;
  };
  assert.equal(results.sessions[0].archiveCompleteness, "partial");
  assert.ok(results.sessions[0].missingFiles.includes("process_log"));
});

test("session bundle report flags expected hook logs that were not archived", () => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-bundle-missing-hooks-"));
  const bundledSessionDir = path.join(bundleRoot, "copilot-session-state", "session-hooks");
  fs.mkdirSync(bundledSessionDir, { recursive: true });
  fs.writeFileSync(path.join(bundledSessionDir, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(bundledSessionDir, "process-1.log"), "process log\n");
  fs.writeFileSync(
    path.join(bundledSessionDir, "workspace.yaml"),
    [
      "id: session-hooks",
      "updated_at: 2026-04-14T10:00:00.000Z",
      "latest_event_at: 2026-04-14T09:59:30.000Z",
      "route_summary: Repo Master -> Patch Master",
      "summary_authority: authoritative",
      "archive_completeness: complete",
      `process_log: ${path.join(bundledSessionDir, "process-1.log")}`,
      'session_state_files: [".xgc/logs/hooks.log", "events.jsonl", "workspace.yaml"]',
      ""
    ].join("\n")
  );

  const result = spawnSync("npm", ["run", "--silent", "report:session-bundle", "--", "--bundle-root", bundleRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(bundleRoot, "SESSION_RESULTS.json"), "utf8")) as {
    sessions: Array<{ archiveCompleteness: string; archiveCompletenessReasons: string[]; missingFiles: string[] }>;
  };
  assert.equal(results.sessions[0].archiveCompleteness, "partial");
  assert.ok(results.sessions[0].missingFiles.includes("hooks_log"));
  assert.ok(results.sessions[0].archiveCompletenessReasons.includes("hook log was unavailable"));
});

test("runtime surface report defaults follow the overridden repo root", () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-script-"));
  fs.mkdirSync(path.join(tempRepo, "source", "agents"), { recursive: true });
  fs.mkdirSync(path.join(tempRepo, "source", "skills", "review-work"), { recursive: true });
  fs.writeFileSync(path.join(tempRepo, "source", "agents", "repo-master.agent.md"), "---\nname: Repo Master\n---\n");
  fs.writeFileSync(path.join(tempRepo, "source", "skills", "review-work", "SKILL.md"), "# review-work\n");

  const tempCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-home-"));
  const sessionDir = path.join(tempCopilotHome, ".copilot-xgc", "session-state", "session-1");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-1",
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "updated_at: 2026-04-14T09:00:00.000Z",
      "latest_event_at: 2026-04-14T08:59:30.000Z",
      "session_start_head: start-head",
      "session_end_head: end-head",
      "route_summary: Repo Master -> Patch Master -> Explore Agent",
      'route_agents: ["Repo Master", "Patch Master", "Explore Agent"]',
      "summary_authority: finalized_with_gaps",
      'summary_authority_reasons: ["matching process log was unavailable"]',
      "archive_completeness: partial",
      'archive_completeness_reasons: ["matching process log was unavailable"]',
      "summary_finalization_status: finalized",
      "finalization_complete: true",
      "finalization_partial: false",
      "finalization_error: false",
      "session_outcome: success",
      "session_outcome_detail: completed_with_validation_passed",
      "validation_status: passed",
      "validation_overclaim_observed: true",
      'validation_command_failures: ["1 failed"]',
      "working_tree_clean: true",
      "post_execution_ownership_leak_observed: true",
      "execution_claim_without_observed_repo_diff: true",
      "execution_owner: Patch Master",
      "ownership_transferred_to_execution: true",
      "background_execution_agent_observed: true",
      "background_execution_agent_unresolved: true",
      "integration_class_task_observed: true",
      "foundation_readiness_assessed: false",
      "foundation_readiness_unknown: true",
      "foundation_risk_raised: true",
      "shared_surface_change_observed: true",
      "shared_surface_owner_declared: false",
      "shared_surface_conflict_risk: false",
      "shared_surface_review_recommended: true",
      "shared_surface_final_integrator_needed: false",
      "foundation_recovery_suggested: true",
      "summary_route_count_mismatch: true",
      "summary_capability_count_mismatch: false",
      'committed_repo_files: ["committed.ts"]',
      'repo_working_tree_files: ["app.ts"]',
      'session_state_files: ["events.jsonl", "workspace.yaml"]',
      "validation_artifact_files: []",
      ""
    ].join("\n")
  );
  const repoOwnedTruthPath = path.join(tempRepo, ".xgc", "validation", "workspace.yaml");
  fs.mkdirSync(path.dirname(repoOwnedTruthPath), { recursive: true });
  fs.writeFileSync(
    repoOwnedTruthPath,
    [
      "id: session-1",
      "operator_truth_source: repo-owned-validation-workspace",
      `source_session_workspace_yaml: ${path.join(sessionDir, "workspace.yaml")}`,
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "updated_at: 2026-04-14T09:01:00.000Z",
      "latest_event_at: 2026-04-14T09:00:30.000Z",
      "session_start_head: start-head",
      "session_end_head: end-head",
      "route_summary: Repo Master -> Patch Master",
      'route_agents: ["Repo Master", "Patch Master"]',
      "route_summary_available: true",
      "route_summary_derived_from_raw_events: true",
      "route_summary_heuristic: false",
      "summary_authority: authoritative",
      'summary_authority_reasons: ["repo-owned validation workspace was finalized"]',
      "archive_completeness: complete",
      "summary_finalization_status: finalized",
      "finalization_complete: true",
      "finalization_partial: false",
      "finalization_error: false",
      "session_outcome: success",
      "session_outcome_detail: completed_with_validation_passed",
      "validation_status: passed",
      "validation_raw_status: passed",
      "validation_overclaim_observed: false",
      "direct_tool_execution_observed: false",
      "summary_route_heuristic_mismatch: false",
      "summary_timestamp_stale: false",
      "working_tree_clean: true",
      'key_agents: ["Repo Master", "Patch Master"]',
      "repo_scout_invocation_count: 1",
      "triage_invocation_count: 0",
      "patch_master_invocation_count: 2",
      "required_check_invocation_count: 0",
      "built_in_generic_agent_invocation_count: 0",
      "post_execution_planner_reopen_agents: []",
      "post_execution_generic_agent_observed: false",
      "post_execution_built_in_agent_observed: false",
      "post_execution_generic_agents: []",
      "post_execution_built_in_agents: []",
      "post_execution_ownership_leak_observed: false",
      "post_execution_root_write_observed: false",
      "post_execution_root_patch_observed: false",
      "post_execution_root_write_count: 0",
      "execution_claim_without_observed_repo_diff: false",
      "execution_owner: Patch Master",
      "ownership_transferred_to_execution: true",
      "background_execution_agent_observed: false",
      "background_execution_agent_unresolved: false",
      "integration_class_task_observed: true",
      "foundation_readiness_assessed: true",
      "foundation_readiness_unknown: false",
      "foundation_risk_raised: false",
      "repeated_foundation_failure_observed: false",
      "foundation_failure_classes: []",
      "foundation_recovery_reason: null",
      "shared_surface_change_observed: true",
      "shared_surface_owner_declared: true",
      "shared_surface_conflict_risk: false",
      "shared_surface_review_recommended: true",
      "shared_surface_final_integrator_needed: false",
      "foundation_recovery_suggested: false",
      "integration_owned_surfaces_touched: []",
      "hook_execution_failure_observed: false",
      "validation_port_conflict_observed: false",
      "validation_server_readiness_failure_observed: false",
      "github_memory_enabled_check: disabled_after_404",
      "github_memory_enabled_check_cached: true",
      "github_memory_enabled_check_count: 0",
      "github_memory_enabled_success_count: 0",
      "pr_context_check: disabled_after_404",
      "pr_context_check_cached: true",
      "pr_context_check_count: 0",
      "github_pr_lookup_success_count: 0",
      "github_capability_cache_hits: 2",
      "github_capability_cache_misses: 0",
      "github_memory_enabled_fresh_after_cache_observed: false",
      "pr_context_fresh_after_cache_observed: false",
      'probe_cache_summary: ["memory-enabled", "pr-lookup"]',
      "provider_retry_observed: true",
      "provider_retry_state: recovered",
      "provider_retry_count: 1",
      "provider_retry_reason: http2_goaway",
      "user_abort_observed: false",
      "subagent_failure_observed: false",
      "terminal_provider_failure_observed: false",
      "model_rate_limit_observed: false",
      "model_rate_limit_count: 0",
      "provider_502_observed: false",
      "provider_502_count: 0",
      "requested_runtime_model: claude-sonnet-4.6",
      "session_current_model: gpt-5.4",
      'observed_runtime_models: ["claude-sonnet-4.6", "gpt-5.4"]',
      "mixed_model_session_observed: true",
      "non_requested_model_usage_observed: true",
      "specialist_lane_expected: true",
      "required_specialist_lanes: []",
      'recommended_specialist_lanes: ["visual-forge", "writing-desk"]',
      "observed_specialist_lanes: []",
      "missing_required_specialist_lanes: []",
      'unobserved_recommended_specialist_lanes: ["visual-forge", "writing-desk"]',
      "specialist_fanout_observed: true",
      "specialist_fanout_partial: false",
      "specialist_fanout_covered_by_patch_master: true",
      "specialist_fanout_status: covered_by_patch_master_swarm",
      "specialist_fanout_reason: patch master swarm covered specialist work",
      "patch_master_swarm_observed: true",
      "patch_master_swarm_count: 13",
      "github_repo_identity_missing_observed: true",
      "github_repo_identity_source: local_repo_without_github_remote",
      "github_memory_suppressed_for_missing_repo_identity: true",
      "summary_route_count_mismatch: false",
      "summary_capability_count_mismatch: false",
      'committed_repo_files: ["committed.ts"]',
      "repo_working_tree_files: []",
      'session_state_files: ["events.jsonl", "workspace.yaml"]',
      "validation_artifact_files: []",
      ""
    ].join("\n")
  );
  const unrelatedSessionDir = path.join(tempCopilotHome, ".copilot-xgc", "session-state", "session-unrelated");
  fs.mkdirSync(unrelatedSessionDir, { recursive: true });
  const unrelatedWorkspaceYaml = path.join(unrelatedSessionDir, "workspace.yaml");
  fs.writeFileSync(
    unrelatedWorkspaceYaml,
    [
      "id: session-unrelated",
      "cwd: /tmp/unrelated-repo",
      "git_root: /tmp/unrelated-repo",
      "route_summary: Repo Master -> Patch Master -> General Purpose Agent",
      "summary_finalization_status: finalized",
      "post_execution_ownership_leak_observed: true",
      ""
    ].join("\n")
  );
  fs.utimesSync(unrelatedWorkspaceYaml, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  const result = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "report:surfaces",
      "--",
      "--repo-root",
      tempRepo,
      "--workspace-root",
      tempRepo,
      "--home-dir",
      tempCopilotHome,
      "--copilot-home",
      path.join(tempCopilotHome, ".copilot-custom")
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const reportJsonPath = path.join(tempRepo, ".xgc", "validation", "surface-resolution.json");
  const reportMdPath = path.join(tempRepo, ".xgc", "validation", "surface-resolution.md");
  assert.ok(fs.existsSync(reportJsonPath));
  assert.ok(fs.existsSync(reportMdPath));
  const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf8")) as {
    notes: string[];
    latestSessionTruth: {
      routeSummary: string | null;
      summaryAuthority: string;
      archiveCompleteness: string;
      sessionOutcomeDetail: string | null;
      validationOverclaimObserved: boolean | null;
      userAbortObserved: boolean | null;
      subagentFailureObserved: boolean | null;
      terminalProviderFailureObserved: boolean | null;
      hookExecutionFailureObserved: boolean | null;
      githubMemoryEnabledCheck: string | null;
      prContextCheck: string | null;
      specialistFanoutStatus: string | null;
      patchMasterSwarmObserved: boolean | null;
      githubRepoIdentityMissingObserved: boolean | null;
      backgroundExecutionAgentUnresolved: boolean | null;
      integrationClassTaskObserved: boolean | null;
      foundationReadinessAssessed: boolean | null;
      foundationReadinessUnknown: boolean | null;
      foundationRiskRaised: boolean | null;
      sharedSurfaceChangeObserved: boolean | null;
      sharedSurfaceOwnerDeclared: boolean | null;
      sharedSurfaceReviewRecommended: boolean | null;
      requestedRuntimeModel: string | null;
      sessionCurrentModel: string | null;
      observedRuntimeModels: string[];
      mixedModelSessionObserved: boolean | null;
      nonRequestedModelUsageObserved: boolean | null;
      committedRepoFileCount: number;
      workspaceYamlPath: string;
      workspaceTruthSource: string;
      updatedAt: string | null;
      latestEventAt: string | null;
      sessionStartHead: string | null;
      sessionEndHead: string | null;
      workspaceTruthFreshnessMismatchObserved: boolean | null;
      workspaceTruthFreshnessReason: string | null;
    } | null;
  };
  assert.ok(report.latestSessionTruth);
  assert.equal(report.latestSessionTruth.routeSummary, "Repo Master -> Patch Master");
  assert.equal(report.latestSessionTruth.workspaceTruthSource, "repo-owned-validation-workspace");
  assert.equal(report.latestSessionTruth.summaryAuthority, "authoritative");
  assert.equal(report.latestSessionTruth.archiveCompleteness, "complete");
  assert.equal(report.latestSessionTruth.sessionOutcomeDetail, "completed_with_validation_passed");
  assert.equal(report.latestSessionTruth.validationOverclaimObserved, false);
  assert.equal(report.latestSessionTruth.userAbortObserved, false);
  assert.equal(report.latestSessionTruth.subagentFailureObserved, false);
  assert.equal(report.latestSessionTruth.terminalProviderFailureObserved, false);
  assert.equal(report.latestSessionTruth.hookExecutionFailureObserved, false);
  assert.equal(report.latestSessionTruth.githubMemoryEnabledCheck, "disabled_after_404");
  assert.equal(report.latestSessionTruth.prContextCheck, "disabled_after_404");
  assert.equal(report.latestSessionTruth.specialistFanoutStatus, "covered_by_patch_master_swarm");
  assert.equal(report.latestSessionTruth.patchMasterSwarmObserved, true);
  assert.equal(report.latestSessionTruth.githubRepoIdentityMissingObserved, true);
  assert.equal(report.latestSessionTruth.backgroundExecutionAgentUnresolved, false);
  assert.equal(report.latestSessionTruth.integrationClassTaskObserved, true);
  assert.equal(report.latestSessionTruth.foundationReadinessAssessed, true);
  assert.equal(report.latestSessionTruth.foundationReadinessUnknown, false);
  assert.equal(report.latestSessionTruth.foundationRiskRaised, false);
  assert.equal(report.latestSessionTruth.sharedSurfaceChangeObserved, true);
  assert.equal(report.latestSessionTruth.sharedSurfaceOwnerDeclared, true);
  assert.equal(report.latestSessionTruth.sharedSurfaceReviewRecommended, true);
  assert.equal(report.latestSessionTruth.requestedRuntimeModel, "claude-sonnet-4.6");
  assert.equal(report.latestSessionTruth.sessionCurrentModel, "gpt-5.4");
  assert.deepEqual(report.latestSessionTruth.observedRuntimeModels, ["claude-sonnet-4.6", "gpt-5.4"]);
  assert.equal(report.latestSessionTruth.mixedModelSessionObserved, true);
  assert.equal(report.latestSessionTruth.nonRequestedModelUsageObserved, true);
  assert.equal(report.latestSessionTruth.committedRepoFileCount, 1);
  assert.equal(report.latestSessionTruth.workspaceYamlPath, repoOwnedTruthPath);
  assert.equal(report.latestSessionTruth.updatedAt, "2026-04-14T09:01:00.000Z");
  assert.equal(report.latestSessionTruth.latestEventAt, "2026-04-14T09:00:30.000Z");
  assert.equal(report.latestSessionTruth.sessionStartHead, "start-head");
  assert.equal(report.latestSessionTruth.sessionEndHead, "end-head");
  assert.equal(report.latestSessionTruth.workspaceTruthFreshnessMismatchObserved, true);
  assert.equal(
    report.latestSessionTruth.workspaceTruthFreshnessReason,
    "repo-owned validation workspace.yaml was at least as fresh as session-state workspace.yaml"
  );
  const notes = report.notes.join("\n");
  assert.match(notes, /Latest session truth/);
  assert.match(notes, /truthSource=repo-owned-validation-workspace/);
  assert.match(notes, /updatedAt=2026-04-14T09:01:00.000Z/);
  assert.match(notes, /latestEventAt=2026-04-14T09:00:30.000Z/);
  assert.match(notes, /sessionStartHead=start-head/);
  assert.match(notes, /sessionEndHead=end-head/);
  assert.match(notes, /outcome=success/);
  assert.match(notes, /outcomeDetail=completed_with_validation_passed/);
  assert.match(notes, /archiveCompleteness=complete/);
  assert.match(notes, /validation=passed/);
  assert.match(notes, /validationOverclaim=no/);
  assert.match(notes, /userAbort=no/);
  assert.match(notes, /subagentFailure=no/);
  assert.match(notes, /terminalProviderFailure=no/);
  assert.match(notes, /requestedRuntimeModel=claude-sonnet-4\.6/);
  assert.match(notes, /sessionCurrentModel=gpt-5\.4/);
  assert.match(notes, /observedRuntimeModels=claude-sonnet-4\.6,gpt-5\.4/);
  assert.match(notes, /mixedModelSession=yes/);
  assert.match(notes, /nonRequestedModelUsage=yes/);
  assert.match(notes, /workingTreeClean=yes/);
  assert.match(notes, /postExecutionOwnershipLeak=no/);
  assert.match(notes, /executionWithoutObservedRepoDiff=no/);
  assert.match(notes, /committedRepoFiles=1/);
  assert.match(notes, /backgroundExecutionUnresolved=no/);
  assert.match(notes, /integrationClassTask=yes/);
  assert.match(notes, /foundationReadinessUnknown=no/);
  assert.match(notes, /sharedSurfaceOwnerDeclared=yes/);
  assert.match(notes, /sharedSurfaceConflictRisk=no/);
  assert.match(notes, /sharedSurfaceFinalIntegratorNeeded=no/);
  assert.match(notes, /foundationRecoverySuggested=no/);
  assert.match(notes, /hookExecutionFailureObserved=no/);
  assert.match(notes, /githubMemoryEnabledCheck=disabled_after_404/);
  assert.match(notes, /prContextCheck=disabled_after_404/);
  assert.match(notes, /specialistFanoutStatus=covered_by_patch_master_swarm/);
  assert.match(notes, /patchMasterSwarmObserved=yes/);
  assert.match(notes, /githubRepoIdentityMissingObserved=yes/);
  assert.match(notes, /summaryRouteCountMismatch=no/);
  assert.match(notes, /summaryCapabilityCountMismatch=no/);
  assert.match(notes, /Repo Master -> Patch Master/);
  assert.doesNotMatch(notes, /Explore Agent/);
  assert.doesNotMatch(notes, /General Purpose Agent/);
  const markdown = fs.readFileSync(reportMdPath, "utf8");
  assert.match(markdown, /Latest Session Truth/);
  assert.match(markdown, /Workspace truth source: repo-owned-validation-workspace/);
  assert.match(markdown, /Workspace truth freshness mismatch: yes/);
  assert.match(markdown, /Workspace truth freshness reason: repo-owned validation workspace\.yaml was at least as fresh as session-state workspace\.yaml/);
  assert.match(markdown, /Updated at: 2026-04-14T09:01:00.000Z/);
  assert.match(markdown, /Latest event at: 2026-04-14T09:00:30.000Z/);
  assert.match(markdown, /Session start HEAD: start-head/);
  assert.match(markdown, /Session end HEAD: end-head/);
  assert.match(markdown, /Summary authority: authoritative/);
  assert.match(markdown, /Outcome detail: completed_with_validation_passed/);
  assert.match(markdown, /Archive completeness: complete/);
  assert.match(markdown, /Finalization partial: no/);
  assert.match(markdown, /Finalization error: no/);
  assert.match(markdown, /Validation overclaim observed: no/);
  assert.match(markdown, /Background execution unresolved: no/);
  assert.match(markdown, /Integration-class task observed: yes/);
  assert.match(markdown, /Foundation readiness assessed: yes/);
  assert.match(markdown, /Shared-surface owner declared: yes/);
  assert.match(markdown, /Hook execution failure observed: no/);
  assert.match(markdown, /GitHub memory enabled check: disabled_after_404/);
  assert.match(markdown, /Requested runtime model: claude-sonnet-4\.6/);
  assert.match(markdown, /Session current model: gpt-5\.4/);
  assert.match(markdown, /Observed runtime models: claude-sonnet-4\.6, gpt-5\.4/);
  assert.match(markdown, /Mixed-model session observed: yes/);
  assert.match(markdown, /Non-requested model usage observed: yes/);
  assert.match(markdown, /PR context check: disabled_after_404/);
  assert.match(markdown, /Specialist fanout status: covered_by_patch_master_swarm/);
  assert.match(markdown, /Patch Master swarm observed: yes/);
  assert.match(markdown, /GitHub repo identity missing observed: yes/);
});

test("runtime surface report keeps missing latest-session booleans unknown", () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-unknown-"));
  fs.mkdirSync(path.join(tempRepo, "source", "agents"), { recursive: true });
  fs.mkdirSync(path.join(tempRepo, "source", "skills"), { recursive: true });
  fs.writeFileSync(path.join(tempRepo, "source", "agents", "repo-master.agent.md"), "---\nname: Repo Master\n---\n");

  const tempCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-unknown-home-"));
  const sessionDir = path.join(tempCopilotHome, ".copilot-xgc", "session-state", "session-legacy");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    [
      "id: session-legacy",
      "operator_truth_source: repo-owned-validation-workspace",
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "route_summary: Repo Master -> Patch Master",
      "summary_authority: heuristic",
      "summary_finalization_status: heuristic",
      "session_outcome: unknown",
      "validation_status: unknown",
      ""
    ].join("\n")
  );

  const result = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "report:surfaces",
      "--",
      "--repo-root",
      tempRepo,
      "--workspace-root",
      tempRepo,
      "--home-dir",
      tempCopilotHome,
      "--copilot-home",
      path.join(tempCopilotHome, ".copilot-custom")
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const reportJsonPath = path.join(tempRepo, ".xgc", "validation", "surface-resolution.json");
  const reportMdPath = path.join(tempRepo, ".xgc", "validation", "surface-resolution.md");
  const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf8")) as {
    notes: string[];
    latestSessionTruth: {
      workspaceTruthSource: string;
      postExecutionOwnershipLeakObserved: boolean | null;
      backgroundExecutionAgentUnresolved: boolean | null;
      integrationClassTaskObserved: boolean | null;
      foundationReadinessUnknown: boolean | null;
      sharedSurfaceOwnerDeclared: boolean | null;
      sharedSurfaceConflictRisk: boolean | null;
      sharedSurfaceFinalIntegratorNeeded: boolean | null;
      foundationRecoverySuggested: boolean | null;
      validationOverclaimObserved: boolean | null;
      userAbortObserved: boolean | null;
      subagentFailureObserved: boolean | null;
      terminalProviderFailureObserved: boolean | null;
      summaryRouteCountMismatch: boolean | null;
      hookExecutionFailureObserved: boolean | null;
      githubMemoryEnabledCheck: string | null;
      prContextCheck: string | null;
      specialistFanoutStatus: string | null;
      patchMasterSwarmObserved: boolean | null;
      githubRepoIdentityMissingObserved: boolean | null;
    } | null;
  };

  assert.ok(report.latestSessionTruth);
  assert.equal(report.latestSessionTruth.workspaceTruthSource, "session-state-workspace");
  assert.equal(report.latestSessionTruth.postExecutionOwnershipLeakObserved, null);
  assert.equal(report.latestSessionTruth.backgroundExecutionAgentUnresolved, null);
  assert.equal(report.latestSessionTruth.integrationClassTaskObserved, null);
  assert.equal(report.latestSessionTruth.foundationReadinessUnknown, null);
  assert.equal(report.latestSessionTruth.sharedSurfaceOwnerDeclared, null);
  assert.equal(report.latestSessionTruth.sharedSurfaceConflictRisk, null);
  assert.equal(report.latestSessionTruth.sharedSurfaceFinalIntegratorNeeded, null);
  assert.equal(report.latestSessionTruth.foundationRecoverySuggested, null);
  assert.equal(report.latestSessionTruth.validationOverclaimObserved, null);
  assert.equal(report.latestSessionTruth.userAbortObserved, null);
  assert.equal(report.latestSessionTruth.subagentFailureObserved, null);
  assert.equal(report.latestSessionTruth.terminalProviderFailureObserved, null);
  assert.equal(report.latestSessionTruth.summaryRouteCountMismatch, null);
  assert.equal(report.latestSessionTruth.hookExecutionFailureObserved, null);
  assert.equal(report.latestSessionTruth.githubMemoryEnabledCheck, null);
  assert.equal(report.latestSessionTruth.prContextCheck, null);
  assert.equal(report.latestSessionTruth.specialistFanoutStatus, null);
  assert.equal(report.latestSessionTruth.patchMasterSwarmObserved, null);
  assert.equal(report.latestSessionTruth.githubRepoIdentityMissingObserved, null);
  const notes = report.notes.join("\n");
  assert.match(notes, /truthSource=session-state-workspace/);
  assert.match(notes, /postExecutionOwnershipLeak=unknown/);
  assert.match(notes, /backgroundExecutionUnresolved=unknown/);
  assert.match(notes, /integrationClassTask=unknown/);
  assert.match(notes, /foundationReadinessUnknown=unknown/);
  assert.match(notes, /sharedSurfaceOwnerDeclared=unknown/);
  assert.match(notes, /sharedSurfaceConflictRisk=unknown/);
  assert.match(notes, /sharedSurfaceFinalIntegratorNeeded=unknown/);
  assert.match(notes, /foundationRecoverySuggested=unknown/);
  assert.match(notes, /userAbort=unknown/);
  assert.match(notes, /subagentFailure=unknown/);
  assert.match(notes, /terminalProviderFailure=unknown/);
  assert.match(notes, /hookExecutionFailureObserved=unknown/);
  assert.match(notes, /githubMemoryEnabledCheck=unknown/);
  assert.match(notes, /prContextCheck=unknown/);
  assert.match(notes, /specialistFanoutStatus=unknown/);
  assert.match(notes, /patchMasterSwarmObserved=unknown/);
  assert.match(notes, /githubRepoIdentityMissingObserved=unknown/);
  assert.match(notes, /validationOverclaim=unknown/);
  assert.match(notes, /summaryRouteCountMismatch=unknown/);
  const markdown = fs.readFileSync(reportMdPath, "utf8");
  assert.match(markdown, /Post-execution ownership leak: unknown/);
  assert.match(markdown, /Background execution unresolved: unknown/);
  assert.match(markdown, /Integration-class task observed: unknown/);
  assert.match(markdown, /Foundation readiness unknown: unknown/);
  assert.match(markdown, /Shared-surface owner declared: unknown/);
  assert.match(markdown, /Finalization partial: unknown/);
  assert.match(markdown, /Finalization error: unknown/);
  assert.match(markdown, /Shared-surface conflict risk: unknown/);
  assert.match(markdown, /Shared-surface final integrator needed: unknown/);
  assert.match(markdown, /Foundation recovery suggested: unknown/);
  assert.match(markdown, /Hook execution failure observed: unknown/);
  assert.match(markdown, /GitHub memory enabled check: unknown/);
  assert.match(markdown, /PR context check: unknown/);
  assert.match(markdown, /Specialist fanout status: unknown/);
  assert.match(markdown, /Patch Master swarm observed: unknown/);
  assert.match(markdown, /GitHub repo identity missing observed: unknown/);
  assert.match(markdown, /Validation overclaim observed: unknown/);
});

test("runtime surface report honors explicit JSON and Markdown output paths", () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-explicit-paths-"));
  const tempCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-explicit-paths-home-"));
  fs.mkdirSync(path.join(tempRepo, "source", "agents"), { recursive: true });
  fs.mkdirSync(path.join(tempRepo, "source", "skills"), { recursive: true });
  fs.writeFileSync(path.join(tempRepo, "source", "agents", "repo-master.agent.md"), "---\nname: Repo Master\n---\n");
  const reportJsonPath = path.join(tempRepo, ".xgc", "custom", "surface.json");
  const reportMdPath = path.join(tempRepo, ".xgc", "custom", "surface.md");

  const result = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "report:surfaces",
      "--",
      "--repo-root",
      tempRepo,
      "--workspace-root",
      tempRepo,
      "--home-dir",
      tempCopilotHome,
      "--copilot-home",
      path.join(tempCopilotHome, ".copilot-custom"),
      "--report-json",
      reportJsonPath,
      "--report-md",
      reportMdPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(reportJsonPath));
  assert.ok(fs.existsSync(reportMdPath));
  assert.equal(fs.existsSync(path.join(tempRepo, ".xgc", "validation", "surface-resolution.json")), false);
  assert.equal(fs.existsSync(path.join(tempRepo, ".xgc", "validation", "surface-resolution.md")), false);
  assert.match(result.stdout, new RegExp(`Surface resolution JSON: ${reportJsonPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, new RegExp(`Surface resolution Markdown: ${reportMdPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("runtime surface report prefers a fresher session-state workspace over a stale repo-owned snapshot", () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-stale-repo-truth-"));
  const tempCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-stale-repo-truth-home-"));
  fs.mkdirSync(path.join(tempRepo, "source", "agents"), { recursive: true });
  fs.mkdirSync(path.join(tempRepo, "source", "skills"), { recursive: true });
  fs.writeFileSync(path.join(tempRepo, "source", "agents", "repo-master.agent.md"), "---\nname: Repo Master\n---\n");
  const sessionDir = path.join(tempCopilotHome, ".copilot-xgc", "session-state", "session-1");
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionWorkspacePath = path.join(sessionDir, "workspace.yaml");
  fs.writeFileSync(
    sessionWorkspacePath,
    [
      "id: session-1",
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "updated_at: 2026-04-14T10:02:00.000Z",
      "latest_event_at: 2026-04-14T10:01:30.000Z",
      "route_summary: Direct Copilot Session",
      "route_summary_source: raw_tool_events_fallback",
      "route_summary_heuristic: true",
      "summary_authority: finalized_with_gaps",
      "summary_finalization_status: finalized",
      "session_outcome: success",
      "validation_status: passed",
      ""
    ].join("\n")
  );
  const repoWorkspacePath = path.join(tempRepo, ".xgc", "validation", "workspace.yaml");
  fs.mkdirSync(path.dirname(repoWorkspacePath), { recursive: true });
  fs.writeFileSync(
    repoWorkspacePath,
    [
      "id: session-1",
      "operator_truth_source: repo-owned-validation-workspace",
      `source_session_workspace_yaml: ${sessionWorkspacePath}`,
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "updated_at: 2026-04-14T10:00:00.000Z",
      "latest_event_at: 2026-04-14T09:59:30.000Z",
      "route_summary: Repo Master -> Stale Snapshot",
      "route_summary_source: started_with_fallbacks",
      "route_summary_heuristic: false",
      "summary_authority: authoritative",
      "summary_finalization_status: finalized",
      "session_outcome: success",
      "validation_status: passed",
      ""
    ].join("\n")
  );

  const result = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "report:surfaces",
      "--",
      "--repo-root",
      tempRepo,
      "--workspace-root",
      tempRepo,
      "--home-dir",
      tempCopilotHome,
      "--copilot-home",
      path.join(tempCopilotHome, ".copilot-custom")
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(
    fs.readFileSync(path.join(tempRepo, ".xgc", "validation", "surface-resolution.json"), "utf8")
  ) as {
    latestSessionTruth: {
      workspaceYamlPath: string;
      workspaceTruthSource: string;
      alternateWorkspaceYamlPath: string | null;
      workspaceTruthFreshnessMismatchObserved: boolean | null;
      workspaceTruthFreshnessReason: string | null;
      routeSummary: string | null;
      summaryAuthority: string;
    } | null;
  };
  assert.ok(report.latestSessionTruth);
  assert.equal(report.latestSessionTruth.workspaceYamlPath, sessionWorkspacePath);
  assert.equal(report.latestSessionTruth.workspaceTruthSource, "session-state-workspace");
  assert.equal(report.latestSessionTruth.alternateWorkspaceYamlPath, repoWorkspacePath);
  assert.equal(report.latestSessionTruth.workspaceTruthFreshnessMismatchObserved, true);
  assert.equal(
    report.latestSessionTruth.workspaceTruthFreshnessReason,
    "session-state workspace.yaml was fresher than repo-owned validation workspace.yaml"
  );
  assert.equal(report.latestSessionTruth.routeSummary, "Direct Copilot Session");
  assert.equal(report.latestSessionTruth.summaryAuthority, "finalized_with_gaps");
});

test("global install script wires the dedicated XGC profile flow", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts/install-global-xgc.sh"), "utf8");
  assert.match(script, /materialize-global-xgc\.ts/);
  assert.match(script, /validate-global-xgc\.ts/);
  assert.match(script, /xgc-shell\.sh/);
  assert.match(script, /--write-shell-profile/);
  assert.match(script, /--permission-mode/);
  assert.match(script, /xgc_prompt_permission_mode/);
  assert.match(script, /Shell profile writes are disabled by default\./);
  assert.match(script, /uninstall-global-xgc\.sh/);
  assert.doesNotMatch(script, /append.*shell startup file.*by default/i);
});

test("global uninstall script documents disable and raw reset modes", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts/uninstall-global-xgc.sh"), "utf8");
  assert.match(script, /--disable-only/);
  assert.match(script, /--reset-raw-config/);
  assert.match(script, /--clear-raw-state/);
  assert.match(script, /type copilot/);
  assert.match(script, /copilot plugin list/);
});

test("global uninstall script can disable shell activation and reset raw config in a temp home", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-uninstall-home-"));
  fs.mkdirSync(path.join(tempHome, ".config", "xgc"), { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".copilot-xgc"), { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".copilot", "logs"), { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".copilot", "session-state"), { recursive: true });
  fs.writeFileSync(
    path.join(tempHome, ".zshrc"),
    [
      "export PATH=/opt/homebrew/bin:$PATH",
      "# >>> xgc global mode >>>",
      `[[ -f \"${path.join(tempHome, ".config", "xgc", "xgc-shell.sh")}\" ]] && source \"${path.join(tempHome, ".config", "xgc", "xgc-shell.sh")}\"`,
      "# <<< xgc global mode <<<"
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(tempHome, ".copilot", "config.json"),
    JSON.stringify(
      {
        last_logged_in_user: { host: "https://github.com", login: "juhlee_SKPLNET" },
        logged_in_users: [{ host: "https://github.com", login: "juhlee_SKPLNET" }],
        trusted_folders: [tempHome],
        model: "gpt-5-mini"
      },
      null,
      2
    )
  );

  const result = spawnSync(
    "bash",
    [path.join(repoRoot, "scripts", "uninstall-global-xgc.sh"), "--reset-raw-config", "--clear-raw-state"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: tempHome
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const zshrc = fs.readFileSync(path.join(tempHome, ".zshrc"), "utf8");
  const rawConfig = JSON.parse(fs.readFileSync(path.join(tempHome, ".copilot", "config.json"), "utf8")) as {
    last_logged_in_user?: { login?: string };
    logged_in_users?: Array<{ login?: string }>;
  };
  assert.doesNotMatch(zshrc, /xgc global mode/);
  assert.ok(!fs.existsSync(path.join(tempHome, ".config", "xgc")));
  assert.ok(!fs.existsSync(path.join(tempHome, ".copilot-xgc")));
  assert.deepEqual(Object.keys(rawConfig).sort(), ["last_logged_in_user", "logged_in_users"]);
  assert.equal(rawConfig.last_logged_in_user?.login, "juhlee_SKPLNET");
  assert.equal(rawConfig.logged_in_users?.[0]?.login, "juhlee_SKPLNET");
  assert.match(result.stdout, /Post-remove verification:/);
});

test("global install script can prompt for permission mode", () => {
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
        "printf 'yolo\\n' | xgc_prompt_permission_mode work"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Choose the default X for GitHub Copilot permission mode:/);
  assert.equal(result.stdout.trim(), "yolo");
});

test("materialize global script defaults invalid env permission mode to ask", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-materialize-permission-"));
  const result = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "materialize:global",
      "--",
      "--home-dir",
      tempHome,
      "--repo-root",
      repoRoot
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        XGC_PERMISSION_MODE: "definitely-not-valid"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const profileEnv = fs.readFileSync(path.join(tempHome, ".config", "xgc", "profile.env"), "utf8");
  const installState = JSON.parse(
    fs.readFileSync(path.join(tempHome, ".config", "xgc", "install-state.json"), "utf8")
  ) as { permissionMode?: string };
  assert.match(profileEnv, /XGC_PERMISSION_MODE='ask'/);
  assert.equal(installState.permissionMode, "ask");
});

test("materialize global script resolves and preserves the raw Copilot binary without requiring an env override", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-materialize-raw-bin-"));
  const rawDir = path.join(tempHome, "raw-bin");
  fs.mkdirSync(rawDir, { recursive: true });
  const rawCopilot = path.join(rawDir, "copilot");
  fs.writeFileSync(rawCopilot, ["#!/usr/bin/env bash", "exit 0"].join("\n"));
  fs.chmodSync(rawCopilot, 0o755);

  const runMaterialize = (pathEnv: string) =>
    spawnSync(
      "npm",
      [
        "run",
        "--silent",
        "materialize:global",
        "--",
        "--home-dir",
        tempHome,
        "--repo-root",
        repoRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: pathEnv,
          XGC_COPILOT_RAW_BIN: ""
        }
      }
    );

  const first = runMaterialize(`${rawDir}:${process.env.PATH ?? ""}`);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`raw copilot binary: ${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const profileEnvPath = path.join(tempHome, ".config", "xgc", "profile.env");
  const installStatePath = path.join(tempHome, ".config", "xgc", "install-state.json");
  assert.match(fs.readFileSync(profileEnvPath, "utf8"), new RegExp(`XGC_COPILOT_RAW_BIN='${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(
    (JSON.parse(fs.readFileSync(installStatePath, "utf8")) as { rawCopilotBin?: string | null }).rawCopilotBin,
    rawCopilot
  );

  const second = runMaterialize(process.env.PATH ?? "");
  assert.equal(second.status, 0, second.stderr);
  assert.match(fs.readFileSync(profileEnvPath, "utf8"), new RegExp(`XGC_COPILOT_RAW_BIN='${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(
    (JSON.parse(fs.readFileSync(installStatePath, "utf8")) as { rawCopilotBin?: string | null }).rawCopilotBin,
    rawCopilot
  );
});

test("materialize global script recovers from stale inherited XGC_COPILOT_RAW_BIN", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-materialize-stale-env-raw-bin-"));
  const rawDir = path.join(tempHome, "raw-bin");
  fs.mkdirSync(rawDir, { recursive: true });
  const rawCopilot = path.join(rawDir, "copilot");
  fs.writeFileSync(rawCopilot, ["#!/usr/bin/env bash", "exit 0"].join("\n"));
  fs.chmodSync(rawCopilot, 0o755);

  const result = spawnSync(
    "npm",
    ["run", "--silent", "materialize:global", "--", "--home-dir", tempHome, "--repo-root", repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${rawDir}:${process.env.PATH ?? ""}`,
        XGC_COPILOT_RAW_BIN: path.join(tempHome, "missing-old-copilot")
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`raw copilot binary: ${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const profileEnvPath = path.join(tempHome, ".config", "xgc", "profile.env");
  assert.match(fs.readFileSync(profileEnvPath, "utf8"), new RegExp(`XGC_COPILOT_RAW_BIN='${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
});

test("materialize global script rewrites stale profile raw Copilot binary from PATH", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-materialize-stale-profile-raw-bin-"));
  const rawDir = path.join(tempHome, "raw-bin");
  const profileEnvPath = path.join(tempHome, ".config", "xgc", "profile.env");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(path.dirname(profileEnvPath), { recursive: true });
  const rawCopilot = path.join(rawDir, "copilot");
  fs.writeFileSync(rawCopilot, ["#!/usr/bin/env bash", "exit 0"].join("\n"));
  fs.chmodSync(rawCopilot, 0o755);
  fs.writeFileSync(profileEnvPath, "export XGC_COPILOT_RAW_BIN='/tmp/definitely-missing-old-copilot'\n");

  const result = spawnSync(
    "npm",
    ["run", "--silent", "materialize:global", "--", "--home-dir", tempHome, "--repo-root", repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${rawDir}:${process.env.PATH ?? ""}`,
        XGC_COPILOT_RAW_BIN: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`raw copilot binary: ${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(fs.readFileSync(profileEnvPath, "utf8"), new RegExp(`XGC_COPILOT_RAW_BIN='${rawCopilot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
});

test("validate global reports repair command for shell shim materialization drift", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-validate-global-drift-"));
  const materialize = spawnSync(
    "npm",
    ["run", "--silent", "materialize:global", "--", "--home-dir", tempHome, "--repo-root", repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  assert.equal(materialize.status, 0, materialize.stderr);

  const shellShimPath = path.join(tempHome, ".config", "xgc", "xgc-shell.sh");
  fs.appendFileSync(shellShimPath, "\n# stale local edit\n");

  const validate = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      path.join(repoRoot, "scripts/validate-global-xgc.ts"),
      "--home-dir",
      tempHome,
      "--repo-root",
      repoRoot
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.notEqual(validate.status, 0);
  assert.match(validate.stderr, /profile shell shim content drifted/);
  assert.match(validate.stderr, /npm run materialize:global/);
  assert.match(validate.stderr, /npm run validate:global/);
});

test("TypeScript sources typecheck", () => {
  execFileSync("npm", ["run", "typecheck", "--silent"], { cwd: repoRoot });
});

test("use-xgc-env sources repo-local session env overrides", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-env-"));
  const sessionEnv = path.join(tmp, "session-env.sh");
  fs.writeFileSync(sessionEnv, "export XGC_SESSION_TEST_VALUE=repo-local\n");

  const output = execFileSync(
    "bash",
    [
      path.join(repoRoot, "scripts/use-xgc-env.sh"),
      "bash",
      "-lc",
      'printf "%s" "$XGC_SESSION_TEST_VALUE"'
    ],
    {
      env: {
        ...process.env,
        XGC_ENV_FILE: path.join(tmp, "missing-env.sh"),
        XGC_SESSION_ENV_FILE: sessionEnv
      }
    }
  ).toString();

  assert.equal(output, "repo-local");
});

test("use-xgc-env preserves launcher PATH and COPILOT_HOME while loading secrets", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-use-env-guard-"));
  const envFile = path.join(tmp, "env.sh");
  const originalPath = process.env.PATH ?? "";
  const originalCopilotHome = path.join(tmp, "copilot-home");
  fs.writeFileSync(
    envFile,
    [
      "export PATH='/tmp/stale-env-path'",
      "export COPILOT_HOME='/tmp/stale-copilot-home'",
      "export XGC_SESSION_TEST_SECRET='loaded-secret'"
    ].join("\n") + "\n"
  );

  const output = execFileSync(
    "bash",
    [
      path.join(repoRoot, "scripts/use-xgc-env.sh"),
      process.execPath,
      "-e",
      'process.stdout.write([process.env.PATH ?? "", process.env.COPILOT_HOME ?? "", process.env.XGC_SESSION_TEST_SECRET ?? ""].join("\\n"))'
    ],
    {
      env: {
        ...process.env,
        PATH: originalPath,
        COPILOT_HOME: originalCopilotHome,
        XGC_ENV_FILE: envFile,
        XGC_SESSION_ENV_FILE: path.join(tmp, "missing-session-env.sh")
      }
    }
  ).toString();

  assert.deepEqual(output.split("\n").slice(0, 3), [originalPath, originalCopilotHome, "loaded-secret"]);
});

test("use-xgc-env keeps COPILOT_HOME truly unset when the launcher did not set it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-use-env-unset-copilot-home-"));
  const envFile = path.join(tmp, "env.sh");
  fs.writeFileSync(envFile, "export COPILOT_HOME='/tmp/stale-copilot-home'\n");

  const output = execFileSync(
    "bash",
    [
      path.join(repoRoot, "scripts/use-xgc-env.sh"),
      "bash",
      "-c",
      'if [[ "${COPILOT_HOME+x}" == "x" ]]; then printf "set:%s" "$COPILOT_HOME"; else printf "unset"; fi'
    ],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? os.homedir(),
        XGC_ENV_FILE: envFile,
        XGC_SESSION_ENV_FILE: path.join(tmp, "missing-session-env.sh")
      }
    }
  ).toString();

  assert.equal(output, "unset");
});

test("global install raw binary resolver skips XGC wrapper candidates", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-raw-resolver-"));
  const wrapperDir = path.join(tmp, "wrapper-bin");
  const rawDir = path.join(tmp, "raw-bin");
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const wrapperCopilot = path.join(wrapperDir, "copilot");
  const rawCopilot = path.join(rawDir, "copilot");
  fs.writeFileSync(
    wrapperCopilot,
    ["#!/usr/bin/env bash", "export XGC_COPILOT_PROFILE_HOME=/tmp/xgc", "exec copilot_raw \"$@\""].join("\n")
  );
  fs.writeFileSync(rawCopilot, ["#!/usr/bin/env bash", "exit 0"].join("\n"));
  fs.chmodSync(wrapperCopilot, 0o755);
  fs.chmodSync(rawCopilot, 0o755);

  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
        "resolve_raw_copilot_bin"
      ].join("; ")
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${wrapperDir}:${rawDir}:${process.env.PATH ?? ""}`,
        XGC_COPILOT_RAW_BIN: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), rawCopilot);
});

test("optional live smoke reports an honest skip when copilot is unavailable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-live-smoke-"));
  const reportPath = path.join(tmp, "report.json");
  const result = spawnSync(
    "npm",
    ["run", "--silent", "smoke:copilot-cli", "--", "--report", reportPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        COPILOT_BIN: "__definitely_missing_copilot__"
      }
    }
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    overall: { status: string; summary: string };
    environment: { copilotAvailable: boolean };
    mcpServers: unknown[];
    lspServers: unknown[];
  };
  assert.equal(report.overall.status, "skipped");
  assert.equal(report.environment.copilotAvailable, false);
  assert.ok(Array.isArray(report.mcpServers));
  assert.ok(Array.isArray(report.lspServers));
  assert.match(report.overall.summary, /GitHub Copilot CLI binary not found/i);
});
