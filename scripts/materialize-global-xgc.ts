import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeGlobalProfile,
  isXgcPermissionMode,
  isXgcReasoningEffort,
  isXgcReasoningEffortCap,
  normalizeXgcPermissionMode,
  normalizeXgcReasoningEffort,
  normalizeXgcReasoningEffortCap,
  resolveRawCopilotBin,
  resolveGlobalPaths,
  writeGlobalInstallState,
  writeGlobalShellEnv,
  type XgcInstallSource
} from "./lib/global-xgc.js";
import { resolveRepoRoot } from "./lib/runtime-surfaces.js";
import { normalizeAutoUpdateMode } from "./lib/update-policy.js";

function parseArgs(argv: string[]) {
  const args = {
    repoRoot: resolveRepoRoot(fileURLToPath(import.meta.url)),
    homeDir: os.homedir(),
    rawCopilotBin: process.env.XGC_COPILOT_RAW_BIN || null,
    rawCopilotBinFromCli: false,
    permissionMode: normalizeXgcPermissionMode(process.env.XGC_PERMISSION_MODE),
    reasoningEffort: normalizeXgcReasoningEffort(process.env.XGC_REASONING_EFFORT),
    reasoningEffortCap: normalizeXgcReasoningEffortCap(process.env.XGC_REASONING_EFFORT_CAP),
    installSource: "repo-checkout" as XgcInstallSource,
    releaseRepo: process.env.GITHUB_REPOSITORY || "Juhwa-Lee1023/x-for-github-copilot",
    releaseTag: null as string | null,
    updateTrack: null as string | null,
    updateChannel: "stable" as const,
    autoUpdateMode: normalizeAutoUpdateMode(process.env.XGC_AUTO_UPDATE_MODE)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--repo-root" && argv[index + 1]) {
      args.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--home-dir" && argv[index + 1]) {
      args.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--raw-copilot-bin" && argv[index + 1]) {
      args.rawCopilotBin = path.resolve(argv[index + 1]);
      args.rawCopilotBinFromCli = true;
      index += 1;
    } else if (current === "--permission-mode" && argv[index + 1]) {
      const mode = argv[index + 1];
      if (!isXgcPermissionMode(mode)) {
        throw new Error(`Invalid --permission-mode: ${mode}. Expected ask, work, or yolo.`);
      }
      args.permissionMode = mode;
      index += 1;
    } else if ((current === "--reasoning-effort" || current === "--effort") && argv[index + 1]) {
      const effort = argv[index + 1];
      if (!isXgcReasoningEffort(effort)) {
        throw new Error(`Invalid --reasoning-effort: ${effort}. Expected low, medium, high, xhigh, or off.`);
      }
      args.reasoningEffort = effort;
      index += 1;
    } else if ((current === "--reasoning-effort-cap" || current === "--effort-cap") && argv[index + 1]) {
      const cap = argv[index + 1];
      if (!isXgcReasoningEffortCap(cap)) {
        throw new Error(`Invalid --reasoning-effort-cap: ${cap}. Expected low, medium, high, or xhigh.`);
      }
      args.reasoningEffortCap = cap;
      index += 1;
    } else if (current.startsWith("--reasoning-effort-cap=") || current.startsWith("--effort-cap=")) {
      const cap = current.split("=", 2)[1] ?? "";
      if (!isXgcReasoningEffortCap(cap)) {
        throw new Error(`Invalid --reasoning-effort-cap: ${cap}. Expected low, medium, high, or xhigh.`);
      }
      args.reasoningEffortCap = cap;
    } else if (current === "--install-source" && argv[index + 1]) {
      const source = argv[index + 1];
      if (source !== "repo-checkout" && source !== "release-artifact" && source !== "npm-package") {
        throw new Error(`Invalid --install-source: ${source}. Expected repo-checkout, release-artifact, or npm-package.`);
      }
      args.installSource = source;
      index += 1;
    } else if (current === "--release-repo" && argv[index + 1]) {
      args.releaseRepo = argv[index + 1];
      index += 1;
    } else if (current === "--release-tag" && argv[index + 1]) {
      args.releaseTag = argv[index + 1];
      index += 1;
    } else if (current === "--update-track" && argv[index + 1]) {
      args.updateTrack = argv[index + 1];
      index += 1;
    } else if (current === "--update-channel" && argv[index + 1]) {
      args.updateChannel = argv[index + 1] as "stable";
      index += 1;
    } else if (current === "--auto-update-mode" && argv[index + 1]) {
      args.autoUpdateMode = normalizeAutoUpdateMode(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

try {
  const paths = resolveGlobalPaths(args.homeDir);
  const rawCopilotBin = resolveRawCopilotBin({
    explicitRawCopilotBin: args.rawCopilotBin,
    strictExplicitRawCopilotBin: args.rawCopilotBinFromCli,
    existingProfileEnvPath: paths.shellEnvPath,
    homeDir: args.homeDir,
    repoRoot: args.repoRoot
  });
  const result = await materializeGlobalProfile({
    repoRoot: args.repoRoot,
    homeDir: args.homeDir,
    reasoningEffort: args.reasoningEffort,
    reasoningEffortCap: args.reasoningEffortCap,
    requireRuntimeDist: args.installSource !== "repo-checkout"
  });
  writeGlobalShellEnv({
    paths,
    rawCopilotBin,
    homeDir: args.homeDir,
    repoRoot: args.repoRoot,
    permissionMode: args.permissionMode,
    reasoningEffort: args.reasoningEffort,
    reasoningEffortCap: args.reasoningEffortCap,
    autoUpdateMode: args.autoUpdateMode
  });
  writeGlobalInstallState({
    paths,
    repoRoot: args.repoRoot,
    rawCopilotBin,
    permissionMode: args.permissionMode,
    reasoningEffort: args.reasoningEffort,
    reasoningEffortCap: args.reasoningEffortCap,
    installSource: args.installSource,
    releaseRepo: args.releaseRepo,
    releaseTag: args.releaseTag,
    updateTrack: args.updateTrack,
    updateChannel: args.updateChannel,
    autoUpdateMode: args.autoUpdateMode
  });

  console.log(`materialized profile: ${result.paths.profileHome}`);
  console.log(`materialized config: ${result.configPath}`);
  console.log(`materialized mcp config: ${result.mcpConfigPath}`);
  console.log(`materialized lsp config: ${result.lspConfigPath}`);
  console.log(`raw copilot binary: ${rawCopilotBin ?? "not found; shim will resolve from PATH at shell load time"}`);
  console.log(`permission mode: ${args.permissionMode}`);
  console.log(`reasoning effort: ${args.reasoningEffort}`);
  console.log(`reasoning effort cap: ${args.reasoningEffortCap}`);
  console.log(`auto update mode: ${args.autoUpdateMode}`);
  console.log(`copied agents: ${result.copiedAgents.length}`);
  console.log(`copied skills: ${result.copiedSkills.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
