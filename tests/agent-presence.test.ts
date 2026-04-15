import test from "node:test";
import assert from "node:assert/strict";
import {
  builtInAgentIds,
  listRuntimeFrontmatterKeys,
  renderRuntimeAgentContent,
  runtimeAgentFrontmatterAllowlist,
  runtimeAgentUnsupportedFrontmatterKeys
} from "../scripts/lib/runtime-surfaces.js";
import { exists, listFilesRecursive, readText } from "./helpers.js";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const agents = [
  "repo-master.agent.md",
  "patch-master.agent.md",
  "repo-scout.agent.md",
  "ref-index.agent.md",
  "merge-gate.agent.md",
  "milestone.agent.md",
  "maintainer.agent.md",
  "triage.agent.md",
  "required-check.agent.md",
  "visual-forge.agent.md",
  "writing-desk.agent.md",
  "multimodal-look.agent.md",
  "artistry-studio.agent.md"
];

for (const agent of agents) {
  test(`canonical agent exists and has frontmatter: ${agent}`, () => {
    const file = `source/agents/${agent}`;
    assert.ok(exists(file));
    const content = readText(file);
    assert.match(content, /^---/);
    assert.match(content, /description:/);
    assert.doesNotMatch(content, /former_name:/);
    assert.doesNotMatch(content, /In upstream OMO/i);
  });
}

test("generated runtime agent surfaces match stripped canonical runtime rendering", () => {
  const canonicalFiles = listFilesRecursive("source/agents");
  const pluginFiles = listFilesRecursive("agents");
  const githubFiles = listFilesRecursive(".github/agents");

  assert.deepEqual(pluginFiles, canonicalFiles);
  assert.deepEqual(githubFiles, canonicalFiles);

  for (const file of canonicalFiles) {
    const canonical = readText(`source/agents/${file}`);
    const expectedRuntime = renderRuntimeAgentContent(canonical);
    assert.equal(readText(`agents/${file}`), expectedRuntime);
    assert.equal(readText(`.github/agents/${file}`), expectedRuntime);
  }
});

test("canonical source may keep internal metadata, but runtime mirrors strip unsupported frontmatter", () => {
  const canonical = readText("source/agents/repo-master.agent.md");
  assert.match(canonical, /^target:/m);
  assert.match(canonical, /^modelPolicy:/m);
  assert.match(canonical, /^metadata:/m);

  for (const runtimeFile of ["agents/repo-master.agent.md", ".github/agents/repo-master.agent.md"]) {
    const runtimeContent = readText(runtimeFile);
    const keys = listRuntimeFrontmatterKeys(runtimeContent);

    assert.doesNotMatch(runtimeContent, /^target:/m);
    assert.doesNotMatch(runtimeContent, /^metadata:/m);
    for (const key of keys) {
      assert.ok(runtimeAgentFrontmatterAllowlist.has(key), `${runtimeFile} leaked unsupported key ${key}`);
    }
    for (const forbiddenKey of runtimeAgentUnsupportedFrontmatterKeys) {
      assert.ok(!keys.includes(forbiddenKey), `${runtimeFile} still includes ${forbiddenKey}`);
    }
  }
});

test("custom runtime-facing agent ids do not collide with GitHub Copilot built-ins", () => {
  for (const agent of agents) {
    const id = agent.replace(/\.agent\.md$/, "");
    assert.ok(!builtInAgentIds.includes(id as (typeof builtInAgentIds)[number]), `${id} collides`);
  }
});

test("retired runtime-facing agent ids are no longer present in canonical or mirrored surfaces", () => {
  const retired = [
    "docs-master.agent.md",
    "review-master.agent.md",
    "plan-master.agent.md",
    "task-master.agent.md",
    "scope-master.agent.md",
    "gate-master.agent.md"
  ];

  for (const file of retired) {
    assert.ok(!exists(`source/agents/${file}`), `${file} still exists in source/agents`);
    assert.ok(!exists(`agents/${file}`), `${file} still exists in agents`);
    assert.ok(!exists(`.github/agents/${file}`), `${file} still exists in .github/agents`);
  }
});

test("retired runtime-facing display names are no longer primary labels in canonical or mirrored surfaces", () => {
  const retiredLabels = [
    "name: Docs Master",
    "name: Review Master",
    "name: Plan Master",
    "name: Task Master",
    "name: Scope Master",
    "name: Gate Master"
  ];

  for (const relativeRoot of ["source/agents", "agents", ".github/agents"]) {
    for (const file of listFilesRecursive(relativeRoot)) {
      const content = readText(`${relativeRoot}/${file}`);
      for (const label of retiredLabels) {
        assert.doesNotMatch(content, new RegExp(escapeRegex(label)));
      }
    }
  }
});

test("legacy mythological ids do not remain in runtime-facing agent surfaces", () => {
  const legacyIds = ["sisyphus", "hephaestus", "librarian", "oracle", "prometheus", "atlas", "metis", "momus"];
  const legacyDisplayOnlyPatterns = [/^name:\s*Explore\s*$/im];

  for (const relativeRoot of ["source/agents", "agents", ".github/agents"]) {
    for (const file of listFilesRecursive(relativeRoot)) {
      const content = readText(`${relativeRoot}/${file}`);
      for (const legacyId of legacyIds) {
        assert.doesNotMatch(content, new RegExp(`\\b${escapeRegex(legacyId)}\\b`, "i"));
      }
      for (const pattern of legacyDisplayOnlyPatterns) {
        assert.doesNotMatch(content, pattern);
      }
    }
  }
});

test("local-context lanes do not expose GitHub-specific tools by default", () => {
  const shouldSkipGitHubContext = [
    "repo-master.agent.md",
    "repo-scout.agent.md",
    "ref-index.agent.md",
    "milestone.agent.md",
    "triage.agent.md",
    "patch-master.agent.md",
    "required-check.agent.md",
    "visual-forge.agent.md",
    "writing-desk.agent.md",
    "multimodal-look.agent.md",
    "artistry-studio.agent.md"
  ];

  for (const relativeRoot of ["source/agents", "agents", ".github/agents"]) {
    for (const file of shouldSkipGitHubContext) {
      const content = readText(`${relativeRoot}/${file}`);
      assert.doesNotMatch(content, /github\/\*/i, `${relativeRoot}/${file} should not expose github/* tools`);
    }
  }

  for (const file of ["merge-gate.agent.md", "maintainer.agent.md"]) {
    const content = readText(`source/agents/${file}`);
    assert.match(content, /github\/\*/i, `${file} should retain GitHub-aware tools for review/maintenance lanes`);
  }
});
