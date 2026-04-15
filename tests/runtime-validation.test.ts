import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildMcpStates,
  classifyIntegrationOwnedSurfaces,
  classifyLspEvidence,
  classifyMcpEvidence,
  classifyModifiedFiles,
  collapseConsecutiveNames,
  countObservedNames,
  captureWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  containsOrderedSubsequence,
  extractObservedSessionModels,
  summarizeAgentModelPolicyMismatches,
  extractCliReportedUsage,
  extractObservedSubagentNames,
  summarizeRouteObservations,
  summarizeObservedSessionModels,
  summarizeValidationLog,
  summarizeProviderRetries,
  inspectInstalledPlugin,
  listCommittedFilesBetween,
  pluginListedInOutput,
  withCommittedRepoFiles
} from "../scripts/lib/runtime-validation.js";
import {
  emptyGitHubProbeCache,
  observeGitHubProbeResults,
  observeGitHubProbeFailures,
  resolveGitHubProbePolicy,
  resolveGitHubProbeRepoIdentity
} from "../scripts/lib/github-probe-gating.js";

test("extractCliReportedUsage parses Copilot result-event usage", () => {
  const stdout = [
    '{"type":"session.started","data":{}}',
    JSON.stringify({
      type: "result",
      usage: {
        premiumRequests: 0.33,
        totalApiDurationMs: 19681,
        sessionDurationMs: 26150,
        codeChanges: {
          linesAdded: 1,
          linesRemoved: 0,
          filesModified: ["validation-fixtures/notes/runtime-check.md"]
        }
      }
    })
  ].join("\n");

  const usage = extractCliReportedUsage(stdout);
  assert.ok(usage);
  assert.equal(usage.premiumRequests, 0.33);
  assert.equal(usage.totalApiDurationMs, 19681);
  assert.equal(usage.sessionDurationMs, 26150);
  assert.equal(usage.linesAdded, 1);
  assert.equal(usage.linesRemoved, 0);
  assert.deepEqual(usage.filesModified, ["validation-fixtures/notes/runtime-check.md"]);
});

test("classifyModifiedFiles separates repo files from state and validation artifacts", () => {
  const workspaceRoot = path.join(os.tmpdir(), "xgc-runtime-workspace");
  const copilotHome = path.join(workspaceRoot, ".xgc", "copilot-home");
  const classified = classifyModifiedFiles(
    [
      "validation-fixtures/notes/runtime-check.md",
      path.join(workspaceRoot, ".xgc", "validation", "runtime-validation.md"),
      path.join(workspaceRoot, "test-results", ".last-run.json"),
      path.join(workspaceRoot, "playwright-report", "index.html"),
      path.join(copilotHome, "session-state", "session-1", "plan.md"),
      "/tmp/external-note.txt"
    ],
    { workspaceRoot, copilotHome }
  );

  assert.deepEqual(classified.repoWorkingTreeFiles, ["validation-fixtures/notes/runtime-check.md"]);
  assert.deepEqual(classified.validationArtifactFiles, [
    path.join(".xgc", "validation", "runtime-validation.md"),
    path.join("playwright-report", "index.html"),
    path.join("test-results", ".last-run.json")
  ]);
  assert.deepEqual(classified.sessionStateFiles, [path.join(".xgc", "copilot-home", "session-state", "session-1", "plan.md")]);
  assert.deepEqual(classified.stateArtifactFiles, [path.join(".xgc", "copilot-home", "session-state", "session-1", "plan.md")]);
  assert.deepEqual(classified.externalFiles, ["/tmp/external-note.txt"]);
  assert.equal(classified.repoWorkingTreeChanged, true);
  assert.equal(classified.sessionStateOnly, false);
  assert.equal(classified.stateArtifactOnly, false);
  assert.deepEqual(classified.integrationOwnedSurfacesTouched, []);
  assert.equal(classified.sharedSurfaceChangeObserved, false);
  assert.equal(classified.sharedSurfaceOwnerDeclared, false);
});

test("classifyModifiedFiles reports integration-owned shared surfaces conservatively", () => {
  const workspaceRoot = path.join(os.tmpdir(), "xgc-runtime-shared-surfaces");
  const classified = classifyModifiedFiles(
    [
      ".env.local",
      "prisma/schema.prisma",
      "app/layout.tsx",
      "components/shell/app-shell.tsx",
      "src/lib/queries/services.ts",
      "src/components/ui/status-badge.tsx",
      "tests/helpers/render.ts",
      "README.md",
      "e2e/smoke/login.spec.ts",
      "package.json",
      "features/incidents/page.tsx"
    ],
    { workspaceRoot, sharedSurfaceOwnerDeclared: true }
  );

  assert.deepEqual(classified.integrationOwnedSurfacesTouched, [
    ".env.local",
    "README.md",
    "app/layout.tsx",
    "components/shell/app-shell.tsx",
    "e2e/smoke/login.spec.ts",
    "package.json",
    "prisma/schema.prisma",
    "src/components/ui/status-badge.tsx",
    "src/lib/queries/services.ts",
    "tests/helpers/render.ts"
  ]);
  assert.equal(classified.sharedSurfaceChangeObserved, true);
  assert.equal(classified.sharedSurfaceOwnerDeclared, true);
  assert.equal(classified.sharedSurfaceConflictRisk, false);
  assert.equal(classified.sharedSurfaceReviewRecommended, true);
  assert.equal(classified.sharedSurfaceFinalIntegratorNeeded, true);
  assert.equal(classified.repoCodeChanged, true);
  assert.equal(classified.workingTreeClean, false);
  assert.deepEqual(classifyIntegrationOwnedSurfaces(["features/incidents/page.tsx"]), []);
  assert.deepEqual(classifyIntegrationOwnedSurfaces(["./.env", ".env.local"]), [".env", ".env.local"]);
});

test("classifyModifiedFiles flags undeclared shared-surface conflict risk", () => {
  const workspaceRoot = path.join(os.tmpdir(), "xgc-runtime-shared-surface-risk");
  const classified = classifyModifiedFiles(["prisma/schema.prisma", "src/features/incidents/page.tsx"], { workspaceRoot });

  assert.deepEqual(classified.integrationOwnedSurfacesTouched, ["prisma/schema.prisma"]);
  assert.equal(classified.sharedSurfaceChangeObserved, true);
  assert.equal(classified.sharedSurfaceOwnerDeclared, false);
  assert.equal(classified.sharedSurfaceConflictRisk, true);
  assert.equal(classified.sharedSurfaceReviewRecommended, true);
  assert.equal(classified.sharedSurfaceFinalIntegratorNeeded, true);
  assert.equal(classified.repoCodeChanged, true);
  assert.equal(classified.repoChangesUncommitted, true);
  assert.equal(classified.repoChangesCommitted, null);
  assert.equal(classified.committedRepoChanged, null);
  assert.equal(classified.committedRepoFiles, null);
});

test("withCommittedRepoFiles separates committed clean-tree work from working-tree-only drift", () => {
  const cleanSummary = classifyModifiedFiles([".xgc/logs/hooks.log"], {
    workspaceRoot: path.join(os.tmpdir(), "xgc-runtime-committed-clean")
  });
  const committed = withCommittedRepoFiles(cleanSummary, ["src/app/page.tsx", "prisma/schema.prisma"]);

  assert.deepEqual(committed.repoWorkingTreeFiles, []);
  assert.deepEqual(committed.committedRepoFiles, ["prisma/schema.prisma", "src/app/page.tsx"]);
  assert.equal(committed.committedRepoChanged, true);
  assert.equal(committed.repoCodeChanged, true);
  assert.equal(committed.repoChangesCommitted, true);
  assert.equal(committed.repoChangesUncommitted, false);
  assert.equal(committed.workingTreeClean, true);
  assert.equal(committed.workingTreeOnlyDiffObserved, false);
  assert.equal(committed.committedDiffSource, "git-head-range");
  assert.equal(committed.sessionStateOnly, false);

  const committedCleanTreeSummary = classifyModifiedFiles(["src/app/page.tsx"], {
    workspaceRoot: path.join(os.tmpdir(), "xgc-runtime-committed-snapshot-drift")
  });
  const committedCleanTree = withCommittedRepoFiles(committedCleanTreeSummary, ["src/app/page.tsx"], false);
  assert.deepEqual(committedCleanTree.repoWorkingTreeFiles, ["src/app/page.tsx"]);
  assert.deepEqual(committedCleanTree.committedRepoFiles, ["src/app/page.tsx"]);
  assert.equal(committedCleanTree.repoCodeChanged, true);
  assert.equal(committedCleanTree.repoChangesCommitted, true);
  assert.equal(committedCleanTree.repoChangesUncommitted, false);
  assert.equal(committedCleanTree.workingTreeClean, true);
  assert.equal(committedCleanTree.workingTreeOnlyDiffObserved, false);

  const dirtySummary = classifyModifiedFiles(["src/app/page.tsx"], {
    workspaceRoot: path.join(os.tmpdir(), "xgc-runtime-working-tree-only")
  });
  const dirty = withCommittedRepoFiles(dirtySummary, [], true);
  assert.equal(dirty.repoCodeChanged, true);
  assert.equal(dirty.repoChangesCommitted, false);
  assert.equal(dirty.repoChangesUncommitted, true);
  assert.equal(dirty.workingTreeClean, false);
  assert.equal(dirty.workingTreeOnlyDiffObserved, true);
  assert.equal(dirty.committedDiffSource, "git-head-range");

  const unknownCommitEvidence = withCommittedRepoFiles(dirtySummary, null, true);
  assert.equal(unknownCommitEvidence.committedRepoChanged, null);
  assert.equal(unknownCommitEvidence.repoChangesUncommitted, true);
  assert.equal(unknownCommitEvidence.workingTreeClean, false);
  assert.equal(unknownCommitEvidence.workingTreeOnlyDiffObserved, false);
  assert.equal(unknownCommitEvidence.committedDiffSource, "working-tree");
});

test("withCommittedRepoFiles does not promote committed validation artifacts to repo code changes", () => {
  const summary = classifyModifiedFiles([], {
    workspaceRoot: path.join(os.tmpdir(), "xgc-runtime-committed-validation-artifacts")
  });
  const committed = withCommittedRepoFiles(summary, [".xgc/validation/workspace.yaml", ".xgc/live-smoke/report.md"], false);

  assert.deepEqual(committed.committedRepoFiles, []);
  assert.equal(committed.committedRepoChanged, false);
  assert.equal(committed.repoChangesCommitted, false);
  assert.equal(committed.repoCodeChanged, false);
  assert.equal(committed.workingTreeClean, true);
});

test("listCommittedFilesBetween distinguishes unavailable head evidence from an empty checked range", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-runtime-commit-range-"));
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('init');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  assert.deepEqual(listCommittedFilesBetween(workspaceRoot, head, head), []);
  assert.equal(listCommittedFilesBetween(workspaceRoot, null, head), null);
});

