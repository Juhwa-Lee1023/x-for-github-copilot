import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { repoRoot } from "./helpers.js";

function parseWorkspaceYaml(filePath: string) {
  const result: Record<string, unknown> = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith(" ") || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!key) continue;
    if (value === "true" || value === "false") {
      result[key] = value === "true";
    } else if (value === "null") {
      result[key] = null;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = Number.parseInt(value, 10);
    } else if (value.startsWith("[") || value.startsWith("{") || (value.startsWith('"') && value.endsWith('"'))) {
      result[key] = JSON.parse(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function assertNoDuplicateTopLevelYamlKeys(filePath: string) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith(" ") || !line.includes(":")) continue;
    const key = line.split(":", 1)[0];
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  assert.deepEqual([...duplicates], [], `workspace.yaml must not contain duplicate top-level keys: ${[...duplicates].join(", ")}`);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runSpecialistFanoutFinalizer(opts: {
  promptText: string;
  routeAgents: string[];
  sessionLabel: string;
}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `xgc-session-summary-${opts.sessionLabel}-`));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = `session-${opts.sessionLabel}`;
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: specialist fanout route",
      "created_at: 2026-04-13T09:00:00.000Z",
      ""
    ].join("\n")
  );
  const events = [
    JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:00:00.000Z" }),
    JSON.stringify({
      type: "user.message",
      timestamp: "2026-04-13T09:00:01.000Z",
      data: { content: opts.promptText }
    }),
    ...opts.routeAgents.map((agentDisplayName, index) =>
      JSON.stringify({
        type: "subagent.started",
        timestamp: `2026-04-13T09:00:${String(index + 2).padStart(2, "0")}.000Z`,
        data: { agentDisplayName }
      })
    ),
    JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:00:59.000Z" })
  ];
  fs.writeFileSync(transcriptPath, `${events.join("\n")}\n`);

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:01:00.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  return parseWorkspaceYaml(workspaceYaml);
}

test("hook common records session summary finalizer failures", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-finalizer-failure-"));
  const logRoot = path.join(tempRoot, "logs");
  const payload = JSON.stringify({
    sessionId: "session-finalizer-failure",
    timestamp: Date.parse("2026-04-11T09:00:00.000Z"),
    stopReason: "end_turn"
  });

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        `source ${shellQuote(path.join(repoRoot, "scripts/hooks/common.sh"))}`,
        `XGC_LOG_ROOT=${shellQuote(logRoot)} XGC_COPILOT_PROFILE_HOME=/dev/null xgc_hook_log_event agentStop ${shellQuote(payload)}`
      ].join("; ")
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const hookLog = fs.readFileSync(path.join(logRoot, "hooks.log"), "utf8");
  assert.match(hookLog, / agentStop /);
  assert.match(hookLog, / finalizeSessionSummary /);
  assert.match(hookLog, /"status":"failed"/);
  assert.match(hookLog, /"reason":"finalizer_error"/);

  const directMessage = "tab\tbackspace\bformfeed\fline\nquote\"slash\\";
  const directResult = spawnSync(
    "bash",
    [
      "-lc",
      [
        `source ${shellQuote(path.join(repoRoot, "scripts/hooks/common.sh"))}`,
        `xgc_hook_log_finalizer_status ${shellQuote(logRoot)} agentStop failed finalizer_error 9 ${shellQuote(directMessage)}`
      ].join("; ")
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(directResult.status, 0, directResult.stderr);
  const updatedHookLog = fs.readFileSync(path.join(logRoot, "hooks.log"), "utf8");
  const finalizerPayloads = [...updatedHookLog.matchAll(/ finalizeSessionSummary (\{.+\})/g)].map((match) =>
    JSON.parse(match[1]) as { message?: string; exitCode?: number }
  );
  assert.ok(finalizerPayloads.length >= 2);
  assert.equal(finalizerPayloads.at(-1)?.message, directMessage);
  assert.equal(finalizerPayloads.at(-1)?.exitCode, 9);
});

test("session summary finalizer ingests scoped hooks log finalizer failures", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-hooks-log-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-hooks-log-finalizer";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const hooksLog = path.join(workspaceRoot, ".xgc", "logs", "hooks.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(hooksLog), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: hooks log finalizer failure",
      "created_at: 2026-04-11T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "session.start", timestamp: "2026-04-11T09:00:00.000Z" })}\n`);
  fs.writeFileSync(
    hooksLog,
    `2026-04-11T09:00:01Z finalizeSessionSummary {"status":"failed","reason":"deferred_finalizer_error","sessionId":"${sessionId}"}\n`
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-11T09:00:02.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.foundation_failure_classes, ["hook-execution"]);
  assert.equal(summary.hook_execution_failure_observed, true);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer ignores hooks log entries from other sessions", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-hooks-log-stale-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-current-hooks-log";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const hooksLog = path.join(workspaceRoot, ".xgc", "logs", "hooks.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(hooksLog), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: clean current session",
      "created_at: 2026-04-11T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "session.start", timestamp: "2026-04-11T09:00:00.000Z" })}\n`);
  fs.writeFileSync(
    hooksLog,
    [
      '2026-04-11T08:00:01Z finalizeSessionSummary {"status":"failed","reason":"deferred_finalizer_error","sessionId":"session-old-hooks-log"}',
      '2026-04-11T09:00:01Z finalizeSessionSummary {"status":"skipped","reason":"non-terminal","sessionId":"session-current-hooks-log"}'
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-11T09:00:02.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.notDeepEqual(summary.foundation_failure_classes, ["hook-execution"]);
  assert.notEqual(summary.hook_execution_failure_observed, true);
  assert.notEqual(summary.bootstrap_failure_observed, true);
  assert.doesNotMatch((summary.summary_authority_reasons as string[]).join("\n"), /deferred_finalizer_error|session-old-hooks-log/);
});

test("session summary finalizer preserves terminal status without events", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-no-events-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-no-events";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-11T09:00:00.000Z",
      "updated_at: 2026-04-11T09:00:01.000Z",
      ""
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T09:01:00.000Z"),
    cwd: workspaceRoot
  });
  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "errorOccurred"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.final_status, "error");
  assert.equal(summary.summary_finalization_status, "error");
  assert.equal(summary.updated_at, "2026-04-11T09:01:00.000Z");
});

test("session summary finalizer reports Copilot auth/model preflight blockers before generation", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-preflight-blocker-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-preflight-blocker";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-14T08:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T08:00:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T08:00:02.000Z",
        data: {
          text: [
            "Unable to load available models list",
            "Authorization error, you may need to run /login"
          ].join("\n")
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T08:00:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.preflight_blocker_observed, true);
  assert.equal(summary.preflight_blocker_kind, "auth-and-model");
  assert.match(String(summary.preflight_blocker_reason), /Authorization error|Unable to load available models list/);
  assert.equal(summary.copilot_auth_failure_observed, true);
  assert.equal(summary.copilot_model_list_failure_observed, true);
  assert.deepEqual(summary.foundation_failure_classes, ["copilot-auth", "copilot-model-list"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.equal(summary.foundation_readiness_unknown, true);
  assert.equal(summary.foundation_risk_raised, true);
  assert.equal(summary.session_outcome, "blocked");
  assert.equal(summary.session_outcome_detail, "blocked_before_generation_auth-and-model");
  assert.equal(summary.repo_code_changed, false);
});

test("session summary finalizer does not treat app HTTP 401 code as Copilot auth preflight failure", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-app-401-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-app-401";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-14T08:05:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T08:05:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T08:05:02.000Z",
        data: {
          text: 'return NextResponse.json({ message: "Unauthorized" }, { status: 401 });'
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T08:05:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.copilot_auth_failure_observed, false);
  assert.equal(summary.preflight_blocker_observed, false);
  assert.ok(!(summary.foundation_failure_classes as string[]).includes("copilot-auth"));
});

test("session summary finalizer reports Copilot policy entitlement blockers before generation", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-policy-blocker-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-policy-blocker";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-14T08:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T08:10:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T08:10:02.000Z",
        data: {
          text: [
            "Error: Access denied by policy settings",
            "Your Copilot CLI policy setting may be preventing access.",
            "Copilot Pro trials have been temporarily paused. Please upgrade your account or revert to Copilot Free."
          ].join("\n")
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T08:10:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.preflight_blocker_observed, true);
  assert.equal(summary.preflight_blocker_kind, "policy");
  assert.equal(summary.copilot_policy_failure_observed, true);
  assert.equal(summary.copilot_auth_failure_observed, false);
  assert.equal(summary.copilot_model_list_failure_observed, false);
  assert.deepEqual(summary.foundation_failure_classes, ["copilot-policy"]);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.equal(summary.session_outcome, "blocked");
  assert.equal(summary.session_outcome_detail, "blocked_before_generation_policy");
});

test("session summary finalizer quotes colon-heavy YAML scalar values", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-yaml-safe-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-yaml-safe";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Existing summary",
      "summary_count: 0",
      "created_at: 2026-04-11T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T09:00:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-11T09:00:01.000Z",
        data: {
          text: "auth session failed: credentials missing"
        }
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-11T09:00:02.000Z",
        data: {
          text: "auth session failed: credentials missing again"
        }
      })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T09:00:03.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });
  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const rawWorkspaceYaml = fs.readFileSync(workspaceYaml, "utf8");
  assert.match(rawWorkspaceYaml, /^foundation_recovery_reason: "repeated foundation failure class\(es\): auth-session"$/m);

  const validationWorkspaceYaml = path.join(workspaceRoot, ".xgc", "validation", "workspace.yaml");
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.operator_truth_source, "session-state-workspace");
  assert.equal(summary.validation_workspace_yaml, validationWorkspaceYaml);
  assert.equal(summary.foundation_recovery_reason, "repeated foundation failure class(es): auth-session");
  assert.equal(summary.repeated_foundation_failure_observed, true);
  assertNoDuplicateTopLevelYamlKeys(workspaceYaml);

  assert.ok(fs.existsSync(validationWorkspaceYaml));
  const validationSummary = parseWorkspaceYaml(validationWorkspaceYaml);
  assert.equal(validationSummary.operator_truth_source, "repo-owned-validation-workspace");
  assert.equal(validationSummary.source_session_workspace_yaml, workspaceYaml);
  assert.equal(validationSummary.foundation_recovery_reason, "repeated foundation failure class(es): auth-session");
  assertNoDuplicateTopLevelYamlKeys(validationWorkspaceYaml);
});

