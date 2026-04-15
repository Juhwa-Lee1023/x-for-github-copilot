import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { syncRuntimeSurfaces, writeRuntimeAgentMirror } from "./runtime-surfaces.js";
import { readJsonIfExists } from "./runtime-validation.js";
import { normalizeRootModel } from "./model-policy.js";
import {
  deriveDefaultUpdatePolicy,
  deriveDefaultUpdateTrack,
  normalizeAutoUpdateMode,
  type XgcAutoUpdateMode,
  type XgcUpdateChannel,
  type XgcUpdatePolicy
} from "./update-policy.js";

export type GlobalPaths = {
  homeDir: string;
  runtimeHome: string;
  runtimeReleasesHome: string;
  runtimeCurrentPath: string;
  runtimeCurrentBinPath: string;
  profileHome: string;
  configHome: string;
  profileConfigPath: string;
  profileMcpConfigPath: string;
  profileLspConfigPath: string;
  profileAgentsDir: string;
  profileSkillsDir: string;
  profileHookScriptsDir: string;
  shellShimPath: string;
  updaterScriptPath: string;
  shellEnvPath: string;
  installStatePath: string;
};

export type CopilotConfig = Record<string, unknown> & {
  installed_plugins?: unknown[];
  model?: string;
  trusted_folders?: string[];
  custom_agents?: Record<string, unknown> & {
    default_local_only?: boolean;
  };
};

type CopilotPluginRegistration = {
  name?: string;
  marketplace?: string;
  version?: string;
  installed_at?: string;
  enabled?: boolean;
  cache_path?: string;
  source?: {
    source?: string;
    path?: string;
  };
};

export type MaterializeGlobalProfileOptions = {
  homeDir?: string;
  repoRoot: string;
  rawConfigPath?: string;
  requireRuntimeDist?: boolean;
};

export type XgcPermissionMode = "ask" | "work" | "yolo";
export type XgcInstallSource = "repo-checkout" | "release-artifact" | "npm-package";

export function isXgcPermissionMode(value: string): value is XgcPermissionMode {
  return value === "ask" || value === "work" || value === "yolo";
}

export function normalizeXgcPermissionMode(value: string | undefined | null): XgcPermissionMode {
  return value && isXgcPermissionMode(value) ? value : "ask";
}

export type MaterializeGlobalProfileResult = {
  paths: GlobalPaths;
  copiedAgents: string[];
  copiedSkills: string[];
  configPath: string;
  mcpConfigPath: string;
  lspConfigPath: string;
  rootModel: string;
};

export type ResolveRawCopilotBinOptions = {
  explicitRawCopilotBin?: string | null;
  strictExplicitRawCopilotBin?: boolean;
  existingProfileEnvPath?: string | null;
  homeDir?: string;
  repoRoot?: string;
  pathEnv?: string;
};

function copyCleanDir(sourceDir: string, targetDir: string) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function resolveRuntimeDistEntry(repoRoot: string, fileName: string, fallbackSegments: string[], strict = false) {
  const compiledPath = path.join(repoRoot, "runtime-dist", fileName);
  if (fs.existsSync(compiledPath)) {
    return compiledPath;
  }
  if (strict) {
    throw new Error(`Missing packaged runtime entry: ${compiledPath}`);
  }
  return path.join(repoRoot, ...fallbackSegments);
}

function listLeafFiles(root: string) {
  const result: string[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        result.push(path.relative(root, fullPath));
      }
    }
  };

  if (fs.existsSync(root)) {
    walk(root);
  }
  return result.sort();
}

export function resolveGlobalPaths(homeDir = os.homedir()): GlobalPaths {
  const profileHome = path.join(homeDir, ".copilot-xgc");
  const configHome = path.join(homeDir, ".config", "xgc");
  const runtimeHome = path.join(homeDir, ".local", "share", "xgc");
  const runtimeCurrentPath = path.join(runtimeHome, "current");
  return {
    homeDir,
    runtimeHome,
    runtimeReleasesHome: path.join(runtimeHome, "releases"),
    runtimeCurrentPath,
    runtimeCurrentBinPath: path.join(runtimeCurrentPath, "bin", "xgc.mjs"),
    profileHome,
    configHome,
    profileConfigPath: path.join(profileHome, "config.json"),
    profileMcpConfigPath: path.join(profileHome, "mcp-config.json"),
    profileLspConfigPath: path.join(profileHome, "lsp.json"),
    profileAgentsDir: path.join(profileHome, "agents"),
    profileSkillsDir: path.join(profileHome, "skills"),
    profileHookScriptsDir: path.join(configHome, "hooks"),
    shellShimPath: path.join(configHome, "xgc-shell.sh"),
    updaterScriptPath: path.join(configHome, "xgc-update.mjs"),
    shellEnvPath: path.join(configHome, "profile.env"),
    installStatePath: path.join(configHome, "install-state.json")
  };
}

