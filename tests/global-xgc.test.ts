import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  effectiveCopilotReasoningEffort,
  materializeGlobalProfile,
  resolveGlobalPaths,
  writeGlobalInstallState,
  writeGlobalShellEnv
} from "../scripts/lib/global-xgc.js";
import { resolveAgentModelPolicy } from "../scripts/lib/model-policy.js";
import {
  commandUsesUnsafeWorkspaceHookPath,
  findLegacyHookPluginConflicts,
  validateHookManifestTruth
} from "../scripts/lib/hook-path-truth.js";
import { repairRawCopilotHookConflicts } from "../scripts/repair-raw-copilot-hooks.js";
import { repoRoot } from "./helpers.js";

const sanitizedXgcEnvPrelude = [
  "unset XGC_COPILOT_PROFILE_HOME",
  "unset XGC_COPILOT_CONFIG_HOME",
  "unset COPILOT_HOME",
  "unset XGC_RUNTIME_HOME",
  "unset XGC_PROFILE_ENV_FILE",
  "unset XGC_ENV_FILE",
  "unset XGC_SESSION_ENV_FILE",
  "unset XGC_HOOK_SCRIPT_ROOT",
  "unset XGC_PERMISSION_MODE",
  "unset XGC_REASONING_EFFORT",
  "unset XGC_REASONING_EFFORT_CAP"
].join("; ");

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function createFakeRawCopilot(tempRoot: string) {
  const rawPath = path.join(tempRoot, "copilot-raw");
  fs.writeFileSync(
    rawPath,
    [
      "#!/usr/bin/env bash",
      "python3 - \"$@\" <<'PY'",
      "import json, os, sys",
      "print(json.dumps({\"argv\": sys.argv[1:], \"copilotHome\": os.environ.get(\"COPILOT_HOME\"), \"sessionSecret\": os.environ.get(\"XGC_SESSION_TEST_SECRET\"), \"pathEnv\": os.environ.get(\"PATH\")}))",
      "PY"
    ].join("\n")
  );
  fs.chmodSync(rawPath, 0o755);
  return rawPath;
}

function createFakeShutdownRawCopilot(tempRoot: string) {
  const rawPath = path.join(tempRoot, "copilot-shutdown-raw");
  fs.writeFileSync(
    rawPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "session_id=\"${XGC_FAKE_SESSION_ID:-session-shell-shutdown-recovery}\"",
      "session_dir=\"${COPILOT_HOME:?}/session-state/${session_id}\"",
      "mkdir -p \"$session_dir\"",
      "python3 - \"$session_dir\" \"$PWD\" \"$session_id\" \"$@\" <<'PY'",
      "import json, os, pathlib, sys",
      "from datetime import datetime, timedelta, timezone",
      "session_dir = pathlib.Path(sys.argv[1])",
      "cwd = sys.argv[2]",
      "session_id = sys.argv[3]",
      "argv = sys.argv[4:]",
      "shutdown_at = datetime.now(timezone.utc)",
      "turn_at = shutdown_at - timedelta(seconds=3)",
      "started_at = shutdown_at - timedelta(seconds=240)",
      "def iso(value): return value.isoformat().replace('+00:00', 'Z')",
      "workspace_yaml = session_dir / 'workspace.yaml'",
      "events_path = session_dir / 'events.jsonl'",
      "final_status = os.environ.get('XGC_FAKE_WORKSPACE_FINAL_STATUS', 'in_progress')",
      "summary_status = os.environ.get('XGC_FAKE_SUMMARY_FINALIZATION_STATUS', 'started')",
      "workspace_yaml.write_text('\\n'.join([",
      "    f'id: {session_id}',",
      "    f'cwd: {json.dumps(cwd)}',",
      "    f'git_root: {json.dumps(cwd)}',",
      "    'summary: shell shutdown recovery',",
      "    f'created_at: {iso(started_at)}',",
      "    f'updated_at: {iso(started_at)}',",
      "    f'summary_finalization_status: {summary_status}',",
      "    f'final_status: {final_status}',",
      "    'session_shutdown_observed: false',",
      "    ''",
      "]) + '\\n', encoding='utf-8')",
      "events = [",
      "    {'type': 'session.start', 'timestamp': iso(started_at), 'data': {'cwd': cwd}},",
      "    {'type': 'assistant.turn_start', 'timestamp': iso(turn_at), 'data': {'turn': 6}},",
      "    {'type': 'session.shutdown', 'timestamp': iso(shutdown_at), 'data': {'shutdownType': 'routine', 'currentModel': 'claude-sonnet-4.6', 'codeChanges': {'linesAdded': 0, 'linesRemoved': 0, 'filesModified': []}}},",
      "]",
      "events_path.write_text('\\n'.join(json.dumps(event) for event in events) + '\\n', encoding='utf-8')",
      "print(json.dumps({'argv': argv, 'copilotHome': os.environ.get('COPILOT_HOME'), 'sessionId': session_id}))",
      "PY"
    ].join("\n")
  );
  fs.chmodSync(rawPath, 0o755);
  return rawPath;
}

function createFakePreflightCopilot(tempRoot: string) {
  const rawPath = path.join(tempRoot, "copilot-preflight-raw");
  fs.writeFileSync(
    rawPath,
    [
      "#!/usr/bin/env bash",
      "case \"${XGC_FAKE_COPILOT_MODE:-ok}\" in",
      "  auth)",
      "    echo 'Authorization error, you may need to run /login' >&2",
      "    exit 1",
      "    ;;",
      "  model)",
      "    echo 'Unable to load available models list' >&2",
      "    exit 1",
      "    ;;",
      "  policy)",
      "    echo 'Error: Access denied by policy settings' >&2",
      "    echo 'Your Copilot CLI policy setting may be preventing access.' >&2",
      "    exit 1",
      "    ;;",
      "esac",
      "echo XGC_PREFLIGHT_OK"
    ].join("\n")
  );
  fs.chmodSync(rawPath, 0o755);
  return rawPath;
}

function parseFlatYaml(filePath: string) {
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

function sourceShimAndRun(opts: {
  tempHome: string;
  rawBin: string;
  fnCall: string;
  disableProbeCache?: boolean;
  cwd?: string;
}) {
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${opts.tempHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${opts.rawBin.replace(/'/g, `'\\''`)}'`,
        `export XGC_DISABLE_PROBE_CACHE='${opts.disableProbeCache === false ? "0" : "1"}'`,
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        opts.fnCall
      ].join("; ")
    ],
    {
      encoding: "utf8",
      cwd: opts.cwd
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /command not found: inject_default_agent/);
  return JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null };
}

function sourceShimAndRunRaw(opts: {
  tempHome: string;
  rawBin: string;
  fnCall: string;
  extraEnv?: Record<string, string>;
  cwd?: string;
}) {
  return spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(opts.tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(opts.rawBin)}`,
        `export XGC_DISABLE_PROBE_CACHE='1'`,
        ...Object.entries(opts.extraEnv ?? {}).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        opts.fnCall
      ].join("; ")
    ],
    { encoding: "utf8", cwd: opts.cwd }
  );
}

const injectedContextFlags = new Set([
  "--disable-builtin-mcps",
  "--disable-mcp-server=github-mcp-server",
  "--no-experimental"
]);

function isInjectedPermissionFlag(entry: string) {
  return (
    entry === "--allow-all" ||
    entry === "--allow-all-tools" ||
    entry === "--allow-all-paths" ||
    entry === "--allow-all-urls" ||
    entry.startsWith("--allow-tool=") ||
    entry.startsWith("--deny-tool=") ||
    entry.startsWith("--allow-url=") ||
    entry.startsWith("--deny-url=")
  );
}

function isInjectedReasoningEffortFlag(entry: string) {
  return entry.startsWith("--reasoning-effort=");
}

function withoutInjectedFlags(argv: string[]) {
  return argv.filter((entry) => !injectedContextFlags.has(entry) && !isInjectedPermissionFlag(entry) && !isInjectedReasoningEffortFlag(entry));
}

function frontmatterModel(filePath: string) {
  const match = fs.readFileSync(filePath, "utf8").match(/^model:\s*(.+)$/m);
  const value = match?.[1].trim();
  if (!value) return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

function createMinimalRepoFixture() {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-repo-"));
  fs.cpSync(path.join(repoRoot, "source"), path.join(tempRepo, "source"), { recursive: true });
  fs.cpSync(path.join(repoRoot, ".github"), path.join(tempRepo, ".github"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "skills"), path.join(tempRepo, "skills"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "hooks"), path.join(tempRepo, "hooks"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "runtime-dist"), path.join(tempRepo, "runtime-dist"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "scripts", "hooks"), path.join(tempRepo, "scripts", "hooks"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "xgc-shell.sh"), path.join(tempRepo, "scripts", "xgc-shell.sh"));
  fs.copyFileSync(path.join(repoRoot, "scripts", "xgc-update.mjs"), path.join(tempRepo, "scripts", "xgc-update.mjs"));
  fs.copyFileSync(path.join(repoRoot, "lsp.json"), path.join(tempRepo, "lsp.json"));
  return tempRepo;
}

function createGitHubRemoteWorkspace(ownerRepo = "example/xgc") {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-github-workspace-"));
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", `https://github.com/${ownerRepo}.git`], {
    cwd: workspace,
    stdio: "ignore"
  });
  return workspace;
}

function packageVersion() {
  return (JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
}

type HookManifest = {
  hooks?: Record<string, Array<{ type?: string; bash?: string }>>;
};

function collectHookCommands(manifestPath: string) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as HookManifest;
  const commands: Array<{ hookName: string; command: string }> = [];
  for (const [hookName, handlers] of Object.entries(manifest.hooks ?? {})) {
    for (const handler of handlers) {
      if (handler.type === "command" && typeof handler.bash === "string") {
        commands.push({ hookName, command: handler.bash });
      }
    }
  }
  return commands;
}

function runHookCommand(
  command: string,
  opts: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: string } = { cwd: process.cwd() }
) {
  return spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env,
    input: opts.stdin ?? "{}"
  });
}

