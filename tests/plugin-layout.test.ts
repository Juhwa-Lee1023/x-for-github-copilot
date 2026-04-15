import test from "node:test";
import assert from "node:assert/strict";
import { exists, readJson, readText } from "./helpers.js";

test("plugin manifest references real generated paths", () => {
  const plugin = readJson<Record<string, string>>("plugin.json");
  assert.equal(plugin.name, "xgc");
  assert.ok(exists(plugin.agents));
  assert.ok(exists(plugin.skills));
  assert.ok(exists(plugin.hooks));
  assert.ok(exists(plugin.mcpServers));
  assert.ok(exists(plugin.lspServers));
});

test("required top-level files exist", () => {
  for (const file of [
    "README.md",
    "LICENSE",
    "UPSTREAM.md",
    "PORTING_NOTES.md",
    "MIGRATION_NOTES.md",
    "ANTI_PATTERNS.md",
    "KNOWN_RISKS.md",
    "AGENTS.md",
    "package.json",
    "tsconfig.json",
    "docs/rename-map.md",
    "docs/runtime-validation.md"
  ]) {
    assert.ok(exists(file), `${file} should exist`);
  }
});

test("hook manifests use the global XGC hook root fallback", () => {
  const pluginHooks = readText("hooks/hooks.json");
  const githubHooks = readText(".github/hooks/xgc-hooks.json");

  assert.match(pluginHooks, /XGC_HOOK_SCRIPT_ROOT/);
  assert.match(pluginHooks, /\.\/scripts\/hooks\//);
  assert.match(pluginHooks, /\bexit 0\b/);
  assert.doesNotMatch(pluginHooks, /\.mjs\b/);
  assert.equal(pluginHooks, githubHooks);
});
