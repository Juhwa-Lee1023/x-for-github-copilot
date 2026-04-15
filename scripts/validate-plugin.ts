import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  builtInAgentIds,
  listCanonicalAgentIds,
  listRuntimeFrontmatterKeys,
  resolveRepoRoot,
  runtimeAgentFrontmatterAllowlist,
  runtimeAgentUnsupportedFrontmatterKeys,
  syncRuntimeSurfaces
} from "./lib/runtime-surfaces.js";
import { buildLspStates, buildMcpStates, loadSelectedTooling } from "./lib/runtime-validation.js";
import { validateHookManifestTruth } from "./lib/hook-path-truth.js";

const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));

const documentedHookNames = new Set([
  "agentStop",
  "errorOccurred",
  "notification",
  "postToolUse",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStop",
  "userPromptSubmitted"
]);

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await syncRuntimeSurfaces(repoRoot, { check: true });

  const plugin = readJson<Record<string, string>>("plugin.json");
  const pkg = readJson<{ version?: string }>("package.json");
  assert(plugin.version === pkg.version, "plugin.json version must match package.json version");
  for (const key of ["agents", "skills", "hooks", "mcpServers", "lspServers"]) {
    const target = plugin[key];
    assert(Boolean(target), `plugin.json must define ${key}`);
    assert(fs.existsSync(path.join(repoRoot, target)), `plugin.json ${key} path does not exist: ${target}`);
  }

  const settings = readJson<{ enabledPlugins?: Record<string, boolean> }>(".github/copilot/settings.json");
  assert(
    settings.enabledPlugins?.[plugin.name] === true,
    `.github/copilot/settings.json must enable plugin ${plugin.name}`
  );

  const hooksConfig = readJson<{ hooks?: Record<string, Array<{ bash?: string; type?: string }>> }>("hooks/hooks.json");
  assert(hooksConfig.hooks && typeof hooksConfig.hooks === "object", "hooks/hooks.json must define a hooks object");
  const githubHooksMirror = fs.readFileSync(path.join(repoRoot, ".github/hooks/xgc-hooks.json"), "utf8");
  const pluginHooks = fs.readFileSync(path.join(repoRoot, "hooks/hooks.json"), "utf8");
  assert(githubHooksMirror === pluginHooks, ".github/hooks/xgc-hooks.json must mirror hooks/hooks.json exactly");
  const hookTruth = validateHookManifestTruth(path.join(repoRoot, "hooks/hooks.json"));
  assert(
    hookTruth.staleLegacyHookCommands.length === 0,
    `hooks/hooks.json must not reference stale legacy .mjs hook paths: ${hookTruth.staleLegacyHookCommands
      .map((entry) => `${entry.hookName}=${entry.command}`)
      .join("; ")}`
  );
  assert(
    hookTruth.unsafeWorkspaceHookCommands.length === 0,
    `hooks/hooks.json must not directly invoke workspace-relative .sh hook paths without fail-open guards: ${hookTruth.unsafeWorkspaceHookCommands
      .map((entry) => `${entry.hookName}=${entry.command}`)
      .join("; ")}`
  );
  assert(
    hookTruth.missingExpectedShellHooks.length === 0,
    `hooks/hooks.json must expose current .sh hook scripts through XGC_HOOK_SCRIPT_ROOT for: ${hookTruth.missingExpectedShellHooks.join(", ")}`
  );
  assert(
    hookTruth.missingFailOpenShellHooks.length === 0,
    `hooks/hooks.json must use fail-open shell hook commands (XGC_HOOK_SCRIPT_ROOT -> ./scripts/hooks when present -> exit 0) for: ${hookTruth.missingFailOpenShellHooks.join(", ")}`
  );
  for (const [hookName, handlers] of Object.entries(hooksConfig.hooks)) {
    assert(documentedHookNames.has(hookName), `Unsupported hook name in hooks/hooks.json: ${hookName}`);
    assert(Array.isArray(handlers) && handlers.length > 0, `Hook ${hookName} must define at least one handler`);
    for (const handler of handlers) {
      assert(handler.type === "command", `Hook ${hookName} must use documented command handlers`);
      assert(Boolean(handler.bash), `Hook ${hookName} command handler must define bash`);
      assert(
        handler.bash!.includes("XGC_HOOK_SCRIPT_ROOT") || fs.existsSync(path.join(repoRoot, handler.bash!)),
        `Hook ${hookName} must reference an existing repo script or the XGC_HOOK_SCRIPT_ROOT fallback: ${handler.bash}`
      );
    }
  }

  const mcpConfig = readJson<{ mcpServers?: Record<string, unknown> }>(".github/mcp.json");
  assert(
    mcpConfig.mcpServers && typeof mcpConfig.mcpServers === "object" && !Array.isArray(mcpConfig.mcpServers),
    ".github/mcp.json must contain an mcpServers object"
  );

  const lspConfig = readJson<{ lspServers?: Record<string, { command?: unknown; args?: unknown; fileExtensions?: unknown }> }>("lsp.json");
  assert(lspConfig && typeof lspConfig === "object" && !Array.isArray(lspConfig), "lsp.json must be a JSON object");
  assert(
    lspConfig.lspServers && typeof lspConfig.lspServers === "object" && !Array.isArray(lspConfig.lspServers),
    'lsp.json must contain a root-level "lspServers" object'
  );
  for (const [name, server] of Object.entries(lspConfig.lspServers)) {
    assert(server && typeof server === "object" && !Array.isArray(server), `lsp.json server ${name} must be an object`);
    assert(typeof server.command === "string" && server.command.length > 0, `lsp.json server ${name} must have a command string`);
    assert(
      server.args === undefined || (Array.isArray(server.args) && server.args.every((entry) => typeof entry === "string")),
      `lsp.json server ${name} must have a string-array args field when args are present`
    );
    assert(
      server.fileExtensions &&
        typeof server.fileExtensions === "object" &&
        !Array.isArray(server.fileExtensions) &&
        Object.keys(server.fileExtensions).length > 0,
      `lsp.json server ${name} must have a non-empty fileExtensions object`
    );
  }

  for (const runtimeDir of ["agents", ".github/agents"]) {
    const absoluteDir = path.join(repoRoot, runtimeDir);
    for (const file of fs.readdirSync(absoluteDir).filter((entry) => entry.endsWith(".agent.md"))) {
      const content = fs.readFileSync(path.join(absoluteDir, file), "utf8");
      const keys = listRuntimeFrontmatterKeys(content);
      for (const key of keys) {
        assert(
          runtimeAgentFrontmatterAllowlist.has(key),
          `runtime-facing agent ${runtimeDir}/${file} contains unsupported frontmatter key: ${key}`
        );
      }
      for (const forbiddenKey of runtimeAgentUnsupportedFrontmatterKeys) {
        assert(
          !keys.includes(forbiddenKey),
          `runtime-facing agent ${runtimeDir}/${file} must strip internal frontmatter key: ${forbiddenKey}`
        );
      }
    }
  }

  const selectedTooling = loadSelectedTooling(repoRoot);
  if (selectedTooling) {
    const mcpStates = buildMcpStates(repoRoot, process.env);
    const lspStates = buildLspStates(repoRoot);
    for (const server of mcpStates) {
      assert(
        !(server.selected && !server.configured),
        `selected-tooling.json marks MCP ${server.id} enabled but .github/mcp.json does not configure it`
      );
      assert(
        !(!server.selected && server.configured),
        `.github/mcp.json configures MCP ${server.id} but selected-tooling.json does not record it`
      );
    }
    for (const server of lspStates) {
      assert(
        !(server.selected && !server.configured),
        `selected-tooling.json marks LSP ${server.id} enabled but lsp.json does not configure it`
      );
      assert(
        !(!server.selected && server.configured),
        `lsp.json configures LSP ${server.id} but selected-tooling.json does not record it`
      );
    }
  }

  const agentIds = await listCanonicalAgentIds(repoRoot);
  for (const builtInId of builtInAgentIds) {
    assert(!agentIds.includes(builtInId), `Custom agent id collides with built-in Copilot agent: ${builtInId}`);
  }

  console.log("Plugin structure and runtime surfaces validated.");
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