test("materializeGlobalProfile creates a dedicated XGC profile with user-level agents and skills", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-home-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  fs.mkdirSync(rawCopilotHome, { recursive: true });
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        model: "gpt-4.1",
        logged_in_users: [{ host: "https://github.com", login: "example" }],
        trusted_folders: ["/tmp/existing"]
      },
      null,
      2
    )
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  assert.ok(fs.existsSync(result.paths.profileHome));
  assert.ok(fs.existsSync(result.paths.profileAgentsDir));
  assert.ok(fs.existsSync(result.paths.profileSkillsDir));
  assert.ok(fs.existsSync(result.paths.profileHookScriptsDir));
  assert.equal(
    fs.readFileSync(result.paths.shellShimPath, "utf8"),
    fs.readFileSync(path.join(tempRepo, "scripts", "xgc-shell.sh"), "utf8")
  );
  assert.equal(
    fs.readFileSync(result.paths.updaterScriptPath, "utf8"),
    fs.readFileSync(path.join(tempRepo, "runtime-dist", "xgc-update.mjs"), "utf8")
  );
  assert.ok(fs.existsSync(result.configPath));
  assert.ok(fs.existsSync(result.mcpConfigPath));
  assert.ok(fs.existsSync(result.lspConfigPath));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "session-start.sh")));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "common.sh")));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "pre-tool-use.sh")));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "agent-stop.sh")));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "subagent-stop.sh")));
  assert.ok(fs.existsSync(path.join(result.paths.profileHookScriptsDir, "error-occurred.sh")));
  assert.ok(result.copiedAgents.includes("repo-master.agent.md"));
  assert.ok(result.copiedAgents.includes("ref-index.agent.md"));
  assert.ok(result.copiedAgents.includes("visual-forge.agent.md"));
  assert.ok(result.copiedAgents.includes("writing-desk.agent.md"));
  assert.ok(result.copiedAgents.includes("multimodal-look.agent.md"));
  assert.ok(result.copiedAgents.includes("artistry-studio.agent.md"));
  assert.ok(result.copiedSkills.includes("review-work/SKILL.md"));
  assert.equal(result.rootModel, "claude-sonnet-4.6");

  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
    model?: string;
    effortLevel?: string;
    logged_in_users?: unknown[];
    trusted_folders?: string[];
    custom_agents?: { default_local_only?: boolean };
    installedPlugins?: unknown[];
    installed_plugins?: unknown[];
  };
  assert.equal(profileConfig.model, undefined);
  assert.equal(profileConfig.effortLevel, "high");
  assert.equal(Array.isArray(profileConfig.logged_in_users), true);
  assert.equal(profileConfig.custom_agents?.default_local_only, true);
  assert.ok(profileConfig.trusted_folders?.includes(tempRepo));
  assert.equal("installedPlugins" in profileConfig, false);
  assert.equal("installed_plugins" in profileConfig, false);

  const lspConfig = JSON.parse(fs.readFileSync(result.lspConfigPath, "utf8")) as {
    lspServers?: Record<string, unknown>;
  };
  assert.ok(lspConfig.lspServers && typeof lspConfig.lspServers === "object");
  for (const agentId of ["repo-master", "milestone", "repo-scout", "ref-index", "visual-forge", "writing-desk", "multimodal-look", "artistry-studio"]) {
    const contentPath = path.join(result.paths.profileAgentsDir, `${agentId}.agent.md`);
    const expectedModel: string | null = agentId === "repo-master" ? null : resolveAgentModelPolicy({ agentId, rootModel: result.rootModel });
    assert.equal(frontmatterModel(contentPath), expectedModel);
    assert.doesNotMatch(fs.readFileSync(contentPath, "utf8"), /^modelPolicy:/m);
  }
});

test("materialized hook common keeps detached watcher spawn without nohup shell-job fallback", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-hook-common-detach-"));
  const tempRepo = createMinimalRepoFixture();
  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const commonPath = path.join(result.paths.profileHookScriptsDir, "common.sh");
  const commonText = fs.readFileSync(commonPath, "utf8");

  assert.match(commonText, /start_new_session=True/);
  assert.doesNotMatch(commonText, /nohup\s+bash/);
});

test("writeGlobalInstallState records update track and policy metadata", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-install-state-"));
  const paths = resolveGlobalPaths(tempHome);

  writeGlobalInstallState({
    paths,
    repoRoot,
    rawCopilotBin: null,
    permissionMode: "work"
  });

  const installState = JSON.parse(fs.readFileSync(paths.installStatePath, "utf8")) as Record<string, unknown>;
  const [major, minor] = packageVersion().split(".");
  assert.equal(installState.version, packageVersion());
  assert.equal(installState.releaseTag, `v${packageVersion()}`);
  assert.equal(installState.updateTrack, `${major}.${minor}`);
  assert.equal(installState.updatePolicy, "patch-within-track");
  assert.equal(installState.autoUpdateMode, "check");
  assert.equal(installState.permissionMode, "work");
  assert.equal(installState.reasoningEffort, "xhigh");
  assert.equal(installState.reasoningEffortCap, "high");
  assert.equal(installState.runtimeHome, paths.runtimeHome);
  assert.equal(installState.runtimeCurrentPath, paths.runtimeCurrentPath);
  assert.equal(installState.runtimeCurrentBinPath, paths.runtimeCurrentBinPath);
});

test("effective reasoning effort applies account cap before model support", () => {
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "claude-sonnet-4.6"), "high");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "google/gemini-3.1-pro"), "high");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "gpt-4.1"), "high");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "gpt-5.4"), "high");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "gpt-5.4", "xhigh"), "xhigh");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "gpt-5.4-mini", "xhigh"), "xhigh");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "claude-sonnet-4.6", "xhigh"), "high");
  assert.equal(effectiveCopilotReasoningEffort("xhigh", "gpt-5.4", "medium"), "medium");
  assert.equal(effectiveCopilotReasoningEffort("high", "gpt-5.4"), "high");
  assert.equal(effectiveCopilotReasoningEffort("off", "gpt-5.4"), null);
});

test("writeGlobalShellEnv preserves an existing raw Copilot binary when re-materialized without an explicit raw path", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-preserve-raw-bin-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const paths = resolveGlobalPaths(tempHome);

  writeGlobalShellEnv({ paths, rawCopilotBin: rawBin, permissionMode: "work" });
  writeGlobalShellEnv({ paths, rawCopilotBin: null, permissionMode: "ask" });

  const profileEnv = fs.readFileSync(paths.shellEnvPath, "utf8");
  assert.match(profileEnv, new RegExp(`XGC_RUNTIME_HOME=${shellQuote(paths.runtimeCurrentPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(profileEnv, /XGC_PERMISSION_MODE='ask'/);
  assert.match(profileEnv, /XGC_REASONING_EFFORT='xhigh'/);
  assert.match(profileEnv, /XGC_REASONING_EFFORT_CAP='high'/);
  assert.match(profileEnv, /XGC_AUTO_UPDATE_MODE='check'/);
  assert.match(profileEnv, new RegExp(`XGC_COPILOT_RAW_BIN=${shellQuote(rawBin).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("xgc management subcommands dispatch to the installed runtime CLI", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-runtime-cli-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const runtimeHome = path.join(tempHome, ".local", "share", "xgc", "current");
  const runtimeBin = path.join(runtimeHome, "bin");
  const capturePath = path.join(tempHome, "runtime-cli-call.json");
  fs.mkdirSync(runtimeBin, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeBin, "xgc.mjs"),
    [
      "#!/usr/bin/env node",
      "import fs from 'node:fs';",
      "const payload = { argv: process.argv.slice(2), cwd: process.cwd() };",
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(payload));`,
      "process.stdout.write(JSON.stringify(payload));"
    ].join("\n")
  );
  fs.chmodSync(path.join(runtimeBin, "xgc.mjs"), 0o755);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        `export XGC_RUNTIME_HOME=${shellQuote(runtimeHome)}`,
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "xgc doctor --json"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(capturePath, "utf8")) as { argv: string[]; cwd: string };
  assert.deepEqual(payload.argv, ["doctor", "--json"]);
  assert.equal(payload.cwd, repoRoot);
});

test("writeGlobalShellEnv drops stale preserved raw Copilot binary values", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-drop-stale-raw-bin-"));
  const paths = resolveGlobalPaths(tempHome);
  fs.mkdirSync(path.dirname(paths.shellEnvPath), { recursive: true });
  fs.writeFileSync(paths.shellEnvPath, "export XGC_COPILOT_RAW_BIN='/tmp/definitely-missing-xgc-raw-bin'\n");

  writeGlobalShellEnv({ paths, rawCopilotBin: null, permissionMode: "ask", homeDir: tempHome, repoRoot });

  const profileEnv = fs.readFileSync(paths.shellEnvPath, "utf8");
  assert.doesNotMatch(profileEnv, /XGC_COPILOT_RAW_BIN/);
});

test("writeGlobalShellEnv drops preserved wrapper raw Copilot binary values", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-drop-wrapper-raw-bin-"));
  const paths = resolveGlobalPaths(tempHome);
  const wrapperBin = path.join(paths.configHome, "copilot");
  fs.mkdirSync(path.dirname(paths.shellEnvPath), { recursive: true });
  fs.mkdirSync(paths.configHome, { recursive: true });
  fs.writeFileSync(wrapperBin, ["#!/usr/bin/env bash", "source xgc-shell.sh"].join("\n"));
  fs.chmodSync(wrapperBin, 0o755);
  fs.writeFileSync(paths.shellEnvPath, `export XGC_COPILOT_RAW_BIN=${shellQuote(wrapperBin)}\n`);

  writeGlobalShellEnv({ paths, rawCopilotBin: null, permissionMode: "ask", homeDir: tempHome, repoRoot });

  const profileEnv = fs.readFileSync(paths.shellEnvPath, "utf8");
  assert.doesNotMatch(profileEnv, /XGC_COPILOT_RAW_BIN/);
});

test("sourcing the shell shim makes type copilot authoritative even when which remains raw", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-shell-activation-"));
  const tempBin = path.join(tempHome, "bin");
  fs.mkdirSync(tempBin, { recursive: true });
  const rawBin = path.join(tempBin, "copilot");
  fs.writeFileSync(rawBin, "#!/usr/bin/env bash\necho raw-copilot\n");
  fs.chmodSync(rawBin, 0o755);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export PATH=${shellQuote(`${tempBin}:${process.env.PATH ?? ""}`)}`,
        "echo BEFORE_TYPE",
        "type copilot",
        "echo BEFORE_WHICH",
        "which copilot",
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "echo AFTER_TYPE",
        "type copilot",
        "echo AFTER_WHICH",
        "which copilot"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`BEFORE_TYPE[\\s\\S]*copilot is ${rawBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, /AFTER_TYPE[\s\S]*copilot is a function/);
  assert.match(result.stdout, /AFTER_TYPE[\s\S]*xgc__invoke "repo-master"/);
  assert.match(result.stdout, new RegExp(`AFTER_WHICH\\s+${rawBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("xgc_preflight reports auth and model-list readiness blockers before long TUI runs", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-live-preflight-"));
  const rawBin = createFakePreflightCopilot(tempHome);

  const success = sourceShimAndRunRaw({ tempHome, rawBin, fnCall: "xgc_preflight" });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /X for GitHub Copilot live preflight passed/);

  const authFailure = sourceShimAndRunRaw({
    tempHome,
    rawBin,
    fnCall: "xgc_preflight",
    extraEnv: { XGC_FAKE_COPILOT_MODE: "auth" },
    cwd: tempHome
  });
  assert.equal(authFailure.status, 2);
  assert.match(authFailure.stderr, /Copilot auth is not ready/);
  assert.match(authFailure.stderr, /copilot --config-dir .*\.copilot-xgc.* login/);
  assert.match(authFailure.stderr, /Diagnostic log:/);
  assert.match(fs.readFileSync(path.join(tempHome, ".xgc", "validation", "preflight-diagnostic.log"), "utf8"), /Authorization error/);

  const modelFailure = sourceShimAndRunRaw({
    tempHome,
    rawBin,
    fnCall: "xgc_preflight",
    extraEnv: { XGC_FAKE_COPILOT_MODE: "model" },
    cwd: tempHome
  });
  assert.equal(modelFailure.status, 3);
  assert.match(modelFailure.stderr, /model availability could not be loaded/);
  assert.match(fs.readFileSync(path.join(tempHome, ".xgc", "validation", "preflight-diagnostic.log"), "utf8"), /Unable to load available models list/);

  const policyFailure = sourceShimAndRunRaw({
    tempHome,
    rawBin,
    fnCall: "xgc_preflight",
    extraEnv: { XGC_FAKE_COPILOT_MODE: "policy" },
    cwd: tempHome
  });
  assert.equal(policyFailure.status, 4);
  assert.match(policyFailure.stderr, /policy or plan entitlement blocked prompt generation/);
  assert.match(fs.readFileSync(path.join(tempHome, ".xgc", "validation", "preflight-diagnostic.log"), "utf8"), /Access denied by policy settings/);
});

test("xgc_preflight runs from zsh without colliding with zsh readonly status", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-zsh-live-preflight-"));
  const rawBin = createFakePreflightCopilot(tempHome);
  const result = spawnSync(
    "zsh",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "xgc_preflight"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /X for GitHub Copilot live preflight passed/);
  assert.doesNotMatch(result.stderr, /read-only variable: status/);
});

test("validate global fails when any materialized hook script is missing", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-missing-hook-"));
  await materializeGlobalProfile({ repoRoot, homeDir: tempHome });
  fs.rmSync(path.join(tempHome, ".config", "xgc", "hooks", "pre-tool-use.sh"));

  const result = spawnSync(
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile hook scripts file set drifted/);
  assert.match(result.stderr, /xgc install/);
});

test("validate global fails when profile.env redirects dedicated profile homes", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-profile-env-drift-"));
  await materializeGlobalProfile({ repoRoot, homeDir: tempHome });
  fs.appendFileSync(
    path.join(tempHome, ".config", "xgc", "profile.env"),
    [
      `export XGC_COPILOT_PROFILE_HOME=${shellQuote(path.join(tempHome, ".copilot-raw-contaminated"))}`,
      `export XGC_COPILOT_CONFIG_HOME=${shellQuote(path.join(tempHome, ".config", "raw-contaminated"))}`,
      ""
    ].join("\n")
  );

  const result = spawnSync(
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile\.env must not redirect XGC_COPILOT_PROFILE_HOME/);
  assert.match(result.stderr, /xgc install/);
});

test("materializeGlobalProfile drops existing active profile root model for TUI-selected root models", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-existing-root-"));
  const tempRepo = createMinimalRepoFixture();
  const profileHome = path.join(tempHome, ".copilot-xgc");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.json"),
    JSON.stringify({ model: "acme-ultra-preview", trusted_folders: ["/tmp/old"] }, null, 2)
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as { model?: string; trusted_folders?: string[] };
  assert.equal(result.rootModel, "claude-sonnet-4.6");
  assert.equal(profileConfig.model, undefined);
  assert.ok(profileConfig.trusted_folders?.includes(tempRepo));
  assert.equal(frontmatterModel(path.join(result.paths.profileAgentsDir, "repo-master.agent.md")), null);
  assert.equal(frontmatterModel(path.join(result.paths.profileAgentsDir, "milestone.agent.md")), "claude-sonnet-4.6");
  assert.equal(frontmatterModel(path.join(result.paths.profileAgentsDir, "repo-scout.agent.md")), "gpt-5.4-mini");
});