test("validation log summary treats assertion-only failures as failed validation overclaims", () => {
  const summary = summarizeValidationLog(
    [
      "npm test",
      "AssertionError [ERR_ASSERTION]: expected values to be strictly equal",
      "validation_exit=0"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "failed");
  assert.equal(summary.validationOverclaimObserved, true);
  assert.deepEqual(summary.validationCommandFailures, ["AssertionError [ERR_ASSERTION]: expected values to be strictly equal"]);
});

test("validation log summary ignores task prompt text unless validation evidence is present", () => {
  const summary = summarizeValidationLog(
    [
      "Build AtlasField Command in this fresh repository.",
      "The prompt mentions a seed command, prisma generate, and playwright smoke.",
      "Use the exact prompt text but do not run any command here.",
      "Seed command",
      "Validation requirements"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, false);
  assert.equal(summary.validationStatus, "not-observed");
  assert.equal(summary.validationRawStatus, "not-observed");
  assert.equal(summary.validationOverclaimObserved, false);
  assert.deepEqual(summary.validationCommandFailures, []);
});

test("validation log summary still detects real seed failures from command output", () => {
  const summary = summarizeValidationLog(
    [
      "npx prisma db seed",
      "Running seed command `tsx prisma/seed.ts` ...",
      "Error: seed command failed",
      "validation_exit=1"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "failed");
  assert.equal(summary.validationRawStatus, "failed");
  assert.match(summary.validationCommandFailures.join("\n"), /seed command failed/);
});

test("validation log summary ignores prompt-style command chains from process logs", () => {
  const summary = summarizeValidationLog(
    [
      "Validation commands:",
      "npm install → npx prisma generate → npx prisma db push --force-reset → npm test → npm run build → npx playwright test",
      "CAPIError: Request was aborted."
    ].join("\n")
  );

  assert.equal(summary.validationObserved, false);
  assert.equal(summary.validationStatus, "not-observed");
  assert.deepEqual(summary.validationCommandFailures, []);
});

test("validation log summary ignores planning acceptance prose with validation words", () => {
  const summary = summarizeValidationLog(
    [
      "**Acceptance:** Seed completes without error. 4 Users, 3 Orgs, 6 Projects, 30 Activities all queryable via `npx prisma studio` or inline query. ✅",
      "Next steps: run npm install, npx prisma generate, npm test, npm run build, and npx playwright test after Patch Master finishes.",
      "Risk: if the dev server did not become ready, retry validation from a separate terminal."
    ].join("\n")
  );

  assert.equal(summary.validationObserved, false);
  assert.equal(summary.validationStatus, "not-observed");
  assert.equal(summary.validationRawStatus, "not-observed");
  assert.deepEqual(summary.validationCommandFailures, []);
});

test("validation log summary treats later strong validation success as recovery from earlier failures", () => {
  const summary = summarizeValidationLog(
    [
      "npm run build",
      "Error: next build failed",
      "npm run lint",
      "No ESLint warnings or errors",
      "npm test",
      "Test Files 5 passed",
      "npm run build",
      "Compiled successfully",
      "npm run smoke",
      "Smoke test passed"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "passed");
  assert.equal(summary.validationRawStatus, "failed");
  assert.equal(summary.validationOverclaimObserved, false);
  assert.deepEqual(summary.validationCommandFailures, []);
  assert.equal(summary.validationRecoveredAfterFailuresObserved, true);
  assert.equal(summary.validationRecoverySource, "raw-later-validation-pass");
  assert.deepEqual(summary.validationRecoveredCommandFailures, ["Error: next build failed"]);
});

test("validation log summary treats checkmarked final validation as recovered despite retrospective failure notes", () => {
  const summary = summarizeValidationLog(
    [
      "npx prisma db push --force-reset",
      "Error: Schema engine error:",
      "npm test",
      "Error: Playwright Test did not expect test() to be called here.",
      "Validation results:",
      "1. npm install ✅",
      "2. npx prisma generate ✅",
      "3. npx prisma db push --force-reset ✅",
      "4. npm run seed ✅",
      "5. npm run lint ✅",
      "6. npm test ✅",
      "7. npm run build ✅",
      "8. npx playwright test ✅",
      "npx playwright test",
      "1 passed (6.2s)",
      "Known limitation / remaining uncertainty: Prisma 5.22.0 was a proven blocker here due repeated schema-engine failures, so execution switched to Prisma 6.16.0 and added a local Prisma wrapper so the required npx prisma db push --force-reset path succeeds.",
      "Raw validation notes:",
      "- Initial pinned Prisma/db push path failed with repeated Schema engine error; resolved via local wrapper."
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "passed");
  assert.equal(summary.validationRawStatus, "failed");
  assert.equal(summary.validationOverclaimObserved, false);
  assert.deepEqual(summary.validationCommandFailures, []);
  assert.equal(summary.validationRecoveredAfterFailuresObserved, true);
  assert.equal(summary.validationRecoverySource, "raw-later-validation-pass");
  assert.match(summary.validationRecoveredCommandFailures.join("\n"), /Schema engine error|Playwright Test/);
});

test("validation log summary does not let unrelated build success hide raw Playwright failures", () => {
  const summary = summarizeValidationLog(
    [
      "npx playwright test",
      "1 failed",
      "Error: strict mode violation: getByRole('link', { name: 'Incidents' }) resolved to 2 elements",
      "npm run build",
      "Compiled successfully"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "failed");
  assert.equal(summary.validationRawStatus, "failed");
  assert.equal(summary.validationOverclaimObserved, true);
  assert.match(summary.validationCommandFailures.join("\n"), /strict mode violation/);
});

test("workspace snapshots detect repo and .xgc state drift separately", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-runtime-snapshot-"));
  fs.mkdirSync(path.join(workspaceRoot, ".xgc", "logs"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('before');\n");

  const before = captureWorkspaceSnapshot(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('after');\n");
  fs.writeFileSync(path.join(workspaceRoot, ".xgc", "logs", "hooks.log"), "hook\n");
  const after = captureWorkspaceSnapshot(workspaceRoot);

  const changed = diffWorkspaceSnapshots(before, after);
  const classified = classifyModifiedFiles(changed, { workspaceRoot });
  assert.deepEqual(classified.repoWorkingTreeFiles, ["app.ts"]);
  assert.deepEqual(classified.sessionStateFiles, [path.join(".xgc", "logs", "hooks.log")]);
  assert.deepEqual(classified.stateArtifactFiles, []);
  assert.equal(classified.stateArtifactOnly, false);
});

test("classifyModifiedFiles treats ~/.copilot-xgc session-state paths as session-state artifacts", () => {
  const profileHome = path.join(os.tmpdir(), ".copilot-xgc-test-home");
  const classified = classifyModifiedFiles(
    [path.join(profileHome, "session-state", "session-1", "plan.md")],
    { profileHome }
  );

  assert.deepEqual(classified.repoWorkingTreeFiles, []);
  assert.deepEqual(classified.sessionStateFiles, [path.join(".copilot-xgc-test-home", "session-state", "session-1", "plan.md")]);
  assert.deepEqual(classified.stateArtifactFiles, [path.join(".copilot-xgc-test-home", "session-state", "session-1", "plan.md")]);
  assert.equal(classified.sessionStateOnly, true);
  assert.equal(classified.stateArtifactOnly, true);
});

test("classifyModifiedFiles treats .xgc live-smoke output as validation artifacts", () => {
  const workspaceRoot = path.join(os.tmpdir(), "xgc-runtime-validation-workspace");
  const classified = classifyModifiedFiles(
    [path.join(workspaceRoot, ".xgc", "live-smoke", "session-summary.md")],
    { workspaceRoot }
  );

  assert.deepEqual(classified.repoWorkingTreeFiles, []);
  assert.deepEqual(classified.validationArtifactFiles, [path.join(".xgc", "live-smoke", "session-summary.md")]);
  assert.deepEqual(classified.sessionStateFiles, []);
  assert.equal(classified.repoWorkingTreeChanged, false);
  assert.equal(classified.sessionStateOnly, false);
});

test("inspectInstalledPlugin reads ~/.copilot/config.json evidence", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-home-"));
  const copilotDir = path.join(home, ".copilot");
  const cachePath = path.join(copilotDir, "installed-plugins", "_direct", "xgc-direct-plugin");
  fs.mkdirSync(cachePath, { recursive: true });

  fs.writeFileSync(
    path.join(copilotDir, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            source: { source_path: "/tmp/source-repo" },
            cache_path: cachePath
          }
        ]
      },
      null,
      2
    )
  );

  const evidence = inspectInstalledPlugin("xgc", { homeDir: home, sourcePath: "/tmp/source-repo" });
  assert.equal(evidence.registeredInConfig, true);
  assert.equal(evidence.cachePathExists, true);
  assert.equal(evidence.cachedPluginPath, cachePath);
  assert.equal(evidence.notes.length, 0);
});

test("inspectInstalledPlugin also supports direct COPILOT_HOME config dirs", () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-config-dir-"));
  const cachePath = path.join(configDir, "installed-plugins", "_direct", "xgc-direct-plugin");
  fs.mkdirSync(cachePath, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            source: { source_path: "/tmp/source-repo" },
            cache_path: cachePath
          }
        ]
      },
      null,
      2
    )
  );

  const evidence = inspectInstalledPlugin("xgc", { homeDir: configDir, sourcePath: "/tmp/source-repo" });
  assert.equal(evidence.registeredInConfig, true);
  assert.equal(evidence.configPath, path.join(configDir, "config.json"));
  assert.equal(evidence.cachePathExists, true);
});

test("buildMcpStates reports selected-but-not-configured drift explicitly", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-mcp-state-"));
  fs.mkdirSync(path.join(repoRoot, ".xgc", "bootstrap"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, ".github"), { recursive: true });

  fs.writeFileSync(
    path.join(repoRoot, ".xgc", "bootstrap", "selected-tooling.json"),
    JSON.stringify(
      {
        selected: {
          mcpServers: ["context7"]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(repoRoot, ".github", "mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));

  const states = buildMcpStates(repoRoot, {});
  const context7 = states.find((state) => state.id === "context7");
  assert.ok(context7);
  assert.equal(context7.configured, false);
  assert.equal(context7.selected, true);
  assert.equal(context7.credentialStatus, "selected-but-not-configured");
  assert.match(context7.notes.join("\n"), /selected in bootstrap record but missing/i);
});

test("classifyLspEvidence does not treat generic definition words as explicit proof", () => {
  const evidence = classifyLspEvidence(
    "typescript-language-server",
    "Found the definition and diagnostic for the issue.",
    "",
    ""
  );
  assert.notEqual(evidence.strength, "explicit");
});

test("classifyMcpEvidence keeps broad web text at weak or unproven without capability-unique markers", () => {
  const evidence = classifyMcpEvidence(
    "websearch",
    "This answer includes an https source url and a recent external reference.",
    "",
    ""
  );
  assert.ok(evidence.strength === "weak" || evidence.strength === "unproven");
});

test("classifyMcpEvidence records alternate built-in code search as strong indirect when task markers exist", () => {
  const transcript = [
    "### ✅ `github-mcp-server-search_code`",
    "Use external code search if it helps.",
    "Summarize the repository names and the command shape for public open-source examples."
  ].join("\n");

  const evidence = classifyMcpEvidence("grep_app", transcript, "", "");
  assert.equal(evidence.strength, "strong-indirect");
  assert.equal(evidence.pathKind, "alternate");
  assert.ok(evidence.observedTools.includes("github-mcp-server-search_code"));
});

test("classifyLspEvidence accepts validation-fixture diagnostics as strong indirect code-aware proof", () => {
  const transcript = [
    "validation-fixtures/typescript/app.ts",
    "definition of formatUser",
    "type mismatch",
    "### ✅ `bash`",
    "tsc --noEmit"
  ].join("\n");

  const evidence = classifyLspEvidence("typescript-language-server", transcript, "", "");
  assert.equal(evidence.strength, "strong-indirect");
  assert.ok(evidence.pathKind === "selected" || evidence.pathKind === "alternate");
  assert.ok(evidence.observedTools.includes("bash"));
});

test("hook-only explicit capability markers do not become explicit proof", () => {
  const evidence = classifyMcpEvidence("context7", "", "", '{"toolName":"context7"}');
  assert.notEqual(evidence.strength, "explicit");
  assert.ok(evidence.strength === "weak" || evidence.strength === "unproven");
});

test("hook-only alternate tool markers do not overclaim strong proof", () => {
  const evidence = classifyMcpEvidence("grep_app", "", "", '{"toolName":"github-mcp-server-search_code"}');
  assert.ok(evidence.strength === "weak" || evidence.strength === "unproven");
  assert.notEqual(evidence.strength, "strong-indirect");
});

test("pluginListedInOutput matches whole plugin entries conservatively", () => {
  const output = [
    "Installed plugins:",
    "  • xgc (v0.1.0)",
    "  • xgc-extra (v0.1.0)"
  ].join("\n");

  assert.equal(pluginListedInOutput(output, "xgc"), true);
  assert.equal(pluginListedInOutput(output, "xgc-ex"), false);
});

test("extractObservedSubagentNames reads stdout and hook traces in order", () => {
  const stdout = [
    JSON.stringify({
      type: "subagent.selected",
      timestamp: "2026-04-06T09:42:50Z",
      data: { agentDisplayName: "Repo Master" }
    }),
    JSON.stringify({
      type: "subagent.started",
      timestamp: "2026-04-06T09:42:52Z",
      data: { agentDisplayName: "Milestone" }
    }),
    JSON.stringify({
      type: "subagent.completed",
      timestamp: "2026-04-06T09:45:08Z",
      data: { agentDisplayName: "Milestone" }
    })
  ].join("\n");
  const hookLog = [
    '2026-04-06T09:42:51Z preToolUse {"toolName":"task","toolArgs":"{\\"agent_type\\":\\"Repo Scout\\"}"}',
    '2026-04-06T09:45:07Z subagentStop {"agentName":"Repo Scout"}'
  ].join("\n");

  assert.deepEqual(extractObservedSubagentNames(stdout, hookLog), [
    "Repo Master",
    "Repo Scout",
    "Milestone",
    "Repo Scout",
    "Milestone"
  ]);
});

test("extractObservedSubagentNames merges stdout and hook events by timestamp", () => {
  const stdout = [
    JSON.stringify({
      type: "subagent.started",
      timestamp: "2026-04-06T10:00:05Z",
      data: { agentDisplayName: "Patch Master" }
    }),
    JSON.stringify({
      type: "subagent.completed",
      timestamp: "2026-04-06T10:00:20Z",
      data: { agentDisplayName: "Patch Master" }
    })
  ].join("\n");
  const hookLog = [
    '2026-04-06T10:00:01Z preToolUse {"toolName":"task","toolArgs":"{\\"agent_type\\":\\"Repo Scout\\"}"}',
    '2026-04-06T10:00:04Z subagentStop {"agentName":"Repo Scout"}',
    '2026-04-06T10:00:02Z preToolUse {"toolName":"task","toolArgs":"{\\"agent_type\\":\\"Milestone\\"}"}',
    '2026-04-06T10:00:03Z subagentStop {"agentName":"Milestone"}'
  ].join("\n");

  assert.deepEqual(extractObservedSubagentNames(stdout, hookLog), [
    "Repo Scout",
    "Milestone",
    "Milestone",
    "Repo Scout",
    "Patch Master",
    "Patch Master"
  ]);
});

test("countObservedNames tallies repeated subagent events for swarm checks", () => {
  assert.deepEqual(countObservedNames(["Repo Scout", "Repo Scout", "Milestone"]), {
    "Repo Scout": 2,
    Milestone: 1
  });
});

test("collapseConsecutiveNames reduces lifecycle duplicates to distinct observed runs", () => {
  assert.deepEqual(
    collapseConsecutiveNames([
      "Repo Scout",
      "Repo Scout",
      "Milestone",
      "Repo Scout",
      "Repo Scout",
      "Repo Scout",
      "Patch Master"
    ]),
    ["Repo Scout", "Milestone", "Repo Scout", "Patch Master"]
  );
});

test("extractObservedSessionModels keeps the observed model order without duplicate churn", () => {
  const stdout = [
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "gpt-5-mini" } }),
    JSON.stringify({ type: "session.tools_updated", data: { model: "gpt-5-mini" } }),
    JSON.stringify({ type: "session.tools_updated", data: { model: "gpt-5-mini" } }),
    JSON.stringify({ type: "session.tools_updated", data: { model: "claude-sonnet-4.6" } }),
    JSON.stringify({
      type: "session.shutdown",
      data: {
        modelMetrics: {
          "claude-sonnet-4.6": { requests: { count: 1 } },
          "gpt-5.4": { requests: { count: 1 } }
        },
        currentModel: "gpt-5.4"
      }
    })
  ].join("\n");

  assert.deepEqual(extractObservedSessionModels(stdout), ["gpt-5-mini", "claude-sonnet-4.6", "gpt-5.4"]);
});

test("summarizeObservedSessionModels allows model-policy-resolved child tool models after model_change", () => {
  const stdout = [
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "gpt-5-mini" } }),
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "claude-sonnet-4.6" } }),
    JSON.stringify({ type: "user.message", data: { content: "Build the product" } }),
    JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolTelemetry: {
          restrictedProperties: { agent_name: "Milestone" },
          properties: { model: "gpt-5.4" }
        }
      }
    })
  ].join("\n");

  const summary = summarizeObservedSessionModels(stdout);
  assert.equal(summary.requestedRuntimeModel, "claude-sonnet-4.6");
  assert.deepEqual(summary.observedRuntimeModels, ["gpt-5-mini", "claude-sonnet-4.6"]);
  assert.deepEqual(summary.postPromptObservedRuntimeModels, []);
  assert.deepEqual(summary.observedAgentToolModels, ["gpt-5.4"]);
  assert.equal(summary.mixedModelSessionObserved, false);
  assert.equal(summary.nonRequestedModelUsageObserved, false);
  assert.deepEqual(summary.modelIdentity, {
    requestedRuntimeModel: "claude-sonnet-4.6",
    selectedRuntimeModel: "claude-sonnet-4.6",
    observedToolModels: ["gpt-5.4"],
    observedModelMetricModels: []
  });
  assert.deepEqual(summary.modelMismatch, {
    observed: false,
    selectedRuntimeModel: "claude-sonnet-4.6",
    observedToolModels: ["gpt-5.4"],
    mismatchedToolModels: []
  });
});

