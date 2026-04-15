import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectInstalledPlugin, pluginListedInOutput, writeText } from "./lib/runtime-validation.js";
import { resolveGlobalPaths, shellQuote } from "./lib/global-xgc.js";
import { normalizeRootModel, resolveAgentModelPolicy } from "./lib/model-policy.js";
import {
  findLegacyHookPluginConflicts,
  formatLegacyHookPluginConflict,
  validateHookManifestTruth
} from "./lib/hook-path-truth.js";
import { renderRuntimeAgentContent, resolveRepoRoot } from "./lib/runtime-surfaces.js";
import { renderRuntimeSourceReportMarkdown, resolveRuntimeSourceReport } from "./lib/runtime-source-resolution.js";

// Global X for GitHub Copilot validation checks:
// - dedicated profile materialization
// - wrapper behavior and shortcut routing
// - winning runtime surfaces and declared models under X profile mode

function parseArgs(argv: string[]) {
  const args = {
    repoRoot: resolveRepoRoot(fileURLToPath(import.meta.url)),
    homeDir: os.homedir(),
    allowLegacyPlugins: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--repo-root" && argv[index + 1]) {
      args.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--home-dir" && argv[index + 1]) {
      args.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--allow-legacy-plugins") {
      args.allowLegacyPlugins = true;
    }
  }

  return args;
}

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

function globalRepairHint(label: string) {
  return [
    `${label} drift repair:`,
    "  xgc install",
    "  xgc doctor",
    "Repo-checkout development alternative:",
    "  npm run materialize:global && npm run validate:global"
  ].join("\n");
}

function readShellExportValue(filePath: string, key: string) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(`^\\s*(?:export\\s+)?${escapedKey}=([^\\n#]+)`, "gm"))];
  const match = matches.at(-1);
  if (!match) return null;
  const raw = match[1].trim();
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function assertProfileEnvHomeTruth(paths: ReturnType<typeof resolveGlobalPaths>) {
  const profileHome = readShellExportValue(paths.shellEnvPath, "XGC_COPILOT_PROFILE_HOME");
  const configHome = readShellExportValue(paths.shellEnvPath, "XGC_COPILOT_CONFIG_HOME");
  if (profileHome !== null) {
    assert.equal(
      profileHome,
      paths.profileHome,
      `profile.env must not redirect XGC_COPILOT_PROFILE_HOME away from the dedicated profile\n${globalRepairHint("profile.env")}`
    );
  }
  if (configHome !== null) {
    assert.equal(
      configHome,
      paths.configHome,
      `profile.env must not redirect XGC_COPILOT_CONFIG_HOME away from the dedicated config home\n${globalRepairHint("profile.env")}`
    );
  }
}

function compareMirrors(expectedRoot: string, actualRoot: string, label: string) {
  assert.ok(fs.existsSync(actualRoot), `${label} is missing: ${actualRoot}`);
  const expected = listFilesRecursive(expectedRoot);
  const actual = listFilesRecursive(actualRoot);
  assert.deepEqual(actual, expected, `${label} file set drifted\n${globalRepairHint(label)}`);

  for (const file of expected) {
    const expectedContent = fs.readFileSync(path.join(expectedRoot, file), "utf8");
    const actualContent = fs.readFileSync(path.join(actualRoot, file), "utf8");
    assert.equal(actualContent, expectedContent, `${label} content drifted for ${file}\n${globalRepairHint(label)}`);
  }
}

function compareAgentMirror(expectedSourceRoot: string, actualRoot: string, rootModel: string, label: string) {
  assert.ok(fs.existsSync(actualRoot), `${label} is missing: ${actualRoot}`);
  const expected = listFilesRecursive(expectedSourceRoot);
  const actual = listFilesRecursive(actualRoot);
  assert.deepEqual(actual, expected, `${label} file set drifted\n${globalRepairHint(label)}`);

  for (const file of expected) {
    const expectedContent = renderRuntimeAgentContent(fs.readFileSync(path.join(expectedSourceRoot, file), "utf8"), {
      agentId: path.basename(file, ".agent.md"),
      rootModel
    });
    const actualContent = fs.readFileSync(path.join(actualRoot, file), "utf8");
    assert.equal(actualContent, expectedContent, `${label} content drifted for ${file}\n${globalRepairHint(label)}`);
    assert.doesNotMatch(actualContent, /^modelPolicy:/m, `${label} leaked source-only modelPolicy for ${file}`);
  }
}