test("materializeGlobalProfile removes stale profile effort level when reasoning effort is disabled", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-effort-off-"));
  const tempRepo = createMinimalRepoFixture();
  const profileHome = path.join(tempHome, ".copilot-xgc");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.json"),
    JSON.stringify({ effortLevel: "high", trusted_folders: ["/tmp/old"] }, null, 2)
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome, reasoningEffort: "off" });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
    effortLevel?: string;
    trusted_folders?: string[];
  };

  assert.equal(profileConfig.effortLevel, undefined);
  assert.ok(profileConfig.trusted_folders?.includes(tempRepo));
});

test("materializeGlobalProfile preserves existing XGC auth metadata when raw config is absent", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-preserve-auth-"));
  const tempRepo = createMinimalRepoFixture();
  const profileHome = path.join(tempHome, ".copilot-xgc");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.json"),
    JSON.stringify(
      {
        last_logged_in_user: { host: "https://github.com", login: "fresh-user" },
        logged_in_users: [{ host: "https://github.com", login: "fresh-user" }],
        trusted_folders: ["/tmp/existing"]
      },
      null,
      2
    )
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
    last_logged_in_user?: { login?: string };
    logged_in_users?: Array<{ login?: string }>;
    trusted_folders?: string[];
  };

  assert.equal(profileConfig.last_logged_in_user?.login, "fresh-user");
  assert.deepEqual(profileConfig.logged_in_users?.map((entry) => entry.login), ["fresh-user"]);
  assert.ok(profileConfig.trusted_folders?.includes("/tmp/existing"));
  assert.ok(profileConfig.trusted_folders?.includes(tempRepo));
});

test("materializeGlobalProfile filters stale legacy plugins from the dedicated XGC profile", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-filter-stale-plugins-"));
  const tempRepo = createMinimalRepoFixture();
  const profileHome = path.join(tempHome, ".copilot-xgc");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "orchestra-dual-runtime",
            source: { source_path: "/tmp/orchestra-opencode/packages/copilot-cli-plugin" },
            cache_path: "/tmp/stale-copilot-cli-plugin"
          },
          {
            name: "xgc",
            source: { source_path: tempRepo },
            cache_path: "/tmp/current-xgc-plugin"
          }
        ]
      },
      null,
      2
    )
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as { installedPlugins?: Array<{ name?: string }> };

  assert.deepEqual(profileConfig.installedPlugins?.map((entry) => entry.name), ["xgc"]);
});

test("materializeGlobalProfile recovers local plugin registration when a dedicated profile cache already exists", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-recover-plugin-registration-"));
  const tempRepo = createMinimalRepoFixture();
  const profilePluginCache = path.join(tempHome, ".copilot-xgc", "installed-plugins", "_direct", path.basename(tempRepo));
  fs.mkdirSync(profilePluginCache, { recursive: true });
  fs.writeFileSync(
    path.join(profilePluginCache, "plugin.json"),
    JSON.stringify({ name: "xgc", version: "0.1.0" }, null, 2)
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
    installedPlugins?: Array<{ name?: string; enabled?: boolean; cache_path?: string; source?: { source?: string; path?: string } }>;
  };
  assert.equal(profileConfig.installedPlugins?.length, 1);
  assert.equal(profileConfig.installedPlugins?.[0]?.name, "xgc");
  assert.equal(profileConfig.installedPlugins?.[0]?.enabled, true);
  assert.equal(profileConfig.installedPlugins?.[0]?.cache_path, profilePluginCache);
  assert.deepEqual(profileConfig.installedPlugins?.[0]?.source, { source: "local", path: tempRepo });
});

test("materializeGlobalProfile refreshes plugin registration version from the source manifest", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-refresh-plugin-version-"));
  const tempRepo = createMinimalRepoFixture();
  const profilePluginCache = path.join(tempHome, ".copilot-xgc", "installed-plugins", "_direct", path.basename(tempRepo));
  fs.mkdirSync(profilePluginCache, { recursive: true });
  fs.writeFileSync(path.join(tempRepo, "plugin.json"), JSON.stringify({ name: "xgc", version: "0.1.1" }, null, 2));
  fs.writeFileSync(path.join(tempRepo, "package.json"), JSON.stringify({ name: "x-for-github-copilot", version: "0.1.1" }, null, 2));
  fs.writeFileSync(path.join(profilePluginCache, "plugin.json"), JSON.stringify({ name: "xgc", version: "0.1.0" }, null, 2));

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
    installedPlugins?: Array<{ name?: string; version?: string }>;
  };

  assert.equal(profileConfig.installedPlugins?.[0]?.name, "xgc");
  assert.equal(profileConfig.installedPlugins?.[0]?.version, "0.1.1");
});

test("materializeGlobalProfile drops active root model instead of injecting it into runtime config", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-root-injection-"));
  const tempRepo = createMinimalRepoFixture();
  const profileHome = path.join(tempHome, ".copilot-xgc");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.json"),
    JSON.stringify({ model: "gpt-4.1\nuser-invocable: false", trusted_folders: ["/tmp/old"] }, null, 2)
  );

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const repoMasterPath = path.join(result.paths.profileAgentsDir, "repo-master.agent.md");
  const repoMaster = fs.readFileSync(repoMasterPath, "utf8");
  const profileConfig = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as { model?: string };

  assert.equal(result.rootModel, "claude-sonnet-4.6");
  assert.equal(profileConfig.model, undefined);
  assert.equal(frontmatterModel(repoMasterPath), null);
  assert.doesNotMatch(repoMaster, /^model:\s*gpt-4\.1$/m);
  assert.doesNotMatch(repoMaster, /^user-invocable:\s*false$/m);
  assert.match(repoMaster, /^user-invocable:\s*true$/m);
});

test("fresh profile hook truth detects stale raw legacy .mjs plugin conflicts while materialized XGC hooks stay current", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-hook-truth-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "copilot-cli-plugin");
  fs.mkdirSync(path.join(staleCachePath, "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "orchestra-dual-runtime", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    path.join(staleCachePath, "hooks", "hooks.json"),
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }],
          preToolUse: [{ type: "command", bash: "node ./scripts/pre-tool-use.mjs", cwd: "." }],
          userPromptSubmitted: [{ type: "command", bash: "node ./scripts/prompt-submitted.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "orchestra-dual-runtime",
            source: { source_path: "/tmp/orchestra-opencode/packages/copilot-cli-plugin" },
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 3);
  assert.deepEqual(conflicts.map((entry) => entry.hookName).sort(), ["preToolUse", "sessionStart", "userPromptSubmitted"]);
  assert.ok(conflicts.every((entry) => entry.pluginName === "orchestra-dual-runtime"));
  assert.match(conflicts.map((entry) => entry.command).join("\n"), /pre-tool-use\.mjs/);

  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const sourceHookTruth = validateHookManifestTruth(path.join(tempRepo, "hooks", "hooks.json"));
  assert.deepEqual(sourceHookTruth.staleLegacyHookCommands, []);
  assert.deepEqual(sourceHookTruth.missingExpectedShellHooks, []);
  assert.deepEqual(sourceHookTruth.missingFailOpenShellHooks, []);
  const materializedHookFiles = fs.readdirSync(result.paths.profileHookScriptsDir);
  assert.ok(materializedHookFiles.includes("pre-tool-use.sh"));
  assert.ok(materializedHookFiles.includes("session-start.sh"));
  assert.ok(materializedHookFiles.every((entry) => !entry.endsWith(".mjs")));
});

test("fresh profile hook truth detects name-only orchestra dual-runtime legacy conflicts", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-name-only-dual-runtime-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const neutralCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "neutral-runtime-cache");
  const hookManifestPath = path.join(neutralCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(neutralCachePath, "plugin.json"),
    JSON.stringify({ name: "neutral-runtime-cache", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }],
          preToolUse: [{ type: "command", bash: "node ./scripts/pre-tool-use.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "orchestra-dual-runtime",
            source: { source_path: "/tmp/vendor/neutral-runtime" },
            cache_path: neutralCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts.map((entry) => entry.hookName).sort(), ["preToolUse", "sessionStart"]);
  assert.ok(conflicts.every((entry) => entry.pluginName === "orchestra-dual-runtime"));
  assert.match(conflicts.map((entry) => entry.reasons.join("\n")).join("\n"), /known legacy Orchestra\/Copilot runtime plugin/);
});

test("raw hook conflict detection ignores disabled legacy plugins", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-disabled-legacy-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "disabled-copilot-cli-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "orchestra-dual-runtime", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "orchestra-dual-runtime",
            enabled: false,
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.deepEqual(conflicts, []);
  const repair = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: createMinimalRepoFixture() });
  assert.equal(repair.conflictsFound, 0);
  assert.equal(repair.changesApplied, false);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8").includes("session-start.mjs"), true);
});

