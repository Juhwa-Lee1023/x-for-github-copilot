import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandUsesLegacyHookPath,
  commandUsesUnsafeWorkspaceHookPath,
  findLegacyHookPluginConflicts,
  formatLegacyHookPluginConflict
} from "./lib/hook-path-truth.js";
import { resolveRepoRoot } from "./lib/runtime-surfaces.js";

type HookHandler = Record<string, unknown> & {
  bash?: string;
  command?: string;
  cwd?: string;
  type?: string;
};

type HookManifest = {
  hooks?: Record<string, HookHandler[]>;
};

const repairableCanonicalHookNames = new Set(["sessionStart", "preToolUse", "agentStop", "subagentStop", "errorOccurred"]);
const deprecatedRawHookNames = new Set(["userPromptSubmitted", "promptSubmitted", "sessionEnd"]);

export type RawHookRepairResult = {
  dryRun: boolean;
  conflictsFound: number;
  repairableConflictsFound: number;
  wouldRepair: boolean;
  changesApplied: boolean;
  repairComplete: boolean;
  repairedManifests: Array<{
    manifestPath: string;
    backupPath: string | null;
    replacedHookNames: string[];
    removedHookNames: string[];
  }>;
  skippedManifests: string[];
  manualReviewConflicts: string[];
  unrepairedConflicts: string[];
  conflictMessages: string[];
};

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomically(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeJson(tempPath, value);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Best effort cleanup; preserve the original write failure.
    }
    throw error;
  }
}

