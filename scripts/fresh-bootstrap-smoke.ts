import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { materializeGlobalProfile } from "./lib/global-xgc.js";
import { resolveAgentModelPolicy } from "./lib/model-policy.js";
import { validateHookManifestTruth } from "./lib/hook-path-truth.js";
import { resolveRepoRoot } from "./lib/runtime-surfaces.js";

const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));

function listFilesRecursive(root: string) {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(path.relative(root, fullPath));
      }
    }
  };
  walk(root);
  return files.sort();
}

function compareMirrors(expectedRoot: string, actualRoot: string, label: string) {
  assert.ok(fs.existsSync(actualRoot), `${label} is missing: ${actualRoot}`);
  const expectedFiles = listFilesRecursive(expectedRoot);
  const actualFiles = listFilesRecursive(actualRoot);
  assert.deepEqual(actualFiles, expectedFiles, `${label} file set drifted`);

  for (const file of expectedFiles) {
    assert.equal(
      fs.readFileSync(path.join(actualRoot, file), "utf8"),
      fs.readFileSync(path.join(expectedRoot, file), "utf8"),
      `${label} content drifted for ${file}`
    );
  }
}

function createFreshRepoFixture() {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-fresh-bootstrap-repo-"));
  fs.cpSync(path.join(repoRoot, "source"), path.join(tempRepo, "source"), { recursive: true });
  fs.cpSync(path.join(repoRoot, ".github"), path.join(tempRepo, ".github"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "hooks"), path.join(tempRepo, "hooks"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "runtime-dist"), path.join(tempRepo, "runtime-dist"), { recursive: true });
  fs.mkdirSync(path.join(tempRepo, "scripts"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "scripts", "hooks"), path.join(tempRepo, "scripts", "hooks"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "xgc-shell.sh"), path.join(tempRepo, "scripts", "xgc-shell.sh"));
  fs.copyFileSync(path.join(repoRoot, "scripts", "xgc-update.mjs"), path.join(tempRepo, "scripts", "xgc-update.mjs"));
  fs.copyFileSync(path.join(repoRoot, "lsp.json"), path.join(tempRepo, "lsp.json"));
  return tempRepo;
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

function runHookCommand(command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: string }) {
  return spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env,
    input: opts.stdin ?? "{}"
  });
}

function validateFailOpenHookCommands(tempRepo: string, materializedHookRoot: string, profileHome: string) {
  const commands = collectHookCommands(path.join(tempRepo, "hooks", "hooks.json"));
  assert.ok(commands.length > 0, "hook manifest must define command handlers");
  const bareWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-fresh-hook-no-scripts-"));

  for (const entry of commands) {
    const failOpenResult = runHookCommand(entry.command, {
      cwd: bareWorkspace,
      env: {
        ...process.env,
        XGC_HOOK_SCRIPT_ROOT: ""
      }
    });
    assert.equal(
      failOpenResult.status,
      0,
      `hook ${entry.hookName} must fail open in a fresh workspace without scripts/hooks\n${failOpenResult.stderr}`
    );
  }

  for (const entry of commands) {
    const absoluteRootResult = runHookCommand(entry.command, {
      cwd: bareWorkspace,
      env: {
        ...process.env,
        XGC_HOOK_SCRIPT_ROOT: materializedHookRoot,
        XGC_COPILOT_PROFILE_HOME: profileHome,
        XGC_LOG_ROOT: path.join(bareWorkspace, ".xgc", "logs")
      }
    });
    assert.equal(
      absoluteRootResult.status,
      0,
      `hook ${entry.hookName} must run through materialized absolute XGC_HOOK_SCRIPT_ROOT\n${absoluteRootResult.stderr}`
    );
  }
}