test("raw hook repair refuses plugin hook manifests outside the plugin cache", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-foreign-hook-manifest-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-plugin");
  const foreignManifestPath = path.join(rawCopilotHome, "installed-plugins", "_direct", "foreign", "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(foreignManifestPath), { recursive: true });
  fs.mkdirSync(staleCachePath, { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "../foreign/hooks/hooks.json" }, null, 2)
  );
  const originalForeignManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(foreignManifestPath, originalForeignManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify({ installed_plugins: [{ name: "xgc", cache_path: staleCachePath }] }, null, 2)
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].hookManifestPath, null);
  assert.match(conflicts[0].reasons.join("\n"), /hook manifest.*could not be found/);
  const repair = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: createMinimalRepoFixture() });
  assert.equal(repair.conflictsFound, 1);
  assert.equal(repair.changesApplied, false);
  assert.equal(fs.readFileSync(foreignManifestPath, "utf8"), originalForeignManifest);
});

test("raw hook conflict detection prefers nested raw Copilot config over unrelated home config", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-dual-config-hook-truth-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "copilot-cli-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(path.join(tempHome, "config.json"), JSON.stringify({ installed_plugins: [] }, null, 2));
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "orchestra-dual-runtime", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify({ installed_plugins: [{ name: "orchestra-dual-runtime", cache_path: staleCachePath }] }, null, 2)
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].pluginName, "orchestra-dual-runtime");
  assert.equal(conflicts[0].hookName, "sessionStart");
});

test("raw hook conflict detection surfaces neutral plugins with legacy XGC hook commands for manual review", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-neutral-legacy-hook-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const neutralCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "neutral-runtime-cache");
  const hookManifestPath = path.join(neutralCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(neutralCachePath, "plugin.json"),
    JSON.stringify({ name: "neutral-runtime-cache", hooks: "hooks/hooks.json" }, null, 2)
  );
  const originalManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        sessionStart: [{ type: "command", bash: "node ./scripts/session-start.mjs", cwd: "." }],
        preToolUse: [{ type: "command", bash: "node ./scripts/pre-tool-use.mjs", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(hookManifestPath, originalManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "neutral-runtime",
            source: { source_path: "/tmp/vendor/neutral-runtime" },
            cache_path: neutralCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every((entry) => entry.pluginName === "neutral-runtime"));
  assert.match(conflicts.map((entry) => entry.reasons.join("\n")).join("\n"), /manual review required/);

  const repair = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: createMinimalRepoFixture() });
  assert.equal(repair.conflictsFound, 2);
  assert.equal(repair.repairableConflictsFound, 0);
  assert.equal(repair.repairComplete, false);
  assert.equal(repair.changesApplied, false);
  assert.equal(repair.manualReviewConflicts.length, 2);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8"), originalManifest);
  assert.deepEqual(
    fs.readdirSync(path.dirname(hookManifestPath)).filter((entry) => entry.includes(".bak-")),
    []
  );
});

test("raw hook conflict detection surfaces known legacy plugins with missing hook manifests", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-missing-hook-manifest-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "copilot-cli-plugin");
  fs.mkdirSync(staleCachePath, { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "orchestra-dual-runtime", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify({ installed_plugins: [{ name: "orchestra-dual-runtime", cache_path: staleCachePath }] }, null, 2)
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].hookName, null);
  assert.equal(conflicts[0].command, null);
  assert.match(conflicts[0].reasons.join("\n"), /hook manifest.*could not be found/);
});

test("fresh profile hook truth detects unsafe raw workspace-relative .sh hook commands", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-global-unsafe-sh-hook-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "copilot-cli-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }],
          preToolUse: [{ type: "command", bash: "./scripts/pre-tool-use.sh", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  assert.equal(commandUsesUnsafeWorkspaceHookPath("bash ./scripts/hooks/pre-tool-use.sh"), true);
  assert.equal(commandUsesUnsafeWorkspaceHookPath("bash ./scripts/pre-tool-use.sh"), true);
  assert.equal(commandUsesUnsafeWorkspaceHookPath("./scripts/pre-tool-use.sh"), true);
  const truth = validateHookManifestTruth(hookManifestPath);
  assert.deepEqual(
    truth.unsafeWorkspaceHookCommands.map((entry) => entry.hookName).sort(),
    ["preToolUse", "sessionStart"]
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 2);
  assert.match(conflicts.map((entry) => entry.reasons.join("; ")).join("\n"), /workspace-relative \.sh script/);
});

test("raw hook conflict detection resolves relative cache_path from the Copilot config directory", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-relative-cache-hook-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const relativeCachePath = path.join("installed-plugins", "_direct", "xgc-direct-plugin");
  const pluginCachePath = path.join(rawCopilotHome, relativeCachePath);
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: relativeCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].cachePath, pluginCachePath);
  assert.equal(conflicts[0].hookManifestPath, hookManifestPath);
});

test("raw hook conflict detection reads current Copilot installedPlugins shape", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-modern-hook-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "0.1.1");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installedPlugins: [
          {
            name: "xgc",
            source: { source: "local", path: "/tmp/xgc-runtime" },
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const conflicts = findLegacyHookPluginConflicts({ homeDir: tempHome });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].cachePath, pluginCachePath);
  assert.equal(conflicts[0].hookManifestPath, hookManifestPath);
});

test("raw hook repair rewrites unsafe raw hook commands with backups", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-raw-hook-repair-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "copilot-cli-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/session-start.sh", cwd: "." }],
          preToolUse: [{ type: "command", bash: "./scripts/hooks/pre-tool-use.sh", cwd: "." }],
          userPromptSubmitted: [{ type: "command", bash: "node ./scripts/prompt-submitted.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: tempRepo });
  assert.equal(result.conflictsFound, 3);
  assert.equal(result.repairComplete, true);
  assert.equal(result.wouldRepair, true);
  assert.equal(result.changesApplied, true);
  assert.deepEqual(result.manualReviewConflicts, []);
  assert.deepEqual(result.unrepairedConflicts, []);
  assert.equal(result.repairedManifests.length, 1);
  assert.deepEqual(result.repairedManifests[0].replacedHookNames, ["preToolUse", "sessionStart"]);
  assert.deepEqual(result.repairedManifests[0].removedHookNames, ["userPromptSubmitted"]);
  assert.ok(result.repairedManifests[0].backupPath);
  assert.equal(fs.existsSync(result.repairedManifests[0].backupPath!), true);

  const repairedTruth = validateHookManifestTruth(hookManifestPath);
  assert.deepEqual(repairedTruth.staleLegacyHookCommands, []);
  assert.deepEqual(repairedTruth.unsafeWorkspaceHookCommands, []);
  assert.deepEqual(repairedTruth.missingFailOpenShellHooks.sort(), ["agentStop", "errorOccurred", "subagentStop"]);
  const repairedManifest = JSON.parse(fs.readFileSync(hookManifestPath, "utf8")) as HookManifest;
  assert.match(repairedManifest.hooks?.sessionStart?.[0]?.bash ?? "", /XGC_HOOK_SCRIPT_ROOT/);
  assert.equal("userPromptSubmitted" in (repairedManifest.hooks ?? {}), false);
});

test("raw hook repair dry-run reports planned changes without writing backups", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-raw-hook-repair-dry-run-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  const originalManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        sessionStart: [{ type: "command", bash: "bash ./scripts/session-start.sh", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(hookManifestPath, originalManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: tempRepo, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.conflictsFound, 1);
  assert.equal(result.repairComplete, false);
  assert.equal(result.wouldRepair, true);
  assert.equal(result.changesApplied, false);
  assert.equal(result.repairedManifests.length, 1);
  assert.equal(result.repairedManifests[0].backupPath, null);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8"), originalManifest);
  assert.deepEqual(
    fs.readdirSync(path.dirname(hookManifestPath)).filter((entry) => entry.includes(".bak-")),
    []
  );
});

test("raw hook conflict detection does not rewrite unrelated plugins", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-unrelated-hook-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "unrelated-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "unrelated-plugin", hooks: "hooks/hooks.json" }, null, 2)
  );
  const originalManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        sessionStart: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }],
        customHook: [{ type: "command", bash: "node ./scripts/custom-hook.mjs", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(hookManifestPath, originalManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "unrelated-plugin",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  assert.deepEqual(findLegacyHookPluginConflicts({ homeDir: tempHome }), []);
  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: createMinimalRepoFixture() });
  assert.equal(result.conflictsFound, 0);
  assert.equal(result.repairComplete, true);
  assert.equal(result.repairedManifests.length, 0);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8"), originalManifest);
});