test("session summary finalizer refreshes updated_at and separates repo/state/validation evidence", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-1";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const validationPath = path.join(workspaceRoot, ".xgc", "validation", "runtime-validation.md");
  const playwrightResultPath = path.join(workspaceRoot, "test-results", ".last-run.json");
  const playwrightReportPath = path.join(workspaceRoot, "playwright-report", "index.html");
  const processLogPath = path.join(profileHome, "logs", "process-1.log");

  fs.mkdirSync(path.join(workspaceRoot, ".xgc", "validation"), { recursive: true });
  fs.mkdirSync(path.dirname(playwrightResultPath), { recursive: true });
  fs.mkdirSync(path.dirname(playwrightReportPath), { recursive: true });
  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('before');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('after');\n");
  fs.writeFileSync(validationPath, "# runtime validation\n");
  fs.writeFileSync(playwrightResultPath, JSON.stringify({ status: "passed" }));
  fs.writeFileSync(playwrightReportPath, "<!doctype html><title>Playwright report</title>");

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-app",
      "host_type: github",
      "branch: codex/runtime-truth-pass",
      "summary: Fix extension theme",
      "summary_count: 0",
      "created_at: 2026-04-09T17:46:58.831Z",
      `session_start_head: ${startHead}`,
      "updated_at: 2026-04-09T17:47:20.612Z",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-09T17:46:58.839Z" }),
      JSON.stringify({ type: "subagent.selected", timestamp: "2026-04-09T17:46:59.214Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T17:47:26.820Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-09T18:19:01.650Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-09T18:24:29.280Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-09T18:26:18.932Z", data: { toolName: "apply_patch" } }),
      JSON.stringify({ type: "assistant.message", timestamp: "2026-04-09T18:26:49.328Z" }),
      JSON.stringify({ type: "hook.end", timestamp: "2026-04-09T18:26:49.383Z" })
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    processLogPath,
    [
      `2026-04-09T17:46:58.838Z [INFO] Workspace initialized: ${sessionId} (checkpoints: 0)`,
      "2026-04-09T17:46:59.464Z [INFO] [Octokit] GET /repos/example-org/example-app/pulls?head=example-org%3Acodex%2Forchestra-dark-mode-probe&state=open&per_page=1 - 200 with id abc in 337ms",
      "2026-04-09T17:47:01.728Z [INFO] Memory enablement check: enabled",
      "2026-04-09T17:47:01.758Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-09T18:26:49.332Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  const sessionSummaryText = fs.readFileSync(path.join(sessionDir, "SESSION_SUMMARY.txt"), "utf8");
  assert.match(sessionSummaryText, /X for GitHub Copilot Session Summary/);
  assert.match(sessionSummaryText, /Route: Repo Master -> Milestone -> Patch Master/);
  assert.match(sessionSummaryText, /Summary authority: authoritative/);
  assert.match(sessionSummaryText, /Archive completeness: complete/);
  assert.match(sessionSummaryText, /Committed repo files: 0/);
  assert.match(sessionSummaryText, /Working-tree repo files: 1/);
  assert.equal(summary.updated_at, "2026-04-09T18:26:49.383Z");
  assert.equal(summary.latest_event_at, "2026-04-09T18:26:49.383Z");
  assert.equal(summary.final_status, "completed");
  assert.equal(summary.stop_reason, "end_turn");
  assert.equal(summary.summary_authority, "authoritative");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /terminal hook, raw events, route, process log, git heads/);
  assert.equal(summary.route_summary, "Repo Master -> Milestone -> Patch Master");
  assert.equal(summary.route_summary_source, "started_with_fallbacks");
  assert.deepEqual(summary.route_agents, ["Repo Master", "Milestone", "Patch Master"]);
  assert.deepEqual(summary.key_agents, ["Repo Master", "Milestone", "Patch Master"]);
  assert.equal(summary.repo_scout_invocation_count, 0);
  assert.equal(summary.triage_invocation_count, 0);
  assert.equal(summary.patch_master_invocation_count, 1);
  assert.equal(summary.required_check_invocation_count, 0);
  assert.equal(summary.execution_owner, "Patch Master");
  assert.equal(summary.ownership_transferred_to_execution, true);
  assert.equal(summary.background_execution_agent_observed, false);
  assert.equal(summary.background_execution_agent_unresolved, false);
  assert.deepEqual(summary.background_execution_agent_ids, []);
  assert.equal(summary.triage_duplicate_observed, false);
  assert.equal(summary.triage_duplicate_allowed_reason, null);
  assert.equal(summary.execution_ready_handoff_seen_before_second_triage, false);
  assert.equal(summary.post_execution_root_write_observed, true);
  assert.equal(summary.post_execution_root_patch_observed, true);
  assert.equal(summary.post_execution_root_write_count, 1);
  assert.equal(summary.repo_working_tree_changed, true);
  assert.equal(summary.working_tree_only_diff_observed, true);
  assert.equal(summary.execution_claim_without_observed_repo_diff, false);
  assert.deepEqual(summary.repo_working_tree_files, ["app.ts"]);
  assert.deepEqual(summary.session_state_files, ["events.jsonl", "workspace.yaml"]);
  assert.deepEqual(summary.validation_artifact_files, [
    ".xgc/validation/runtime-validation.md",
    "playwright-report/index.html",
    "test-results/.last-run.json"
  ]);
  assert.deepEqual(summary.external_files, []);
  assert.equal(summary.github_memory_enabled_check, "checked_fresh");
  assert.equal(summary.github_memory_enabled_check_cached, false);
  assert.equal(summary.github_memory_enabled_check_count, 1);
  assert.equal(summary.github_memory_enabled_success_count, 1);
  assert.equal(summary.pr_context_check, "checked_fresh");
  assert.equal(summary.pr_context_check_cached, false);
  assert.equal(summary.pr_context_check_count, 1);
  assert.equal(summary.github_pr_lookup_success_count, 1);
  assert.equal(summary.github_capability_cache_hits, 0);
  assert.equal(summary.github_capability_cache_misses, 2);
  assert.equal(summary.github_memory_enabled_fresh_after_cache_observed, false);
  assert.equal(summary.pr_context_fresh_after_cache_observed, false);
  assert.deepEqual(summary.probe_cache_summary, ["memory-enabled-success", "pr-lookup-success"]);
  assert.equal(summary.provider_retry_observed, false);
  assert.equal(summary.provider_retry_state, "not-observed");
  assert.equal(summary.provider_retry_count, 0);
  assert.equal(summary.process_log, processLogPath);

  const probeCache = fs.readFileSync(path.join(configHome, "github-probe-cache.tsv"), "utf8");
  assert.match(probeCache, /memory-enabled-success/);
  assert.match(probeCache, /pr-lookup-success/);
});

test("session summary finalizer recovers direct single-session route and separates stale hook bootstrap failures", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-direct-route-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-direct-single";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const processLogPath = path.join(profileHome, "logs", "process-direct.log");

  fs.mkdirSync(path.join(workspaceRoot, "app"), { recursive: true });
  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# before\n");
  spawnSync("git", ["add", "README.md"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "app", "page.tsx"), "export default function Page() { return 'done'; }\n");
  spawnSync("git", ["add", "app/page.tsx"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "add direct app"], { cwd: workspaceRoot, stdio: "ignore" });

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-core",
      "summary: Existing OmniCore operator summary",
      "summary_count: 0",
      "created_at: 2026-04-12T06:00:00.000Z",
      `session_start_head: ${startHead}`,
      "updated_at: 2026-04-12T06:00:01.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T06:00:00.000Z" }),
      JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-12T06:01:00.000Z", data: { toolName: "bash" } }),
      JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-12T06:02:00.000Z", data: { toolName: "apply_patch" } }),
      JSON.stringify({
        type: "hook.end",
        timestamp: "2026-04-12T06:02:01.000Z",
        data: {
          stderr: "Error: Cannot find module '/Users/example/project/scripts/pre-tool-use.mjs'"
        }
      }),
      JSON.stringify({
        type: "hook.end",
        timestamp: "2026-04-12T06:02:02.000Z",
        data: {
          stderr: "bash: ./scripts/pre-tool-use.sh: No such file or directory"
        }
      }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-12T06:05:00.000Z",
        data: {
          shutdownType: "routine",
          codeChanges: {
            linesAdded: 24,
            linesRemoved: 2,
            filesModified: ["app/page.tsx"]
          }
        }
      })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    processLogPath,
    [
      `2026-04-12T06:00:00.000Z [INFO] Workspace initialized: ${sessionId} (checkpoints: 0)`,
      "2026-04-12T06:05:00.000Z [INFO] npm test passed"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T06:05:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });
  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.route_summary, "Direct Copilot Session");
  assert.equal(summary.route_summary_source, "raw_tool_events_fallback");
  assert.equal(summary.route_summary_available, true);
  assert.equal(summary.route_summary_derived_from_raw_events, true);
  assert.equal(summary.route_summary_heuristic, true);
  assert.deepEqual(summary.route_agents, []);
  assert.equal(summary.direct_tool_execution_observed, true);
  assert.equal(summary.direct_tool_events_observed, true);
  assert.equal(summary.tool_execution_count, 2);
  assert.equal(summary.write_tool_count, 1);
  assert.equal(summary.bash_tool_count, 1);
  assert.equal(summary.session_shutdown_observed, true);
  assert.equal(summary.session_shutdown_code_changes_observed, true);
  assert.deepEqual(summary.session_shutdown_files_modified, ["app/page.tsx"]);
  assert.equal(summary.session_shutdown_lines_added, 24);
  assert.equal(summary.repo_code_changed, true);
  assert.equal(summary.working_tree_clean, true);
  assert.equal(summary.committed_repo_changed, true);
  assert.equal(summary.committed_diff_source, "git-head-range");
  assert.deepEqual(summary.committed_repo_files, ["app/page.tsx"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.hook_execution_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.deepEqual(summary.foundation_failure_classes, ["bootstrap-hook-path"]);
  assert.equal(summary.validation_status, "passed");
  assert.equal(summary.session_outcome, "success");
  assert.equal(summary.summary, "Existing OmniCore operator summary");
  assert.equal(summary.summary_count, 0);
  assert.equal(summary.summary_authority, "finalized_with_gaps");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /direct single-session tool route/);
});

test("session summary finalizer sets tooling materialization failure from materialization evidence", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-tooling-materialization-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-tooling-materialization";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-12T07:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T07:30:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-12T07:31:00.000Z",
        data: {
          text: "profile materialization failed: copy hooks failed while refreshing the global XGC profile"
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-12T07:32:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-12T07:32:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.foundation_failure_classes, ["tooling-materialization"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.tooling_materialization_failure_observed, true);
  assert.equal(summary.hook_execution_failure_observed, false);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer labels shutdown-only direct route provenance conservatively", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-shutdown-only-route-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-shutdown-only-direct";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-12T07:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T07:00:00.000Z" }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-12T07:05:00.000Z",
        data: {
          shutdownType: "routine",
          codeChanges: {
            linesAdded: 8,
            linesRemoved: 0,
            filesModified: ["app/page.tsx"]
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-12T07:05:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.route_summary, "Direct Copilot Session");
  assert.equal(summary.route_summary_source, "session_shutdown_code_changes_fallback");
  assert.equal(summary.route_summary_derived_from_raw_events, true);
  assert.equal(summary.route_summary_heuristic, true);
  assert.equal(summary.direct_tool_execution_observed, true);
  assert.equal(summary.direct_tool_events_observed, false);
  assert.equal(summary.tool_execution_count, 0);
  assert.equal(summary.session_shutdown_code_changes_observed, true);
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /session\.shutdown code changes/);
});

test("session summary finalizer finds raw profile process logs from transcript path when profile env is absent", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-raw-process-log-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const rawProfileHome = path.join(tempRoot, ".copilot");
  const sessionId = "session-raw-profile";
  const sessionDir = path.join(rawProfileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const processLogPath = path.join(rawProfileHome, "logs", "process-raw.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(rawProfileHome, "logs"), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-14T02:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T02:00:00.000Z" }),
      JSON.stringify({ type: "session.shutdown", timestamp: "2026-04-14T02:05:00.000Z" })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(processLogPath, `2026-04-14T02:05:00.000Z [INFO] Finished ${sessionId} in ${workspaceRoot}\n`);

  const env = { ...process.env };
  delete env.XGC_COPILOT_PROFILE_HOME;
  delete env.COPILOT_HOME;
  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T02:05:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.process_log, processLogPath);
  assert.doesNotMatch((summary.archive_completeness_reasons as string[]).join("\n"), /matching process log was unavailable/);
});

test("session summary finalizer finds process logs from explicit custom log root", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-custom-process-log-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const customLogRoot = path.join(tempRoot, "custom-copilot-logs");
  const sessionId = "session-custom-process-log";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const processLogPath = path.join(customLogRoot, "process-custom.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(customLogRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: custom log root session",
      "created_at: 2026-04-14T02:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T02:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T02:00:01.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-14T02:00:02.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "session.shutdown", timestamp: "2026-04-14T02:00:03.000Z", data: { shutdownType: "routine" } })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(processLogPath, `2026-04-14T02:00:00.000Z [INFO] Workspace initialized: ${sessionId}\n${workspaceRoot}\n`);

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "subagentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T02:00:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome,
      XGC_PROCESS_LOG_ROOT: customLogRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.process_log, processLogPath);
  assert.doesNotMatch((summary.archive_completeness_reasons as string[]).join("\n"), /matching process log was unavailable/);
});

test("session summary finalizer prefers exact process log evidence over newer cwd-only logs", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-process-log-match-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const sessionId = "session-exact-process-log";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const exactProcessLogPath = path.join(logRoot, "process-exact.log");
  const cwdOnlyProcessLogPath = path.join(logRoot, "process-cwd-only.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(logRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-14T03:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T03:00:00.000Z" }),
      JSON.stringify({ type: "session.shutdown", timestamp: "2026-04-14T03:00:03.000Z", data: { shutdownType: "routine" } })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(cwdOnlyProcessLogPath, `2026-04-14T03:00:02.000Z [INFO] Reused workspace ${workspaceRoot}\n`);
  fs.writeFileSync(
    exactProcessLogPath,
    `2026-04-14T03:00:01.000Z [INFO] Workspace initialized: ${sessionId}\ntranscriptPath=${transcriptPath}\n`
  );
  fs.utimesSync(exactProcessLogPath, new Date("2026-04-14T03:00:01.000Z"), new Date("2026-04-14T03:00:01.000Z"));
  fs.utimesSync(cwdOnlyProcessLogPath, new Date("2026-04-14T03:00:05.000Z"), new Date("2026-04-14T03:00:05.000Z"));

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T03:00:04.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.process_log, exactProcessLogPath);
});

test("session summary finalizer records git-head-range source for checked empty committed diffs", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-empty-range-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-empty-committed-range";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# stable baseline\n");
  spawnSync("git", ["add", "README.md"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/empty-range",
      "summary: No-op validation session",
      "created_at: 2026-04-12T07:00:00.000Z",
      `session_start_head: ${head}`,
      "updated_at: 2026-04-12T07:00:01.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T07:00:00.000Z" }),
      JSON.stringify({ type: "session.shutdown", timestamp: "2026-04-12T07:01:00.000Z", data: { shutdownType: "routine" } })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T07:01:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });
  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_start_head, head);
  assert.equal(summary.session_end_head, head);
  assert.equal(summary.committed_diff_source, "git-head-range");
  assert.deepEqual(summary.committed_repo_files, []);
  assert.equal(summary.committed_repo_changed, false);
  assert.equal(summary.repo_changes_committed, false);
  assert.equal(summary.repo_code_changed, false);
  assert.equal(summary.working_tree_clean, true);
  assert.equal(summary.working_tree_only_diff_observed, false);
});

