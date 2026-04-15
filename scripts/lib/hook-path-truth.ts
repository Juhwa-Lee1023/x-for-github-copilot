import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type HookCommandEvidence = {
  hookName: string;
  command: string;
};

export type HookManifestTruth = {
  manifestPath: string;
  commandEvidence: HookCommandEvidence[];
  staleLegacyHookCommands: HookCommandEvidence[];
  unsafeWorkspaceHookCommands: HookCommandEvidence[];
  nonShellHookCommands: HookCommandEvidence[];
  missingExpectedShellHooks: string[];
  missingFailOpenShellHooks: string[];
};

export type LegacyHookPluginConflict = {
  pluginName: string;
  configPath: string;
  cachePath: string | null;
  hookManifestPath: string | null;
  hookName: string | null;
  command: string | null;
  reasons: string[];
};

type CopilotPluginConfig = {
  installed_plugins?: Array<{
    name?: string;
    enabled?: boolean;
    source?: { source_path?: string };
    cache_path?: string;
  }>;
};

const expectedHookScriptsByName: Record<string, string> = {
  sessionStart: "session-start.sh",
  preToolUse: "pre-tool-use.sh",
  agentStop: "agent-stop.sh",
  subagentStop: "subagent-stop.sh",
  errorOccurred: "error-occurred.sh"
};

const legacyHookCommandPattern =
  /\b(?:pre-tool-use|session-start|session-end|prompt-submitted|agent-stop|subagent-stop|error-occurred)\.mjs\b/i;