function parseFlatWorkspaceYaml(filePath: string) {
  const result: Record<string, unknown> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      result[key] = JSON.parse(value);
    } else if (value === "true" || value === "false") {
      result[key] = value === "true";
    } else if (value === "null") {
      result[key] = null;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function frontmatterModel(filePath: string) {
  const match = fs.readFileSync(filePath, "utf8").match(/^model:\s*(.+)$/m);
  return match?.[1].trim() ?? null;
}

function python3Available() {
  const result = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (result.error) {
    const launchError = result.error as NodeJS.ErrnoException;
    if (launchError.code === "ENOENT") return false;
    assert.fail(`Failed to probe python3 for workspace.yaml finalizer validation: ${launchError.message}`);
  }
  return result.status === 0;
}

function validateWorkspaceYamlFinalizer(tempRepo: string, tempHome: string) {
  if (!python3Available()) {
    console.warn("Skipping workspace.yaml finalizer validation because python3 is unavailable.");
    return;
  }

  const profileHome = path.join(tempHome, ".copilot-xgc");
  const sessionId = "fresh-bootstrap-yaml-safe";
  const sessionDir = path.join(profileHome, "session-state", sessionId);
  const transcriptPath = path.join(sessionDir, "events.jsonl");
  const workspaceYamlPath = path.join(sessionDir, "workspace.yaml");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    workspaceYamlPath,
    [
      `id: ${sessionId}`,
      `cwd: ${tempRepo}`,
      `git_root: ${tempRepo}`,
      "summary: Fresh bootstrap smoke",
      "summary_count: 0",
      "created_at: 2026-04-13T00:00:00.000Z",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "session.start", timestamp: "2026-04-13T00:00:00.000Z" }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-13T00:00:01.000Z",
        data: { text: "auth session failed: credentials missing" }
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-04-13T00:00:02.000Z",
        data: { text: "auth session failed: credentials missing again" }
      })
    ].join("\n") + "\n"
  );

  const result = spawnSync("python3", [path.join(repoRoot, "scripts/hooks/finalize-session-summary.py"), "agentStop"], {
    encoding: "utf8",
    input: JSON.stringify({
      sessionId,
      timestamp: Date.parse("2026-04-13T00:00:03.000Z"),
      cwd: tempRepo,
      transcriptPath,
      stopReason: "end_turn"
    }),
    env: {
      ...process.env,
      XGC_COPILOT_PROFILE_HOME: profileHome
    }
  });
  if (result.error) {
    const launchError = result.error as NodeJS.ErrnoException;
    assert.fail(`Failed to launch python3 for workspace.yaml finalizer validation: ${launchError.message}`);
  }
  assert.equal(result.status, 0, result.stderr);

  const rawWorkspaceYaml = fs.readFileSync(workspaceYamlPath, "utf8");
  assert.match(rawWorkspaceYaml, /^foundation_recovery_reason: "repeated foundation failure class\(es\): auth-session"$/m);
  const parsed = parseFlatWorkspaceYaml(workspaceYamlPath);
  assert.equal(parsed.foundation_recovery_reason, "repeated foundation failure class(es): auth-session");

  const validationWorkspaceYamlPath = path.join(tempRepo, ".xgc", "validation", "workspace.yaml");
  assert.ok(fs.existsSync(validationWorkspaceYamlPath), "repo-owned .xgc/validation/workspace.yaml was not written");
  const validationParsed = parseFlatWorkspaceYaml(validationWorkspaceYamlPath);
  assert.equal(validationParsed.operator_truth_source, "repo-owned-validation-workspace");
  assert.equal(validationParsed.foundation_recovery_reason, "repeated foundation failure class(es): auth-session");
}

async function main() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-fresh-bootstrap-home-"));
  const tempRepo = createFreshRepoFixture();
  const result = await materializeGlobalProfile({ repoRoot: tempRepo, homeDir: tempHome });

  compareMirrors(path.join(tempRepo, "agents"), result.paths.profileAgentsDir, "profile agents");
  compareMirrors(path.join(tempRepo, "skills"), result.paths.profileSkillsDir, "profile skills");
  compareMirrors(path.join(tempRepo, "scripts", "hooks"), result.paths.profileHookScriptsDir, "profile hook scripts");
  assert.equal(
    fs.readFileSync(result.paths.shellShimPath, "utf8"),
    fs.readFileSync(path.join(tempRepo, "scripts", "xgc-shell.sh"), "utf8"),
    "profile shell shim drifted from repo source"
  );
  assert.equal(
    fs.readFileSync(result.paths.updaterScriptPath, "utf8"),
    fs.readFileSync(path.join(tempRepo, "runtime-dist", "xgc-update.mjs"), "utf8"),
    "profile updater script drifted from repo source"
  );
  for (const agentId of ["visual-forge", "writing-desk", "multimodal-look", "artistry-studio"]) {
    const materializedAgent = path.join(result.paths.profileAgentsDir, `${agentId}.agent.md`);
    assert.ok(fs.existsSync(materializedAgent), `specialist agent was not materialized: ${agentId}`);
    assert.equal(frontmatterModel(materializedAgent), resolveAgentModelPolicy({ agentId, rootModel: result.rootModel }));
    assert.doesNotMatch(fs.readFileSync(materializedAgent, "utf8"), /^modelPolicy:/m);
  }
  assert.equal(
    fs.readFileSync(result.mcpConfigPath, "utf8"),
    fs.readFileSync(path.join(tempRepo, ".github", "mcp.json"), "utf8"),
    "profile MCP config drifted from repo source"
  );

  const lspConfig = JSON.parse(fs.readFileSync(result.lspConfigPath, "utf8")) as {
    lspServers?: Record<string, unknown>;
  };
  assert.ok(
    lspConfig.lspServers && typeof lspConfig.lspServers === "object" && !Array.isArray(lspConfig.lspServers),
    'fresh bootstrap profile lsp.json must contain root-level "lspServers"'
  );

  for (const manifestPath of [path.join(tempRepo, "hooks", "hooks.json"), path.join(tempRepo, ".github", "hooks", "xgc-hooks.json")]) {
    const truth = validateHookManifestTruth(manifestPath);
    assert.deepEqual(truth.staleLegacyHookCommands, [], `${manifestPath} contains stale legacy hook commands`);
    assert.deepEqual(truth.missingExpectedShellHooks, [], `${manifestPath} is missing expected shell hooks`);
    assert.deepEqual(
      truth.missingFailOpenShellHooks,
      [],
      `${manifestPath} must use fail-open shell hook commands (XGC_HOOK_SCRIPT_ROOT -> ./scripts/hooks when present -> exit 0)`
    );
  }

  validateFailOpenHookCommands(tempRepo, result.paths.profileHookScriptsDir, result.paths.profileHome);

  validateWorkspaceYamlFinalizer(tempRepo, tempHome);

  console.log(`Fresh bootstrap smoke passed: ${tempRepo}`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