test("raw hook repair treats known plugins with current fail-open hooks as already safe", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-safe-known-hook-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  const canonicalManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks", "hooks.json"), "utf8")) as HookManifest;
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(hookManifestPath, `${JSON.stringify(canonicalManifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  assert.deepEqual(findLegacyHookPluginConflicts({ homeDir: tempHome }), []);
  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot });
  assert.equal(result.conflictsFound, 0);
  assert.equal(result.repairComplete, true);
  assert.equal(result.wouldRepair, false);
  assert.equal(result.changesApplied, false);
  assert.deepEqual(result.repairedManifests, []);
  assert.deepEqual(
    fs.readdirSync(path.dirname(hookManifestPath)).filter((entry) => entry.includes(".bak-")),
    []
  );
});

test("raw hook repair does not delete nonstandard hooks even when they need manual review", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-nonstandard-hook-plugin-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  const originalManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        customOrgHook: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(hookManifestPath, originalManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  assert.equal(findLegacyHookPluginConflicts({ homeDir: tempHome }).length, 1);
  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: createMinimalRepoFixture() });
  assert.equal(result.conflictsFound, 1);
  assert.equal(result.repairComplete, false);
  assert.deepEqual(result.repairedManifests, []);
  assert.deepEqual(result.skippedManifests, [hookManifestPath]);
  assert.equal(result.manualReviewConflicts.length, 1);
  assert.equal(result.unrepairedConflicts.length, 1);
  assert.match(result.manualReviewConflicts[0], /customOrgHook/);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8"), originalManifest);
});

test("raw hook repair can remove deprecated hooks without canonical commands", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-deprecated-only-hook-plugin-"));
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-deprecated-only-empty-repo-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          userPromptSubmitted: [{ type: "command", bash: "node ./scripts/prompt-submitted.mjs", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: tempRepo });
  assert.equal(result.conflictsFound, 1);
  assert.equal(result.repairComplete, true);
  assert.deepEqual(result.manualReviewConflicts, []);
  assert.equal(result.repairedManifests.length, 1);
  assert.deepEqual(result.repairedManifests[0].removedHookNames, ["userPromptSubmitted"]);
  const repairedManifest = JSON.parse(fs.readFileSync(hookManifestPath, "utf8")) as HookManifest;
  assert.equal("userPromptSubmitted" in (repairedManifest.hooks ?? {}), false);
});

test("raw hook repair reports incomplete repair when auto fixes and manual-review hooks coexist", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-mixed-manual-hook-plugin-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/hooks/session-start.sh", cwd: "." }],
          customOrgHook: [{ type: "command", bash: "bash ./scripts/hooks/pre-tool-use.sh", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const result = repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: tempRepo });
  assert.equal(result.conflictsFound, 2);
  assert.equal(result.repairComplete, false);
  assert.equal(result.repairedManifests.length, 1);
  assert.deepEqual(result.repairedManifests[0].replacedHookNames, ["sessionStart"]);
  assert.equal(result.manualReviewConflicts.length, 1);
  assert.match(result.manualReviewConflicts[0], /customOrgHook/);
  const repairedManifest = JSON.parse(fs.readFileSync(hookManifestPath, "utf8")) as HookManifest;
  assert.match(repairedManifest.hooks?.sessionStart?.[0]?.bash ?? "", /XGC_HOOK_SCRIPT_ROOT/);
  assert.equal(repairedManifest.hooks?.customOrgHook?.[0]?.bash, "bash ./scripts/hooks/pre-tool-use.sh");
});

test("raw hook repair CLI reports manual-review conflicts with nonzero exit and no mutation", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-cli-manual-hook-plugin-"));
  const tempRepo = createMinimalRepoFixture();
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const pluginCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(pluginCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(pluginCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  const originalManifest = JSON.stringify(
    {
      version: 1,
      hooks: {
        customOrgHook: [{ type: "command", bash: "bash ./scripts/hooks/pre-tool-use.sh", cwd: "." }]
      }
    },
    null,
    2
  );
  fs.writeFileSync(hookManifestPath, originalManifest);
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: pluginCachePath
          }
        ]
      },
      null,
      2
    )
  );

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repoRoot, "scripts/repair-raw-copilot-hooks.ts"),
      "--home-dir",
      tempHome,
      "--repo-root",
      tempRepo
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout) as {
    repairComplete: boolean;
    manualReviewConflicts: string[];
    unrepairedConflicts: string[];
  };
  assert.equal(payload.repairComplete, false);
  assert.equal(payload.manualReviewConflicts.length, 1);
  assert.equal(payload.unrepairedConflicts.length, 1);
  assert.match(payload.manualReviewConflicts[0], /customOrgHook/);
  assert.equal(fs.readFileSync(hookManifestPath, "utf8"), originalManifest);
});

test("raw hook repair refuses to run when canonical hook commands are unavailable", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-raw-hook-repair-missing-canonical-"));
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-raw-hook-repair-empty-repo-"));
  const rawCopilotHome = path.join(tempHome, ".copilot");
  const staleCachePath = path.join(rawCopilotHome, "installed-plugins", "_direct", "xgc-direct-plugin");
  const hookManifestPath = path.join(staleCachePath, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(hookManifestPath), { recursive: true });
  fs.writeFileSync(
    path.join(staleCachePath, "plugin.json"),
    JSON.stringify({ name: "xgc", hooks: "hooks/hooks.json" }, null, 2)
  );
  fs.writeFileSync(
    hookManifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "bash ./scripts/session-start.sh", cwd: "." }]
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(rawCopilotHome, "config.json"),
    JSON.stringify(
      {
        installed_plugins: [
          {
            name: "xgc",
            cache_path: staleCachePath
          }
        ]
      },
      null,
      2
    )
  );

  assert.throws(
    () => repairRawCopilotHookConflicts({ homeDir: tempHome, repoRoot: tempRepo }),
    /Refusing to repair raw Copilot hooks because canonical source hook commands are missing/
  );
});

test("hook manifest truth accepts expected shell handler when a hook has multiple handlers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-truth-multi-handler-"));
  const manifestPath = path.join(tempRoot, "hooks.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", bash: "echo preflight", cwd: "." },
            {
              type: "command",
              bash: "bash -lc 'xgc_hook_root=\"\"; if [ -n \"${XGC_HOOK_SCRIPT_ROOT:-}\" ] && [ -f \"${XGC_HOOK_SCRIPT_ROOT}/session-start.sh\" ]; then xgc_hook_root=\"${XGC_HOOK_SCRIPT_ROOT}\"; elif [ -f \"./scripts/hooks/session-start.sh\" ]; then xgc_hook_root=\"./scripts/hooks\"; fi; if [ -n \"$xgc_hook_root\" ]; then bash \"$xgc_hook_root/session-start.sh\"; else exit 0; fi'",
              cwd: "."
            }
          ],
          preToolUse: [
            {
              type: "command",
              bash: "bash -lc 'xgc_hook_root=\"\"; if [ -n \"${XGC_HOOK_SCRIPT_ROOT:-}\" ] && [ -f \"${XGC_HOOK_SCRIPT_ROOT}/pre-tool-use.sh\" ]; then xgc_hook_root=\"${XGC_HOOK_SCRIPT_ROOT}\"; elif [ -f \"./scripts/hooks/pre-tool-use.sh\" ]; then xgc_hook_root=\"./scripts/hooks\"; fi; if [ -n \"$xgc_hook_root\" ]; then bash \"$xgc_hook_root/pre-tool-use.sh\"; else exit 0; fi'",
              cwd: "."
            }
          ],
          agentStop: [
            {
              type: "command",
              bash: "bash -lc 'xgc_hook_root=\"\"; if [ -n \"${XGC_HOOK_SCRIPT_ROOT:-}\" ] && [ -f \"${XGC_HOOK_SCRIPT_ROOT}/agent-stop.sh\" ]; then xgc_hook_root=\"${XGC_HOOK_SCRIPT_ROOT}\"; elif [ -f \"./scripts/hooks/agent-stop.sh\" ]; then xgc_hook_root=\"./scripts/hooks\"; fi; if [ -n \"$xgc_hook_root\" ]; then bash \"$xgc_hook_root/agent-stop.sh\"; else exit 0; fi'",
              cwd: "."
            }
          ],
          subagentStop: [
            {
              type: "command",
              bash: "bash -lc 'xgc_hook_root=\"\"; if [ -n \"${XGC_HOOK_SCRIPT_ROOT:-}\" ] && [ -f \"${XGC_HOOK_SCRIPT_ROOT}/subagent-stop.sh\" ]; then xgc_hook_root=\"${XGC_HOOK_SCRIPT_ROOT}\"; elif [ -f \"./scripts/hooks/subagent-stop.sh\" ]; then xgc_hook_root=\"./scripts/hooks\"; fi; if [ -n \"$xgc_hook_root\" ]; then bash \"$xgc_hook_root/subagent-stop.sh\"; else exit 0; fi'",
              cwd: "."
            }
          ],
          errorOccurred: [
            {
              type: "command",
              bash: "bash -lc 'xgc_hook_root=\"\"; if [ -n \"${XGC_HOOK_SCRIPT_ROOT:-}\" ] && [ -f \"${XGC_HOOK_SCRIPT_ROOT}/error-occurred.sh\" ]; then xgc_hook_root=\"${XGC_HOOK_SCRIPT_ROOT}\"; elif [ -f \"./scripts/hooks/error-occurred.sh\" ]; then xgc_hook_root=\"./scripts/hooks\"; fi; if [ -n \"$xgc_hook_root\" ]; then bash \"$xgc_hook_root/error-occurred.sh\"; else exit 0; fi'",
              cwd: "."
            }
          ]
        }
      },
      null,
      2
    )
  );

  const truth = validateHookManifestTruth(manifestPath);
  assert.deepEqual(truth.staleLegacyHookCommands, []);
  assert.deepEqual(truth.missingExpectedShellHooks, []);
  assert.deepEqual(truth.missingFailOpenShellHooks, []);
});

test("hook commands fail open in fresh workspaces without scripts/hooks", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-fail-open-workspace-"));
  const commands = collectHookCommands(path.join(repoRoot, "hooks", "hooks.json"));
  assert.ok(commands.length > 0);

  for (const entry of commands) {
    const result = runHookCommand(entry.command, {
      cwd: workspace,
      env: {
        ...process.env,
        XGC_HOOK_SCRIPT_ROOT: ""
      }
    });
    assert.equal(result.status, 0, `hook ${entry.hookName} should fail open without scripts/hooks\n${result.stderr}`);
  }
});

test("hook commands use materialized absolute XGC_HOOK_SCRIPT_ROOT when available", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-absolute-root-"));
  const tempRepo = createMinimalRepoFixture();
  const materialized = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-absolute-root-workspace-"));
  const commands = collectHookCommands(path.join(tempRepo, "hooks", "hooks.json"));

  for (const entry of commands) {
    const result = runHookCommand(entry.command, {
      cwd: workspace,
      env: {
        ...process.env,
        XGC_HOOK_SCRIPT_ROOT: materialized.paths.profileHookScriptsDir,
        XGC_LOG_ROOT: path.join(workspace, ".xgc", "logs"),
        XGC_COPILOT_PROFILE_HOME: materialized.paths.profileHome
      }
    });
    assert.equal(result.status, 0, `hook ${entry.hookName} should run via materialized absolute hook root\n${result.stderr}`);
  }
});

test("hook commands prefer XGC_HOOK_SCRIPT_ROOT over workspace scripts/hooks when both exist", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-hook-root-precedence-"));
  const workspace = path.join(tempRoot, "workspace");
  const workspaceHooks = path.join(workspace, "scripts", "hooks");
  const materializedHooks = path.join(tempRoot, "materialized-hooks");
  const markerPath = path.join(tempRoot, "marker.txt");
  fs.mkdirSync(workspaceHooks, { recursive: true });
  fs.mkdirSync(materializedHooks, { recursive: true });
  fs.writeFileSync(path.join(workspaceHooks, "session-start.sh"), "#!/usr/bin/env bash\necho workspace > \"$XGC_TEST_MARKER\"\n");
  fs.writeFileSync(path.join(materializedHooks, "session-start.sh"), "#!/usr/bin/env bash\necho materialized > \"$XGC_TEST_MARKER\"\n");
  fs.chmodSync(path.join(workspaceHooks, "session-start.sh"), 0o755);
  fs.chmodSync(path.join(materializedHooks, "session-start.sh"), 0o755);
  const sessionStart = collectHookCommands(path.join(repoRoot, "hooks", "hooks.json")).find(
    (entry) => entry.hookName === "sessionStart"
  );
  assert.ok(sessionStart);

  const result = runHookCommand(sessionStart.command, {
    cwd: workspace,
    env: {
      ...process.env,
      XGC_HOOK_SCRIPT_ROOT: materializedHooks,
      XGC_TEST_MARKER: markerPath
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(markerPath, "utf8").trim(), "materialized");
});

test("xgc shell shim injects repo-master only when no explicit agent is provided", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-home-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const defaultCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --prompt 'hi'"
  });
  assert.equal(defaultCall.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.ok(defaultCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(defaultCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(defaultCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(defaultCall.argv).slice(0, 2), ["--agent", "repo-master"]);

  const explicitAgentCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --agent ref-index --prompt 'hi'"
  });
  assert.equal(explicitAgentCall.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.ok(explicitAgentCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(explicitAgentCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(explicitAgentCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(explicitAgentCall.argv).slice(0, 2), ["--agent", "ref-index"]);
  assert.ok(!explicitAgentCall.argv.includes("repo-master"));

  const explicitConfigDirCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --config-dir /tmp/raw-profile --prompt 'hi'"
  });
  assert.equal(explicitConfigDirCall.copilotHome, null);
  assert.deepEqual(explicitConfigDirCall.argv.slice(0, 2), ["--config-dir", "/tmp/raw-profile"]);
  assert.ok(!explicitConfigDirCall.argv.includes("repo-master"));
});

test("xgc shell shim can be sourced from zsh with nounset enabled", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-home-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const shimPath = path.join(repoRoot, "scripts", "xgc-shell.sh");
  const result = spawnSync(
    "zsh",
    [
      "-lc",
      [
        "set -u",
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `source ${shellQuote(shimPath)}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /BASH_SOURCE/);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null };
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
});