function isExecutableFile(candidate: string) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function tryRealpath(candidate: string) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function readShellExportValue(filePath: string, key: string) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const assignment = new RegExp(`^export\\s+${key}=([\\s\\S]*)$`);
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(assignment);
    if (!match) {
      continue;
    }
    const rawValue = match[1].trim();
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      return rawValue.slice(1, -1).split("'\\''").join("'");
    }
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        return JSON.parse(rawValue) as string;
      } catch {
        return rawValue.slice(1, -1);
      }
    }
    return rawValue;
  }
  return null;
}

export function isProbablyXgcWrapperCandidate(
  candidate: string,
  opts: { homeDir?: string; repoRoot?: string } = {}
) {
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : null;
  const resolved = tryRealpath(candidate);
  const configHome = path.join(homeDir, ".config", "xgc");

  if (resolved.startsWith(`${configHome}${path.sep}`)) {
    return true;
  }
  if (repoRoot && resolved === path.join(repoRoot, "scripts", "xgc-shell.sh")) {
    return true;
  }

  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile() || stat.size > 1024 * 1024) {
      return false;
    }
    const sample = fs.readFileSync(candidate, "utf8").slice(0, 8192);
    return /xgc-shell\.sh|XGC_COPILOT_PROFILE_HOME|xgc__invoke|xgc global mode/.test(sample);
  } catch {
    return false;
  }
}

function normalizeResolvableRawCandidate(
  candidate: string | null,
  opts: { homeDir: string; repoRoot?: string; strict?: boolean }
) {
  const value = candidate?.trim();
  if (!value) {
    return null;
  }
  const resolved = path.resolve(value);
  if (!isExecutableFile(resolved)) {
    if (opts.strict) {
      throw new Error(`XGC_COPILOT_RAW_BIN is set but not executable: ${resolved}`);
    }
    return null;
  }
  if (isProbablyXgcWrapperCandidate(resolved, { homeDir: opts.homeDir, repoRoot: opts.repoRoot })) {
    if (opts.strict) {
      throw new Error(`XGC_COPILOT_RAW_BIN appears to point at an X for GitHub Copilot wrapper, not the raw GitHub Copilot CLI: ${resolved}`);
    }
    return null;
  }
  return resolved;
}