function parseArgs(argv: string[]) {
  const args = {
    homeDir: os.homedir(),
    configPath: null as string | null,
    repoRoot: resolveRepoRoot(fileURLToPath(import.meta.url)),
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--home-dir" && argv[index + 1]) {
      args.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--config-path" && argv[index + 1]) {
      args.configPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--repo-root" && argv[index + 1]) {
      args.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function timestampForBackup() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(".", "-").replace(/Z$/, "Z");
}

function uniqueBackupPath(filePath: string) {
  const base = `${filePath}.bak-${timestampForBackup()}`;
  if (!fs.existsSync(base)) return base;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique backup path for ${filePath}`);
}

function loadCanonicalHookCommands(repoRoot: string) {
  const manifestPath = path.join(repoRoot, "hooks", "hooks.json");
  const manifest = readJsonIfExists<HookManifest>(manifestPath);
  const commands = new Map<string, string>();
  for (const [hookName, handlers] of Object.entries(manifest?.hooks ?? {})) {
    const command = handlers.find((handler) => typeof handler.bash === "string")?.bash;
    if (command) commands.set(hookName, command);
  }
  return commands;
}

function handlerCommand(handler: HookHandler) {
  return typeof handler.bash === "string"
    ? handler.bash
    : typeof handler.command === "string"
      ? handler.command
      : "";
}

function handlerNeedsRepair(handler: HookHandler) {
  const command = handlerCommand(handler);
  return commandUsesLegacyHookPath(command) || commandUsesUnsafeWorkspaceHookPath(command);
}

function conflictRequiresManualReview(conflict: ReturnType<typeof findLegacyHookPluginConflicts>[number]) {
  return conflict.reasons.some((reason) => /manual review|could not be found/i.test(reason));
}

function conflictNeedsCanonicalRepair(conflict: ReturnType<typeof findLegacyHookPluginConflicts>[number]) {
  return Boolean(conflict.hookName && repairableCanonicalHookNames.has(conflict.hookName) && !conflictRequiresManualReview(conflict));
}

function conflictIsAutoRepairable(conflict: ReturnType<typeof findLegacyHookPluginConflicts>[number]) {
  return Boolean(
    conflict.hookName &&
      (repairableCanonicalHookNames.has(conflict.hookName) || deprecatedRawHookNames.has(conflict.hookName)) &&
      !conflictRequiresManualReview(conflict)
  );
}

export function repairRawCopilotHookConflicts(opts: {
  homeDir?: string;
  configPath?: string | null;
  repoRoot?: string;
  dryRun?: boolean;
} = {}): RawHookRepairResult {
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const repoRoot = path.resolve(opts.repoRoot ?? resolveRepoRoot(fileURLToPath(import.meta.url)));
  const dryRun = opts.dryRun ?? false;
  const conflicts = findLegacyHookPluginConflicts({
    homeDir,
    configPath: opts.configPath ?? undefined
  });
  const canonicalCommands = loadCanonicalHookCommands(repoRoot);
  if (conflicts.length > 0) {
    const repairableConflictingHooks = [
      ...new Set(conflicts.filter(conflictNeedsCanonicalRepair).map((conflict) => conflict.hookName as string))
    ];
    const missingCanonicalHooks = repairableConflictingHooks.filter((hookName) => !canonicalCommands.has(hookName));
    if (missingCanonicalHooks.length > 0) {
      throw new Error(
        `Refusing to repair raw Copilot hooks because canonical source hook commands are missing for: ${missingCanonicalHooks.join(", ")}`
      );
    }
  }
  const manifestPaths = [...new Set(conflicts.map((conflict) => conflict.hookManifestPath).filter(Boolean) as string[])];
  const repairedManifests: RawHookRepairResult["repairedManifests"] = [];
  const skippedManifests: string[] = [];
  const repairableConflictsFound = conflicts.filter(conflictIsAutoRepairable).length;
  const manualReviewConflicts = conflicts.filter((conflict) => !conflictIsAutoRepairable(conflict)).map(formatLegacyHookPluginConflict);
  const autoRepairHookNamesByManifest = new Map<string, Set<string>>();
  for (const conflict of conflicts.filter(conflictIsAutoRepairable)) {
    if (!conflict.hookManifestPath || !conflict.hookName) continue;
    const hookNames = autoRepairHookNamesByManifest.get(conflict.hookManifestPath) ?? new Set<string>();
    hookNames.add(conflict.hookName);
    autoRepairHookNamesByManifest.set(conflict.hookManifestPath, hookNames);
  }

  for (const manifestPath of manifestPaths) {
    const manifest = readJsonIfExists<HookManifest>(manifestPath);
    if (!manifest?.hooks || typeof manifest.hooks !== "object") {
      skippedManifests.push(manifestPath);
      continue;
    }

    let changed = false;
    const replacedHookNames = new Set<string>();
    const removedHookNames = new Set<string>();
    const autoRepairHookNames = autoRepairHookNamesByManifest.get(manifestPath) ?? new Set<string>();

    for (const [hookName, handlers] of Object.entries(manifest.hooks)) {
      if (!Array.isArray(handlers)) continue;
      if (!autoRepairHookNames.has(hookName)) continue;
      const canonicalCommand = canonicalCommands.get(hookName);
      if (canonicalCommand) {
        manifest.hooks[hookName] = handlers.map((handler) => {
          if (!handlerNeedsRepair(handler)) return handler;
          changed = true;
          replacedHookNames.add(hookName);
          const next: HookHandler = {
            ...handler,
            type: "command",
            bash: canonicalCommand,
            cwd: "."
          };
          delete next.command;
          return next;
        });
        continue;
      }

      if (deprecatedRawHookNames.has(hookName) && handlers.some(handlerNeedsRepair)) {
        delete manifest.hooks[hookName];
        changed = true;
        removedHookNames.add(hookName);
      }
    }

    if (!changed) {
      skippedManifests.push(manifestPath);
      continue;
    }

    const backupPath = uniqueBackupPath(manifestPath);
    if (!dryRun) {
      fs.copyFileSync(manifestPath, backupPath);
      writeJsonAtomically(manifestPath, manifest);
    }
    repairedManifests.push({
      manifestPath,
      backupPath: dryRun ? null : backupPath,
      replacedHookNames: [...replacedHookNames].sort(),
      removedHookNames: [...removedHookNames].sort()
    });
  }

  const skippedManifestSet = new Set(skippedManifests);
  const skippedManifestConflicts = conflicts
    .filter((conflict) => conflict.hookManifestPath && skippedManifestSet.has(conflict.hookManifestPath))
    .map(formatLegacyHookPluginConflict);
  const unrepairedConflicts = [...new Set([...manualReviewConflicts, ...skippedManifestConflicts])];
  const wouldRepair = repairedManifests.length > 0;
  const changesApplied = !dryRun && repairedManifests.length > 0;
  const repairComplete = conflicts.length === 0 || (!dryRun && unrepairedConflicts.length === 0 && skippedManifests.length === 0);

  return {
    dryRun,
    conflictsFound: conflicts.length,
    repairableConflictsFound,
    wouldRepair,
    changesApplied,
    repairComplete,
    repairedManifests,
    skippedManifests,
    manualReviewConflicts,
    unrepairedConflicts,
    conflictMessages: conflicts.map(formatLegacyHookPluginConflict)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = repairRawCopilotHookConflicts(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.repairComplete && !result.dryRun) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