test("xgc shell shim recovers session.shutdown final truth after raw Copilot exits", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-shutdown-recovery-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-shutdown-recovery-workspace-"));
  const rawBin = createFakeShutdownRawCopilot(tempHome);
  const shimPath = path.join(repoRoot, "scripts", "xgc-shell.sh");
  const sessionId = "session-shell-shutdown-recovery";

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        `export XGC_HOOK_SCRIPT_ROOT=${shellQuote(path.join(repoRoot, "scripts", "hooks"))}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `source ${shellQuote(shimPath)}`,
        `cd ${shellQuote(workspace)}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null; sessionId: string };
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.equal(call.sessionId, sessionId);

  const sessionWorkspaceYaml = path.join(tempHome, ".copilot-xgc", "session-state", sessionId, "workspace.yaml");
  const repoWorkspaceYaml = path.join(workspace, ".xgc", "validation", "workspace.yaml");
  const sessionSummary = parseFlatYaml(sessionWorkspaceYaml);
  const repoSummary = parseFlatYaml(repoWorkspaceYaml);

  assert.equal(sessionSummary.session_shutdown_observed, true);
  assert.equal(sessionSummary.session_shutdown_recovery_finalized, true);
  assert.equal(sessionSummary.routine_shutdown_during_open_turn_observed, true);
  assert.equal(sessionSummary.final_status, "stopped");
  assert.equal(sessionSummary.summary_finalization_status, "stopped");
  assert.equal(sessionSummary.session_outcome, "incomplete");
  assert.equal(repoSummary.operator_truth_source, "repo-owned-validation-workspace");
  assert.equal(repoSummary.final_status, "stopped");
});

test("xgc shell shim recovers late session.shutdown after terminal hook finalization", (t) => {
  if (spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-late-shutdown-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-late-shutdown-workspace-"));
  const rawBin = createFakeShutdownRawCopilot(tempHome);
  const shimPath = path.join(repoRoot, "scripts", "xgc-shell.sh");
  const sessionId = "session-shell-late-shutdown-recovery";

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        `export XGC_HOOK_SCRIPT_ROOT=${shellQuote(path.join(repoRoot, "scripts", "hooks"))}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `export XGC_FAKE_SESSION_ID=${shellQuote(sessionId)}`,
        "export XGC_FAKE_WORKSPACE_FINAL_STATUS=completed",
        "export XGC_FAKE_SUMMARY_FINALIZATION_STATUS=finalized",
        `source ${shellQuote(shimPath)}`,
        `cd ${shellQuote(workspace)}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const sessionWorkspaceYaml = path.join(tempHome, ".copilot-xgc", "session-state", sessionId, "workspace.yaml");
  const sessionSummary = parseFlatYaml(sessionWorkspaceYaml);

  assert.equal(sessionSummary.session_shutdown_observed, true);
  assert.equal(sessionSummary.session_shutdown_recovery_finalized, true);
  assert.equal(sessionSummary.final_status, "stopped");
  assert.notEqual(sessionSummary.summary_timestamp_stale, true);
});

test("xgc shell shim auto-discovers raw copilot from zsh without explicit XGC_COPILOT_RAW_BIN", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-autobin-home-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const tempBin = path.join(tempHome, "bin");
  fs.mkdirSync(tempBin, { recursive: true });
  fs.copyFileSync(rawBin, path.join(tempBin, "copilot"));
  fs.chmodSync(path.join(tempBin, "copilot"), 0o755);
  const shimPath = path.join(repoRoot, "scripts", "xgc-shell.sh");
  const result = spawnSync(
    "zsh",
    [
      "-lc",
      [
        "set -u",
        sanitizedXgcEnvPrelude,
        "unset XGC_COPILOT_RAW_BIN",
        `export HOME=${shellQuote(tempHome)}`,
        `export PATH=${shellQuote(`${tempBin}:${process.env.PATH ?? ""}`)}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        "function copilot(){ echo stale-wrapper; }",
        `source ${shellQuote(shimPath)}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /bad option: -P/);
  assert.doesNotMatch(result.stderr, /could not find the raw GitHub Copilot CLI binary/);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null; pathEnv: string };
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.match(call.pathEnv, new RegExp(tempBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
});

test("xgc shell shim clears existing zsh copilot aliases before defining wrappers", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-alias-home-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const shimPath = path.join(repoRoot, "scripts", "xgc-shell.sh");
  const result = spawnSync(
    "zsh",
    [
      "-ic",
      [
        sanitizedXgcEnvPrelude,
        "alias copilot='echo alias-hit'",
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `source ${shellQuote(shimPath)}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /defining function based on alias|parse error/);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null };
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
});

test("xgc shell shim self-heals stale raw bin env from PATH", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-stale-raw-home-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const tempBin = path.join(tempHome, "bin");
  fs.mkdirSync(tempBin, { recursive: true });
  fs.copyFileSync(rawBin, path.join(tempBin, "copilot"));
  fs.chmodSync(path.join(tempBin, "copilot"), 0o755);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        "export XGC_COPILOT_RAW_BIN=/tmp/xgc-missing-raw-copilot",
        `export PATH=${shellQuote(`${tempBin}:${process.env.PATH ?? ""}`)}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `source ${shellQuote(path.join(repoRoot, "scripts", "xgc-shell.sh"))}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null };
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
});

test("xgc shell shim skips wrapper-looking copilot binaries during raw discovery", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-wrapper-path-home-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const wrapperBin = path.join(tempHome, "wrapper-bin");
  const rawBinDir = path.join(tempHome, "raw-bin");
  fs.mkdirSync(wrapperBin, { recursive: true });
  fs.mkdirSync(rawBinDir, { recursive: true });
  fs.writeFileSync(
    path.join(wrapperBin, "copilot"),
    "#!/usr/bin/env bash\n# X for GitHub Copilot shell shim wrapper\nexport XGC_COPILOT_PROFILE_HOME=/tmp/wrapper\nexit 99\n"
  );
  fs.chmodSync(path.join(wrapperBin, "copilot"), 0o755);
  fs.copyFileSync(rawBin, path.join(rawBinDir, "copilot"));
  fs.chmodSync(path.join(rawBinDir, "copilot"), 0o755);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        "unset XGC_COPILOT_RAW_BIN",
        `export HOME=${shellQuote(tempHome)}`,
        `export PATH=${shellQuote(`${wrapperBin}:${rawBinDir}:${process.env.PATH ?? ""}`)}`,
        "export XGC_DISABLE_PROBE_CACHE=1",
        `source ${shellQuote(path.join(repoRoot, "scripts", "xgc-shell.sh"))}`,
        "copilot --prompt hi"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[]; pathEnv: string };
  assert.match(call.pathEnv, new RegExp(rawBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
});

test("xgc shell shim reads probe cache from zsh without bash-only read flags", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-probe-cache-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const configHome = path.join(tempHome, ".config", "xgc");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    "example-org/test-repo\tmemory-enabled\tsession-1\t2026-04-09T00:00:00Z\n"
  );

  const result = spawnSync(
    "zsh",
    [
      "-lc",
      [
        "set -u",
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_DISABLE_PROBE_CACHE=0",
        `source ${shellQuote(path.join(repoRoot, "scripts", "xgc-shell.sh"))}`,
        "copilot --version"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /bad option: -a/);
});

test("probe cache seeding tolerates an empty zsh profile log directory", (t) => {
  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status !== 0) {
    t.skip("zsh unavailable");
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-empty-logs-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const logRoot = path.join(tempHome, ".copilot-xgc", "logs");
  fs.mkdirSync(logRoot, { recursive: true });

  const result = spawnSync(
    "zsh",
    [
      "-lc",
      [
        "set -u",
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_DISABLE_PROBE_CACHE=0",
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "xgc__probe_cache_seed_from_process_logs example-org/test-repo /tmp",
        "echo ok"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
  assert.doesNotMatch(result.stderr, /no matches found: .*process-\*\.log/);
});

test("xgc convenience wrappers target the expected specialist lanes", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-shortcuts-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const scoutCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_scout --prompt 'hi'"
  });
  assert.ok(scoutCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(scoutCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(scoutCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(scoutCall.argv).slice(0, 2),
    ["--agent", "repo-scout"]
  );

  const patchCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_patch --prompt 'hi'"
  });
  assert.ok(patchCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(patchCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(patchCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(patchCall.argv).slice(0, 2),
    ["--agent", "patch-master"]
  );

  const reviewCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_review --prompt 'hi'"
  });
  assert.ok(!reviewCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(!reviewCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(!reviewCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(reviewCall.argv).slice(0, 2),
    ["--agent", "merge-gate"]
  );

  const planCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_plan --prompt 'hi'"
  });
  assert.ok(planCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(planCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(planCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(planCall.argv).slice(0, 2),
    ["--agent", "milestone"]
  );

  const triageCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_triage --prompt 'hi'"
  });
  assert.ok(triageCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(triageCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(triageCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(triageCall.argv).slice(0, 2),
    ["--agent", "triage"]
  );

  const checkCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_check --prompt 'hi'"
  });
  assert.ok(checkCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(checkCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(checkCall.argv.includes("--no-experimental"));
  assert.deepEqual(
    withoutInjectedFlags(checkCall.argv).slice(0, 2),
    ["--agent", "required-check"]
  );
});

test("xgc_update dispatches to the installed runtime CLI update command", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-update-wrapper-"));
  const runtimeBinDir = path.join(tempHome, ".local", "share", "xgc", "current", "bin");
  fs.mkdirSync(runtimeBinDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeBinDir, "xgc.mjs"),
    [
      "import fs from 'node:fs';",
      "fs.writeFileSync(process.env.XGC_TEST_UPDATE_CAPTURE, JSON.stringify(process.argv.slice(2)));"
    ].join("\n")
  );
  fs.chmodSync(path.join(runtimeBinDir, "xgc.mjs"), 0o755);

  const capturePath = path.join(tempHome, "update-args.json");
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_TEST_UPDATE_CAPTURE=${shellQuote(capturePath)}`,
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "xgc_update --check"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(capturePath, "utf8")) as string[], ["update", "--check"]);
});

test("interactive zsh sourcing does not keep the background updater in the shell job list", () => {
  const zshCheck = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" });
  if (zshCheck.status !== 0) {
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-detached-update-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const updaterDir = path.join(tempHome, ".config", "xgc");
  const updaterPath = path.join(updaterDir, "xgc-update.mjs");
  const updaterArgsPath = path.join(tempHome, "updater-args.json");
  fs.mkdirSync(updaterDir, { recursive: true });
  fs.writeFileSync(
    updaterPath,
    [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(updaterArgsPath)}, JSON.stringify(process.argv.slice(2)));`,
      "setTimeout(() => process.exit(0), 300);"
    ].join("\n")
  );

  const result = spawnSync(
    "zsh",
    [
      "-ic",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_AUTO_UPDATE_MODE=check",
        "export XGC_AUTO_UPDATE_ON_SHELL_START=1",
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "jobs -l",
        "print -- ---",
        "sleep 0.4",
        "jobs -l"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "");
  assert.equal(result.stdout.trim(), "---");
  assert.deepEqual(JSON.parse(fs.readFileSync(updaterArgsPath, "utf8")) as string[], [
    "--home-dir",
    tempHome,
    "--config-home",
    updaterDir,
    "--check",
    "--if-due",
    "--quiet"
  ]);
});

test("interactive zsh sourcing does not run updater unless shell-start updates are explicitly enabled", () => {
  const zshCheck = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" });
  if (zshCheck.status !== 0) {
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-zsh-no-startup-update-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const updaterDir = path.join(tempHome, ".config", "xgc");
  const markerPath = path.join(tempHome, "updater-ran.txt");
  const updaterPath = path.join(updaterDir, "xgc-update.mjs");
  fs.mkdirSync(updaterDir, { recursive: true });
  fs.writeFileSync(
    updaterPath,
    [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(markerPath)}, 'ran\\n');`
    ].join("\n")
  );

  const result = spawnSync(
    "zsh",
    [
      "-ic",
      [
        sanitizedXgcEnvPrelude,
        `export HOME=${shellQuote(tempHome)}`,
        `export XGC_COPILOT_RAW_BIN=${shellQuote(rawBin)}`,
        "export XGC_AUTO_UPDATE_MODE=check",
        `source ${shellQuote(path.join(repoRoot, "scripts/xgc-shell.sh"))}`,
        "print -- ready"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "");
  assert.equal(result.stdout.trim(), "ready");
  assert.equal(fs.existsSync(markerPath), false);
});

test("review wrapper suppresses GitHub context in local workspaces without repo identity", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-local-no-remote-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-local-no-remote-workspace-"));
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    cwd: workspace,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(call.argv.includes("--no-experimental"));
});

test("explicit XGC_COPILOT_RAW_BIN overrides generated profile.env", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-env-override-"));
  const configHome = path.join(tempHome, ".config", "xgc");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "profile.env"),
    "export XGC_COPILOT_RAW_BIN=/definitely/not/the/fake/raw/bin\n"
  );

  const rawBin = createFakeRawCopilot(tempHome);
  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(call.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(call.argv).slice(0, 2), ["--agent", "repo-master"]);
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
});