test("session summary finalizer does not promote shutdown-only validation artifacts to repo changes", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-shutdown-artifact-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-shutdown-artifact-only";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(workspaceRoot, ".xgc", "validation"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".xgc", "validation", "workspace.yaml"), "summary: generated\n");
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Artifact-only shutdown",
      "created_at: 2026-04-12T07:30:00.000Z",
      "updated_at: 2026-04-12T07:30:01.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T07:30:00.000Z" }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-12T07:31:00.000Z",
        data: {
          shutdownType: "routine",
          codeChanges: {
            linesAdded: 1,
            linesRemoved: 0,
            filesModified: [".xgc/validation/workspace.yaml"]
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-12T07:31:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.session_shutdown_files_modified, [".xgc/validation/workspace.yaml"]);
  assert.deepEqual(summary.committed_repo_files, []);
  assert.equal(summary.committed_repo_changed, false);
  assert.equal(summary.repo_changes_committed, false);
  assert.equal(summary.repo_code_changed, false);
  assert.notEqual(summary.committed_diff_source, "session-shutdown-codeChanges");
});

test("session summary finalizer does not borrow unrelated process logs when no session log matches", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-no-log-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-no-log";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-app",
      "host_type: github",
      "branch: main",
      "summary: No matching log case",
      "summary_count: 0",
      "created_at: 2026-04-10T00:00:00.000Z",
      "updated_at: 2026-04-10T00:00:00.000Z",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-10T00:00:00.100Z" }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-10T00:00:01.000Z" })
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(profileHome, "logs", "process-unrelated.log"),
    [
      "2026-04-10T00:00:00.000Z [INFO] Workspace initialized: other-session (checkpoints: 0)",
      "2026-04-10T00:00:00.100Z [INFO] [Octokit] GET /repos/example-org/other-repo/pulls?head=branch&state=open&per_page=1 - 200 with id abc in 50ms",
      "2026-04-10T00:00:00.200Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-10T00:00:01.050Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.updated_at, "2026-04-10T00:00:01.050Z");
  assert.equal(summary.latest_event_at, "2026-04-10T00:00:01.000Z");
  assert.equal(summary.final_status, "completed");
  assert.equal(summary.process_log, undefined);
  assert.equal(summary.github_memory_enabled_check, "unobserved");
  assert.equal(summary.github_memory_enabled_check_cached, false);
  assert.equal(summary.github_memory_enabled_check_count, 0);
  assert.equal(summary.pr_context_check, "unobserved");
  assert.equal(summary.pr_context_check_cached, false);
  assert.equal(summary.pr_context_check_count, 0);
  assert.equal(summary.github_capability_cache_misses, 0);

  const probeCachePath = path.join(configHome, "github-probe-cache.tsv");
  if (fs.existsSync(probeCachePath)) {
    const probeCache = fs.readFileSync(probeCachePath, "utf8");
    assert.equal(probeCache.trim(), "");
  }
});

test("session summary finalizer reuses legacy three-column probe cache rows for the current session summary", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-legacy-cache-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-legacy-cache";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(configHome, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    [
      "example-org/example-app\tmemory-enabled-success\t2026-04-10T00:00:00Z",
      "example-org/example-app\tpr-lookup-success\t2026-04-10T00:00:01Z"
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-app",
      "host_type: github",
      "branch: main",
      "summary: Legacy cache reuse case",
      "summary_count: 0",
      "created_at: 2026-04-10T00:00:00.000Z",
      "updated_at: 2026-04-10T00:00:00.000Z",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-10T00:00:00.100Z" }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-10T00:00:01.000Z" })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-10T00:00:01.050Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.updated_at, "2026-04-10T00:00:01.050Z");
  assert.equal(summary.latest_event_at, "2026-04-10T00:00:01.000Z");
  assert.equal(summary.github_memory_enabled_check, "reused_from_cache");
  assert.equal(summary.github_memory_enabled_check_cached, true);
  assert.equal(summary.github_memory_enabled_check_count, 0);
  assert.equal(summary.pr_context_check, "reused_from_cache");
  assert.equal(summary.pr_context_check_cached, true);
  assert.equal(summary.pr_context_check_count, 0);
  assert.equal(summary.github_capability_cache_hits, 2);
  assert.equal(summary.github_capability_cache_misses, 0);
  assert.equal(summary.github_memory_enabled_fresh_after_cache_observed, false);
  assert.equal(summary.pr_context_fresh_after_cache_observed, false);
  assert.deepEqual(summary.probe_cache_summary, ["memory-enabled-success", "pr-lookup-success"]);
  assert.equal(
    fs.readFileSync(path.join(configHome, "github-probe-cache.tsv"), "utf8"),
    [
      "example-org/example-app\tmemory-enabled-success\t2026-04-10T00:00:00Z",
      "example-org/example-app\tpr-lookup-success\t2026-04-10T00:00:01Z"
    ].join("\n") + "\n"
  );
});

test("session summary finalizer preserves duplicate Triage and Patch Master invocations in route truth", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-duplicate-route-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-duplicate-route";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const processLogPath = path.join(profileHome, "logs", "process-duplicate.log");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-ios-app",
      "host_type: github",
      "branch: main",
      "summary: TonePrep iOS Implementation",
      "summary_count: 0",
      "created_at: 2026-04-10T04:47:57.591Z",
      "updated_at: 2026-04-10T04:48:03.000Z",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-10T04:47:57.591Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:48:46.975Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:48:48.087Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:49:02.343Z", data: { agentDisplayName: "Repo Scout" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:49:57.500Z", data: { agentDisplayName: "Ref Index" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:51:42.023Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T04:54:22.341Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T04:57:52.093Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T04:58:05.729Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T05:01:09.957Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T05:03:05.233Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T05:15:11.072Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T05:15:33.254Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T05:26:56.134Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-10T05:27:30.061Z" })
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    processLogPath,
    [
      `2026-04-10T04:47:57.591Z [INFO] Workspace initialized: ${sessionId} (checkpoints: 0)`,
      "2026-04-10T04:47:58.225Z [INFO] [Octokit] GET /repos/example-org/example-ios-app/pulls?head=example-org%3Amain&state=open&per_page=1 - 200 with id abc in 346ms",
      "2026-04-10T04:48:00.445Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:48:00.456Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:48:00.815Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:48:01.000Z [INFO] --- Start of group: configured settings: ---",
      "2026-04-10T04:48:02.929Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:48:03.000Z [INFO] --- End of group ---",
      "2026-04-10T04:48:47.635Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:48:48.087Z [INFO] Custom agent \"Milestone\" using tools: view, bash, task",
      "2026-04-10T04:49:02.885Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:49:02.886Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:49:03.000Z [INFO] --- Start of group: git rev-parse HEAD ---",
      "2026-04-10T04:49:58.224Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:49:58.263Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:49:58.802Z [INFO] Custom agent \"Ref Index\" using tools: view, bash",
      "2026-04-10T04:51:42.465Z [INFO] Memory enablement check: enabled",
      "2026-04-10T04:51:42.887Z [INFO] Custom agent \"Triage\" using tools: view, bash",
      "2026-04-10T05:03:05.845Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-10T05:27:30.061Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.updated_at, "2026-04-10T05:27:30.061Z");
  assert.equal(summary.latest_event_at, "2026-04-10T05:27:30.061Z");
  assert.equal(
    summary.route_summary,
    "Repo Master -> Milestone -> Repo Scout -> Ref Index -> Triage -> Triage -> Patch Master -> Patch Master"
  );
  assert.equal(summary.route_summary_source, "started_with_fallbacks");
  assert.deepEqual(summary.route_agents, [
    "Repo Master",
    "Milestone",
    "Repo Scout",
    "Ref Index",
    "Triage",
    "Triage",
    "Patch Master",
    "Patch Master"
  ]);
  assert.deepEqual(summary.key_agents, ["Repo Master", "Milestone", "Repo Scout", "Ref Index", "Triage", "Patch Master"]);
  assert.equal(summary.repo_scout_invocation_count, 1);
  assert.equal(summary.triage_invocation_count, 2);
  assert.equal(summary.patch_master_invocation_count, 2);
  assert.equal(summary.required_check_invocation_count, 0);
  assert.equal(summary.triage_duplicate_observed, true);
  assert.equal(summary.triage_duplicate_allowed_reason, null);
  assert.equal(summary.execution_ready_handoff_seen_before_second_triage, true);
  assert.equal(summary.github_memory_enabled_check, "checked_fresh");
  assert.equal(summary.github_memory_enabled_check_count, 7);
  assert.equal(summary.github_memory_enabled_success_count, 7);
  assert.equal(summary.pr_context_check, "checked_fresh");
  assert.equal(summary.pr_context_check_count, 1);
  assert.equal(summary.github_pr_lookup_success_count, 1);
});

test("session summary finalizer matches specialist required and Patch Master swarm threshold", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-specialist-fanout-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-specialist-fanout";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: UI polish route",
      "created_at: 2026-04-13T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:00:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-13T09:00:01.000Z",
        data: { content: "Polish the responsive UI layout, CSS spacing, visual hierarchy, animation, and accessibility." }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:00:02.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:00:03.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:00:04.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:00:05.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:00:06.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.required_specialist_lanes, ["visual-forge"]);
  assert.deepEqual(summary.missing_required_specialist_lanes, ["visual-forge"]);
  assert.equal(summary.patch_master_swarm_count, 2);
  assert.equal(summary.patch_master_swarm_observed, true);
  assert.equal(summary.specialist_fanout_covered_by_patch_master, false);
  assert.equal(summary.specialist_fanout_status, "missing_required");
});

test("session summary finalizer does not count selected-only specialist lanes as observed", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-selected-only-specialist-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-selected-only-specialist";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: selected-only specialist",
      "created_at: 2026-04-13T09:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:10:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-13T09:10:01.000Z",
        data: { content: "Use Visual Forge to polish the responsive UI layout and animation." }
      }),
      JSON.stringify({ type: "subagent.selected", timestamp: "2026-04-13T09:10:02.000Z", data: { agentDisplayName: "Visual Forge" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:10:03.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:10:04.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.required_specialist_lanes, ["visual-forge"]);
  assert.deepEqual(summary.observed_specialist_lanes, []);
  assert.deepEqual(summary.missing_required_specialist_lanes, ["visual-forge"]);
  assert.equal(summary.specialist_fanout_status, "missing_required");
});

test("session summary finalizer treats docs-only work as requiring Writing Desk", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "writing-required",
    promptText: "Rewrite the README, onboarding guide, migration notes, changelog, and validation documentation.",
    routeAgents: ["Repo Master", "Patch Master", "Patch Master"]
  });

  assert.deepEqual(summary.required_specialist_lanes, ["writing-desk"]);
  assert.deepEqual(summary.missing_required_specialist_lanes, ["writing-desk"]);
  assert.equal(summary.patch_master_swarm_count, 2);
  assert.equal(summary.specialist_fanout_covered_by_patch_master, false);
  assert.equal(summary.specialist_fanout_status, "missing_required");
});

test("session summary finalizer treats creative direction as requiring Artistry Studio", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "artistry-required",
    promptText: "Develop naming, tagline, tone, messaging, brand voice, and aesthetic direction for the product.",
    routeAgents: ["Repo Master", "Artistry Studio"]
  });

  assert.deepEqual(summary.required_specialist_lanes, ["artistry-studio"]);
  assert.deepEqual(summary.observed_specialist_lanes, ["artistry-studio"]);
  assert.deepEqual(summary.missing_required_specialist_lanes, []);
  assert.equal(summary.specialist_fanout_status, "complete");
});

test("session summary finalizer lets Patch Master swarm cover only recommended broad product lanes", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "broad-swarm-covered",
    promptText:
      "Build a complex production-shaped multi-tenant SaaS app with dashboard, analytics, docs, tests, architecture, and responsive UI.",
    routeAgents: ["Repo Master", "Patch Master", "Patch Master"]
  });

  assert.equal(summary.large_product_build_task_observed, true);
  assert.deepEqual(summary.required_specialist_lanes, []);
  assert.deepEqual(summary.recommended_specialist_lanes, ["visual-forge", "writing-desk"]);
  assert.deepEqual(summary.unobserved_recommended_specialist_lanes, ["visual-forge", "writing-desk"]);
  assert.equal(summary.patch_master_swarm_count, 2);
  assert.equal(summary.patch_master_swarm_observed, true);
  assert.equal(summary.specialist_fanout_covered_by_patch_master, true);
  assert.equal(summary.specialist_fanout_status, "covered_by_patch_master_swarm");
});

test("session summary finalizer does not require Multimodal Look for visual notes without artifacts", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "visual-notes-no-multimodal",
    promptText:
      "Create a visual launch deck and execution notes. Do not force multimodal analysis unless an actual screenshot/PDF/image is available.",
    routeAgents: ["Repo Master", "Patch Master", "Patch Master"]
  });

  assert.ok(!(summary.required_specialist_lanes as string[]).includes("multimodal-look"));
  assert.deepEqual(summary.required_specialist_lanes, ["visual-forge"]);
  assert.deepEqual(summary.missing_required_specialist_lanes, ["visual-forge"]);
  assert.equal(summary.patch_master_swarm_observed, true);
});