test("summarizeObservedSessionModels flags tool models outside the resolved model policy set", () => {
  const stdout = [
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "gpt-5.4" } }),
    JSON.stringify({ type: "user.message", data: { content: "Build the product" } }),
    JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolTelemetry: {
          restrictedProperties: { agent_name: "Milestone" },
          properties: { model: "claude-haiku-4.6" }
        }
      }
    })
  ].join("\n");

  const summary = summarizeObservedSessionModels(stdout);
  assert.equal(summary.requestedRuntimeModel, "gpt-5.4");
  assert.deepEqual(summary.observedAgentToolModels, ["claude-haiku-4.6"]);
  assert.deepEqual(summary.modelMismatch, {
    observed: true,
    selectedRuntimeModel: "gpt-5.4",
    observedToolModels: ["claude-haiku-4.6"],
    mismatchedToolModels: ["claude-haiku-4.6"]
  });
});

test("summarizeObservedSessionModels treats /model command before prompt as selected runtime model", () => {
  const stdout = [
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "gpt-5-mini" } }),
    JSON.stringify({ type: "user.message", data: { content: "/model gpt-5.4" } }),
    JSON.stringify({ type: "session.model_change", data: { previousModel: "gpt-5-mini", newModel: "gpt-5.4" } }),
    JSON.stringify({ type: "user.message", data: { content: "Build the product" } }),
    JSON.stringify({ type: "session.shutdown", data: { currentModel: "gpt-5.4" } })
  ].join("\n");

  const summary = summarizeObservedSessionModels(stdout);
  assert.equal(summary.requestedRuntimeModel, "gpt-5.4");
  assert.deepEqual(summary.postPromptObservedRuntimeModels, ["gpt-5.4"]);
  assert.equal(summary.nonRequestedModelUsageObserved, false);
  assert.equal(summary.modelMismatch.observed, false);
});

test("extractObservedSessionModels ignores non-record model metrics", () => {
  const stdout = JSON.stringify({
    type: "session.shutdown",
    data: {
      modelMetrics: ["gpt-5.4", "claude-sonnet-4.6"],
      currentModel: "gpt-5.4"
    }
  });

  assert.deepEqual(extractObservedSessionModels(stdout), ["gpt-5.4"]);
});

test("summarizeAgentModelPolicyMismatches compares observed child models with resolved policy", () => {
  const stdout = [
    JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolTelemetry: {
          restrictedProperties: { agent_name: "Milestone" },
          properties: { model: "claude-sonnet-4.6" }
        }
      }
    }),
    JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolTelemetry: {
          restrictedProperties: { agent_name: "Patch Master" },
          properties: { model: "gpt-5.4" }
        }
      }
    })
  ].join("\n");

  const summary = summarizeAgentModelPolicyMismatches(stdout, "claude-opus-4.6");
  assert.equal(summary.agentModelPolicyMismatchObserved, true);
  assert.equal(summary.agentModelPolicyMismatchCount, 1);
  assert.deepEqual(summary.agentModelPolicyMismatches, ["Milestone expected claude-opus-4.6 observed claude-sonnet-4.6"]);
});

test("summarizeAgentModelPolicyMismatches ignores parent task model fields", () => {
  const stdout = JSON.stringify({
    type: "tool.execution_complete",
    data: {
      agentDisplayName: "Milestone",
      model: "gpt-5.4"
    }
  });

  const summary = summarizeAgentModelPolicyMismatches(stdout, "gpt-5.4");
  assert.equal(summary.agentModelPolicyMismatchObserved, false);
  assert.equal(summary.agentModelPolicyMismatchCount, 0);
  assert.deepEqual(summary.agentModelPolicyMismatches, []);
});

test("summarizeValidationLog ignores background agent wait progress as validation failure", () => {
  const summary = summarizeValidationLog(
    [
      "Agent is still running after waiting 60s. agent_id: titanforge-build, agent_type: Patch Master, status: running, tool_calls_completed: 9, (timed out waiting for completion)",
      "2026-04-13T17:59:11.578Z [ERROR] Command failed with exit code 128: git rev-parse HEAD",
      "2026-04-13T17:59:11.578Z [ERROR] Failed to get current commit hash: GitError: unknown revision git error: Command failed with exit code 128: git rev-parse HEAD",
      "npm test passed",
      "playwright smoke test passed"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "passed");
  assert.equal(summary.validationOverclaimObserved, false);
  assert.deepEqual(summary.validationCommandFailures, []);
});

test("summarizeValidationLog ignores transient MCP connection noise after validation success", () => {
  const summary = summarizeValidationLog(
    [
      "npm run build",
      "Compiled successfully",
      "npm test",
      "Test Files 4 passed",
      "npx playwright test",
      "1 passed (7.9s)",
      "2026-04-13T18:47:03.937Z [ERROR] MCP transport for context7 closed",
      "2026-04-13T18:47:03.938Z [ERROR] Transient error connecting to HTTP server context7: TypeError: fetch failed",
      "2026-04-13T18:47:03.938Z [ERROR] Retrying connection to HTTP server context7 (attempt 2/3) after 500ms",
      "2026-04-13T18:47:06.201Z [ERROR] MCP client for context7 connected, took 1760ms"
    ].join("\n")
  );

  assert.equal(summary.validationObserved, true);
  assert.equal(summary.validationStatus, "passed");
  assert.equal(summary.validationOverclaimObserved, false);
  assert.deepEqual(summary.validationCommandFailures, []);
});

test("summarizeRouteObservations reports direct handling and grounding order conservatively", () => {
  const processLog = [
    '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
    "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
    '  "status": 503,',
    '  "message": "503 {\\"error\\":{\\"message\\":\\"HTTP/2 GOAWAY connection terminated\\",\\"type\\":\\"connection_error\\"}}"',
    "2026-04-07T12:55:48.086Z [INFO] --- End of group ---"
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "planning-cold-start",
    observedSubagents: ["Repo Master", "Repo Scout", "Repo Scout", "Milestone", "Triage", "Patch Master"],
    observedSubagentCounts: { "Repo Scout": 2, Milestone: 1, Triage: 1, "Patch Master": 1 },
    stdout: [
      JSON.stringify({ type: "session.tools_updated", data: { model: "gpt-5-mini" } }),
      JSON.stringify({ type: "session.tools_updated", data: { model: "claude-sonnet-4.6" } }),
      JSON.stringify({ type: "session.tools_updated", data: { model: "gpt-5.4" } }),
      JSON.stringify({ type: "session.shutdown", data: { currentModel: "gpt-5.4" } })
    ].join("\n"),
    processLog
  });

  assert.deepEqual(route.observedPlanningChain, ["Repo Master", "Repo Scout", "Repo Scout", "Milestone", "Triage", "Patch Master"]);
  assert.equal(route.routeSummarySource, "name_list_fallback");
  assert.equal(route.observedFrontDoorHandledDirectly, false);
  assert.equal(route.observedScoutCount, 2);
  assert.equal(route.repoScoutInvocationCount, 2);
  assert.equal(route.triageInvocationCount, 1);
  assert.equal(route.patchMasterInvocationCount, 1);
  assert.equal(route.requiredCheckInvocationCount, 0);
  assert.equal(route.executionOwner, "Patch Master");
  assert.equal(route.ownershipTransferredToExecution, true);
  assert.equal(route.backgroundExecutionAgentObserved, false);
  assert.equal(route.backgroundExecutionAgentUnresolved, false);
  assert.equal(route.triageDuplicateObserved, false);
  assert.equal(route.triageDuplicateAllowedReason, null);
  assert.equal(route.executionReadyHandoffSeenBeforeSecondTriage, false);
  assert.equal(route.observedPlannerBeforeExecutor, true);
  assert.equal(route.observedTriageBeforeExecutor, true);
  assert.equal(route.observedRefIndex, false);
  assert.equal(route.observedGroundingBeforeExecutor, "grounded-before-executor");
  assert.equal(route.observedExecutionPhasePure, true);
  assert.deepEqual(route.postExecutionPlannerReopenAgents, []);
  assert.equal(route.githubMemoryEnabledProbe, "skipped_for_route");
  assert.equal(route.githubMemoryPromptProbe, "skipped_for_route");
  assert.equal(route.prLookup, "skipped_for_route");
  assert.equal(route.githubMemoryEnabledCheck, "skipped");
  assert.equal(route.githubMemoryEnabledCheckCached, false);
  assert.equal(route.githubMemoryEnabledCheckCount, 0);
  assert.equal(route.githubMemoryEnabledCheckSource, "route_skip");
  assert.equal(route.githubMemoryEnabledFreshAfterCacheObserved, false);
  assert.equal(route.prContextCheck, "skipped");
  assert.equal(route.prContextCheckCached, false);
  assert.equal(route.prContextCheckCount, 0);
  assert.equal(route.prContextCheckSource, "route_skip");
  assert.equal(route.prContextFreshAfterCacheObserved, false);
  assert.equal(route.prLookupCheck, "skipped");
  assert.equal(route.prLookupCheckCached, false);
  assert.equal(route.prLookupCheckSource, "route_skip");
  assert.equal(route.githubCapabilityCacheHits, 0);
  assert.equal(route.githubCapabilityCacheMisses, 0);
  assert.equal(route.observedMemoryProbeSuppressed, true);
  assert.equal(route.observedPrProbeSuppressed, true);
  assert.equal(route.providerRetryObserved, true);
  assert.equal(route.providerRetryActive, false);
  assert.equal(route.providerRetryState, "recovered-after-retry");
  assert.equal(route.providerRetryRecovered, true);
  assert.equal(route.providerRetryCount, 1);
  assert.equal(route.providerRetryReason, "HTTP/2 GOAWAY / 503 connection_error");
  assert.equal(route.activeAgentDuringRetry, "Patch Master");
  assert.equal(route.providerRetryConfidence, "explicit");
  assert.equal(route.routeConfidence, "explicit");
  assert.equal(route.requestedRuntimeModel, "gpt-5-mini");
  assert.equal(route.sessionCurrentModel, "gpt-5.4");
  assert.deepEqual(route.observedRuntimeModels, ["gpt-5-mini", "claude-sonnet-4.6", "gpt-5.4"]);
  assert.equal(route.mixedModelSessionObserved, true);
  assert.equal(route.nonRequestedModelUsageObserved, true);
});