test("explicit XGC_PERMISSION_MODE overrides generated profile.env", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-permission-env-override-"));
  const configHome = path.join(tempHome, ".config", "xgc");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(path.join(configHome, "profile.env"), "export XGC_PERMISSION_MODE='yolo'\n");

  const rawBin = createFakeRawCopilot(tempHome);
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${rawBin.replace(/'/g, `'\\''`)}'`,
        "export XGC_PERMISSION_MODE='ask'",
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        "copilot --prompt 'hi'"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as { argv: string[] };
  assert.ok(!call.argv.includes("--allow-all"));
});

test("env.sh cannot override shell operational settings at invocation time", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-runtime-env-guard-"));
  const configHome = path.join(tempHome, ".config", "xgc");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "env.sh"),
    [
      "export XGC_PERMISSION_MODE='yolo'",
      "export XGC_COPILOT_PROFILE_HOME='/tmp/stale-profile-from-env-sh'",
      "export XGC_COPILOT_RAW_BIN='/tmp/stale-raw-bin-from-env-sh'",
      "export XGC_REASONING_EFFORT='xhigh'",
      "export XGC_REASONING_EFFORT_CAP='xhigh'",
      "export COPILOT_HOME='/tmp/stale-copilot-home-from-env-sh'",
      "export PATH='/tmp/stale-path-from-env-sh'",
      "export XGC_SESSION_TEST_SECRET='still-loaded'"
    ].join("\n") + "\n"
  );
  const rawBin = createFakeRawCopilot(tempHome);
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${rawBin.replace(/'/g, `'\\''`)}'`,
        "export XGC_PERMISSION_MODE='work'",
        "export XGC_REASONING_EFFORT='off'",
        "export XGC_REASONING_EFFORT_CAP='high'",
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        "copilot --prompt 'hi'"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as {
    argv: string[];
    copilotHome: string | null;
    sessionSecret: string | null;
    pathEnv: string | null;
  };
  assert.ok(call.argv.includes("--allow-tool=write"));
  assert.ok(!call.argv.includes("--allow-all"));
  assert.ok(!call.argv.some((entry) => entry.startsWith("--reasoning-effort")));
  assert.equal(call.copilotHome, path.join(tempHome, ".copilot-xgc"));
  assert.equal(call.sessionSecret, "still-loaded");
  assert.notEqual(call.pathEnv, "/tmp/stale-path-from-env-sh");
});

test("env.sh cannot override COPILOT_HOME for raw Copilot calls", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-raw-copilot-home-guard-"));
  const configHome = path.join(tempHome, ".config", "xgc");
  const launcherCopilotHome = path.join(tempHome, "launcher-copilot-home");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(path.join(configHome, "env.sh"), "export COPILOT_HOME='/tmp/stale-copilot-home-from-env-sh'\n");
  const rawBin = createFakeRawCopilot(tempHome);
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `export COPILOT_HOME='${launcherCopilotHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${rawBin.replace(/'/g, `'\\''`)}'`,
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        "copilot_raw --version"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout.trim()) as { copilotHome: string | null };
  assert.equal(call.copilotHome, launcherCopilotHome);
});

test("explicit GitHub MCP flags prevent the shim from auto-disabling builtin MCPs", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-github-override-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --agent repo-master --add-github-mcp-tool '*' --prompt 'hi'"
  });

  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(!call.argv.includes("--no-experimental"));
  assert.ok(call.argv.includes("--add-github-mcp-tool"));
});

test("permission flags do not prevent local-context MCP suppression", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-permission-tool-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --agent repo-master --allow-tool=write --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--allow-tool=write"));
  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(call.argv.includes("--no-experimental"));
});

test("explicit experimental context flags prevent duplicate experimental suppression", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-experimental-override-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --no-experimental --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.equal(call.argv.filter((entry) => entry === "--no-experimental").length, 1);
});

test("cached GitHub PR probe failures disable GitHub context earlier on review lanes", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const configHome = path.join(tempHome, ".config", "xgc");
  const workspace = createGitHubRemoteWorkspace();
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    "example/xgc\tmemory-enabled\tsession-1\t2026-04-09T00:00:00Z\nexample/xgc\tpr-lookup\tsession-1\t2026-04-09T00:00:01Z\n"
  );

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: workspace,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--no-experimental"));
  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
});

test("probe cache lookup normalizes GitHub remote trailing slashes", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-remote-slash-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const configHome = path.join(tempHome, ".config", "xgc");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-remote-slash-workspace-"));
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    "example-org/test-repo\tpr-lookup\tsession-1\t2026-04-09T00:00:01Z\n"
  );
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo/"], {
    cwd: workspace,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: workspace,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--disable-builtin-mcps"));
  assert.ok(call.argv.includes("--disable-mcp-server=github-mcp-server"));
});

test("probe cache seeding does not mark PR lookup failed from unrelated 404 lines", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-pr-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const profileHome = path.join(tempHome, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-repo-"));

  fs.mkdirSync(logRoot, { recursive: true });
  fs.writeFileSync(
    path.join(logRoot, "process-1.log"),
    [
      "2026-04-09T06:00:00.000Z [DEBUG] GET /repos/example-org/test-repo/pulls?head=main 200",
      "2026-04-09T06:00:01.000Z [DEBUG] GET /some/other/endpoint failed with status 404"
    ].join("\n")
  );

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(!call.argv.includes("--no-experimental"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));
});

test("review wrapper allows GitHub context for ssh URL GitHub remotes", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-ssh-remote-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-ssh-remote-repo-"));

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "ssh://git@github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(!call.argv.includes("--no-experimental"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));
});

test("probe cache seeding records GET-style memory 404s", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-memory-get-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const profileHome = path.join(tempHome, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-memory-get-repo-"));

  fs.mkdirSync(logRoot, { recursive: true });
  fs.writeFileSync(
    path.join(logRoot, "process-1.log"),
    [
      "2026-04-09T06:00:00.000Z [WARN] GET /internal/memory/v0/example-org/test-repo/enabled 404",
      "2026-04-09T06:00:01.000Z [WARN] GET /internal/memory/v0/example-org/test-repo/prompt 404"
    ].join("\n")
  );

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--no-experimental"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));
  const probeCache = fs.readFileSync(path.join(tempHome, ".config", "xgc", "github-probe-cache.tsv"), "utf8");
  assert.match(probeCache, /memory-enabled/);
  assert.match(probeCache, /memory-prompt/);
});

test("probe cache seeding reuses successful memory enablement without disabling GitHub MCP review context", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-success-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const profileHome = path.join(tempHome, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-success-repo-"));

  fs.mkdirSync(logRoot, { recursive: true });
  fs.writeFileSync(
    path.join(logRoot, "process-1.log"),
    [
      "2026-04-09T06:00:00.000Z [INFO] [Octokit] GET /repos/example-org/test-repo/pulls?head=main - 200 with id abc in 18ms",
      "2026-04-09T06:00:01.000Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--no-experimental"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));

  const probeCache = fs.readFileSync(path.join(tempHome, ".config", "xgc", "github-probe-cache.tsv"), "utf8");
  assert.match(probeCache, /memory-enabled-success/);
  assert.match(probeCache, /pr-lookup-success/);
});

test("probe cache seeding reuses legacy three-column success rows without appending duplicate session rows", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-legacy-success-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const profileHome = path.join(tempHome, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const configHome = path.join(tempHome, ".config", "xgc");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-legacy-success-repo-"));

  fs.mkdirSync(logRoot, { recursive: true });
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    [
      "example-org/test-repo\tmemory-enabled-success\t2026-04-09T00:00:00Z",
      "example-org/test-repo\tpr-lookup-success\t2026-04-09T00:00:01Z"
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    path.join(logRoot, "process-1.log"),
    [
      "2026-04-09T06:00:00.000Z [INFO] Workspace initialized: session-legacy (checkpoints: 0)",
      "2026-04-09T06:00:00.500Z [INFO] [Octokit] GET /repos/example-org/test-repo/pulls?head=main - 200 with id abc in 18ms",
      "2026-04-09T06:00:01.000Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--no-experimental"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));

  const probeCache = fs.readFileSync(path.join(configHome, "github-probe-cache.tsv"), "utf8").trim().split("\n");
  assert.equal(probeCache.length, 2);
  assert.deepEqual(probeCache, [
    "example-org/test-repo\tmemory-enabled-success\t2026-04-09T00:00:00Z",
    "example-org/test-repo\tpr-lookup-success\t2026-04-09T00:00:01Z"
  ]);
});

test("probe cache seeding does not reuse memory success from unrelated repository logs", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-cross-repo-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const profileHome = path.join(tempHome, ".copilot-xgc");
  const logRoot = path.join(profileHome, "logs");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-cross-repo-repo-"));

  fs.mkdirSync(logRoot, { recursive: true });
  fs.writeFileSync(
    path.join(logRoot, "process-1.log"),
    [
      "2026-04-09T06:00:00.000Z [INFO] [Octokit] GET /repos/example-org/other-repo/pulls?head=main - 200 with id abc in 18ms",
      "2026-04-09T06:00:01.000Z [INFO] Memory enablement check: enabled"
    ].join("\n")
  );

  spawnSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example-org/test-repo.git"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: repoRoot,
    fnCall: "xgc_review --prompt 'hi'"
  });

  assert.ok(!call.argv.includes("--no-experimental"));
  const probeCachePath = path.join(tempHome, ".config", "xgc", "github-probe-cache.tsv");
  const probeCache = fs.existsSync(probeCachePath) ? fs.readFileSync(probeCachePath, "utf8") : "";
  assert.doesNotMatch(probeCache, /memory-enabled-success/);
  assert.doesNotMatch(probeCache, /pr-lookup-success/);
});

test("explicit GitHub MCP override bypasses repo-level probe cache suppression", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-probe-cache-override-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const configHome = path.join(tempHome, ".config", "xgc");
  const workspace = createGitHubRemoteWorkspace();
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "github-probe-cache.tsv"),
    "example/xgc\tmemory-enabled\tsession-1\t2026-04-09T00:00:00Z\nexample/xgc\tpr-lookup\tsession-1\t2026-04-09T00:00:01Z\n"
  );

  const call = sourceShimAndRun({
    tempHome,
    rawBin,
    disableProbeCache: false,
    cwd: workspace,
    fnCall: "xgc_review --add-github-mcp-tool '*' --prompt 'hi'"
  });

  assert.ok(call.argv.includes("--add-github-mcp-tool"));
  assert.ok(!call.argv.includes("--disable-builtin-mcps"));
  assert.ok(!call.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(!call.argv.includes("--no-experimental"));
});

test("permission modes inject documented approval flags", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-permissions-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const workCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "export XGC_PERMISSION_MODE=work; copilot --prompt 'hi'"
  });
  assert.ok(workCall.argv.includes("--allow-tool=write"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(pwd)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(git:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(gh:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(printf:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(cat:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(sed:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(find:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(head:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(tail:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(wc:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(grep:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(awk:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(jq:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(mkdir:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(touch:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(cp:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(mv:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(npm:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(npx:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(yarn:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(bun:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(tsx:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(rg:*)"));
  assert.ok(workCall.argv.includes("--allow-tool=shell(ls:*)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(rm)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(rm:*)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(sudo)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(sudo:*)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(chmod)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(chmod:*)"));
  assert.ok(workCall.argv.includes("--deny-tool=shell(git push)"));
  assert.ok(workCall.argv.includes("--allow-url=github.com"));

  const yoloCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "export XGC_PERMISSION_MODE=yolo; copilot --prompt 'hi'"
  });
  assert.ok(yoloCall.argv.includes("--allow-all"));

  const explicitPermissionCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "export XGC_PERMISSION_MODE=yolo; copilot --allow-all-tools --prompt 'hi'"
  });
  assert.ok(explicitPermissionCall.argv.includes("--allow-all-tools"));
  assert.ok(!explicitPermissionCall.argv.includes("--allow-all"));
});

test("reasoning effort defaults to the configured account cap unless explicitly overridden", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-reasoning-effort-"));
  const rawBin = createFakeRawCopilot(tempHome);

  const defaultCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --prompt 'hi'"
  });
  assert.ok(defaultCall.argv.includes("--reasoning-effort=high"));
  assert.ok(!defaultCall.argv.includes("--reasoning-effort=xhigh"));

  const highOnlyModelCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --model claude-sonnet-4.6 --prompt 'hi'"
  });
  assert.ok(highOnlyModelCall.argv.includes("--reasoning-effort=high"));
  assert.ok(!highOnlyModelCall.argv.includes("--reasoning-effort=xhigh"));

  const xhighModelCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --model gpt-5.4 --prompt 'hi'"
  });
  assert.ok(xhighModelCall.argv.includes("--reasoning-effort=high"));
  assert.ok(!xhighModelCall.argv.includes("--reasoning-effort=xhigh"));

  const xhighCapableModelCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "export XGC_REASONING_EFFORT_CAP=xhigh; copilot --model gpt-5.4 --prompt 'hi'"
  });
  assert.ok(xhighCapableModelCall.argv.includes("--reasoning-effort=xhigh"));

  const helperCapCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_effort_cap xhigh >/dev/null; copilot --model gpt-5.4 --prompt 'hi'"
  });
  assert.ok(helperCapCall.argv.includes("--reasoning-effort=xhigh"));

  const profileAgentsDir = path.join(tempHome, ".copilot-xgc", "agents");
  fs.mkdirSync(profileAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(profileAgentsDir, "milestone.agent.md"), "---\nname: Milestone\nmodel: claude-sonnet-4.6\n---\n");
  const highOnlyAgentCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "xgc_plan --prompt 'hi'"
  });
  assert.ok(highOnlyAgentCall.argv.includes("--reasoning-effort=high"));
  assert.ok(!highOnlyAgentCall.argv.includes("--reasoning-effort=xhigh"));

  const explicitLongFlagCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --reasoning-effort medium --prompt 'hi'"
  });
  assert.deepEqual(
    explicitLongFlagCall.argv.filter((entry) => entry === "--reasoning-effort=xhigh"),
    []
  );
  assert.ok(explicitLongFlagCall.argv.includes("--reasoning-effort"));
  assert.ok(explicitLongFlagCall.argv.includes("medium"));

  const explicitShortFlagCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --effort=high --prompt 'hi'"
  });
  assert.ok(!explicitShortFlagCall.argv.includes("--reasoning-effort=xhigh"));
  assert.ok(explicitShortFlagCall.argv.includes("--effort=high"));

  const disabledCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "export XGC_REASONING_EFFORT=off; copilot --prompt 'hi'"
  });
  assert.ok(!disabledCall.argv.some((entry) => entry.startsWith("--reasoning-effort")));
});

test("profile.env cannot redirect dedicated profile and config homes", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-profile-env-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const configHome = path.join(tempHome, ".config", "xgc");
  const altProfileHome = path.join(tempHome, ".copilot-alt");
  const altConfigHome = path.join(tempHome, ".config", "xgc-alt");
  fs.mkdirSync(configHome, { recursive: true });
  fs.writeFileSync(
    path.join(configHome, "profile.env"),
    [
      `export XGC_COPILOT_PROFILE_HOME='${altProfileHome.replace(/'/g, `'\\''`)}'`,
      `export XGC_COPILOT_CONFIG_HOME='${altConfigHome.replace(/'/g, `'\\''`)}'`
    ].join("\n") + "\n"
  );

  const inheritedCall = sourceShimAndRun({
    tempHome,
    rawBin,
    fnCall: "copilot --prompt 'hi'"
  });
  assert.equal(inheritedCall.copilotHome, path.join(tempHome, ".copilot-xgc"));

  const explicitOverride = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${rawBin.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_PROFILE_HOME='${path.join(tempHome, ".copilot-explicit").replace(/'/g, `'\\''`)}'`,
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        "copilot --prompt 'hi'"
      ].join("; ")
    ],
    { encoding: "utf8" }
  );
  assert.equal(explicitOverride.status, 0, explicitOverride.stderr);
  const parsed = JSON.parse(explicitOverride.stdout.trim()) as { copilotHome: string | null };
  assert.equal(parsed.copilotHome, path.join(tempHome, ".copilot-explicit"));
});

test("shell shim exports XGC_HOOK_SCRIPT_ROOT default for global profile hooks", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-hook-root-"));
  const rawBin = createFakeRawCopilot(tempHome);
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        sanitizedXgcEnvPrelude,
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `export XGC_COPILOT_RAW_BIN='${rawBin.replace(/'/g, `'\\''`)}'`,
        `source '${path.join(repoRoot, "scripts/xgc-shell.sh").replace(/'/g, `'\\''`)}'`,
        'printf "%s" "$XGC_HOOK_SCRIPT_ROOT"'
      ].join("; ")
    ],
    {
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, path.join(tempHome, ".config", "xgc", "hooks"));
});

test("global installer previews shell profile changes by default without writing", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-install-preview-"));
  const profilePath = path.join(tempHome, ".zshrc");
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
        `block="$(xgc_shell_source_block '$HOME/.config/xgc')"`,
        `xgc_preview_shell_profile_change '${profilePath.replace(/'/g, `'\\''`)}' "$block" 'source "$HOME/.config/xgc/xgc-shell.sh"'`
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Shell profile writes are disabled by default\./);
  assert.equal(fs.existsSync(profilePath), false);
});