export function resolveRawCopilotBin(opts: ResolveRawCopilotBinOptions = {}) {
  const explicit = opts.explicitRawCopilotBin?.trim();
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : undefined;

  const explicitCandidate = normalizeResolvableRawCandidate(explicit ?? null, {
    homeDir,
    repoRoot,
    strict: Boolean(explicit) && opts.strictExplicitRawCopilotBin === true
  });
  if (explicitCandidate) {
    return explicitCandidate;
  }

  if (opts.existingProfileEnvPath) {
    const existingCandidate = normalizeResolvableRawCandidate(
      readShellExportValue(opts.existingProfileEnvPath, "XGC_COPILOT_RAW_BIN"),
      {
        homeDir,
        repoRoot
      }
    );
    if (existingCandidate) {
      return existingCandidate;
    }
  }

  const searchPath = opts.pathEnv ?? process.env.PATH ?? "";
  const seen = new Set<string>();
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, "copilot");
    const resolved = tryRealpath(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (isExecutableFile(candidate) && !isProbablyXgcWrapperCandidate(candidate, { homeDir, repoRoot })) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function inferHomeDirFromGlobalPaths(paths: GlobalPaths) {
  return path.resolve(paths.configHome, "..", "..");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readRepoPackageVersion(repoRoot: string) {
  return readJsonIfExists<{ version?: string }>(path.join(repoRoot, "package.json"))?.version ?? "0.1.0";
}

function filtersLegacyInstalledPlugin(entry: unknown) {
  const serialized = JSON.stringify(entry ?? "").toLowerCase();
  return serialized.includes("orchestra-dual-runtime") || serialized.includes("copilot-cli-plugin");
}

function samePluginRegistration(entry: unknown, pluginName: string, repoRoot: string) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const record = entry as CopilotPluginRegistration;
  return record.name === pluginName || record.source?.path === repoRoot;
}

function ensureDedicatedProfilePluginRegistration(opts: {
  profileConfig: CopilotConfig;
  paths: GlobalPaths;
  repoRoot: string;
}) {
  const cachePath = path.join(opts.paths.profileHome, "installed-plugins", "_direct", path.basename(opts.repoRoot));
  const cachedPluginJsonPath = path.join(cachePath, "plugin.json");
  if (!fs.existsSync(cachedPluginJsonPath)) {
    return opts.profileConfig;
  }

  const pluginJson = readJsonIfExists<{ name?: string; version?: string }>(cachedPluginJsonPath);
  const repoVersion = readRepoPackageVersion(opts.repoRoot);
  const pluginName = pluginJson?.name ?? "xgc";
  const existingRegistrations = Array.isArray(opts.profileConfig.installed_plugins)
    ? (opts.profileConfig.installed_plugins.filter((entry) => !samePluginRegistration(entry, pluginName, opts.repoRoot)) as CopilotPluginRegistration[])
    : [];
  const existing = Array.isArray(opts.profileConfig.installed_plugins)
    ? (opts.profileConfig.installed_plugins.find((entry) => samePluginRegistration(entry, pluginName, opts.repoRoot)) as
        | CopilotPluginRegistration
        | undefined)
    : undefined;

  return {
    ...opts.profileConfig,
    installed_plugins: [
      ...existingRegistrations,
      {
        ...(existing ?? {}),
        name: pluginName,
        marketplace: existing?.marketplace ?? "",
        version: pluginJson?.version ?? existing?.version ?? repoVersion,
        installed_at: existing?.installed_at ?? new Date().toISOString(),
        enabled: true,
        cache_path: cachePath,
        source: {
          source: "local",
          path: opts.repoRoot
        }
      }
    ]
  };
}

export function buildGlobalProfileConfig(opts: {
  repoRoot: string;
  baseConfig: CopilotConfig | null;
  existingProfileConfig: CopilotConfig | null;
}): CopilotConfig {
  const source = {
    ...(opts.existingProfileConfig ?? {}),
    ...(opts.baseConfig ?? {})
  } as CopilotConfig;

  delete source.installed_plugins;
  delete source.model;

  const existingInstalledPlugins = Array.isArray(opts.existingProfileConfig?.installed_plugins)
    ? opts.existingProfileConfig?.installed_plugins.filter((entry) => !filtersLegacyInstalledPlugin(entry))
    : undefined;

  const trustedFolders = uniqueStrings([
    ...(Array.isArray(source.trusted_folders) ? source.trusted_folders : []),
    opts.repoRoot
  ]);

  const customAgents = {
    ...(typeof source.custom_agents === "object" && source.custom_agents ? source.custom_agents : {}),
    default_local_only: true
  };
  return {
    ...source,
    trusted_folders: trustedFolders,
    custom_agents: customAgents,
    ...(existingInstalledPlugins ? { installed_plugins: existingInstalledPlugins } : {})
  };
}

export async function materializeGlobalProfile(
  options: MaterializeGlobalProfileOptions
): Promise<MaterializeGlobalProfileResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : os.homedir();
  const paths = resolveGlobalPaths(homeDir);

  fs.mkdirSync(paths.profileHome, { recursive: true });
  fs.mkdirSync(paths.configHome, { recursive: true });

  await syncRuntimeSurfaces(repoRoot);

  const rawConfigPath =
    options.rawConfigPath ?? path.join(homeDir, ".copilot", "config.json");
  const baseConfig = readJsonIfExists<CopilotConfig>(rawConfigPath);
  const existingProfileConfig = readJsonIfExists<CopilotConfig>(paths.profileConfigPath);
  const profileConfig = ensureDedicatedProfilePluginRegistration({
    profileConfig: buildGlobalProfileConfig({
      repoRoot,
      baseConfig,
      existingProfileConfig
    }),
    repoRoot,
    paths
  });
  const rootModel = normalizeRootModel(profileConfig.model);

  await writeRuntimeAgentMirror(path.join(repoRoot, "source", "agents"), paths.profileAgentsDir, { rootModel });
  copyCleanDir(path.join(repoRoot, "skills"), paths.profileSkillsDir);
  copyCleanDir(path.join(repoRoot, "scripts", "hooks"), paths.profileHookScriptsDir);
  fs.copyFileSync(path.join(repoRoot, "scripts", "xgc-shell.sh"), paths.shellShimPath);
  fs.chmodSync(paths.shellShimPath, 0o755);
  fs.copyFileSync(resolveRuntimeDistEntry(repoRoot, "xgc-update.mjs", ["scripts", "xgc-update.mjs"], options.requireRuntimeDist === true), paths.updaterScriptPath);
  fs.chmodSync(paths.updaterScriptPath, 0o755);
  fs.copyFileSync(path.join(repoRoot, ".github", "mcp.json"), paths.profileMcpConfigPath);
  fs.copyFileSync(path.join(repoRoot, "lsp.json"), paths.profileLspConfigPath);

  fs.writeFileSync(paths.profileConfigPath, `${JSON.stringify(profileConfig, null, 2)}\n`);

  return {
    paths,
    copiedAgents: listLeafFiles(paths.profileAgentsDir),
    copiedSkills: listLeafFiles(paths.profileSkillsDir),
    configPath: paths.profileConfigPath,
    mcpConfigPath: paths.profileMcpConfigPath,
    lspConfigPath: paths.profileLspConfigPath,
    rootModel
  };
}