test("summarizeRouteObservations records executor before grounding without task-name special cases", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "structure-orientation",
    observedSubagents: ["Repo Master", "Patch Master", "Repo Scout"],
    observedSubagentCounts: {},
    stdout: JSON.stringify({ type: "session.tools_updated", data: { model: "gpt-5-mini" } })
  });

  assert.equal(route.observedGroundingBeforeExecutor, "executor-before-grounding");
  assert.equal(route.observedScoutCount, 1);
  assert.equal(route.observedRefIndex, false);
});

test("summarizeRouteObservations flags planner/reference reopen after Patch Master", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Milestone", "Patch Master", "Ref Index"],
    observedSubagentCounts: { Milestone: 1, "Patch Master": 1, "Ref Index": 1 },
    stdout: JSON.stringify({ type: "session.tools_updated", data: { model: "claude-sonnet-4.6" } })
  });

  assert.equal(route.observedExecutionPhasePure, false);
  assert.deepEqual(route.postExecutionPlannerReopenAgents, ["Ref Index"]);
  assert.equal(route.postExecutionOwnershipLeakObserved, true);
  assert.equal(route.ownershipLeakAllowedReason, null);
});

test("summarizeRouteObservations records conservative allowed reasons for post-execution helper reopen", () => {
  const noBlocker = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master", "Explore Agent"],
    observedSubagentCounts: { "Patch Master": 1, "Explore Agent": 1 },
    stdout: "Patch Master completed. blocker: none. Explore Agent reopened after execution."
  });
  assert.equal(noBlocker.postExecutionOwnershipLeakObserved, true);
  assert.equal(noBlocker.ownershipLeakAllowedReason, null);

  const negatedBlocker = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master", "General Purpose Agent"],
    observedSubagentCounts: { "Patch Master": 1, "General Purpose Agent": 1 },
    stdout: "Patch Master completed. The follow-up is not blocked by schema anymore."
  });
  assert.equal(negatedBlocker.postExecutionOwnershipLeakObserved, true);
  assert.equal(negatedBlocker.ownershipLeakAllowedReason, null);

  const namedBlocker = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master", "Explore Agent"],
    observedSubagentCounts: { "Patch Master": 1, "Explore Agent": 1 },
    stdout: "Patch Master blocked by schema migration blocker: needs owner decision"
  });
  assert.equal(namedBlocker.postExecutionOwnershipLeakObserved, true);
  assert.equal(namedBlocker.ownershipLeakAllowedReason, "named_blocker");

  const narrowFollowUp = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master", "Ref Index"],
    observedSubagentCounts: { "Patch Master": 1, "Ref Index": 1 },
    stdout: "bounded follow-up requested for one targeted read after execution"
  });
  assert.equal(narrowFollowUp.ownershipLeakAllowedReason, "narrow_follow_up");

  const requestedReview = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master", "General Purpose Agent"],
    observedSubagentCounts: { "Patch Master": 1, "General Purpose Agent": 1 },
    stdout: "The user requested a double check review after implementation"
  });
  assert.equal(requestedReview.ownershipLeakAllowedReason, "user_requested_review");
});

test("summarizeRouteObservations recognizes specialist lanes as XGC route agents", () => {
  const visualRoute = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Visual Forge", "Patch Master"],
    observedSubagentCounts: { "Visual Forge": 1, "Patch Master": 1 },
    stdout: ""
  });

  assert.deepEqual(visualRoute.observedPlanningChain, ["Repo Master", "Visual Forge", "Patch Master"]);
  assert.equal(visualRoute.routeConfidence, "explicit");

  const multimodalRoute = summarizeRouteObservations({
    agentId: "multimodal-look",
    agentLane: "specialist",
    observedSubagents: ["Multimodal Look"],
    observedSubagentCounts: { "Multimodal Look": 1 },
    stdout: ""
  });

  assert.deepEqual(multimodalRoute.observedPlanningChain, ["Multimodal Look"]);
  assert.equal(multimodalRoute.routeConfidence, "explicit");
});

test("summarizeRouteObservations treats shared surface changes as integration-class evidence", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: "",
    sharedSurfaceChangeObserved: true
  });

  assert.equal(route.integrationClassTaskObserved, true);
  assert.equal(route.foundationReadinessAssessed, false);
  assert.equal(route.foundationReadinessUnknown, true);
});

test("summarizeRouteObservations treats missing recommended specialist lanes as acceptable when Patch Master swarms", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "mega-product-build",
    promptText:
      "Build a complex production-shaped multi-tenant SaaS app with dashboard, analytics, docs, tests, and responsive UI.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 3 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, true);
  assert.equal(route.specialistLaneExpected, true);
  assert.deepEqual(route.requiredSpecialistLanes, []);
  assert.deepEqual(route.recommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.deepEqual(route.missingRequiredSpecialistLanes, []);
  assert.deepEqual(route.missingRecommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.equal(route.patchMasterSwarmObserved, true);
  assert.equal(route.patchMasterSwarmCount, 3);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, true);
  assert.equal(route.specialistFanoutStatus, "covered_by_patch_master_swarm");
  assert.match(route.specialistFanoutReason ?? "", /Patch Master swarm coverage/i);
});

test("summarizeRouteObservations treats narrow visual work as requiring Visual Forge", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "visual-polish",
    promptText: "Polish the responsive UI layout, CSS spacing, visual hierarchy, animation, and accessibility.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, false);
  assert.deepEqual(route.requiredSpecialistLanes, ["visual-forge"]);
  assert.deepEqual(route.recommendedSpecialistLanes, []);
  assert.deepEqual(route.missingRequiredSpecialistLanes, ["visual-forge"]);
  assert.equal(route.patchMasterSwarmObserved, true);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, false);
  assert.equal(route.specialistFanoutStatus, "missing_required");
});

test("summarizeRouteObservations does not count selected-only specialist lanes as executed fanout", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "selected-only-visual",
    promptText: "Use Visual Forge to polish the responsive UI layout and animation.",
    observedSubagents: [],
    observedSubagentCounts: {},
    observedSubagentEvents: [
      { agentName: "Visual Forge", kind: "selected", source: "stdout", timestampMs: Date.parse("2026-04-15T01:00:00Z") }
    ],
    stdout: ""
  });

  assert.deepEqual(route.requiredSpecialistLanes, ["visual-forge"]);
  assert.deepEqual(route.observedSpecialistLanes, []);
  assert.deepEqual(route.missingRequiredSpecialistLanes, ["visual-forge"]);
  assert.equal(route.specialistFanoutStatus, "missing_required");
});

test("summarizeRouteObservations scopes specialist fanout to explicit prompt over stale broad transcript", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "stale-broad-transcript",
    promptText: "현재 크롬 익스텐션에서 라이트모드 / 다크모드가 정상동작하지않는데 수정해줘",
    transcriptText:
      "User: Build a complex production-shaped multi-tenant SaaS app with dashboard, analytics, docs, tests, architecture, validation, and responsive UI.",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, false);
  assert.deepEqual(route.requiredSpecialistLanes, ["visual-forge"]);
  assert.deepEqual(route.recommendedSpecialistLanes, []);
  assert.deepEqual(route.foundationFailureClasses, []);
});

test("summarizeRouteObservations ignores planning advisory text when classifying foundation failures", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "planning-advisory-foundation",
    promptText: "Build AtlasField Command",
    observedSubagents: ["Repo Master"],
    observedSubagentCounts: {},
    stdout: [
      "Missing constraint — no Node.js version constraint.",
      "`bcryptjs`, `next-auth` v4, and Next.js 14 each have minimum Node version floors. On a machine running Node 16 the build will fail with a non-obvious error.",
      "Confirmed: Playwright requires `npx playwright install chromium` before `npx playwright test` or it errors with \"browser not found.\" This step is not in `package.json` scripts.",
      "npm install → npx prisma generate → npm test → npm run build"
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, []);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations does not classify generic session summary errors as auth-session", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "generic-session-summary-error",
    observedSubagents: ["Repo Master"],
    observedSubagentCounts: {},
    stdout: "Error: session summary stale after retry"
  });

  assert.deepEqual(route.foundationFailureClasses, []);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations treats narrow writing work as requiring Writing Desk", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "docs-only",
    promptText: "Rewrite the README, onboarding guide, migration notes, changelog, and validation documentation.",
    observedSubagents: ["Repo Master"],
    observedSubagentCounts: {},
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, false);
  assert.deepEqual(route.requiredSpecialistLanes, ["writing-desk"]);
  assert.deepEqual(route.missingRequiredSpecialistLanes, ["writing-desk"]);
  assert.equal(route.patchMasterSwarmObserved, false);
  assert.equal(route.specialistFanoutStatus, "missing_required");
});

test("summarizeRouteObservations treats narrow creative direction as requiring Artistry Studio", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "creative-only",
    promptText: "Create naming, tone, messaging, brand voice, tagline, and aesthetic direction options.",
    observedSubagents: ["Repo Master", "Artistry Studio"],
    observedSubagentCounts: { "Artistry Studio": 1 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, false);
  assert.deepEqual(route.requiredSpecialistLanes, ["artistry-studio"]);
  assert.deepEqual(route.observedSpecialistLanes, ["artistry-studio"]);
  assert.deepEqual(route.missingRequiredSpecialistLanes, []);
  assert.equal(route.specialistFanoutStatus, "complete");
});

test("summarizeRouteObservations keeps a single Patch Master from counting as swarm coverage", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "mega-single-executor",
    promptText:
      "Build a complex production-shaped multi-tenant SaaS app with dashboard, analytics, docs, tests, and responsive UI.",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: ""
  });

  assert.deepEqual(route.requiredSpecialistLanes, []);
  assert.deepEqual(route.recommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.equal(route.patchMasterSwarmObserved, false);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, false);
  assert.equal(route.specialistFanoutStatus, "partial");
});

test("summarizeRouteObservations respects explicit single-Copilot session scope over broad specialist fanout", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "single-copilot-mega-product",
    promptText:
      "Use one single Copilot session only. Build a complex production-shaped multi-tenant SaaS app with dashboard, responsive UI, docs, tests, architecture, and visual artifact analysis.",
    observedSubagents: ["Repo Master", "Milestone", "Triage"],
    observedSubagentCounts: { "Repo Master": 1, Milestone: 1, Triage: 1 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, true);
  assert.equal(route.specialistLaneExpected, false);
  assert.deepEqual(route.requiredSpecialistLanes, []);
  assert.deepEqual(route.recommendedSpecialistLanes, []);
  assert.deepEqual(route.missingRequiredSpecialistLanes, []);
  assert.equal(route.specialistFanoutStatus, "not_applicable");
  assert.equal(route.specialistFanoutReason, "single_session_scope_declared");
});