function createFakeCopilot(tempRoot: string) {
  const scriptPath = path.join(tempRoot, "copilot-raw");
  fs.writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "python3 - \"$@\" <<'PY'",
      "import json, os, sys",
      "print(json.dumps({\"argv\": sys.argv[1:], \"copilotHome\": os.environ.get(\"COPILOT_HOME\")}))",
      "PY"
    ].join("\n")
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runShellCall(opts: {
  shimPath: string;
  rawBin: string;
  profileHome: string;
  configHome: string;
  fnCall: string;
  cwd?: string;
}) {
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        "unset XGC_COPILOT_PROFILE_HOME",
        "unset XGC_COPILOT_CONFIG_HOME",
        "unset XGC_PROFILE_ENV_FILE",
        "unset XGC_ENV_FILE",
        "unset XGC_SESSION_ENV_FILE",
        "unset XGC_HOOK_SCRIPT_ROOT",
        "unset XGC_PERMISSION_MODE",
        `export XGC_COPILOT_RAW_BIN=${shellQuote(opts.rawBin)}`,
        `export XGC_COPILOT_PROFILE_HOME=${shellQuote(opts.profileHome)}`,
        `export XGC_COPILOT_CONFIG_HOME=${shellQuote(opts.configHome)}`,
        `export XGC_DISABLE_PROBE_CACHE='1'`,
        `source ${shellQuote(opts.shimPath)}`,
        opts.fnCall
      ].join("; ")
    ],
    {
      encoding: "utf8",
      cwd: opts.cwd
    }
  );

  assert.equal(result.status, 0, `shell shim invocation failed: ${opts.fnCall}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim()) as { argv: string[]; copilotHome: string | null };
}

function createGitHubRemoteWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-validate-github-workspace-"));
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example/xgc.git"], {
    cwd: workspace,
    stdio: "ignore"
  });
  return workspace;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolveGlobalPaths(args.homeDir);
  const surfaceReportJson = path.join(args.repoRoot, ".xgc", "validation", "surface-resolution.json");
  const surfaceReportMd = path.join(args.repoRoot, ".xgc", "validation", "surface-resolution.md");

  assert.ok(fs.existsSync(paths.profileHome), `X for GitHub Copilot profile home is missing: ${paths.profileHome}`);
  assert.ok(fs.existsSync(paths.configHome), `X for GitHub Copilot config home is missing: ${paths.configHome}`);
  assert.ok(fs.existsSync(paths.profileConfigPath), `profile config is missing: ${paths.profileConfigPath}`);
  assert.ok(fs.existsSync(paths.profileMcpConfigPath), `profile MCP config is missing: ${paths.profileMcpConfigPath}`);
  assert.ok(fs.existsSync(paths.profileLspConfigPath), `profile LSP config is missing: ${paths.profileLspConfigPath}`);
  assert.ok(fs.existsSync(paths.profileHookScriptsDir), `profile hook scripts are missing: ${paths.profileHookScriptsDir}`);
  assert.ok(fs.existsSync(paths.shellShimPath), `installed X for GitHub Copilot shell shim is missing: ${paths.shellShimPath}`);
  assertProfileEnvHomeTruth(paths);
  assert.ok(fs.existsSync(path.join(paths.profileHookScriptsDir, "session-start.sh")), "session-start hook script is missing from X for GitHub Copilot config home");
  assert.ok(fs.existsSync(path.join(paths.profileHookScriptsDir, "common.sh")), "hook common helper is missing from X for GitHub Copilot config home");
  compareMirrors(path.join(args.repoRoot, "scripts", "hooks"), paths.profileHookScriptsDir, "profile hook scripts");
  const sourceHookTruth = validateHookManifestTruth(path.join(args.repoRoot, "hooks/hooks.json"));
  assert.equal(
    sourceHookTruth.staleLegacyHookCommands.length,
    0,
    `source hook manifest still references stale .mjs hooks: ${sourceHookTruth.staleLegacyHookCommands
      .map((entry) => `${entry.hookName}=${entry.command}`)
      .join("; ")}`
  );
  assert.equal(
    sourceHookTruth.unsafeWorkspaceHookCommands.length,
    0,
    `source hook manifest directly invokes workspace-relative .sh hooks without fail-open guards: ${sourceHookTruth.unsafeWorkspaceHookCommands
      .map((entry) => `${entry.hookName}=${entry.command}`)
      .join("; ")}`
  );
  assert.equal(
    sourceHookTruth.missingExpectedShellHooks.length,
    0,
    `source hook manifest is missing current .sh hook commands for: ${sourceHookTruth.missingExpectedShellHooks.join(", ")}`
  );
  assert.equal(
    sourceHookTruth.missingFailOpenShellHooks.length,
    0,
    `source hook manifest must use fail-open shell commands (XGC_HOOK_SCRIPT_ROOT -> ./scripts/hooks when present -> exit 0) for: ${sourceHookTruth.missingFailOpenShellHooks.join(", ")}`
  );
  const materializedHookScripts = listFilesRecursive(paths.profileHookScriptsDir);
  assert.equal(
    materializedHookScripts.some((entry) => entry.endsWith(".mjs")),
    false,
    `materialized X for GitHub Copilot hook scripts must not include stale .mjs entrypoints: ${materializedHookScripts.filter((entry) => entry.endsWith(".mjs")).join(", ")}`
  );
  const rawProfileConflicts = findLegacyHookPluginConflicts({ homeDir: args.homeDir });
  const xgcProfileConflicts = findLegacyHookPluginConflicts({ homeDir: paths.profileHome });
  assert.equal(
    xgcProfileConflicts.length,
    0,
    `X for GitHub Copilot profile contains stale legacy hook plugin conflicts: ${xgcProfileConflicts.map(formatLegacyHookPluginConflict).join("\n")}`
  );
  if (rawProfileConflicts.length > 0) {
    const message = [
      "Raw/default Copilot profile contains enabled stale legacy hook plugin conflicts.",
      "Fresh raw `copilot` runs may execute old .mjs hooks or unsafe workspace-relative .sh hooks from that profile even though X for GitHub Copilot source hooks are fail-open .sh scripts.",
      "Run `npm run repair:raw-hooks` to rewrite known stale hook manifests with backups, disable/uninstall the legacy plugin, or run through the X for GitHub Copilot profile/shell.",
      "Use --allow-legacy-plugins only for intentional compatibility investigation.",
      ...rawProfileConflicts.map((conflict) => `- ${formatLegacyHookPluginConflict(conflict)}`)
    ].join("\n");
    assert.ok(args.allowLegacyPlugins, message);
    console.warn(message);
  }

  const profileLspConfig = JSON.parse(fs.readFileSync(paths.profileLspConfigPath, "utf8")) as {
    lspServers?: Record<string, unknown>;
  };
  assert.ok(
    profileLspConfig.lspServers && typeof profileLspConfig.lspServers === "object" && !Array.isArray(profileLspConfig.lspServers),
    'X for GitHub Copilot profile lsp.json must contain a root-level "lspServers" object'
  );

  const profileConfig = JSON.parse(fs.readFileSync(paths.profileConfigPath, "utf8")) as { model?: string };
  const rootModel = normalizeRootModel(profileConfig.model);
  compareAgentMirror(path.join(args.repoRoot, "source", "agents"), paths.profileAgentsDir, rootModel, "profile agents");
  compareMirrors(path.join(args.repoRoot, "skills"), paths.profileSkillsDir, "profile skills");
  assert.equal(
    fs.readFileSync(paths.shellShimPath, "utf8"),
    fs.readFileSync(path.join(args.repoRoot, "scripts", "xgc-shell.sh"), "utf8"),
    `profile shell shim content drifted\n${globalRepairHint("profile shell shim")}`
  );

  const pluginEvidence = inspectInstalledPlugin("xgc", {
    homeDir: paths.profileHome,
    sourcePath: args.repoRoot
  });
  assert.equal(pluginEvidence.registeredInConfig, true, "X for GitHub Copilot plugin is not registered in the X profile config");

  const copilotResult = spawnSync("bash", ["-lc", `COPILOT_HOME='${paths.profileHome.replace(/'/g, `'\\''`)}' copilot plugin list`], {
    encoding: "utf8"
  });
  assert.equal(copilotResult.status, 0, `copilot plugin list failed under X for GitHub Copilot profile\n${copilotResult.stderr}`);
  assert.equal(pluginListedInOutput(copilotResult.stdout, "xgc"), true, "xgc is not visible in plugin list under X for GitHub Copilot profile");

  const surfaceReport = resolveRuntimeSourceReport({
    repoRoot: args.repoRoot,
    workspaceRoot: args.repoRoot,
    copilotHome: paths.profileHome,
    copilotConfigPath: pluginEvidence.configPath,
    pluginCachePath: pluginEvidence.cachedPluginPath,
    xgcProfileHome: paths.profileHome
  });
  for (const winner of [...surfaceReport.agents, ...surfaceReport.skills]) {
    assert.equal(
      winner.winner?.layer,
      "user-level-profile",
      `${winner.kind} ${winner.id} should resolve to the user-level X for GitHub Copilot profile copy in global mode`
    );
  }
  const repoMaster = surfaceReport.agents.find((entry) => entry.id === "repo-master");
  assert.equal(
    repoMaster?.winner?.model,
    null,
    `repo-master should omit static model frontmatter and inherit active root model ${rootModel} in global X for GitHub Copilot mode`
  );
  for (const laneId of ["repo-scout", "ref-index"]) {
    const lane = surfaceReport.agents.find((entry) => entry.id === laneId);
    assert.equal(
      lane?.winner?.model,
      resolveAgentModelPolicy({ agentId: laneId, rootModel }),
      `${laneId} should resolve through parent-aware model policy in global X for GitHub Copilot mode`
    );
  }
  writeText(surfaceReportJson, `${JSON.stringify(surfaceReport, null, 2)}\n`);
  writeText(surfaceReportMd, renderRuntimeSourceReportMarkdown(surfaceReport));

  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-shell-validate-"));
  const fakeRaw = createFakeCopilot(fakeRoot);
  const githubWorkspace = createGitHubRemoteWorkspace();
  const injectedContextFlags = new Set([
    "--disable-builtin-mcps",
    "--disable-mcp-server=github-mcp-server",
    "--no-experimental"
  ]);
  const isInjectedPermissionFlag = (entry: string) =>
    entry === "--allow-all" ||
    entry === "--allow-all-tools" ||
    entry === "--allow-all-paths" ||
    entry === "--allow-all-urls" ||
    entry.startsWith("--allow-tool=") ||
    entry.startsWith("--deny-tool=") ||
    entry.startsWith("--allow-url=") ||
    entry.startsWith("--deny-url=");
  const withoutInjectedFlags = (argv: string[]) =>
    argv.filter((entry) => !injectedContextFlags.has(entry) && !isInjectedPermissionFlag(entry));
  const shellEnvText = fs.existsSync(paths.shellEnvPath) ? fs.readFileSync(paths.shellEnvPath, "utf8") : "";
  assert.match(shellEnvText, /XGC_PERMISSION_MODE='?(ask|work|yolo)'?/, "profile.env should persist an X for GitHub Copilot permission mode");

  const defaultCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "copilot --prompt 'hi'"
  });
  assert.equal(defaultCall.copilotHome, paths.profileHome);
  assert.ok(defaultCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(defaultCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(defaultCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(defaultCall.argv).slice(0, 2), ["--agent", "repo-master"]);

  if (spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).status === 0) {
    const zshResult = spawnSync(
      "zsh",
      [
        "-lc",
        [
          "set -u",
          "unset XGC_COPILOT_PROFILE_HOME",
          "unset XGC_COPILOT_CONFIG_HOME",
          "unset XGC_PROFILE_ENV_FILE",
          "unset XGC_ENV_FILE",
          "unset XGC_SESSION_ENV_FILE",
          "unset XGC_HOOK_SCRIPT_ROOT",
          "unset XGC_PERMISSION_MODE",
          `export XGC_COPILOT_RAW_BIN=${shellQuote(fakeRaw)}`,
          `export XGC_COPILOT_PROFILE_HOME=${shellQuote(paths.profileHome)}`,
          `export XGC_COPILOT_CONFIG_HOME=${shellQuote(paths.configHome)}`,
          "export XGC_DISABLE_PROBE_CACHE=1",
          `source ${shellQuote(paths.shellShimPath)}`,
          "copilot --prompt hi"
        ].join("; ")
      ],
      { encoding: "utf8" }
    );
    assert.equal(zshResult.status, 0, `zsh shell shim invocation failed\n${zshResult.stderr}`);
    assert.doesNotMatch(zshResult.stderr, /BASH_SOURCE/);
    const zshCall = JSON.parse(zshResult.stdout.trim()) as { argv: string[]; copilotHome: string | null };
    assert.equal(zshCall.copilotHome, paths.profileHome);
    assert.deepEqual(withoutInjectedFlags(zshCall.argv).slice(0, 2), ["--agent", "repo-master"]);
  }

  const explicitAgentCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "copilot --agent ref-index --prompt 'hi'"
  });
  assert.equal(explicitAgentCall.copilotHome, paths.profileHome);
  assert.ok(explicitAgentCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(explicitAgentCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(explicitAgentCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(explicitAgentCall.argv).slice(0, 2), ["--agent", "ref-index"]);
  assert.ok(!explicitAgentCall.argv.includes("repo-master"));

  const explicitConfigDirCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "copilot --config-dir /tmp/custom-copilot --prompt 'hi'"
  });
  assert.equal(explicitConfigDirCall.copilotHome, null);
  assert.ok(!explicitConfigDirCall.argv.includes("repo-master"));
  assert.deepEqual(explicitConfigDirCall.argv.slice(0, 2), ["--config-dir", "/tmp/custom-copilot"]);

  const managementCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "copilot plugin list"
  });
  assert.equal(managementCall.copilotHome, paths.profileHome);
  assert.deepEqual(managementCall.argv.slice(0, 2), ["plugin", "list"]);
  assert.ok(!managementCall.argv.includes("repo-master"));
  assert.ok(!managementCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(!managementCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(!managementCall.argv.includes("--no-experimental"));

  const shortcutCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "xgc_review --prompt 'hi'",
    cwd: githubWorkspace
  });
  assert.equal(shortcutCall.copilotHome, paths.profileHome);
  assert.deepEqual(withoutInjectedFlags(shortcutCall.argv).slice(0, 2), ["--agent", "merge-gate"]);
  assert.ok(!shortcutCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(!shortcutCall.argv.includes("--disable-mcp-server=github-mcp-server"));
  assert.ok(!shortcutCall.argv.includes("--no-experimental"));

  const planShortcutCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "xgc_plan --prompt 'hi'"
  });
  assert.ok(planShortcutCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(planShortcutCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(planShortcutCall.argv).slice(0, 2), ["--agent", "milestone"]);

  const triageShortcutCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "xgc_triage --prompt 'hi'"
  });
  assert.ok(triageShortcutCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(triageShortcutCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(triageShortcutCall.argv).slice(0, 2), ["--agent", "triage"]);

  const checkShortcutCall = runShellCall({
    shimPath: paths.shellShimPath,
    rawBin: fakeRaw,
    profileHome: paths.profileHome,
    configHome: paths.configHome,
    fnCall: "xgc_check --prompt 'hi'"
  });
  assert.ok(checkShortcutCall.argv.includes("--disable-builtin-mcps"));
  assert.ok(checkShortcutCall.argv.includes("--no-experimental"));
  assert.deepEqual(withoutInjectedFlags(checkShortcutCall.argv).slice(0, 2), ["--agent", "required-check"]);

  console.log(`Validated X for GitHub Copilot profile: ${paths.profileHome}`);
  console.log(`Validated X for GitHub Copilot shell shim: ${paths.shellShimPath}`);
  console.log(`Surface resolution JSON: ${surfaceReportJson}`);
  console.log(`Surface resolution Markdown: ${surfaceReportMd}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