test("session summary finalizer still requires Multimodal Look when one artifact type is absent but another is present", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "pdf-without-screenshot",
    promptText: "Analyze the attached PDF architecture diagram and extract the visual hierarchy. No screenshot is available.",
    routeAgents: ["Repo Master", "Patch Master", "Patch Master"]
  });

  assert.ok((summary.required_specialist_lanes as string[]).includes("multimodal-look"));
  assert.ok((summary.missing_required_specialist_lanes as string[]).includes("multimodal-look"));
  assert.equal(summary.specialist_fanout_status, "missing_required");
  assert.equal(summary.specialist_fanout_covered_by_patch_master, false);
});

test("session summary finalizer keeps fanout not applicable when no specialist lane is expected", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "backend-swarm-no-specialist",
    promptText: "Refactor backend data access and improve server-side error handling.",
    routeAgents: ["Repo Master", "Patch Master", "Patch Master"]
  });

  assert.equal(summary.specialist_lane_expected, false);
  assert.deepEqual(summary.required_specialist_lanes, []);
  assert.deepEqual(summary.recommended_specialist_lanes, []);
  assert.equal(summary.patch_master_swarm_observed, true);
  assert.equal(summary.specialist_fanout_observed, false);
  assert.equal(summary.specialist_fanout_status, "not_applicable");
  assert.equal(summary.specialist_fanout_reason, "no_specialist_scope_detected");
});

test("session summary finalizer scopes specialist fanout to latest user request and strips transformed agent instructions", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-latest-scope-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-latest-scope";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: latest user scope",
      "created_at: 2026-04-14T06:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:00:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-14T06:01:00.000Z",
        data: {
          content: "현재 크롬 익스텐션에서 라이트모드 / 다크모드가 정상동작하지않는데 수정해줘",
          transformedContent:
            "<agent_instructions>Build a complex production-shaped SaaS app with dashboard, docs, architecture, validation, malformed payload symptom, seed data, and browser smoke checks.</agent_instructions>\n현재 크롬 익스텐션에서 라이트모드 / 다크모드가 정상동작하지않는데 수정해줘"
        }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:02:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:03:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:04:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.large_product_build_task_observed, false);
  assert.deepEqual(summary.required_specialist_lanes, ["visual-forge"]);
  assert.deepEqual(summary.recommended_specialist_lanes, []);
  assert.deepEqual(summary.foundation_failure_classes, []);
});

test("session summary finalizer separates preexisting untracked files from session-touched repo files", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3 && command -v git"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 or git unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-preexisting-untracked-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-preexisting-untracked";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "existing.txt"), "base\n");
  spawnSync("git", ["add", "existing.txt"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(path.join(workspaceRoot, "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "screenshots", "old.png"), "preexisting\n");
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      `session_start_head: ${startHead}`,
      `session_start_git_status_files: ${JSON.stringify(["screenshots/old.png"])}`,
      "summary: preexisting untracked baseline",
      "created_at: 2026-04-14T06:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-14T06:02:00.000Z",
        data: { toolName: "edit", arguments: { path: path.join(workspaceRoot, "existing.txt") } }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:03:00.000Z" })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(path.join(workspaceRoot, "existing.txt"), "changed\n");

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:03:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.session_touched_repo_files, ["existing.txt"]);
  assert.deepEqual(summary.preexisting_working_tree_files, ["screenshots/old.png"]);
  assert.deepEqual(summary.repo_working_tree_files, ["existing.txt"]);
  assert.match(fs.readFileSync(path.join(workspaceRoot, ".git", "info", "exclude"), "utf8"), /^\.xgc\/$/m);
});

test("session summary finalizer respects explicit single-Copilot session scope over specialist fanout", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const summary = runSpecialistFanoutFinalizer({
    sessionLabel: "single-copilot-large-product",
    promptText:
      "Use one single Copilot session only to build a complex production-shaped multi-tenant SaaS app with dashboard, responsive UI, docs, tests, and screenshot/PDF analysis notes.",
    routeAgents: ["Repo Master", "Milestone", "Triage"]
  });

  assert.equal(summary.large_product_build_task_observed, true);
  assert.equal(summary.single_session_scope_declared, true);
  assert.equal(summary.specialist_lane_expected, false);
  assert.deepEqual(summary.required_specialist_lanes, []);
  assert.deepEqual(summary.recommended_specialist_lanes, []);
  assert.deepEqual(summary.missing_required_specialist_lanes, []);
  assert.equal(summary.specialist_fanout_status, "not_applicable");
  assert.equal(summary.specialist_fanout_reason, "single_session_scope_declared");
});

test("session summary finalizer avoids single-session app-domain false positives", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const hyphenated = runSpecialistFanoutFinalizer({
    sessionLabel: "hyphenated-single-session-scope",
    promptText:
      "Use single-session scope for this complex production-shaped SaaS app with dashboard, responsive UI, docs, tests, and architecture.",
    routeAgents: ["Repo Master", "Milestone", "Triage"]
  });
  assert.equal(hyphenated.single_session_scope_declared, true);
  assert.equal(hyphenated.specialist_lane_expected, false);
  assert.equal(hyphenated.specialist_fanout_reason, "single_session_scope_declared");

  const appDomainSession = runSpecialistFanoutFinalizer({
    sessionLabel: "single-session-auth-domain",
    promptText:
      "Build a complex production-shaped SaaS app with dashboard, responsive UI, docs, tests, architecture, single session auth, and one session cookie handling.",
    routeAgents: ["Repo Master", "Patch Master"]
  });
  assert.equal(appDomainSession.single_session_scope_declared, false);
  assert.equal(appDomainSession.specialist_lane_expected, true);
  assert.deepEqual(appDomainSession.recommended_specialist_lanes, ["visual-forge", "writing-desk"]);
  assert.equal(appDomainSession.specialist_fanout_status, "partial");
});

test("session summary finalizer preserves local repo identity signal after probe summary update", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-local-identity-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-local-identity";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: local-repo-abcdef123456",
      "summary: local workspace route",
      "created_at: 2026-04-13T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:00:01.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:00:02.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:00:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.github_repo_identity_missing_observed, true);
  assert.equal(summary.github_repo_identity_source, "local_repo_without_github_remote");
  assert.equal(summary.github_memory_suppressed_for_missing_repo_identity, true);
});

test("session summary finalizer does not treat quoted repo identity error text as missing GitHub repo", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-quoted-repo-identity-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-quoted-repo-identity";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: octocat/hello-world",
      "summary: quoted repo identity error text",
      "created_at: 2026-04-13T09:05:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:05:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-13T09:05:01.000Z",
        data: { content: 'Document this exact text: "GitHub repository name is required".' }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:05:02.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:05:03.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:05:04.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.github_repo_identity_missing_observed, false);
  assert.equal(summary.github_repo_identity_source, "not-observed");
  assert.equal(summary.github_memory_suppressed_for_missing_repo_identity, false);
});

test("session summary finalizer flags post-Patch-Master generic ownership leaks and shared surfaces", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-integration-leak-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-integration-leak";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), "{\"name\":\"example-ops\"}\n");
  spawnSync("git", ["add", "package.json"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, ".env.local"), "OPSFORGE_DEMO=true\n");
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), "{\"name\":\"example-ops\",\"private\":true}\n");

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: example-org/example-ops",
      "host_type: github",
      "branch: copilot/example-ops-integration",
      "summary: integration-class multi-session product work",
      "summary_count: 0",
      "created_at: 2026-04-10T20:00:00.000Z",
      "updated_at: 2026-04-10T20:00:01.000Z",
      "route_summary: Repo Master -> Patch Master",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-10T20:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T20:00:10.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T20:00:20.000Z", data: { agentDisplayName: "Repo Scout" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T20:01:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-10T20:01:50.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T20:02:00.000Z", data: { agentDisplayName: "General Purpose Agent" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-10T20:03:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-10T20:04:00.000Z",
        data: { text: "Shared surface owner: integration owner\nFoundation readiness: assessed\nblocker: none\nnot blocked by schema anymore" }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-10T20:05:00.000Z" })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-10T20:05:02.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.updated_at, "2026-04-10T20:05:02.000Z");
  assert.equal(summary.latest_event_at, "2026-04-10T20:05:00.000Z");
  assert.equal(summary.summary_finalization_status, "finalized");
  assert.equal(summary.summary_route_heuristic_mismatch, true);
  assert.equal(summary.summary_timestamp_stale, false);
  assert.equal(summary.route_summary, "Repo Master -> Repo Scout -> Patch Master -> General Purpose Agent -> Patch Master");
  assert.deepEqual(summary.route_agents, ["Repo Master", "Repo Scout", "Patch Master", "General Purpose Agent", "Patch Master"]);
  assert.deepEqual(summary.key_agents, ["Repo Master", "Repo Scout", "Patch Master", "General Purpose Agent"]);
  assert.equal(summary.patch_master_invocation_count, 2);
  assert.equal(summary.built_in_generic_agent_invocation_count, 1);
  assert.equal(summary.post_execution_generic_agent_observed, true);
  assert.equal(summary.post_execution_built_in_agent_observed, true);
  assert.deepEqual(summary.post_execution_generic_agents, ["General Purpose Agent"]);
  assert.equal(summary.post_execution_ownership_leak_observed, true);
  assert.equal(summary.ownership_leak_allowed_reason, null);
  assert.equal(summary.integration_class_task_observed, true);
  assert.equal(summary.foundation_readiness_assessed, true);
  assert.equal(summary.foundation_readiness_unknown, false);
  assert.equal(summary.foundation_risk_raised, false);
  assert.equal(summary.shared_surface_change_observed, true);
  assert.equal(summary.shared_surface_owner_declared, true);
  assert.deepEqual(summary.integration_owned_surfaces_touched, [".env.local", "package.json"]);
  assert.deepEqual(summary.repo_working_tree_files, [".env.local", "package.json"]);
});

test("session summary finalizer distinguishes committed repo changes from a clean working tree", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-committed-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-committed-clean";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(path.join(profileHome, "logs"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('before');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('after');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "session change"], { cwd: workspaceRoot, stdio: "ignore" });
  const endHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "repository: local/sentinelgrid",
      "branch: copilot/session",
      "summary: integration-class task with committed output",
      "summary_count: 0",
      "created_at: 2026-04-11T10:00:00.000Z",
      `session_start_head: ${startHead}`,
      "updated_at: 2026-04-11T10:00:01.000Z",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T10:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T10:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T10:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-11T10:04:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-11T10:05:00.000Z" })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T10:05:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_start_head, startHead);
  assert.equal(summary.session_end_head, endHead);
  assert.equal(summary.session_head_changed, true);
  assert.equal(summary.working_tree_clean, true);
  assert.equal(summary.summary_authority, "finalized_with_gaps");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /matching process log was unavailable/);
  assert.equal(summary.repo_working_tree_changed, false);
  assert.equal(summary.committed_repo_changed, true);
  assert.equal(summary.repo_changes_committed, true);
  assert.equal(summary.repo_changes_uncommitted, false);
  assert.equal(summary.working_tree_only_diff_observed, false);
  assert.equal(summary.repo_code_changed, true);
  assert.deepEqual(summary.repo_working_tree_files, []);
  assert.deepEqual(summary.committed_repo_files, ["app.ts"]);
  assert.equal(summary.execution_claim_without_observed_repo_diff, false);
  assert.equal(summary.session_state_only, false);
  assert.equal(summary.validation_status, "not-observed");
  assert.equal(summary.session_outcome, "success");
  assert.equal(summary.session_outcome_detail, "completed_with_repo_changes");
});