test("summarizeRouteObservations recognizes hyphenated single-session scope without matching app-domain sessions", () => {
  const hyphenated = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "single-session-scope",
    promptText:
      "Use single-session scope for this complex production-shaped SaaS app with dashboard, responsive UI, docs, tests, architecture, and visual polish.",
    observedSubagents: ["Repo Master", "Milestone", "Triage"],
    observedSubagentCounts: { "Repo Master": 1, Milestone: 1, Triage: 1 },
    stdout: ""
  });
  assert.equal(hyphenated.largeProductBuildTaskObserved, true);
  assert.equal(hyphenated.specialistLaneExpected, false);
  assert.equal(hyphenated.specialistFanoutReason, "single_session_scope_declared");

  const appDomainSession = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "single-session-auth",
    promptText:
      "Build a complex production-shaped SaaS app with dashboard, responsive UI, docs, tests, architecture, plus single session auth and one session cookie handling.",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: ""
  });
  assert.equal(appDomainSession.largeProductBuildTaskObserved, true);
  assert.equal(appDomainSession.specialistLaneExpected, true);
  assert.deepEqual(appDomainSession.recommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.equal(appDomainSession.specialistFanoutStatus, "partial");
});

test("summarizeRouteObservations does not recommend Multimodal Look for asset-only mentions without analysis intent", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "mockup-build",
    promptText:
      "Build a complex production-shaped SaaS app with dashboard, responsive UI, docs, tests, architecture, and mockup-inspired styling.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout: ""
  });

  assert.equal(route.largeProductBuildTaskObserved, true);
  assert.deepEqual(route.requiredSpecialistLanes, []);
  assert.deepEqual(route.recommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.deepEqual(route.missingRecommendedSpecialistLanes, ["visual-forge", "writing-desk"]);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, true);
  assert.equal(route.specialistFanoutStatus, "covered_by_patch_master_swarm");
});

test("summarizeRouteObservations ignores noisy multimodal words outside the user scope", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "launch-visual-notes",
    promptText:
      "Create a visual launch deck and execution notes for the incident readiness workflow. Do not force multimodal analysis unless an actual screenshot/PDF/image is available.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout: "agent step: review screenshot metadata from prior run",
    processLog: "parsed PDF summary from legacy notes"
  });

  assert.equal(route.largeProductBuildTaskObserved, false);
  assert.deepEqual(route.requiredSpecialistLanes, []);
  assert.equal(route.patchMasterSwarmObserved, true);
});

test("summarizeRouteObservations still requires Multimodal Look when one artifact type is absent but another is present", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "pdf-without-screenshot",
    promptText: "Analyze the attached PDF architecture diagram and extract the visual hierarchy. No screenshot is available.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout: ""
  });

  assert.deepEqual(route.requiredSpecialistLanes, ["multimodal-look"]);
  assert.deepEqual(route.missingRequiredSpecialistLanes, ["multimodal-look"]);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, false);
  assert.equal(route.specialistFanoutStatus, "missing_required");
});

test("summarizeRouteObservations does not accept Patch Master-only swarm when required specialist lanes are missing", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "visual-artifact-analysis",
    promptText: "Analyze this screenshot and PDF diagram, then extract the visual hierarchy findings.",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout: ""
  });

  assert.equal(route.specialistLaneExpected, true);
  assert.deepEqual(route.requiredSpecialistLanes, ["multimodal-look"]);
  assert.deepEqual(route.observedSpecialistLanes, []);
  assert.deepEqual(route.missingRequiredSpecialistLanes, ["multimodal-look"]);
  assert.equal(route.patchMasterSwarmObserved, true);
  assert.equal(route.specialistFanoutCoveredByPatchMaster, false);
  assert.equal(route.specialistFanoutStatus, "missing_required");
  assert.match(route.specialistFanoutReason ?? "", /missing required specialist lanes/i);
});

test("summarizeRouteObservations recovers direct raw Copilot tool execution when no subagents exist", () => {
  const stdout = [
    JSON.stringify({ type: "session.start", timestamp: "2026-04-12T06:00:00.000Z" }),
    JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-12T06:01:00.000Z", data: { toolName: "bash" } }),
    JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-12T06:02:00.000Z", data: { toolName: "apply_patch" } }),
    JSON.stringify({
      type: "session.shutdown",
      timestamp: "2026-04-12T06:05:00.000Z",
      data: {
        codeChanges: {
          linesAdded: 50,
          linesRemoved: 4,
          filesModified: ["app/page.tsx", "package.json"]
        }
      }
    })
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: null,
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout
  });

  assert.deepEqual(route.routeAgents, []);
  assert.equal(route.routeSummary, "Direct Copilot Session");
  assert.equal(route.routeSummarySource, "raw_tool_events_fallback");
  assert.equal(route.directToolExecutionObserved, true);
  assert.equal(route.toolExecutionCount, 2);
  assert.equal(route.writeToolCount, 1);
  assert.equal(route.bashToolCount, 1);
  assert.equal(route.sessionShutdownObserved, true);
  assert.equal(route.sessionShutdownCodeChangesObserved, true);
  assert.deepEqual(route.sessionShutdownFilesModified, ["app/page.tsx", "package.json"]);
  assert.equal(route.sessionShutdownLinesAdded, 50);
  assert.equal(route.sessionShutdownLinesRemoved, 4);
  assert.equal(route.routeConfidence, "strong-indirect");
});

test("summarizeRouteObservations labels shutdown-only direct sessions without claiming tool-event provenance", () => {
  const stdout = [
    JSON.stringify({ type: "session.start", timestamp: "2026-04-12T06:00:00.000Z" }),
    JSON.stringify({
      type: "session.shutdown",
      timestamp: "2026-04-12T06:05:00.000Z",
      data: {
        codeChanges: {
          linesAdded: 12,
          linesRemoved: 1,
          filesModified: ["app/page.tsx"]
        }
      }
    })
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: null,
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout
  });

  assert.deepEqual(route.routeAgents, []);
  assert.equal(route.routeSummary, "Direct Copilot Session");
  assert.equal(route.routeSummarySource, "session_shutdown_code_changes_fallback");
  assert.equal(route.directToolExecutionObserved, true);
  assert.equal(route.toolExecutionCount, 0);
  assert.equal(route.sessionShutdownCodeChangesObserved, true);
  assert.deepEqual(route.sessionShutdownFilesModified, ["app/page.tsx"]);
});

test("summarizeRouteObservations flags built-in Explore after Patch Master as ownership leak", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T20:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T20:01:00.000Z") },
      { agentName: "Explore Agent", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T20:02:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master", "Explore Agent"],
    observedSubagentCounts: { "Patch Master": 1, "Explore Agent": 1 },
    stdout: "integration-class task: multi-session product work"
  });

  assert.deepEqual(route.routeAgents, ["Repo Master", "Patch Master", "Explore Agent"]);
  assert.equal(route.routeSummary, "Repo Master -> Patch Master -> Explore Agent");
  assert.deepEqual(route.keyAgents, ["Repo Master", "Patch Master", "Explore Agent"]);
  assert.deepEqual(route.observedPlanningChain, ["Repo Master", "Patch Master"]);
  assert.equal(route.builtInGenericAgentInvocationCount, 1);
  assert.equal(route.postExecutionGenericAgentObserved, true);
  assert.equal(route.postExecutionBuiltInAgentObserved, true);
  assert.deepEqual(route.postExecutionGenericAgents, ["Explore Agent"]);
  assert.deepEqual(route.postExecutionBuiltInAgents, ["Explore Agent"]);
  assert.equal(route.postExecutionOwnershipLeakObserved, true);
  assert.equal(route.ownershipLeakAllowedReason, null);
  assert.equal(route.executionOwner, "Patch Master");
  assert.equal(route.ownershipTransferredToExecution, true);
  assert.equal(route.observedExecutionPhasePure, false);
  assert.equal(route.integrationClassTaskObserved, true);
  assert.equal(route.foundationReadinessAssessed, false);
  assert.equal(route.foundationReadinessUnknown, true);
});

test("summarizeRouteObservations flags General Purpose followed by Patch Master as post-execution ownership leak", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Repo Scout", "Patch Master", "General Purpose Agent", "Patch Master"],
    observedSubagentCounts: { "Repo Scout": 1, "Patch Master": 2, "General Purpose Agent": 1 },
    stdout: "Foundation readiness: assessed\nownership leak allowed reason: named blocker returned to integration owner"
  });

  assert.equal(route.patchMasterInvocationCount, 2);
  assert.equal(route.builtInGenericAgentInvocationCount, 1);
  assert.deepEqual(route.postExecutionGenericAgents, ["General Purpose Agent"]);
  assert.equal(route.postExecutionOwnershipLeakObserved, true);
  assert.equal(route.ownershipLeakAllowedReason, "named blocker returned to integration owner");
  assert.equal(route.foundationReadinessAssessed, true);
  assert.equal(route.foundationReadinessUnknown, false);
});

test("summarizeRouteObservations flags unresolved background Patch Master execution", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: "Agent started in background with agent_id: asterion-integration-merge. Track progress with /tasks"
  });

  assert.equal(route.executionOwner, "Patch Master");
  assert.equal(route.ownershipTransferredToExecution, true);
  assert.equal(route.backgroundExecutionAgentObserved, true);
  assert.equal(route.backgroundExecutionAgentUnresolved, true);
  assert.deepEqual(route.backgroundExecutionAgentIds, ["asterion-integration-merge"]);
  assert.equal(route.patchMasterHandoffWithoutCompletionObserved, true);
  assert.equal(route.executionHandoffWithoutObservedRepoDiff, true);
});

test("summarizeRouteObservations classifies malformed JSON task payload symptoms", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: "Expected ',' or '}' after property value in JSON at position 128"
  });

  assert.equal(route.malformedTaskPayloadObserved, true);
  assert.ok(route.foundationFailureClasses.includes("task-payload"));
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations treats explicit Execution status as background closure", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "Agent started in background with agent_id: asterion-integration-merge.",
      "Execution status: ready_for_return"
    ].join("\n")
  });

  assert.equal(route.backgroundExecutionAgentObserved, true);
  assert.equal(route.backgroundExecutionAgentUnresolved, false);
  assert.equal(route.executionOwnerResultRead, false);
  assert.equal(route.executionOwnerBlockedObserved, false);
  assert.equal(route.postExecutionCompletionGapObserved, false);
  assert.equal(route.patchMasterHandoffWithoutCompletionObserved, false);
});

test("summarizeRouteObservations treats visible Patch Master completion as resolved without read_agent", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "Agent started in background with agent_id: patch-master-build.",
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T06:02:00.000Z",
        data: { text: "Execution status: ready_for_return" }
      }),
      "<system_notification>agent patch-master-build completed successfully</system_notification>",
      "Patch Master visible result was not read because read_agent is unavailable in this runtime."
    ].join("\n")
  });

  assert.equal(route.backgroundExecutionAgentObserved, true);
  assert.equal(route.backgroundExecutionAgentUnresolved, false);
  assert.deepEqual(route.backgroundExecutionAgentIds, ["patch-master-build"]);
  assert.deepEqual(route.backgroundAgentsStarted, ["patch-master-build"]);
  assert.deepEqual(route.backgroundAgentsCompleted, ["patch-master-build"]);
  assert.deepEqual(route.backgroundAgentsRead, []);
  assert.equal(route.executionOwnerAgentId, "patch-master-build");
  assert.equal(route.executionOwnerResultRead, false);
  assert.equal(route.executionOwnerBlockedObserved, false);
  assert.equal(route.finalizedBeforeExecutionOwnerRead, false);
  assert.equal(route.postExecutionCompletionGapObserved, false);
  assert.deepEqual(route.blockingBackgroundAgentsUnresolved, []);
});

test("summarizeRouteObservations ignores prompt-only blocked status examples", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "Agent started in background with agent_id: patch-master-build.",
      "- At the end, report `Execution status: ready_for_return` OR `Execution status: blocked`.",
      "Validation plan: if blocked by schema, report the exact blocker.",
      "<system_notification>Background agent `patch-master-build` completed. Use `read_agent(\"patch-master-build\")` to retrieve results.</system_notification>"
    ].join("\n")
  });

  assert.equal(route.executionOwnerBlockedObserved, false);
  assert.equal(route.finalizedBeforeExecutionOwnerRead, true);
  assert.equal(route.postExecutionCompletionGapObserved, true);
});