const workspaceShellHookCommandPattern =
  /(?:^|[\s"'`])(?:bash\s+)?(?:\.\/)?scripts\/(?:hooks\/)?(?:pre-tool-use|session-start|agent-stop|subagent-stop|error-occurred)\.sh\b/i;

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function collectHookCommandEvidence(manifestPath: string): HookCommandEvidence[] {
  const manifest = readJsonIfExists<{ hooks?: Record<string, Array<Record<string, unknown>>> }>(manifestPath);
  if (!manifest?.hooks || typeof manifest.hooks !== "object") return [];

  const evidence: HookCommandEvidence[] = [];
  for (const [hookName, handlers] of Object.entries(manifest.hooks)) {
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      const command = typeof handler.bash === "string"
        ? handler.bash
        : typeof handler.command === "string"
          ? handler.command
          : null;
      if (command) {
        evidence.push({ hookName, command });
      }
    }
  }
  return evidence;
}

export function commandUsesLegacyHookPath(command: string) {
  return legacyHookCommandPattern.test(command);
}

export function commandUsesUnsafeWorkspaceHookPath(command: string) {
  if (!workspaceShellHookCommandPattern.test(command)) return false;
  const normalized = command.replace(/\s+/g, " ");
  return !(
    normalized.includes("XGC_HOOK_SCRIPT_ROOT") &&
    normalized.includes("xgc_hook_root") &&
    /\bexit 0\b/.test(normalized) &&
    /(?:test|\[)\s+-[ef]\s+["']?\.\/scripts\/hooks\//i.test(normalized)
  );
}

export function validateHookManifestTruth(manifestPath: string): HookManifestTruth {
  const commandEvidence = collectHookCommandEvidence(manifestPath);
  const staleLegacyHookCommands = commandEvidence.filter((entry) => commandUsesLegacyHookPath(entry.command));
  const unsafeWorkspaceHookCommands = commandEvidence.filter((entry) => commandUsesUnsafeWorkspaceHookPath(entry.command));
  const nonShellHookCommands = commandEvidence.filter((entry) => {
    if (staleLegacyHookCommands.includes(entry)) return true;
    if (!entry.command.includes("XGC_HOOK_SCRIPT_ROOT")) return false;
    return !/\.sh\b/.test(entry.command);
  });
  const missingExpectedShellHooks = Object.entries(expectedHookScriptsByName)
    .filter(([hookName, scriptName]) => {
      const commands = commandEvidence.filter((entry) => entry.hookName === hookName).map((entry) => entry.command);
      return !commands.some((command) => command.includes(scriptName) && command.includes("XGC_HOOK_SCRIPT_ROOT"));
    })
    .map(([hookName]) => hookName);
  const missingFailOpenShellHooks = Object.entries(expectedHookScriptsByName)
    .filter(([hookName, scriptName]) => {
      const commands = commandEvidence.filter((entry) => entry.hookName === hookName).map((entry) => entry.command);
      return !commands.some((command) => {
        const normalized = command.replace(/\s+/g, " ");
        return (
          normalized.includes("XGC_HOOK_SCRIPT_ROOT") &&
          normalized.includes(`XGC_HOOK_SCRIPT_ROOT}/` + scriptName) &&
          normalized.includes(`./scripts/hooks/${scriptName}`) &&
          normalized.includes(`$xgc_hook_root/${scriptName}`) &&
          /\bexit 0\b/.test(normalized)
        );
      });
    })
    .map(([hookName]) => hookName);

  return {
    manifestPath,
    commandEvidence,
    staleLegacyHookCommands,
    unsafeWorkspaceHookCommands,
    nonShellHookCommands,
    missingExpectedShellHooks,
    missingFailOpenShellHooks
  };
}

function resolveCopilotConfigPath(homeDir: string, explicitConfigPath?: string) {
  if (explicitConfigPath) return explicitConfigPath;
  const rawCopilotConfigPath = path.join(homeDir, ".copilot", "config.json");
  if (fs.existsSync(rawCopilotConfigPath)) return rawCopilotConfigPath;
  return path.join(homeDir, "config.json");
}

function resolvePluginHookManifest(cachePath: string | null) {
  if (!cachePath) return null;
  const resolvedCachePath = path.resolve(cachePath);
  const pluginJsonPath = path.join(cachePath, "plugin.json");
  const pluginJson = readJsonIfExists<{ hooks?: string }>(pluginJsonPath);
  if (typeof pluginJson?.hooks === "string" && pluginJson.hooks) {
    const resolvedHooksPath = path.resolve(resolvedCachePath, pluginJson.hooks);
    if (resolvedHooksPath !== resolvedCachePath && !resolvedHooksPath.startsWith(`${resolvedCachePath}${path.sep}`)) {
      return null;
    }
    return resolvedHooksPath;
  }
  const fallback = path.join(resolvedCachePath, "hooks", "hooks.json");
  return fs.existsSync(fallback) ? fallback : null;
}

function pluginLooksLegacy(entry: NonNullable<CopilotPluginConfig["installed_plugins"]>[number]) {
  const name = (entry.name ?? "").toLowerCase();
  const sourcePath = (entry.source?.source_path ?? "").replace(/\\/g, "/").toLowerCase();
  const cachePath = (entry.cache_path ?? "").replace(/\\/g, "/").toLowerCase();
  const knownPluginNames = new Set([
    "xgc",
    "orchestra-copilot",
    "orchestra-dual-runtime",
    "orchestra-opencode",
    "copilot-cli-plugin"
  ]);
  const knownPathSegmentPattern =
    /(^|\/)(xgc|orchestra-copilot|orchestra-dual-runtime|orchestra-opencode|copilot-cli-plugin)(\/|$)/;
  return knownPluginNames.has(name) || knownPathSegmentPattern.test(sourcePath) || knownPathSegmentPattern.test(cachePath);
}

export function findLegacyHookPluginConflicts(opts: {
  homeDir?: string;
  configPath?: string;
} = {}): LegacyHookPluginConflict[] {
  const homeDir = opts.homeDir ? path.resolve(opts.homeDir) : os.homedir();
  const configPath = resolveCopilotConfigPath(homeDir, opts.configPath);
  const config = readJsonIfExists<CopilotPluginConfig>(configPath);
  if (!Array.isArray(config?.installed_plugins)) return [];

  const conflicts: LegacyHookPluginConflict[] = [];
  for (const entry of config.installed_plugins) {
    if (entry.enabled === false) continue;
    const pluginName = entry.name ?? "<unnamed-plugin>";
    const cachePath = entry.cache_path
      ? path.isAbsolute(entry.cache_path)
        ? path.resolve(entry.cache_path)
        : path.resolve(path.dirname(configPath), entry.cache_path)
      : null;
    const hookManifestPath = resolvePluginHookManifest(cachePath);
    const identityReasons: string[] = [];
    if (pluginLooksLegacy(entry)) {
      identityReasons.push("enabled plugin identity matches a known legacy Orchestra/Copilot runtime plugin");
    }

    if (identityReasons.length > 0 && (!hookManifestPath || !fs.existsSync(hookManifestPath))) {
      conflicts.push({
        pluginName,
        configPath,
        cachePath,
        hookManifestPath,
        hookName: null,
        command: null,
        reasons: [...identityReasons, "hook manifest for the enabled plugin could not be found"].filter(Boolean)
      });
      continue;
    }

    if (hookManifestPath && fs.existsSync(hookManifestPath)) {
      const truth = validateHookManifestTruth(hookManifestPath);
      const staleHookReasons =
        identityReasons.length > 0
          ? identityReasons
          : truth.staleLegacyHookCommands.length > 0
            ? ["hook command references known legacy X for GitHub Copilot .mjs script names but plugin identity is not recognized; manual review required before rewriting hook manifest"]
            : [];
      for (const commandEvidence of truth.staleLegacyHookCommands) {
        conflicts.push({
          pluginName,
          configPath,
          cachePath,
          hookManifestPath,
          hookName: commandEvidence.hookName,
          command: commandEvidence.command,
          reasons: [...staleHookReasons, "hook command references a stale .mjs runtime script"].filter(Boolean)
        });
      }
      if (identityReasons.length === 0) continue;
      for (const commandEvidence of truth.unsafeWorkspaceHookCommands) {
        conflicts.push({
          pluginName,
          configPath,
          cachePath,
          hookManifestPath,
          hookName: commandEvidence.hookName,
          command: commandEvidence.command,
          reasons: [
            ...identityReasons,
            "hook command references a workspace-relative .sh script without the fail-open XGC_HOOK_SCRIPT_ROOT guard"
          ].filter(Boolean)
        });
      }
    }
  }
  return conflicts;
}

export function formatLegacyHookPluginConflict(conflict: LegacyHookPluginConflict) {
  const command = conflict.command ? ` command=${JSON.stringify(conflict.command)}` : "";
  const hookName = conflict.hookName ? ` hook=${conflict.hookName}` : "";
  const manifest = conflict.hookManifestPath ? ` manifest=${conflict.hookManifestPath}` : "";
  return `${conflict.pluginName}${hookName}${command}${manifest}; reasons=${conflict.reasons.join("; ")}`;
}