test("session summary finalizer refreshes stale agentStop truth on subagentStop", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-subagent-stop-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-subagent-stop-refresh";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });

  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('start');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('first');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "first agent stop commit"], { cwd: workspaceRoot, stdio: "ignore" });
  const staleHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(path.join(workspaceRoot, "worker.ts"), "console.log('subagent final work');\n");
  spawnSync("git", ["add", "worker.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "subagent final commit"], { cwd: workspaceRoot, stdio: "ignore" });
  const endHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: stale agentStop summary",
      "summary_count: 1",
      "created_at: 2026-04-13T17:56:31.077Z",
      "updated_at: 2026-04-13T18:23:09.251Z",
      "latest_event_at: 2026-04-13T18:22:57.729Z",
      "summary_finalization_status: finalized",
      "final_status: completed",
      "session_shutdown_observed: false",
      `session_start_head: ${startHead}`,
      `session_end_head: ${staleHead}`,
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T17:56:31.077Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T17:56:33.000Z",
        data: { newModel: "gpt-5.4" }
      }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T17:56:34.411Z",
        data: { previousModel: "gpt-5.4", newModel: "claude-sonnet-4.6" }
      }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T17:56:40.000Z", data: { content: "Build TitanForge" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T17:59:11.000Z", data: { agentDisplayName: "Patch Master", agentId: "titanforge-build" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-13T18:01:00.000Z",
        data: {
          text: [
            "Agent is still running after waiting 60s. agent_id: titanforge-build, agent_type: Patch Master, status: running, tool_calls_completed: 9, (timed out waiting for completion)",
            "npm test passed",
            "npx playwright test passed"
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-13T18:26:32.725Z", data: { agentDisplayName: "Patch Master", agentId: "titanforge-build" } }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-13T18:26:32.982Z",
        data: {
          shutdownType: "routine",
          modelMetrics: {
            "claude-sonnet-4.6": { requests: { count: 2 } },
            "gpt-5.4": { requests: { count: 1 } }
          },
          currentModel: "gpt-5.4",
          codeChanges: {
            linesAdded: 12,
            linesRemoved: 1,
            filesModified: [path.join(workspaceRoot, "worker.ts")]
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "subagentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T18:26:32.725Z"),
      cwd: workspaceRoot,
      transcriptPath,
      agentName: "Patch Master",
      agentDisplayName: "Patch Master",
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.final_status, "completed");
  assert.equal(summary.summary_finalization_status, "finalized");
  assert.equal(summary.latest_event_at, "2026-04-13T18:26:32.982Z");
  assert.equal(summary.updated_at, "2026-04-13T18:26:32.982Z");
  assert.equal(summary.summary_timestamp_stale, false);
  assert.equal(summary.session_shutdown_observed, true);
  assert.equal(summary.session_shutdown_code_changes_observed, true);
  assert.deepEqual(summary.session_shutdown_files_modified, [path.join(workspaceRoot, "worker.ts")]);
  assert.equal(summary.session_start_head, startHead);
  assert.equal(summary.session_end_head, endHead);
  assert.equal(summary.session_head_changed, true);
  assert.equal(summary.repo_changes_committed, true);
  assert.equal(summary.working_tree_clean, true);
  assert.deepEqual(summary.committed_repo_files, ["app.ts", "worker.ts"]);
  assert.equal(summary.validation_status, "passed");
  assert.deepEqual(summary.validation_command_failures, []);
  assert.equal(summary.requested_runtime_model, "claude-sonnet-4.6");
  assert.equal(summary.session_current_model, "gpt-5.4");
  assert.deepEqual(summary.observed_runtime_models, ["gpt-5.4", "claude-sonnet-4.6"]);
  assert.deepEqual(summary.post_prompt_observed_runtime_models, ["gpt-5.4"]);
  assert.deepEqual(summary.observed_model_metric_models, ["claude-sonnet-4.6", "gpt-5.4"]);
  assert.equal(summary.mixed_model_session_observed, true);
  assert.equal(summary.non_requested_model_usage_observed, true);
  assert.equal(summary.model_identity_mismatch_observed, true);
  assert.equal(summary.agent_model_policy_mismatch_observed, false);
  assert.equal(summary.agent_model_policy_mismatch_count, 0);
  assert.doesNotMatch((summary.summary_authority_reasons as string[]).join("\n"), /terminal agentStop hook was not observed|terminal stop hook was not observed/);
});

test("session summary finalizer reports child model policy mismatches from telemetry", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-model-mismatch-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-model-mismatch";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: model mismatch telemetry",
      "created_at: 2026-04-13T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:00:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T09:00:01.000Z",
        data: { previousModel: "claude-sonnet-4.6", newModel: "claude-opus-4.6" }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-13T09:00:02.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-13T09:00:03.000Z",
        data: {
          toolTelemetry: {
            restrictedProperties: { agent_name: "Milestone" },
            properties: { model: "claude-sonnet-4.6" }
          }
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-13T09:00:04.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:00:05.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.requested_runtime_model, "claude-opus-4.6");
  assert.equal(summary.agent_model_policy_mismatch_observed, true);
  assert.equal(summary.agent_model_policy_mismatch_count, 1);
  assert.deepEqual(summary.agent_model_policy_mismatches, ["Milestone expected claude-opus-4.6 observed claude-sonnet-4.6"]);
});

test("session summary finalizer ignores parent task-tool model fields as child policy telemetry", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-parent-tool-model-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-parent-tool-model";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: parent task-tool model field",
      "created_at: 2026-04-15T03:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T03:00:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-15T03:00:01.000Z",
        data: { previousModel: "claude-sonnet-4.6", newModel: "gpt-5.4" }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:00:02.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-15T03:00:03.000Z",
        data: {
          agentDisplayName: "Milestone",
          model: "gpt-5.4"
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-15T03:00:04.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T03:00:05.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.requested_runtime_model, "gpt-5.4");
  assert.equal(summary.agent_model_policy_mismatch_observed, false);
  assert.equal(summary.agent_model_policy_mismatch_count, 0);
  assert.deepEqual(summary.agent_model_policy_mismatches, []);
});

test("session summary finalizer flags tool model identity mismatch outside resolved policy set", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-tool-model-identity-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-tool-model-identity";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: stable runtime model with mismatched tool telemetry",
      "created_at: 2026-04-13T09:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:30:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T09:30:01.000Z",
        data: { previousModel: "claude-sonnet-4.6", newModel: "gpt-5.4" }
      }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T09:30:02.000Z", data: { content: "Build a small app" } }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-13T09:30:03.000Z",
        data: {
          toolTelemetry: {
            properties: { model: "claude-haiku-4.6" }
          }
        }
      }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-13T09:30:04.000Z",
        data: {
          shutdownType: "routine",
          currentModel: "gpt-5.4",
          modelMetrics: {
            "gpt-5.4": { requests: { count: 1 } }
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:30:05.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.requested_runtime_model, "gpt-5.4");
  assert.equal(summary.session_current_model, "gpt-5.4");
  assert.deepEqual(summary.observed_agent_tool_models, ["claude-haiku-4.6"]);
  assert.equal(summary.non_requested_model_usage_observed, false);
  assert.equal(summary.model_identity_mismatch_observed, true);
});

test("session summary finalizer does not flag policy-expected child model mix as identity mismatch", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-policy-model-mix-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-policy-model-mix";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: stable runtime model with expected child models",
      "created_at: 2026-04-13T09:40:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:40:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T09:40:01.000Z",
        data: { previousModel: "claude-sonnet-4.6", newModel: "gpt-5.4" }
      }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T09:40:02.000Z", data: { content: "Build a small app" } }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-13T09:40:03.000Z",
        data: {
          toolTelemetry: {
            restrictedProperties: { agent_name: "Milestone" },
            properties: { model: "claude-sonnet-4.6" }
          }
        }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-13T09:40:04.000Z",
        data: {
          toolTelemetry: {
            restrictedProperties: { agent_name: "Repo Scout" },
            properties: { model: "gpt-5.4-mini" }
          }
        }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-13T09:40:05.000Z",
        data: {
          toolTelemetry: {
            restrictedProperties: { agent_name: "Patch Master" },
            properties: { model: "gpt-5.4" }
          }
        }
      }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-13T09:40:06.000Z",
        data: {
          shutdownType: "routine",
          currentModel: "gpt-5.4",
          modelMetrics: {
            "gpt-5.4": { requests: { count: 1 } }
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:40:07.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.requested_runtime_model, "gpt-5.4");
  assert.deepEqual(summary.observed_agent_tool_models, ["claude-sonnet-4.6", "gpt-5.4-mini", "gpt-5.4"]);
  assert.equal(summary.non_requested_model_usage_observed, false);
  assert.equal(summary.model_identity_mismatch_observed, false);
  assert.equal(summary.agent_model_policy_mismatch_observed, false);
});

test("session summary finalizer uses last /model selection before the real prompt", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-model-command-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-model-command";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: model command before prompt",
      "created_at: 2026-04-13T09:50:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T09:50:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T09:50:01.000Z",
        data: { previousModel: "gpt-5-mini", newModel: "gpt-5-mini" }
      }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T09:50:02.000Z", data: { content: "/model gpt-5.4" } }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-13T09:50:03.000Z",
        data: { previousModel: "gpt-5-mini", newModel: "gpt-5.4" }
      }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T09:50:04.000Z", data: { content: "Build a launch review app" } }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-13T09:50:05.000Z",
        data: {
          shutdownType: "routine",
          currentModel: "gpt-5.4",
          modelMetrics: {
            "gpt-5.4": { requests: { count: 1 } }
          }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T09:50:06.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.requested_runtime_model, "gpt-5.4");
  assert.deepEqual(summary.post_prompt_observed_runtime_models, ["gpt-5.4"]);
  assert.equal(summary.non_requested_model_usage_observed, false);
  assert.equal(summary.model_identity_mismatch_observed, false);
});

test("session summary finalizer recovers start head and keeps single TUI model mismatch advisory", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-tui-single-model-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-tui-single-model";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const processLogPath = path.join(profileHome, "logs", "process-tui-model.log");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(processLogPath), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# before\n");
  spawnSync("git", ["add", "README.md"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: workspaceRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-04-14T16:18:00Z",
      GIT_COMMITTER_DATE: "2026-04-14T16:18:00Z"
    }
  });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('built');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "build app"], {
    cwd: workspaceRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-04-14T16:50:00Z",
      GIT_COMMITTER_DATE: "2026-04-14T16:50:00Z"
    }
  });
  const endHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: TUI single model product run",
      "created_at: 2026-04-14T16:19:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T16:19:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-14T16:19:01.000Z",
        data: { previousModel: "gpt-5-mini", newModel: "gpt-5.4" }
      }),
      JSON.stringify({ type: "subagent.selected", timestamp: "2026-04-14T16:19:02.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T16:20:00.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-14T16:20:30.000Z",
        data: {
          toolTelemetry: {
            restrictedProperties: { agent_name: "Milestone" },
            properties: { model: "gpt-5.4" }
          }
        }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T16:30:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-14T16:52:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.message", timestamp: "2026-04-14T16:53:00.000Z" }),
      JSON.stringify({ type: "hook.end", timestamp: "2026-04-14T16:53:01.000Z" })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    processLogPath,
    [
      `2026-04-14T16:19:00.000Z [INFO] Workspace initialized: ${sessionId}`,
      "2026-04-14T16:53:00.000Z [INFO] npm test passed"
    ].join("\n")
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T16:53:02.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_start_head, startHead);
  assert.equal(summary.session_start_head_source, "git-before-created-at");
  assert.equal(summary.session_end_head, endHead);
  assert.equal(summary.committed_diff_source, "git-head-range");
  assert.equal(summary.summary_authority, "authoritative");
  assert.equal(summary.agent_model_policy_mismatch_observed, true);
  assert.equal(summary.agent_model_policy_mismatch_authority_downgrade, false);
  assert.equal(summary.session_outcome, "success");
  assert.doesNotMatch((summary.summary_authority_reasons as string[]).join("\n"), /model policy/);
});

test("session summary finalizer waits briefly for trailing session shutdown after agentStop hook", async (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-agent-stop-race-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-agent-stop-race";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: terminal hook race",
      "created_at: 2026-04-13T19:00:00.000Z",
      ""
    ].join("\n")
  );
  const preShutdownEvents = [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T19:00:00.000Z" }),
      JSON.stringify({ type: "tool.execution_start", timestamp: "2026-04-13T19:00:01.000Z", data: { toolName: "bash" } }),
      JSON.stringify({ type: "tool.execution_complete", timestamp: "2026-04-13T19:00:02.000Z", data: { toolName: "bash", success: true } }),
      JSON.stringify({
        type: "hook.start",
        timestamp: "2026-04-13T19:00:03.000Z",
        data: {
          hookInvocationId: "hook-agent-stop-race",
          hookType: "agentStop",
          input: { sessionId, cwd: workspaceRoot, transcriptPath, stopReason: "end_turn" }
        }
      }),
      ...Array.from({ length: 13 }, (_, index) =>
        JSON.stringify({
          type: "assistant.message",
          timestamp: `2026-04-13T19:00:03.${String(index + 1).padStart(3, "0")}Z`,
          data: { text: `trailing progress ${index}` }
        })
      )
    ];
  fs.writeFileSync(transcriptPath, `${preShutdownEvents.join("\n")}\n`);

  const child = spawn("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.end(
    JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T19:00:03.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.appendFileSync(
    transcriptPath,
    JSON.stringify({
      type: "session.shutdown",
      timestamp: "2026-04-13T19:00:04.000Z",
      data: {
        shutdownType: "routine",
        codeChanges: {
          linesAdded: 3,
          linesRemoved: 0,
          filesModified: [path.join(workspaceRoot, "app.ts")]
        }
      }
    }) + "\n"
  );

  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_shutdown_observed, true);
  assert.equal(summary.session_shutdown_code_changes_observed, true);
  assert.equal(summary.latest_event_at, "2026-04-13T19:00:04.000Z");
  assert.equal(summary.updated_at, "2026-04-13T19:00:04.000Z");
  assert.equal(summary.route_summary, "Direct Copilot Session");
});