test("summarizeRouteObservations flags completed background execution owner when result was not read", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "Agent started in background with agent_id: patch-signalcraft-main.",
      "<system_notification>Background agent `patch-signalcraft-main` completed. Use `read_agent(\"patch-signalcraft-main\")` to retrieve results.</system_notification>",
      "Patch Master is still executing; I will summarize what is available."
    ].join("\n")
  });

  assert.equal(route.backgroundExecutionAgentObserved, true);
  assert.deepEqual(route.backgroundAgentsStarted, ["patch-signalcraft-main"]);
  assert.deepEqual(route.backgroundAgentsCompleted, ["patch-signalcraft-main"]);
  assert.deepEqual(route.backgroundAgentsRead, []);
  assert.equal(route.executionOwnerAgentId, "patch-signalcraft-main");
  assert.equal(route.executionOwnerResultRead, false);
  assert.equal(route.finalizedBeforeExecutionOwnerRead, true);
  assert.equal(route.postExecutionCompletionGapObserved, true);
  assert.deepEqual(route.blockingBackgroundAgentsUnresolved, ["patch-signalcraft-main"]);
  assert.equal(route.backgroundExecutionAgentUnresolved, true);
});

test("summarizeRouteObservations treats read_agent retrieval as background execution closure", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-14T06:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "Agent started in background with agent_id: patch-signalcraft-main.",
      "Background agent patch-signalcraft-main has completed. Use read_agent with agent_id \"patch-signalcraft-main\" to retrieve the full results.",
      "read_agent(\"patch-signalcraft-main\")",
      "Execution status: ready_for_return"
    ].join("\n")
  });

  assert.deepEqual(route.backgroundAgentsRead, ["patch-signalcraft-main"]);
  assert.equal(route.executionOwnerResultRead, true);
  assert.equal(route.postExecutionCompletionGapObserved, false);
  assert.equal(route.backgroundExecutionAgentUnresolved, false);
});

test("summarizeRouteObservations reports interactive command and missing built-in agent runtime issues", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: [
      "view /tmp/copilot-tool-output-1776146053604-6kqk30.txt 2>/dev/null || cat",
      "<exited with error: posix_spawn failed: No such file or directory>",
      'Error: Failed to load built-in agent "task": Failed to read file',
      "/Users/example/definitions/task.agent.yaml: Error"
    ].join("\n")
  });

  assert.equal(route.interactiveCommandHangObserved, true);
  assert.ok(route.interactiveCommandHangCommands.some((command) => command.includes("view /tmp/copilot-tool-output")));
  assert.ok(route.interactiveCommandHangCommands.some((command) => command.includes("posix_spawn failed")));
  assert.equal(route.missingBuiltInAgentObserved, true);
  assert.deepEqual(route.missingBuiltInAgentNames, ["task"]);
  assert.ok(route.foundationFailureClasses.includes("runtime-tool-execution"));
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations ignores planning prose that mentions commands and acceptance risks", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Milestone", "Repo Scout", "Triage"],
    observedSubagentCounts: { "Repo Master": 1, Milestone: 1, "Repo Scout": 1, Triage: 1 },
    stdout: [
      "7. **Many-to-many relations**: review /tmp notes in the schema plan before Patch Master starts.",
      "**Acceptance:** Seed completes without error. 4 Users, 3 Orgs, 6 Projects, 30 Activities all queryable via `npx prisma studio` or inline query. ✅",
      "Next steps: npm install, npx prisma generate, npx prisma db push --force-reset, seed command, npm test, npm run build, npx playwright test.",
      "Risk: if the dev server did not become ready, record a blocker instead of retrying forever.",
      "Plan: malformed JSON payload examples should be documented, not treated as a live task payload failure.",
      "npm info next-auth versions --json 2>/dev/null | node -e \"const v=JSON.parse(process.argv[1]); console.log(v.length)\"",
      "const id = params.id  // runtime warning / type error in Next.js 15"
    ].join("\n")
  });

  assert.equal(route.interactiveCommandHangObserved, false);
  assert.deepEqual(route.interactiveCommandHangCommands, []);
  assert.equal(route.malformedTaskPayloadObserved, false);
  assert.deepEqual(route.foundationFailureClasses, []);
  assert.equal(route.foundationRiskRaised, false);
  assert.equal(route.validationServerReadinessFailureObserved, false);
});

test("summarizeRouteObservations treats shutdown code changes as Patch Master handoff completion evidence", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Repo Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:00:00.000Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-11T20:01:00.000Z") }
    ],
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: JSON.stringify({
      type: "session.shutdown",
      data: {
        codeChanges: {
          filesModified: ["src/app.ts"]
        }
      }
    })
  });

  assert.equal(route.patchMasterHandoffWithoutCompletionObserved, false);
  assert.equal(route.executionHandoffWithoutObservedRepoDiff, false);
});

test("summarizeRouteObservations surfaces repeated foundation failures and recovery posture", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Milestone", "Patch Master"],
    observedSubagentCounts: { Milestone: 1, "Patch Master": 1 },
    stdout: [
      "integration-class task: fresh product foundation",
      "npx prisma db push failed with schema error",
      "retrying prisma db push after config change",
      "npx prisma db push failed with schema error again",
      "npm run build failed with Type error"
    ].join("\n")
  });

  assert.equal(route.integrationClassTaskObserved, true);
  assert.equal(route.repeatedFoundationFailureObserved, true);
  assert.equal(route.foundationRecoverySuggested, true);
  assert.deepEqual(route.foundationFailureClasses, ["build-typecheck", "schema-db"]);
  assert.match(route.foundationRecoveryReason ?? "", /schema-db/);
  assert.equal(route.foundationReadinessUnknown, true);
  assert.equal(route.foundationRiskRaised, true);
});

test("summarizeRouteObservations separates stale hook bootstrap failures from app foundation failures", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      "Error: Cannot find module '/Users/example/project/scripts/pre-tool-use.mjs'",
      "orchestra-dual-runtime legacy hook plugin still enabled",
      "npm test passed"
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, ["bootstrap-hook-path", "legacy-plugin-conflict"]);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.legacyHookPluginConflictObserved, true);
  assert.equal(route.hookExecutionFailureObserved, true);
  assert.equal(route.runtimeConfigMismatchObserved, false);
  assert.equal(route.toolingMaterializationFailureObserved, false);
  assert.equal(route.appFoundationFailureObserved, false);
  assert.equal(route.validationServerReadinessFailureObserved, false);
});

test("summarizeRouteObservations separates raw workspace-relative .sh hook failures from app foundation failures", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      "bash: ./scripts/hooks/session-start.sh: No such file or directory",
      "bash: ./scripts/pre-tool-use.sh: No such file or directory",
      "zsh: ./scripts/hooks/agent-stop.sh: No such file or directory",
      "sh: ./scripts/hooks/error-occurred.sh: No such file or directory",
      "npm test passed"
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, ["bootstrap-hook-path"]);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.legacyHookPluginConflictObserved, false);
  assert.equal(route.hookExecutionFailureObserved, true);
  assert.equal(route.runtimeConfigMismatchObserved, false);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations classifies tooling materialization failures distinctly", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      "profile materialization failed: copy hooks failed",
      "install plugin failed while refreshing the global XGC profile",
      "npm test passed"
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, ["tooling-materialization"]);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.toolingMaterializationFailureObserved, true);
  assert.equal(route.hookExecutionFailureObserved, false);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations classifies Copilot auth and model-list preflight blockers", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      "✗ Unable to load available models list",
      "✗ Authorization error, you may need to run /login (Request ID: CC3E)"
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, ["copilot-auth", "copilot-model-list"]);
  assert.equal(route.copilotAuthFailureObserved, true);
  assert.equal(route.copilotModelListFailureObserved, true);
  assert.equal(route.preflightBlockerObserved, true);
  assert.equal(route.preflightBlockerKind, "auth-and-model");
  assert.match(route.preflightBlockerReason ?? "", /Authorization error|Unable to load available models list/);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.appFoundationFailureObserved, false);
  assert.equal(route.foundationReadinessUnknown, true);
  assert.equal(route.foundationRiskRaised, true);
});

test("summarizeRouteObservations does not treat app HTTP 401 code as Copilot auth failure", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      'return NextResponse.json({ message: "Unauthorized" }, { status: 401 });',
      "Playwright asserted the login route and then continued validation."
    ].join("\n")
  });

  assert.equal(route.copilotAuthFailureObserved, false);
  assert.equal(route.preflightBlockerObserved, false);
  assert.ok(!route.foundationFailureClasses.includes("copilot-auth"));
});

test("summarizeRouteObservations classifies Copilot policy and plan entitlement blockers", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: [
      'Error: Access denied by policy settings (Request ID: CD17)',
      "Your Copilot CLI policy setting may be preventing access.",
      "Copilot Pro trials have been temporarily paused. Please upgrade your account or revert to Copilot Free."
    ].join("\n")
  });

  assert.deepEqual(route.foundationFailureClasses, ["copilot-policy"]);
  assert.equal(route.copilotAuthFailureObserved, false);
  assert.equal(route.copilotModelListFailureObserved, false);
  assert.equal(route.copilotPolicyFailureObserved, true);
  assert.equal(route.preflightBlockerObserved, true);
  assert.equal(route.preflightBlockerKind, "policy");
  assert.match(route.preflightBlockerReason ?? "", /Access denied by policy settings/);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations treats write EPIPE as runtime transport noise, not app foundation failure", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout: "Error: write EPIPE"
  });

  assert.deepEqual(route.foundationFailureClasses, ["runtime-transport"]);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.hookExecutionFailureObserved, false);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations classifies runtime config mismatch without generic error wording", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: [],
    observedSubagentCounts: {},
    stdout: "runtime config mismatch: hooks/hooks.json differs from the materialized profile"
  });

  assert.deepEqual(route.foundationFailureClasses, ["runtime-config-mismatch"]);
  assert.equal(route.runtimeConfigMismatchObserved, true);
  assert.equal(route.bootstrapFailureObserved, true);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("summarizeRouteObservations distinguishes port-conflict startability recovery", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Repo Master", "Milestone", "Patch Master"],
    observedSubagentCounts: { Milestone: 1, "Patch Master": 1 },
    stdout: [
      "integration-class task: browser validation",
      "npm run build passed",
      "Error: listen EADDRINUSE: address already in use :::3000",
      "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000"
    ].join("\n")
  });

  assert.equal(route.validationPortConflictObserved, true);
  assert.equal(route.validationServerReadinessFailureObserved, true);
  assert.equal(route.foundationRecoverySuggested, true);
  assert.deepEqual(route.foundationFailureClasses, ["startability-port-conflict"]);
  assert.match(route.foundationRecoveryReason ?? "", /port was already in use/);
  assert.equal(route.foundationReadinessUnknown, true);
  assert.equal(route.foundationRiskRaised, true);
});

test("summarizeRouteObservations flags duplicate Triage after a Triage-informed Milestone handoff", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagentEvents: [
      { agentName: "Milestone", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T04:48:48.087Z") },
      { agentName: "Triage", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T04:51:42.023Z") },
      { agentName: "Triage", kind: "completed", source: "stdout", timestampMs: Date.parse("2026-04-10T04:54:22.341Z") },
      { agentName: "Milestone", kind: "completed", source: "stdout", timestampMs: Date.parse("2026-04-10T04:57:52.093Z") },
      { agentName: "Triage", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T04:58:05.729Z") },
      { agentName: "Triage", kind: "completed", source: "stdout", timestampMs: Date.parse("2026-04-10T05:01:09.957Z") },
      { agentName: "Patch Master", kind: "started", source: "stdout", timestampMs: Date.parse("2026-04-10T05:03:05.233Z") }
    ],
    observedSubagents: ["Milestone", "Triage", "Milestone", "Triage", "Patch Master"],
    observedSubagentCounts: { Milestone: 1, Triage: 2, "Patch Master": 1 },
    stdout: ""
  });

  assert.deepEqual(route.observedPlanningChain, ["Milestone", "Triage", "Triage", "Patch Master"]);
  assert.equal(route.routeSummarySource, "started_with_fallbacks");
  assert.equal(route.triageInvocationCount, 2);
  assert.equal(route.triageDuplicateObserved, true);
  assert.equal(route.executionReadyHandoffSeenBeforeSecondTriage, true);
  assert.equal(route.triageDuplicateAllowedReason, null);
  assert.equal(route.patchMasterInvocationCount, 1);
});

test("summarizeRouteObservations does not allow duplicate Triage from name-list fallback alone", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    observedSubagents: ["Milestone", "Triage", "Milestone", "Triage", "Patch Master"],
    observedSubagentCounts: { Milestone: 2, Triage: 2, "Patch Master": 1 },
    stdout: ""
  });

  assert.equal(route.triageInvocationCount, 2);
  assert.equal(route.triageDuplicateObserved, true);
  assert.equal(route.executionReadyHandoffSeenBeforeSecondTriage, false);
  assert.equal(route.triageDuplicateAllowedReason, "no_post_triage_milestone_completion_observed_before_second_triage");
});