test("global installer keeps final success guidance concise", () => {
  const installer = fs.readFileSync(path.join(repoRoot, "scripts/install-global-xgc.sh"), "utf8");
  assert.match(installer, /Open a new terminal, then run: copilot/);
  assert.match(installer, /please star the project: https:\/\/github\.com\/Juhwa-Lee1023\/x-for-github-copilot/);
  assert.doesNotMatch(installer, /Useful commands:/);
  assert.doesNotMatch(installer, /Verify shell activation in a new interactive shell/);
});

test("global installer writes an idempotent shell block and creates a backup", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-install-write-"));
  const profilePath = path.join(tempHome, ".zshrc");
  fs.writeFileSync(profilePath, "# existing shell config\n");

  const runWrite = () =>
    spawnSync(
      "bash",
      [
        "-lc",
        [
          `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
          `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
          `block="$(xgc_shell_source_block '$HOME/.config/xgc')"`,
          `xgc_write_shell_profile_block '${profilePath.replace(/'/g, `'\\''`)}' "$block" 'source "$HOME/.config/xgc/xgc-shell.sh"'`
        ].join("; ")
      ],
      { encoding: "utf8" }
    );

  const firstWrite = runWrite();
  assert.equal(firstWrite.status, 0, firstWrite.stderr);
  assert.match(firstWrite.stdout, /Updated shell profile:/);
  assert.match(firstWrite.stdout, /Backup created:/);

  const contentAfterFirstWrite = fs.readFileSync(profilePath, "utf8");
  assert.match(contentAfterFirstWrite, /# >>> xgc global mode >>>/);

  const backups = fs
    .readdirSync(tempHome)
    .filter((entry) => entry.startsWith(".zshrc.xgc-backup."));
  assert.equal(backups.length, 1);

  const secondWrite = runWrite();
  assert.equal(secondWrite.status, 0, secondWrite.stderr);
  assert.match(secondWrite.stdout, /already contains the X for GitHub Copilot activation block/i);

  const contentAfterSecondWrite = fs.readFileSync(profilePath, "utf8");
  const markerMatches = contentAfterSecondWrite.match(/# >>> xgc global mode >>>/g) ?? [];
  assert.equal(markerMatches.length, 1);
});

test("global installer refreshes an existing X for GitHub Copilot block when the sourced path differs", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-install-markers-"));
  const profilePath = path.join(tempHome, ".zshrc");
  fs.writeFileSync(
    profilePath,
    [
      "# existing shell config",
      "# >>> xgc global mode >>>",
      '[[ -f "/some/other/path/xgc-shell.sh" ]] && source "/some/other/path/xgc-shell.sh"',
      "# <<< xgc global mode <<<"
    ].join("\n") + "\n"
  );

  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        `export HOME='${tempHome.replace(/'/g, `'\\''`)}'`,
        `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
        `block="$(xgc_shell_source_block '$HOME/.config/xgc')"`,
        `xgc_write_shell_profile_block '${profilePath.replace(/'/g, `'\\''`)}' "$block" 'source "$HOME/.config/xgc/xgc-shell.sh"'`
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Refreshed stale X for GitHub Copilot activation block/i);
  const content = fs.readFileSync(profilePath, "utf8");
  const markerMatches = content.match(/# >>> xgc global mode >>>/g) ?? [];
  assert.equal(markerMatches.length, 1);
  assert.match(content, /\$HOME\/\.config\/xgc\/xgc-shell\.sh/);
  assert.doesNotMatch(content, /some\/other\/path/);
  const backups = fs
    .readdirSync(tempHome)
    .filter((entry) => entry.startsWith(".zshrc.xgc-backup."));
  assert.equal(backups.length, 1);
});

test("global installer detects versioned zsh and bash names for shell profile selection", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-install-versioned-shell-"));
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        `source '${path.join(repoRoot, "scripts/install-global-xgc.sh").replace(/'/g, `'\\''`)}'`,
        `printf "%s\\n" "$(xgc_detect_shell_profile_path zsh-5.9 '${tempHome.replace(/'/g, `'\\''`)}')"`,
        `printf "%s" "$(xgc_detect_shell_profile_path bash-5.2 '${tempHome.replace(/'/g, `'\\''`)}')"`
      ].join("; ")
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n"), [path.join(tempHome, ".zshrc"), path.join(tempHome, ".bashrc")]);
});