test("session summary finalizer does not downgrade status for non-terminal subagentStop", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-subagent-nonterminal-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-subagent-nonterminal";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: already finalized by root stop",
      "created_at: 2026-04-13T19:30:00.000Z",
      "updated_at: 2026-04-13T19:31:00.000Z",
      "summary_finalization_status: finalized",
      "final_status: completed",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T19:30:00.000Z" }),
      JSON.stringify({
        type: "hook.start",
        timestamp: "2026-04-13T19:31:01.000Z",
        data: {
          hookInvocationId: "hook-subagent-nonterminal",
          hookType: "subagentStop",
          input: { sessionId, cwd: workspaceRoot, transcriptPath }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "subagentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T19:31:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      agentName: "Patch Master",
      agentDisplayName: "Patch Master"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "1"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.final_status, "completed");
  assert.equal(summary.summary_finalization_status, "finalized");
  assert.equal(summary.stop_reason, undefined);
  assert.equal(summary.finalization_complete, true);
});

test("session summary finalizer does not treat child subagentStop as authoritative session completion", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-child-subagent-stop-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-child-subagent-stop";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "inuse.12345.lock"), "");
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Build AtlasField Command",
      "created_at: 2026-04-13T20:00:00.000Z",
      "updated_at: 2026-04-13T20:00:00.000Z",
      "summary_finalization_status: started",
      "final_status: in_progress",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T20:00:00.000Z" }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T20:00:05.000Z", data: { content: "Build AtlasField Command" } }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-13T20:00:20.000Z",
        data: { agentDisplayName: "Milestone", toolCallId: "milestone-plan" }
      }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-13T20:00:40.000Z",
        data: { agentDisplayName: "Triage", toolCallId: "triage-plan" }
      }),
      JSON.stringify({
        type: "hook.start",
        timestamp: "2026-04-13T20:01:00.000Z",
        data: {
          hookInvocationId: "triage-stop-hook",
          hookType: "subagentStop",
          input: {
            sessionId,
            cwd: workspaceRoot,
            transcriptPath,
            agentName: "Triage",
            agentDisplayName: "Triage",
            stopReason: "end_turn"
          }
        }
      }),
      JSON.stringify({
        type: "hook.end",
        timestamp: "2026-04-13T20:01:01.000Z",
        data: { hookInvocationId: "triage-stop-hook", hookType: "subagentStop", success: true }
      }),
      JSON.stringify({
        type: "subagent.completed",
        timestamp: "2026-04-13T20:01:01.000Z",
        data: { agentDisplayName: "Triage", toolCallId: "triage-plan" }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "subagentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T20:01:00.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      agentName: "Triage",
      agentDisplayName: "Triage",
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "0"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_shutdown_observed, false);
  assert.equal(summary.final_status, "in_progress");
  assert.equal(summary.summary_finalization_status, "partial");
  assert.equal(summary.finalization_complete, false);
  assert.equal(summary.finalization_partial, true);
  assert.equal(summary.summary_authority, "partial");
  assert.notEqual(summary.session_outcome, "success");
  assert.equal(summary.repo_code_changed, false);
  assert.equal(summary.committed_repo_changed, false);
  assert.equal(summary.archive_completeness, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /terminal finalization hook/);
});

test("session summary finalizer treats unresolved background planner with no repo changes as incomplete", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-background-planner-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-background-planner";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".xgc"), { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Launch Review Studio",
      "created_at: 2026-04-15T03:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T03:10:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-15T03:10:01.000Z",
        data: {
          content:
            "Build a local-first Launch Review Studio web app with a dashboard, campaign checklist, visual asset board, copy review queue, approval timeline, seeded data, README, validation notes, and tests."
        }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:10:02.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:10:03.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:10:04.000Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T03:10:05.000Z",
        data: {
          text: "Agent started in background\nagent_id: milestone-launch-review-studio\nWaiting for background agents."
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-15T03:10:06.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T03:10:07.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "0"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.background_agent_unresolved_observed, true);
  assert.deepEqual(summary.background_agent_unresolved_ids, ["milestone-launch-review-studio"]);
  assert.equal(summary.patch_master_invocation_count, 0);
  assert.equal(summary.repo_code_changed, false);
  assert.equal(summary.useful_artifacts_observed, false);
  assert.equal(summary.final_status, "in_progress");
  assert.equal(summary.summary_finalization_status, "partial");
  assert.equal(summary.finalization_complete, false);
  assert.equal(summary.finalization_partial, true);
  assert.equal(summary.summary_authority, "partial");
  assert.equal(summary.archive_completeness, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /background agent remained unresolved/);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "large_product_execution_not_started");
});

test("session summary finalizer flags generic read-agent proxy after planner completion", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-generic-reader-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-generic-reader";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".xgc"), { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Launch Review Studio",
      "created_at: 2026-04-15T03:20:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T03:20:00.000Z" }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-15T03:20:01.000Z",
        data: {
          content:
            "Build a local-first Launch Review Studio web app with a dashboard, campaign checklist, visual asset board, copy review queue, approval timeline, seeded data, README, validation notes, and tests."
        }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:20:02.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T03:20:03.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T03:20:04.000Z",
        data: { text: "Agent started in background with agent_id: milestone-launch-review-studio. Track progress with /tasks." }
      }),
      JSON.stringify({
        type: "subagent.completed",
        timestamp: "2026-04-15T03:20:20.000Z",
        data: { agentDisplayName: "Milestone", toolCallId: "milestone-plan" }
      }),
      JSON.stringify({
        type: "system.notification",
        timestamp: "2026-04-15T03:20:21.000Z",
        data: {
          content:
            'Agent "milestone-launch-review-studio" (Milestone) has completed successfully. Use read_agent with agent_id "milestone-launch-review-studio" to retrieve the full results.',
          kind: {
            type: "agent_completed",
            agentId: "milestone-launch-review-studio",
            agentType: "Milestone",
            status: "completed"
          }
        }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-15T03:20:22.000Z",
        data: {
          toolName: "task",
          toolCallId: "generic-reader-task",
          arguments: {
            agent_type: "general-purpose",
            description: "Read Milestone agent result",
            prompt:
              'Use the read_agent tool with agent_id "milestone-launch-review-studio" and return the full result verbatim.'
          }
        }
      }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-15T03:20:23.000Z",
        data: { agentDisplayName: "General Purpose Agent", toolCallId: "generic-reader-task" }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-15T03:20:24.000Z",
        data: {
          toolName: "read_agent",
          parentToolCallId: "generic-reader-task",
          toolCallId: "generic-read-agent",
          arguments: { agent_id: "milestone-launch-review-studio" }
        }
      }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-15T03:20:25.000Z",
        data: {
          toolName: "read_agent",
          parentToolCallId: "generic-reader-task",
          toolCallId: "generic-read-agent",
          result: {
            content:
              "Output too large to read at once (23.6 KB). Saved to: /tmp/1776223251848-copilot-tool-output-48migj.txt",
            detailedContent: "Full response provided to agent"
          }
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-15T03:20:26.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T03:20:26.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "0"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.generic_result_reader_observed, true);
  assert.equal(summary.planner_result_read_proxy_observed, true);
  assert.equal(summary.planner_result_read_output_too_large_observed, true);
  assert.equal(summary.patch_master_invocation_count, 0);
  assert.equal(summary.repo_code_changed, false);
  assert.equal(summary.useful_artifacts_observed, false);
  assert.deepEqual(summary.background_agents_completed, ["milestone-launch-review-studio"]);
  assert.deepEqual(summary.background_agents_read, []);
  assert.equal(summary.background_agent_unresolved_observed, false);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "planner_result_read_proxy_without_execution");
  assert.deepEqual(summary.route_agents, ["Repo Master", "Milestone", "General Purpose Agent"]);
  assert.equal(summary.archive_completeness, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /generic read-agent proxy/);
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /output-too-large/);
});

test("session summary finalizer treats user-aborted failed planning as incomplete and ignores prompt-only foundation commands", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-aborted-planning-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const logsRoot = path.join(profileHome, "logs");
  const sessionId = "session-aborted-planning";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(logsRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(logsRoot, "process-12345.log"),
    [
      `Session ${sessionId}`,
      `Transcript ${transcriptPath}`,
      "Validation commands:",
      "npm install → npx prisma generate → npx prisma db push --force-reset → npm test → npm run build",
      "- npm install",
      "- npx prisma generate",
      "- npx prisma db push --force-reset",
      "- npm test",
      "- npm run build",
      "CAPIError: Request was aborted."
    ].join("\n")
  );
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Build AtlasField Command",
      "created_at: 2026-04-13T20:10:00.000Z",
      "updated_at: 2026-04-13T20:10:00.000Z",
      "summary_finalization_status: started",
      "final_status: in_progress",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T20:10:00.000Z" }),
      JSON.stringify({ type: "user.message", timestamp: "2026-04-13T20:10:05.000Z", data: { content: "Build AtlasField Command\n\nValidation:\n- npm install\n- npm run build" } }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-13T20:10:20.000Z",
        data: { agentDisplayName: "Milestone", toolCallId: "milestone-plan" }
      }),
      JSON.stringify({
        type: "subagent.failed",
        timestamp: "2026-04-13T20:13:42.000Z",
        data: {
          agentDisplayName: "Milestone",
          toolCallId: "milestone-plan",
          error: "Error: Failed to get response from the AI model; Last error: CAPIError: Request was aborted."
        }
      }),
      JSON.stringify({ type: "abort", timestamp: "2026-04-13T20:13:43.000Z", data: { reason: "user initiated" } }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-13T20:14:00.000Z",
        data: {
          shutdownType: "routine",
          currentModel: "claude-sonnet-4.6",
          codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "subagentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T20:13:42.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      agentName: "Milestone",
      agentDisplayName: "Milestone",
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS: "0"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_shutdown_observed, true);
  assert.equal(summary.user_abort_observed, true);
  assert.equal(summary.subagent_failure_observed, true);
  assert.equal(summary.final_status, "stopped");
  assert.equal(summary.summary_finalization_status, "stopped");
  assert.equal(summary.finalization_complete, false);
  assert.equal(summary.finalization_partial, true);
  assert.equal(summary.summary_authority, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /user abort/);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "user_aborted_before_completion");
  assert.deepEqual(summary.foundation_failure_classes, []);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.equal(summary.validation_status, "not-observed");
  assert.equal(summary.repo_code_changed, false);
});

test("session summary finalizer surfaces unresolved background execution and startability failures", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-background-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-background-unresolved";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: integration-class task with background execution",
      "created_at: 2026-04-11T12:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T12:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T12:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T12:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-11T12:03:00.000Z",
        data: {
          text: [
            "Agent started in background with agent_id: asterion-integration-merge. Track progress with /tasks",
            "Error: listen EADDRINUSE: address already in use :::3000",
            "page.goto: net::ERR_CONNECTION_REFUSED"
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-11T12:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T12:04:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.execution_owner, "Patch Master");
  assert.equal(summary.ownership_transferred_to_execution, true);
  assert.equal(summary.background_execution_agent_observed, true);
  assert.equal(summary.background_execution_agent_unresolved, true);
  assert.deepEqual(summary.background_execution_agent_ids, ["asterion-integration-merge"]);
  assert.equal(summary.patch_master_handoff_without_completion_observed, true);
  assert.equal(summary.execution_handoff_without_observed_repo_diff, true);
  assert.equal(summary.execution_claim_without_observed_repo_diff, true);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "background_execution_unresolved_without_repo_changes");
  assert.equal(summary.summary_authority, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /background execution owner remained unresolved/);
  assert.equal(summary.validation_port_conflict_observed, true);
  assert.equal(summary.validation_server_readiness_failure_observed, true);
  assert.equal(summary.foundation_recovery_suggested, true);
  assert.deepEqual(summary.foundation_failure_classes, ["startability-port-conflict"]);
  assert.match(String(summary.foundation_recovery_reason), /port was already in use|repeated foundation failure/);
});

test("session summary finalizer flags completed background execution owner when result was not read", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-unread-owner-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-unread-owner";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('start');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('patched');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "patch"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: unread background owner",
      "created_at: 2026-04-14T06:00:00.000Z",
      `session_start_head: ${startHead}`,
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T06:03:00.000Z",
        data: {
          text: [
            "Agent started in background with agent_id: patch-signalcraft-main. Track progress with /tasks",
            "Background agent `patch-signalcraft-main` completed. Use `read_agent(\"patch-signalcraft-main\")` to retrieve results.",
            "repoWorkingTreeFiles: app.ts"
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:04:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.background_agents_started, ["patch-signalcraft-main"]);
  assert.deepEqual(summary.background_agents_completed, ["patch-signalcraft-main"]);
  assert.deepEqual(summary.background_agents_read, []);
  assert.equal(summary.execution_owner_agent_id, "patch-signalcraft-main");
  assert.equal(summary.execution_owner_result_read, false);
  assert.equal(summary.execution_owner_blocked_observed, false);
  assert.equal(summary.execution_owner, "Patch Master");
  assert.equal(summary.finalized_before_execution_owner_read, true);
  assert.equal(summary.post_execution_completion_gap_observed, true);
  assert.deepEqual(summary.blocking_background_agents_unresolved, ["patch-signalcraft-main"]);
  assert.equal(summary.background_execution_agent_unresolved, true);
  assert.equal(summary.repo_code_changed, true);
  assert.equal(summary.repo_changes_committed, true);
  assert.equal(summary.working_tree_clean, true);
  assert.equal(summary.session_outcome, "partial-success");
  assert.equal(summary.session_outcome_detail, "completed_with_unread_execution_owner_result");
  assert.equal(summary.summary_authority, "finalized_with_gaps");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /result was not read/);
});