test("summarizeRouteObservations flags root patching after Patch Master completes", () => {
  const stdout = [
    JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T18:19:01.650Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-09T18:24:29.280Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({
      type: "tool.execution_start",
      timestamp: "2026-04-09T18:26:18.932Z",
      data: { toolName: "apply_patch" }
    })
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "deep-implementation",
    observedSubagents: ["Repo Master", "Milestone", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout
  });

  assert.equal(route.postExecutionRootWriteObserved, true);
  assert.equal(route.postExecutionRootPatchObserved, true);
  assert.equal(route.postExecutionRootWriteCount, 1);
});

test("summarizeRouteObservations flags root writes while Patch Master is active", () => {
  const stdout = [
    JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T18:19:01.650Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({
      type: "tool.execution_start",
      timestamp: "2026-04-09T18:20:18.932Z",
      data: { toolName: "apply_patch" }
    }),
    JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-09T18:24:29.280Z", data: { agentDisplayName: "Patch Master" } })
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "active-owner-write",
    observedSubagents: ["Repo Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 1 },
    stdout
  });

  assert.equal(route.executionOwnerActiveRootWriteObserved, true);
  assert.equal(route.executionOwnerActiveRootPatchObserved, true);
  assert.equal(route.executionOwnerActiveRootWriteCount, 1);
  assert.equal(route.postExecutionRootWriteObserved, false);
  assert.equal(route.postExecutionOwnershipLeakObserved, true);
});

test("summarizeRouteObservations keeps restarted Patch Master root writes in the active-owner bucket", () => {
  const stdout = [
    JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T18:19:01.650Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-09T18:24:29.280Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T18:25:01.000Z", data: { agentDisplayName: "Patch Master" } }),
    JSON.stringify({
      type: "tool.execution_start",
      timestamp: "2026-04-09T18:26:18.932Z",
      data: { toolName: "apply_patch" }
    }),
    JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-09T18:27:29.280Z", data: { agentDisplayName: "Patch Master" } })
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "active-owner-write-multipass",
    observedSubagents: ["Repo Master", "Patch Master", "Patch Master"],
    observedSubagentCounts: { "Patch Master": 2 },
    stdout
  });

  assert.equal(route.executionOwnerActiveRootWriteObserved, true);
  assert.equal(route.executionOwnerActiveRootPatchObserved, true);
  assert.equal(route.executionOwnerActiveRootWriteCount, 1);
  assert.equal(route.postExecutionRootWriteObserved, false);
  assert.equal(route.postExecutionRootWriteCount, 0);
});

test("containsOrderedSubsequence detects ordered planning chains", () => {
  assert.equal(
    containsOrderedSubsequence(
      ["Repo Master", "Milestone", "Repo Scout", "Repo Scout", "Triage", "Patch Master"],
      ["Milestone", "Repo Scout", "Triage"]
    ),
    true
  );
  assert.equal(
    containsOrderedSubsequence(["Repo Master", "Patch Master", "Triage"], ["Milestone", "Repo Scout", "Triage"]),
    false
  );
});

test("local-context lanes skip GitHub context by policy", () => {
  const policy = resolveGitHubProbePolicy({
    agentId: "repo-scout",
    caseId: "scout-discovery",
    sessionCache: emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" })
  });

  assert.equal(policy.disableBuiltinMcps, true);
  assert.deepEqual(policy.disableSpecificMcpServers, ["github-mcp-server"]);
  assert.equal(policy.disableExperimentalFeatures, true);
  assert.equal(policy.githubMemoryEnabledProbe, "skipped_for_route");
  assert.equal(policy.githubMemoryPromptProbe, "skipped_for_route");
  assert.equal(policy.prLookup, "skipped_for_route");
  assert.match(policy.notes.join("\n"), /session-1::example-org\/example-app/);
});

test("GitHub probe 404s are cached for later route reporting and can suppress later review lanes", () => {
  const cache = observeGitHubProbeFailures(
    [
      "GET /internal/memory/example-org/example-app/enabled 404",
      "GET /internal/memory/example-org/example-app/prompt 404",
      "GET /repos/example-org/example-app/pulls?head=main 404"
    ].join("\n"),
    emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" })
  );

  assert.equal(cache.memoryEnabledUnavailable, true);
  assert.equal(cache.memoryPromptUnavailable, true);
  assert.equal(cache.prUnavailable, true);
  assert.equal(cache.scopeKey, "session-1::example-org/example-app");

  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: cache
  });

  assert.equal(policy.disableBuiltinMcps, true);
  assert.deepEqual(policy.disableSpecificMcpServers, ["github-mcp-server"]);
  assert.equal(policy.disableExperimentalFeatures, true);
  assert.equal(policy.githubMemoryEnabledProbe, "disabled_after_404");
  assert.equal(policy.githubMemoryPromptProbe, "disabled_after_404");
  assert.equal(policy.prLookup, "disabled_after_404");
  assert.match(policy.notes.join("\n"), /cached GitHub probe failures are suppressing GitHub context earlier/i);
});

test("successful GitHub capability checks are cached within the same repo and session", () => {
  const initial = emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" });
  const observed = observeGitHubProbeResults(
    [
      "2026-04-09T15:17:15.411Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix&state=open&per_page=1 - 200 with id abc in 378ms",
      "2026-04-09T15:17:17.425Z [INFO] Memory enablement check: enabled"
    ].join("\n"),
    initial
  );

  assert.equal(observed.memoryEnabledAvailable, true);
  assert.equal(observed.prAvailable, true);
  assert.equal(observed.memoryEnabledSuccessCount, 1);
  assert.equal(observed.prSuccessCount, 1);
  assert.equal(observed.scopeKey, "session-1::example-org/example-app");

  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: observed
  });

  assert.equal(policy.disableBuiltinMcps, false);
  assert.deepEqual(policy.disableSpecificMcpServers, []);
  assert.equal(policy.disableExperimentalFeatures, true);
  assert.match(policy.notes.join("\n"), /cached GitHub memory enablement is being reused/i);

  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    githubProbeCacheBefore: observed,
    githubProbeCacheAfter: observed
  });

  assert.equal(route.githubMemoryEnabledCheck, "reused_from_cache");
  assert.equal(route.githubMemoryEnabledCheckCached, true);
  assert.equal(route.githubMemoryEnabledCheckCount, 0);
  assert.equal(route.githubMemoryEnabledCheckSource, "session_cache");
  assert.equal(route.githubMemoryEnabledFreshAfterCacheObserved, false);
  assert.equal(route.prContextCheck, "reused_from_cache");
  assert.equal(route.prContextCheckCached, true);
  assert.equal(route.prContextCheckCount, 0);
  assert.equal(route.prContextCheckSource, "session_cache");
  assert.equal(route.prContextFreshAfterCacheObserved, false);
  assert.equal(route.prLookupCheck, "reused_from_cache");
  assert.equal(route.prLookupCheckCached, true);
  assert.equal(route.prLookupCheckSource, "session_cache");
  assert.equal(route.githubCapabilityCacheHits, 2);
  assert.equal(route.githubCapabilityCacheMisses, 0);
});

test("resolveGitHubProbeRepoIdentity hashes local paths when no GitHub remote is available", () => {
  const repoPath = "/Users/example/Documents/GitHub/local-fixture";
  const identity = resolveGitHubProbeRepoIdentity({ repoPath });

  assert.match(identity, /^local-repo-[0-9a-f]{12}$/);
  assert.doesNotMatch(identity, /Users|localuser|local-fixture/);
  assert.equal(identity, resolveGitHubProbeRepoIdentity({ repoPath }));
});

test("resolveGitHubProbeRepoIdentity accepts common GitHub remote URL forms", () => {
  assert.equal(
    resolveGitHubProbeRepoIdentity({ remoteUrl: "git@github.com:example-org/test-repo.git" }),
    "example-org/test-repo"
  );
  assert.equal(
    resolveGitHubProbeRepoIdentity({ remoteUrl: "https://github.com/example-org/test-repo.git" }),
    "example-org/test-repo"
  );
  assert.equal(
    resolveGitHubProbeRepoIdentity({ remoteUrl: "ssh://git@github.com/example-org/test-repo.git" }),
    "example-org/test-repo"
  );
  assert.equal(
    resolveGitHubProbeRepoIdentity({ remoteUrl: "git+ssh://git@github.com/example-org/test-repo.git" }),
    "example-org/test-repo"
  );
});

test("review lanes skip GitHub probes when only a local repo identity exists", () => {
  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: emptyGitHubProbeCache({ repoIdentity: "local-repo-abcdef123456", sessionIdentity: "session-local" })
  });

  assert.equal(policy.disableBuiltinMcps, true);
  assert.deepEqual(policy.disableSpecificMcpServers, ["github-mcp-server"]);
  assert.equal(policy.disableExperimentalFeatures, true);
  assert.equal(policy.githubMemoryEnabledProbe, "skipped_for_route");
  assert.equal(policy.githubMemoryPromptProbe, "skipped_for_route");
  assert.equal(policy.prLookup, "skipped_for_route");
  assert.match(policy.notes.join("\n"), /no live GitHub repository identity/i);

  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog: "Failed to load memories for prompt: Error: GitHub repository name is required",
    githubProbeCacheBefore: emptyGitHubProbeCache({ repoIdentity: "local-repo-abcdef123456", sessionIdentity: "session-local" }),
    githubProbeCacheAfter: emptyGitHubProbeCache({ repoIdentity: "local-repo-abcdef123456", sessionIdentity: "session-local" })
  });

  assert.equal(route.githubRepoIdentityMissingObserved, true);
  assert.equal(route.githubRepoIdentitySource, "process_log");
  assert.equal(route.githubMemorySuppressedForMissingRepoIdentity, true);
  assert.equal(route.appFoundationFailureObserved, false);
});

test("valid GitHub repo identity is not suppressed by quoted repo-name-missing prompt text", () => {
  const route = summarizeRouteObservations({
    agentId: "repo-master",
    agentLane: "front-door",
    caseId: "quoted-repo-identity-error",
    promptText: 'Document this message: "GitHub repository name is required".',
    observedSubagents: ["Repo Master"],
    observedSubagentCounts: {},
    stdout: "",
    processLog: "",
    githubProbeCacheBefore: emptyGitHubProbeCache({ repoIdentity: "octocat/hello-world", sessionIdentity: "session-gh" }),
    githubProbeCacheAfter: emptyGitHubProbeCache({ repoIdentity: "octocat/hello-world", sessionIdentity: "session-gh" })
  });

  assert.equal(route.githubRepoIdentityMissingObserved, false);
  assert.equal(route.githubRepoIdentitySource, "not-observed");
  assert.equal(route.githubMemorySuppressedForMissingRepoIdentity, false);
});

test("fresh probe evidence wins over policy skip in route reporting", () => {
  const processLog = [
    "2026-04-13T08:00:00.000Z [WARN] GET /internal/memory/v0/local-repo-abcdef123456/enabled 404",
    "2026-04-13T08:00:01.000Z [WARN] GET /repos/local-repo-abcdef123456/pulls?head=main 404"
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog,
    githubProbeCacheBefore: emptyGitHubProbeCache({ repoIdentity: "local-repo-abcdef123456", sessionIdentity: "session-local" }),
    githubProbeCacheAfter: observeGitHubProbeFailures(
      processLog,
      emptyGitHubProbeCache({ repoIdentity: "local-repo-abcdef123456", sessionIdentity: "session-local" })
    ),
    githubProbeLogText: processLog
  });

  assert.equal(route.githubMemoryEnabledProbe, "disabled_after_404");
  assert.equal(route.prLookup, "disabled_after_404");
  assert.equal(route.githubMemoryEnabledCheck, "checked_fresh");
  assert.equal(route.githubMemoryEnabledCheckSource, "process_log");
  assert.equal(route.prContextCheck, "checked_fresh");
  assert.equal(route.prLookupCheck, "checked_fresh");
  assert.equal(route.githubCapabilityCacheMisses, 2);
  assert.equal(route.githubRepoIdentityMissingObserved, true);
  assert.equal(route.githubMemorySuppressedForMissingRepoIdentity, false);
  assert.equal(route.observedMemoryProbeSuppressed, false);
  assert.equal(route.observedPrProbeSuppressed, false);
});