export function writeGlobalInstallState(opts: {
  paths: GlobalPaths;
  repoRoot: string;
  rawCopilotBin: string | null;
  permissionMode?: XgcPermissionMode;
  installSource?: XgcInstallSource;
  releaseRepo?: string;
  releaseTag?: string | null;
  updateTrack?: string | null;
  updateChannel?: XgcUpdateChannel;
  updatePolicy?: XgcUpdatePolicy | null;
  autoUpdateMode?: XgcAutoUpdateMode;
}) {
  const version = readRepoPackageVersion(opts.repoRoot);
  const updateTrack = opts.updateTrack ?? deriveDefaultUpdateTrack(version);
  const updatePolicy = opts.updatePolicy ?? deriveDefaultUpdatePolicy(version);
  const payload = {
    schemaVersion: 1,
    product: "xgc",
    version,
    releaseTag: opts.releaseTag ?? `v${version}`,
    releaseRepo: opts.releaseRepo ?? "Juhwa-Lee1023/x-for-github-copilot",
    installSource: opts.installSource ?? "repo-checkout",
    installedAt: new Date().toISOString(),
    repoRoot: path.resolve(opts.repoRoot),
    runtimeRoot: path.resolve(opts.repoRoot),
    runtimeHome: opts.paths.runtimeHome,
    runtimeCurrentPath: opts.paths.runtimeCurrentPath,
    runtimeCurrentBinPath: opts.paths.runtimeCurrentBinPath,
    profileHome: opts.paths.profileHome,
    configHome: opts.paths.configHome,
    shellShimPath: opts.paths.shellShimPath,
    updaterScriptPath: opts.paths.updaterScriptPath,
    rawCopilotBin: opts.rawCopilotBin,
    permissionMode: opts.permissionMode ?? "ask",
    updateChannel: opts.updateChannel ?? "stable",
    updateTrack,
    updatePolicy,
    autoUpdateMode: normalizeAutoUpdateMode(opts.autoUpdateMode),
    lastUpdateCheckAt: null,
    lastUpdateStatus: null,
    lastKnownAvailableVersion: null,
    lastUpdatedFromVersion: null,
    lastUpdateAppliedAt: null
  };

  fs.mkdirSync(path.dirname(opts.paths.installStatePath), { recursive: true });
  fs.writeFileSync(opts.paths.installStatePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function writeGlobalShellEnv(opts: {
  paths: GlobalPaths;
  rawCopilotBin: string | null;
  homeDir?: string;
  repoRoot?: string;
  permissionMode?: XgcPermissionMode;
  autoUpdateMode?: XgcAutoUpdateMode;
}) {
  const rawCopilotBin =
    opts.rawCopilotBin ??
    normalizeResolvableRawCandidate(readShellExportValue(opts.paths.shellEnvPath, "XGC_COPILOT_RAW_BIN"), {
      homeDir: opts.homeDir ?? inferHomeDirFromGlobalPaths(opts.paths),
      repoRoot: opts.repoRoot
    });
  const lines = [
    "# Generated by scripts/install-global-xgc.sh",
    `export XGC_RUNTIME_HOME=${shellQuote(opts.paths.runtimeCurrentPath)}`,
    `export XGC_COPILOT_PROFILE_HOME=${shellQuote(opts.paths.profileHome)}`,
    `export XGC_COPILOT_CONFIG_HOME=${shellQuote(opts.paths.configHome)}`,
    `export XGC_ENV_FILE=${shellQuote(path.join(opts.paths.configHome, "env.sh"))}`,
    `export XGC_HOOK_SCRIPT_ROOT=${shellQuote(opts.paths.profileHookScriptsDir)}`,
    `export XGC_PERMISSION_MODE=${shellQuote(opts.permissionMode ?? "ask")}`,
    `export XGC_AUTO_UPDATE_MODE=${shellQuote(normalizeAutoUpdateMode(opts.autoUpdateMode))}`
  ];

  if (rawCopilotBin) {
    lines.push(`export XGC_COPILOT_RAW_BIN=${shellQuote(rawCopilotBin)}`);
  }

  fs.mkdirSync(path.dirname(opts.paths.shellEnvPath), { recursive: true });
  fs.writeFileSync(opts.paths.shellEnvPath, `${lines.join("\n")}\n`);
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