test("session summary finalizer does not count failed read_agent attempts as result reads", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-failed-read-agent-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-failed-read-agent";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: failed read agent",
      "created_at: 2026-04-14T06:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:10:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:11:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T06:11:05.000Z",
        data: { text: "Agent started in background with agent_id: patch-failed-read. Track progress with /tasks" }
      }),
      JSON.stringify({
        type: "system.notification",
        timestamp: "2026-04-14T06:12:00.000Z",
        data: {
          content: 'Agent "patch-failed-read" (Patch Master) has completed successfully. Use read_agent with agent_id "patch-failed-read" to retrieve the full results.',
          kind: { type: "agent_completed", agentId: "patch-failed-read", agentType: "Patch Master", status: "completed" }
        }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-14T06:12:01.000Z",
        data: { toolName: "read_agent", toolCallId: "read-failed", arguments: { agent_id: "patch-failed-read" } }
      }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-14T06:12:02.000Z",
        data: {
          toolName: "read_agent",
          toolCallId: "read-failed",
          status: "failed",
          result: { content: "read_agent tool failed: request was aborted" }
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:13:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:13:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.deepEqual(summary.background_agents_completed, ["patch-failed-read"]);
  assert.deepEqual(summary.background_agents_read, []);
  assert.deepEqual(summary.blocking_background_agents_unresolved, ["patch-failed-read"]);
  assert.equal(summary.execution_owner_result_read, false);
  assert.equal(summary.background_execution_agent_unresolved, true);
});

test("session summary finalizer treats blocked visible Patch Master execution as explicit blocker without unresolved background owner", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-blocked-owner-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-blocked-owner";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: blocked background owner",
      "created_at: 2026-04-14T06:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:10:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:11:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T06:12:00.000Z",
        data: {
          text: [
            "Agent started in background with agent_id: patch-signalcraft-main. Track progress with /tasks",
            "Execution status: blocked"
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:13:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:13:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.execution_owner, "Patch Master");
  assert.equal(summary.execution_owner_agent_id, "patch-signalcraft-main");
  assert.equal(summary.execution_owner_blocked_observed, true);
  assert.equal(summary.execution_owner_result_read, false);
  assert.equal(summary.finalized_before_execution_owner_read, false);
  assert.equal(summary.post_execution_completion_gap_observed, false);
  assert.deepEqual(summary.blocking_background_agents_unresolved, []);
  assert.equal(summary.background_execution_agent_unresolved, false);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "execution_owner_blocked");
  assert.equal(summary.summary_authority, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /execution owner reported blocked before finalization/);
});

test("session summary finalizer flags root writes while Patch Master owner is still active", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-active-owner-write-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-active-owner-write";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: active owner write leak",
      "created_at: 2026-04-14T06:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T06:01:30.000Z",
        data: {
          text: "Agent started in background with agent_id: patch-theme-fix. Track progress with /tasks"
        }
      }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-14T06:03:00.000Z",
        data: { toolName: "create", arguments: { path: path.join(workspaceRoot, "theme.js") } }
      }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-14T06:05:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "system.notification",
        timestamp: "2026-04-14T06:05:01.000Z",
        data: { content: 'Agent "patch-theme-fix" (Patch Master) has completed successfully. Use read_agent with agent_id "patch-theme-fix" to retrieve the full results.' }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T06:06:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:06:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.execution_owner_active_root_write_observed, true);
  assert.equal(summary.execution_owner_active_root_write_count, 1);
  assert.equal(summary.post_execution_root_write_observed, false);
  assert.equal(summary.post_execution_ownership_leak_observed, true);
  assert.equal(summary.execution_owner_result_read, false);
  assert.deepEqual(summary.blocking_background_agents_unresolved, ["patch-theme-fix"]);
});

test("session summary finalizer keeps restarted Patch Master root writes in the active-owner bucket", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-active-owner-multipass-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-active-owner-multipass";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: active owner write multipass",
      "created_at: 2026-04-14T06:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T06:30:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:31:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-14T06:32:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T06:33:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "tool.execution_start",
        timestamp: "2026-04-14T06:34:00.000Z",
        data: { toolName: "apply_patch" }
      }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-14T06:35:00.000Z", data: { agentDisplayName: "Patch Master" } })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T06:36:00.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.execution_owner_active_root_write_observed, true);
  assert.equal(summary.execution_owner_active_root_patch_observed, true);
  assert.equal(summary.execution_owner_active_root_write_count, 1);
  assert.equal(summary.post_execution_root_write_observed, false);
  assert.equal(summary.post_execution_root_write_count, 0);
});

test("session summary finalizer does not mark Patch Master handoff incomplete when closure text and repo diff exist", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-patch-closure-diff-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-patch-closure-diff";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('start');\n");
  spawnSync("git", ["add", "app.ts"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "app.ts"), "console.log('patched');\n");

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: patch master closure with diff",
      "created_at: 2026-04-11T13:00:00.000Z",
      `session_start_head: ${startHead}`,
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T13:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T13:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T13:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-11T13:03:00.000Z",
        data: {
          text: "Execution status: ready_for_return\nrepoWorkingTreeFiles: app.ts"
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-11T13:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-11T13:04:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.patch_master_handoff_without_completion_observed, false);
  assert.equal(summary.execution_handoff_without_observed_repo_diff, false);
  assert.equal(summary.repo_code_changed, true);
  assert.equal(summary.session_outcome, "success");
  assert.equal(summary.session_outcome_detail, "completed_with_repo_changes");
});

test("session summary finalizer classifies malformed task payloads outside app foundation", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-malformed-payload-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-malformed-payload";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: malformed task payload",
      "created_at: 2026-04-11T12:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T12:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T12:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T12:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-11T12:03:00.000Z",
        data: { text: "Expected ',' or '}' after property value in JSON at position 128" }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-11T12:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-11T12:04:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.malformed_task_payload_observed, true);
  assert.deepEqual(summary.foundation_failure_classes, ["task-payload"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer reports interactive command and missing built-in agent as runtime tooling", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-runtime-tooling-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-runtime-tooling";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: runtime tooling faults",
      "created_at: 2026-04-14T07:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T07:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T07:01:00.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-14T07:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T07:03:00.000Z",
        data: {
          text: [
            "view /tmp/copilot-tool-output-1776146053604-6kqk30.txt 2>/dev/null || cat",
            "<exited with error: posix_spawn failed: No such file or directory>",
            "Error: Failed to load built-in agent \"task\": Failed to read file",
            "/Users/example/definitions/task.agent.yaml: Error"
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T07:04:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T07:04:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.interactive_command_hang_observed, true);
  assert.ok((summary.interactive_command_hang_commands as string[]).some((command) => command.includes("view /tmp/copilot-tool-output")));
  assert.ok((summary.interactive_command_hang_commands as string[]).some((command) => command.includes("posix_spawn failed")));
  assert.equal(summary.missing_builtin_agent_observed, true);
  assert.deepEqual(summary.missing_builtin_agent_names, ["task"]);
  assert.deepEqual(summary.foundation_failure_classes, ["runtime-tool-execution"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer captures scaffold hang markers from event evidence", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-scaffold-hang-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-scaffold-hang";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: scaffold hang marker",
      "created_at: 2026-04-14T07:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-14T07:30:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-14T07:31:00.000Z",
        data: {
          text: "npm create vite@latest titanforge -- --template react-ts"
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-14T07:32:00.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-14T07:32:01.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.interactive_command_hang_observed, true);
  assert.ok((summary.interactive_command_hang_commands as string[]).some((command) => command.includes("npm create vite@latest")));
  assert.deepEqual(summary.foundation_failure_classes, ["runtime-tool-execution"]);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer detects validation overclaim from raw failure evidence", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-validation-overclaim-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-validation-overclaim";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: validation_exit=0 but raw Playwright output failed",
      "created_at: 2026-04-12T00:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T00:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-12T00:01:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "subagent.completed", timestamp: "2026-04-12T00:02:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-12T00:03:00.000Z",
        data: {
          text: [
            "validation_exit=0",
            "validation_state=done",
            "npx playwright test",
            "1 failed",
            "Error: strict mode violation: getByRole('link', { name: 'Incidents' }) resolved to 2 elements",
            "npm run build",
            "Compiled successfully"
          ].join("\n")
        }
      })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T00:04:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_observed, true);
  assert.equal(summary.validation_status, "failed");
  assert.equal(summary.validation_raw_status, "failed");
  assert.equal(summary.validation_overclaim_observed, true);
  assert.match((summary.validation_command_failures as string[]).join("\n"), /strict mode violation/);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "execution_handoff_without_repo_changes");
  assert.equal(summary.archive_completeness, "partial");
});

test("session summary finalizer lets repo-owned validation logs recover earlier raw failures", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-validation-artifact-recovery-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-validation-artifact-recovery";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const validationRoot = path.join(workspaceRoot, ".xgc", "validation", "cycle-02-sonnet46");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(validationRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: raw failures recovered by repo-owned validation logs",
      "created_at: 2026-04-12T01:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T01:00:00.000Z" }),
      JSON.stringify({ type: "assistant.message", timestamp: "2026-04-12T01:01:00.000Z", data: { text: [
        "validation_exit=0",
        "validation_state=done",
        "npx playwright test",
        "1 failed",
        "Error: strict mode violation: getByRole('link', { name: 'Incidents' }) resolved to 2 elements",
        "prisma db push",
        "Error: Command failed with exit code 1",
        "npm run build",
        "Error: build failed"
      ].join("\n") } })
    ].join("\n") + "\n"
  );
  const artifactFiles = [
    ["prisma.log", ["prisma generate", "## END prisma generate exit=0"].join("\n")],
    ["build.log", ["npm run build", "## END npm run build exit=0"].join("\n")],
    ["playwright.log", ["npx playwright test", "## END npx playwright test exit=0"].join("\n")]
  ] as const;
  artifactFiles.forEach(([fileName, contents], index) => {
    const filePath = path.join(validationRoot, fileName);
    fs.writeFileSync(filePath, contents + "\n");
    const timestamp = new Date(Date.parse("2026-04-12T01:10:00.000Z") + index * 1000);
    fs.utimesSync(filePath, timestamp, timestamp);
  });

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T01:11:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_observed, true);
  assert.equal(summary.validation_status, "passed");
  assert.equal(summary.validation_raw_status, "failed");
  assert.equal(summary.validation_overclaim_observed, false);
  assert.deepEqual(summary.validation_command_failures, []);
  assert.match((summary.validation_recovered_command_failures as string[]).join("\n"), /strict mode violation|build failed|exit code 1/);
  assert.equal(summary.validation_recovered_after_failures_observed, true);
  assert.equal(summary.validation_recovery_source, "validation-log-exit-codes");
  assert.equal(summary.session_outcome, "success");
  assert.equal(summary.session_outcome_detail, "completed_without_repo_changes");
});

test("session summary finalizer treats checkmarked final validation as recovery despite retrospective failure notes", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-retrospective-validation-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-retrospective-validation";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: final validation passed after earlier command failures",
      "created_at: 2026-04-12T02:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T02:00:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-12T02:01:00.000Z",
        data: {
          text: [
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
        }
      })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T02:02:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_observed, true);
  assert.equal(summary.validation_status, "passed");
  assert.equal(summary.validation_raw_status, "failed");
  assert.equal(summary.validation_overclaim_observed, false);
  assert.deepEqual(summary.validation_command_failures, []);
  assert.equal(summary.validation_recovered_after_failures_observed, true);
  assert.equal(summary.validation_recovery_source, "raw-later-validation-pass");
  assert.match((summary.validation_recovered_command_failures as string[]).join("\n"), /Schema engine error|Playwright Test/);
});

test("session summary finalizer clears recovered browser smoke from active app foundation failures", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-recovered-browser-smoke-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-recovered-browser-smoke";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: browser smoke recovered",
      "created_at: 2026-04-12T02:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T02:30:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-12T02:31:00.000Z",
        data: {
          text: [
            "npx playwright test",
            "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/",
            "Error: browser smoke failed because the rendered page was blank",
            "npm test",
            "Error: validation harness strict mode violation",
            "Validation results:",
            "1. npm install ✅",
            "2. npm test ✅",
            "3. npm run build ✅",
            "4. npx playwright test ✅",
            "npx playwright test",
            "1 passed (4.1s)"
          ].join("\n")
        }
      })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T02:32:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_status, "passed");
  assert.equal(summary.validation_raw_status, "failed");
  assert.equal(summary.validation_recovered_after_failures_observed, true);
  assert.deepEqual(summary.recovered_foundation_failure_classes, ["browser-smoke", "startability", "validation-harness"]);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.deepEqual(summary.foundation_failure_classes, []);
});