test("GitHub capability success cache does not leak across repo or session scope", () => {
  const initial = emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" });
  const observed = observeGitHubProbeResults(
    [
      "2026-04-09T15:17:15.411Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix&state=open&per_page=1 - 200 with id abc in 378ms",
      "2026-04-09T15:17:17.425Z [INFO] Memory enablement check: enabled"
    ].join("\n"),
    initial
  );
  const differentScope = observeGitHubProbeResults("", observed, {
    repoIdentity: "example-org/example-ios-app",
    sessionIdentity: "session-2"
  });

  assert.equal(differentScope.scopeKey, "session-2::example-org/example-ios-app");
  assert.equal(differentScope.memoryEnabledAvailable, false);
  assert.equal(differentScope.prAvailable, false);
  assert.equal(differentScope.memoryEnabledSuccessCount, 0);
  assert.equal(differentScope.prSuccessCount, 0);

  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: differentScope
  });

  assert.equal(policy.disableExperimentalFeatures, false);
  assert.equal(policy.disableBuiltinMcps, false);
});

test("summarizeRouteObservations distinguishes fresh GitHub checks from cached reuse", () => {
  const cacheBefore = emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" });
  const processLog = [
    "2026-04-09T15:17:15.411Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix&state=open&per_page=1 - 200 with id abc in 378ms",
    "2026-04-09T15:17:17.425Z [INFO] Memory enablement check: enabled"
  ].join("\n");
  const cacheAfter = observeGitHubProbeResults(processLog, cacheBefore);
  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog,
    githubProbeCacheBefore: cacheBefore,
    githubProbeCacheAfter: cacheAfter,
    githubProbeLogText: processLog
  });

  assert.equal(route.githubMemoryEnabledProbe, "allowed_for_review_context");
  assert.equal(route.githubMemoryEnabledCheck, "checked_fresh");
  assert.equal(route.githubMemoryEnabledCheckCached, false);
  assert.equal(route.githubMemoryEnabledCheckCount, 1);
  assert.equal(route.githubMemoryEnabledCheckSource, "process_log");
  assert.equal(route.githubMemoryEnabledFreshAfterCacheObserved, false);
  assert.equal(route.prContextCheck, "checked_fresh");
  assert.equal(route.prContextCheckCached, false);
  assert.equal(route.prContextCheckCount, 1);
  assert.equal(route.prContextCheckSource, "process_log");
  assert.equal(route.prContextFreshAfterCacheObserved, false);
  assert.equal(route.prLookupCheck, "checked_fresh");
  assert.equal(route.prLookupCheckCached, false);
  assert.equal(route.prLookupCheckSource, "process_log");
  assert.equal(route.githubCapabilityCacheHits, 0);
  assert.equal(route.githubCapabilityCacheMisses, 2);
});

test("summarizeRouteObservations keeps fresh review-lane probe failures distinct from pre-run suppression", () => {
  const cacheBefore = emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" });
  const processLog = [
    "2026-04-09T15:17:15.411Z [WARN] GET /internal/memory/example-org/example-app/enabled 404",
    "2026-04-09T15:17:16.411Z [WARN] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix 404"
  ].join("\n");
  const cacheAfter = observeGitHubProbeFailures(processLog, cacheBefore);
  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog,
    githubProbeCacheBefore: cacheBefore,
    githubProbeCacheAfter: cacheAfter,
    githubProbeLogText: processLog
  });

  assert.equal(route.githubMemoryEnabledCheck, "checked_fresh");
  assert.equal(route.githubMemoryEnabledCheckCount, 1);
  assert.equal(route.prContextCheck, "checked_fresh");
  assert.equal(route.prContextCheckCount, 1);
  assert.equal(route.prLookupCheck, "checked_fresh");
  assert.equal(route.observedMemoryProbeSuppressed, false);
  assert.equal(route.observedPrProbeSuppressed, false);
});

test("GitHub capability counts collapse adjacent repeated success lines into one effective check episode", () => {
  const processLog = [
    "2026-04-10T04:48:00.445Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:48:00.456Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:48:00.815Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:48:01.000Z [INFO] --- Start of group: configured settings: ---",
    "2026-04-10T04:48:02.929Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:48:03.000Z [INFO] --- End of group ---",
    "2026-04-10T04:49:58.224Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:49:58.263Z [INFO] Memory enablement check: enabled",
    "2026-04-10T04:47:58.225Z [INFO] [Octokit] GET /repos/example-org/example-ios-app/pulls?head=example-org%3Amain&state=open&per_page=1 - 200 with id abc in 346ms",
    "2026-04-10T04:47:58.226Z [INFO] [Octokit] GET /repos/example-org/example-ios-app/pulls?head=example-org%3Amain&state=open&per_page=1 - 200 with id abc in 347ms"
  ].join("\n");

  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog,
    githubProbeCacheBefore: emptyGitHubProbeCache({ repoIdentity: "example-org/example-ios-app", sessionIdentity: "session-1" }),
    githubProbeCacheAfter: observeGitHubProbeResults(
      processLog,
      emptyGitHubProbeCache({ repoIdentity: "example-org/example-ios-app", sessionIdentity: "session-1" })
    ),
    githubProbeLogText: processLog
  });

  assert.equal(route.githubMemoryEnabledCheckCount, 3);
  assert.equal(route.prContextCheckCount, 1);
});

test("summarizeRouteObservations flags fresh GitHub success after same-session cache reuse", () => {
  const cacheBefore = observeGitHubProbeResults(
    [
      "2026-04-09T15:17:15.411Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix&state=open&per_page=1 - 200 with id abc in 378ms",
      "2026-04-09T15:17:17.425Z [INFO] Memory enablement check: enabled"
    ].join("\n"),
    emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" })
  );
  const processLog = [
    "2026-04-09T15:18:15.411Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Ftheme-fix&state=open&per_page=1 - 200 with id def in 278ms",
    "2026-04-09T15:18:17.425Z [INFO] Memory enablement check: enabled"
  ].join("\n");
  const route = summarizeRouteObservations({
    agentId: "merge-gate",
    agentLane: "gate",
    caseId: "merge-review",
    observedSubagents: ["Merge Gate"],
    observedSubagentCounts: {},
    stdout: "",
    processLog,
    githubProbeCacheBefore: cacheBefore,
    githubProbeCacheAfter: observeGitHubProbeResults(processLog, cacheBefore),
    githubProbeLogText: processLog
  });

  assert.equal(route.githubMemoryEnabledFreshAfterCacheObserved, true);
  assert.equal(route.prContextFreshAfterCacheObserved, true);
});

test("review and PR lanes can still allow GitHub context when cache is clean", () => {
  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" })
  });

  assert.equal(policy.disableBuiltinMcps, false);
  assert.deepEqual(policy.disableSpecificMcpServers, []);
  assert.equal(policy.disableExperimentalFeatures, false);
  assert.equal(policy.githubMemoryEnabledProbe, "allowed_for_review_context");
  assert.equal(policy.githubMemoryPromptProbe, "allowed_for_review_context");
  assert.equal(policy.prLookup, "allowed_for_review_context");
});

test("memory-only cached failures keep review lanes local without fabricating PR 404 evidence", () => {
  const policy = resolveGitHubProbePolicy({
    agentId: "merge-gate",
    caseId: "merge-review",
    sessionCache: {
      ...emptyGitHubProbeCache({ repoIdentity: "example-org/example-app", sessionIdentity: "session-1" }),
      memoryEnabledUnavailable: true,
      memoryEnabled404Count: 2
    }
  });

  assert.equal(policy.disableBuiltinMcps, false);
  assert.deepEqual(policy.disableSpecificMcpServers, []);
  assert.equal(policy.disableExperimentalFeatures, true);
  assert.equal(policy.githubMemoryEnabledProbe, "disabled_after_404");
  assert.equal(policy.githubMemoryPromptProbe, "allowed_for_review_context");
  assert.equal(policy.prLookup, "allowed_for_review_context");
});

test("provider retry observability distinguishes recovered transport retry from silent planning stalls", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
      '  "status": 503,',
      '  "message": "503 {\\"error\\":{\\"message\\":\\"HTTP/2 GOAWAY connection terminated\\",\\"type\\":\\"connection_error\\"}}"',
      "2026-04-07T12:55:48.086Z [INFO] --- End of group ---",
      "2026-04-07T12:55:48.174Z [INFO] --- Start of group: Sending request to the AI model ---"
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryActive, false);
  assert.equal(retry.providerRetryState, "recovered-after-retry");
  assert.equal(retry.providerRetryRecovered, true);
  assert.equal(retry.providerRetryCount, 1);
  assert.equal(retry.providerRetryReason, "HTTP/2 GOAWAY / 503 connection_error");
  assert.equal(retry.activeAgentDuringRetry, "Patch Master");
  assert.equal(retry.providerRetryConfidence, "explicit");
});

test("provider retry observability reports terminal retry failures conservatively", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
      "2026-04-07T12:56:04.584Z [ERROR] Custom agent \"Patch Master\" error: Error: Failed to get response from the AI model; retried 5 times (total retry wait time: 6.1 seconds) Last error: CAPIError: Request was aborted."
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryActive, false);
  assert.equal(retry.providerRetryState, "terminal-failure-after-retry");
  assert.equal(retry.providerRetryRecovered, false);
  assert.equal(retry.providerRetryCount, 5);
  assert.match(retry.lastProviderTransportError ?? "", /retried 5 times/i);
  assert.equal(retry.lastProviderRetryAt, "2026-04-07T12:56:04.584Z");
});

test("provider retry observability captures model rate limits and 502 gateway failures without forcing terminal state", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-12T00:00:00.000Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      '2026-04-12T00:00:10.000Z [ERROR] {"code":"user_model_rate_limited","status":429,"message":"rate limited"}',
      '2026-04-12T00:00:11.000Z [ERROR] {"status":502,"message":"GitHub Unicorn Bad Gateway"}',
      "2026-04-12T00:00:12.000Z [INFO] --- End of group ---"
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryRecovered, true);
  assert.equal(retry.providerRetryState, "recovered-after-retry");
  assert.equal(retry.providerRetryCount, 2);
  assert.equal(retry.providerRetryReason, "model rate limit / 429");
  assert.equal(retry.modelRateLimitObserved, true);
  assert.equal(retry.modelRateLimitCount, 1);
  assert.equal(retry.provider502Observed, true);
  assert.equal(retry.provider502Count, 1);
  assert.equal(retry.activeAgentDuringRetry, "Patch Master");
});

test("validation log summary flags successful wrapper state with failed raw Playwright output", () => {
  const validation = summarizeValidationLog(
    [
      "validation_exit=0",
      "validation_state=done",
      "Running 1 test using 1 worker",
      "1 failed",
      "Error: strict mode violation: getByRole('link', { name: 'Incidents' }) resolved to 2 elements"
    ].join("\n")
  );

  assert.equal(validation.validationObserved, true);
  assert.equal(validation.validationStatus, "failed");
  assert.equal(validation.validationRawStatus, "failed");
  assert.equal(validation.validationOverclaimObserved, true);
  assert.equal(validation.validationCommandFailures.length, 2);
  assert.match(validation.validationCommandFailures.join("\n"), /strict mode violation/);
});

test("provider retry observability uses explicit retry attempt counters when present", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
      "2026-04-07T12:55:44.000Z [WARNING] provider retry attempt 3/5 after connection_error",
      "2026-04-07T12:55:48.086Z [INFO] --- End of group ---"
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryRecovered, true);
  assert.equal(retry.providerRetryCount, 3);
});

test("provider retry observability marks in-progress retry when recovery is not yet proven", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
      '  "status": 503,',
      '  "message": "503 {\\"error\\":{\\"message\\":\\"HTTP/2 GOAWAY connection terminated\\",\\"type\\":\\"connection_error\\"}}"'
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryActive, true);
  assert.equal(retry.providerRetryState, "retry-in-progress");
  assert.equal(retry.providerRetryRecovered, null);
});

test("provider retry observability keeps the latest retry evidence when newer terminal lines appear", () => {
  const retry = summarizeProviderRetries(
    [
      '2026-04-07T12:53:08.642Z [INFO] Custom agent "Patch Master" invoked with prompt: ...',
      "2026-04-07T12:55:42.474Z [WARNING] Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request.",
      '2026-04-07T12:55:43.100Z [ERROR] SocketError: HTTP/2: "GOAWAY"',
      "2026-04-07T12:56:04.584Z [ERROR] Custom agent \"Patch Master\" error: Error: Failed to get response from the AI model; retried 5 times (total retry wait time: 6.1 seconds) Last error: CAPIError: Request was aborted."
    ].join("\n")
  );

  assert.equal(retry.providerRetryObserved, true);
  assert.equal(retry.providerRetryCount, 5);
  assert.equal(retry.lastProviderRetryAt, "2026-04-07T12:56:04.584Z");
  assert.match(retry.lastProviderTransportError ?? "", /Request was aborted/i);
});