test("session summary finalizer ignores validation command lists in prompts and handoffs when no validation ran", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-validation-prompt-only-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-validation-prompt-only";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: planning-only handoff that lists validation commands",
      "created_at: 2026-04-15T09:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T09:00:00.000Z" }),
      JSON.stringify({
        type: "prompt.submitted",
        timestamp: "2026-04-15T09:00:01.000Z",
        data: {
          prompt: [
            "Build the product and, when ready, run these validation commands:",
            "npm install",
            "npx prisma generate",
            "npx prisma db push --force-reset",
            "seed command",
            "npm run lint if available",
            "npm test",
            "npm run build",
            "npx playwright test"
          ].join("\n")
        }
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T09:00:02.000Z",
        data: {
          text: [
            "Handoff acknowledged.",
            "Next steps: npm install, npx prisma generate, npx prisma db push --force-reset, seed command, npm run lint if available, npm test, npm run build, npx playwright test."
          ].join("\n")
        }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-15T09:00:03.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T09:00:04.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_observed, false);
  assert.equal(summary.validation_status, "not-observed");
  assert.equal(summary.validation_raw_status, "not-observed");
  assert.deepEqual(summary.validation_command_failures, []);
  assert.deepEqual(summary.foundation_failure_classes, []);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer ignores planning prose as validation, foundation, and tooling evidence", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-planning-prose-noise-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-planning-prose-noise";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: planning-only handoff with acceptance prose",
      "created_at: 2026-04-15T09:10:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T09:10:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T09:10:10.000Z", data: { agentDisplayName: "Repo Master" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T09:10:20.000Z", data: { agentDisplayName: "Milestone" } }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-15T09:10:30.000Z", data: { agentDisplayName: "Triage" } }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T09:10:40.000Z",
        data: {
          text: [
            "7. **Many-to-many relations**: review /tmp notes in the schema plan before Patch Master starts.",
            "**Acceptance:** Seed completes without error. 4 Users, 3 Orgs, 6 Projects, 30 Activities all queryable via `npx prisma studio` or inline query. ✅",
            "Next steps: npm install, npx prisma generate, npx prisma db push --force-reset, seed command, npm test, npm run build, npx playwright test.",
            "Confirmed: Playwright requires `npx playwright install chromium` before `npx playwright test` or it errors with \"browser not found.\" This step is not in `package.json` scripts.",
            "Risk: if the dev server did not become ready, record a blocker instead of retrying forever.",
            "Plan: malformed JSON payload examples should be documented, not treated as a live task payload failure.",
            '2026-04-15T03:13:01Z sessionStart {"sessionId":"abc","cwd":"/tmp/product-retry","initialPrompt":"Build a local-first app with tests"}',
            '2026-04-15T03:13:52Z agentStop {"sessionId":"abc","cwd":"/tmp/product-retry","stopReason":"end_turn"}',
            "npm info next-auth versions --json 2>/dev/null | node -e \"const v=JSON.parse(process.argv[1]); console.log(v.length)\"",
            "const id = params.id  // runtime warning / type error in Next.js 15"
          ].join("\n")
        }
      }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-04-15T09:10:50.000Z",
        data: {
          shutdownType: "routine",
          currentModel: "claude-sonnet-4.6",
          codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] }
        }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T09:10:55.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.session_shutdown_observed, true);
  assert.equal(summary.validation_observed, false);
  assert.equal(summary.validation_status, "not-observed");
  assert.deepEqual(summary.validation_command_failures, []);
  assert.equal(summary.interactive_command_hang_observed, false);
  assert.deepEqual(summary.interactive_command_hang_commands, []);
  assert.equal(summary.malformed_task_payload_observed, false);
  assert.deepEqual(summary.foundation_failure_classes, []);
  assert.equal(summary.foundation_risk_raised, false);
  assert.equal(summary.app_foundation_failure_observed, false);
});

test("session summary finalizer marks large product planning-only completion as incomplete", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-large-product-no-exec-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-large-product-no-exec";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: Build AtlasField Command",
      "created_at: 2026-04-15T10:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T10:00:00.000Z" }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-15T10:00:01.000Z",
        data: { previousModel: "gpt-5-mini", newModel: "gpt-5.4" }
      }),
      JSON.stringify({
        type: "session.model_change",
        timestamp: "2026-04-15T10:00:02.000Z",
        data: { previousModel: "gpt-5.4", newModel: "claude-sonnet-4.6" }
      }),
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-04-15T10:00:03.000Z",
        data: {
          content: [
            "Build a complex local-first SaaS product workspace with dashboard, projects, grants, field operations, risk register, evidence library, briefing builder, readiness board, activity notifications, responsive UI, UX polish, docs, README, tests, and architecture notes.",
            "Commit the completed product."
          ].join("\n")
        }
      }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-15T10:00:10.000Z",
        data: { agentDisplayName: "Milestone", toolCallId: "milestone-plan" }
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T10:00:11.000Z",
        data: { text: "Agent started in background with agent_id: milestone-plan. You can use /tasks to manage the background agent." }
      }),
      JSON.stringify({
        type: "subagent.started",
        timestamp: "2026-04-15T10:00:20.000Z",
        data: { agentDisplayName: "Triage", toolCallId: "triage-plan" }
      }),
      JSON.stringify({
        type: "subagent.completed",
        timestamp: "2026-04-15T10:00:30.000Z",
        data: { agentDisplayName: "Triage", toolCallId: "triage-plan" }
      }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-15T10:00:31.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T10:00:32.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.large_product_build_task_observed, true);
  assert.equal(summary.patch_master_invocation_count, 0);
  assert.equal(summary.repo_code_changed, false);
  assert.equal(summary.useful_artifacts_observed, false);
  assert.equal(summary.session_outcome, "incomplete");
  assert.equal(summary.session_outcome_detail, "large_product_execution_not_started");
  assert.equal(summary.final_status, "in_progress");
  assert.equal(summary.summary_finalization_status, "partial");
  assert.equal(summary.summary_authority, "partial");
  assert.equal(summary.archive_completeness, "partial");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /no Patch Master execution owner/);
  assert.equal(summary.background_agent_unresolved_observed, true);
  assert.deepEqual(summary.background_agent_unresolved_ids, ["milestone-plan"]);
  assert.equal(summary.requested_runtime_model, "claude-sonnet-4.6");
  assert.deepEqual(summary.observed_runtime_models, ["gpt-5.4", "claude-sonnet-4.6"]);
  assert.deepEqual(summary.post_prompt_observed_runtime_models, []);
  assert.equal(summary.mixed_model_session_observed, false);
  assert.equal(summary.non_requested_model_usage_observed, false);
  assert.equal(summary.model_identity_mismatch_observed, false);
});

test("session summary finalizer prefers executed validation output over assistant tool-request debug text", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-executed-validation-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const sessionId = "session-executed-validation-wins";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [`id: ${sessionId}`, `cwd: ${workspaceRoot}`, `git_root: ${workspaceRoot}`, "created_at: 2026-04-15T10:00:00.000Z", ""].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-15T10:00:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T10:02:00.000Z",
        data: {
          toolRequests: [{ description: "Debug Prisma db push failure" }],
          reasoningText: "I'm searching for potential causes of the schema engine error..."
        }
      }),
      JSON.stringify({
        type: "tool.execution_complete",
        timestamp: "2026-04-15T10:20:00.000Z",
        data: {
          result: {
            content: ["npm test", "Test Files 5 passed", "npm run build", "Compiled successfully", "npx playwright test", "1 passed"].join("\n")
          }
        }
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-15T10:21:00.000Z",
        data: { content: "All required validation commands passed." }
      }),
      JSON.stringify({ type: "hook.end", timestamp: "2026-04-15T10:21:01.000Z" })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-15T10:21:02.000Z"),
      cwd: workspaceRoot,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.validation_observed, true);
  assert.equal(summary.validation_status, "passed");
  assert.deepEqual(summary.validation_command_failures, []);
  assert.equal(summary.validation_overclaim_observed, false);
});

test("session summary finalizer treats transient 429 and 502 process-log evidence as recoverable", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-provider-recovered-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-provider-recovered";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const logDir = path.join(profileHome, "logs");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-12T01:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T01:00:00.000Z" }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-12T01:01:00.000Z" })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    path.join(logDir, "process-1.log"),
    [
      `2026-04-12T01:00:05.000Z [INFO] session ${sessionId}`,
      '2026-04-12T01:00:10.000Z [ERROR] {"code":"user_model_rate_limited","status":429}',
      '2026-04-12T01:00:11.000Z [ERROR] {"status":502,"message":"GitHub Unicorn Bad Gateway"}',
      "2026-04-12T01:00:12.000Z [INFO] --- End of group ---"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T01:01:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.provider_retry_observed, true);
  assert.equal(summary.provider_retry_state, "recovered-after-retry");
  assert.equal(summary.provider_retry_count, 2);
  assert.equal(summary.model_rate_limit_observed, true);
  assert.equal(summary.model_rate_limit_count, 1);
  assert.equal(summary.provider_502_observed, true);
  assert.equal(summary.provider_502_count, 1);
});

test("session summary finalizer treats write EPIPE as runtime transport noise", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-runtime-transport-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-runtime-transport";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");
  const logDir = path.join(profileHome, "logs");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "created_at: 2026-04-12T01:30:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-12T01:30:00.000Z" }),
      JSON.stringify({ type: "assistant.turn_end", timestamp: "2026-04-12T01:31:00.000Z" })
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    path.join(logDir, "process-runtime-transport.log"),
    [
      `2026-04-12T01:30:05.000Z [INFO] session ${sessionId}`,
      "2026-04-12T01:30:10.000Z [ERROR] Error: write EPIPE"
    ].join("\n")
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-12T01:31:01.000Z"),
    cwd: workspaceRoot,
    transcriptPath,
    stopReason: "end_turn"
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.bootstrap_failure_observed, true);
  assert.equal(summary.app_foundation_failure_observed, false);
  assert.deepEqual(summary.foundation_failure_classes, ["runtime-transport"]);
});

test("session summary finalizer marks error runs with useful committed artifacts as partial success", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-error-artifacts-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-error-artifacts";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: workspaceRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(workspaceRoot, "schema.prisma"), "model A { id String @id }\n");
  spawnSync("git", ["add", "schema.prisma"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: workspaceRoot, stdio: "ignore" });
  const startHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(workspaceRoot, "schema.prisma"), "model A { id String @id name String }\n");
  spawnSync("git", ["add", "schema.prisma"], { cwd: workspaceRoot, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "schema change"], { cwd: workspaceRoot, stdio: "ignore" });

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: foundation readiness: unknown",
      "created_at: 2026-04-11T11:00:00.000Z",
      `session_start_head: ${startHead}`,
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T11:00:00.000Z" }),
      JSON.stringify({ type: "subagent.started", timestamp: "2026-04-11T11:01:00.000Z", data: { agentDisplayName: "Patch Master" } }),
      JSON.stringify({ type: "assistant.message", timestamp: "2026-04-11T11:02:00.000Z", data: { text: "npx prisma db push failed with schema error\nretrying prisma db push failed with schema error" } })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T11:03:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "errorOccurred"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.final_status, "error");
  assert.equal(summary.summary_finalization_status, "error");
  assert.equal(summary.finalization_error, true);
  assert.equal(summary.summary_authority, "finalized_with_gaps");
  assert.match((summary.summary_authority_reasons as string[]).join("\n"), /useful repo\/session evidence was recovered/);
  assert.equal(summary.archive_completeness, "partial");
  assert.match((summary.archive_completeness_reasons as string[]).join("\n"), /terminal error hook was observed/);
  assert.equal(summary.session_outcome, "partial-success");
  assert.equal(summary.session_outcome_detail, "failure_with_useful_artifacts");
  assert.equal(summary.repo_code_changed, true);
  assert.deepEqual(summary.useful_session_state_files, []);
  assert.deepEqual(summary.committed_repo_files, ["schema.prisma"]);
  assert.equal(summary.repeated_foundation_failure_observed, true);
  assert.equal(summary.foundation_recovery_suggested, true);
  assert.deepEqual(summary.foundation_failure_classes, ["schema-db"]);
  assert.match(String(summary.foundation_recovery_reason), /schema-db/);
});

test("session summary finalizer does not treat baseline session metadata as useful artifacts", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-session-summary-baseline-only-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const profileHome = path.join(tempRoot, ".copilot-xgc");
  const configHome = path.join(tempRoot, ".config", "xgc");
  const sessionId = "session-baseline-only";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYaml = path.join(sessionDir, "workspace.yaml");

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });

  fs.writeFileSync(
    workspaceYaml,
    [
      `id: ${sessionId}`,
      `cwd: ${workspaceRoot}`,
      `git_root: ${workspaceRoot}`,
      "summary: failed before producing artifacts",
      "created_at: 2026-04-11T12:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-11T12:00:00.000Z" }),
      JSON.stringify({ type: "assistant.message", timestamp: "2026-04-11T12:01:00.000Z", data: { text: "command failed before artifacts" } })
    ].join("\n") + "\n"
  );

  const payload = JSON.stringify({
    sessionId,
    timestamp: Date.parse("2026-04-11T12:02:00.000Z"),
    cwd: workspaceRoot,
    transcriptPath
  });

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "errorOccurred"], {
    encoding: "utf8",
    input: payload,
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome,
      XGC_COPILOT_CONFIG_HOME: configHome
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const summary = parseWorkspaceYaml(workspaceYaml);
  assert.equal(summary.final_status, "error");
  assert.equal(summary.repo_code_changed, false);
  assert.deepEqual(summary.validation_artifact_files, []);
  assert.deepEqual(summary.useful_session_state_files, []);
  assert.equal(summary.useful_artifacts_observed, false);
  assert.equal(summary.session_outcome, "failure");
  assert.equal(summary.session_outcome_detail, "terminal_error_without_useful_artifacts");
});
