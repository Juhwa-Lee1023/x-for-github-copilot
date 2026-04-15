import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderRuntimeSourceReportMarkdown, resolveRuntimeSourceReport } from "../scripts/lib/runtime-source-resolution.js";

function writeFile(targetPath: string, content: string) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-report-"));
  writeFile(path.join(root, "source", "agents", "repo-master.agent.md"), "---\nname: Repo Master\nmodel: gpt-5-mini\n---\n");
  writeFile(path.join(root, "source", "agents", "patch-master.agent.md"), "---\nname: Patch Master\nmodel: gpt-5.4\n---\n");
  writeFile(path.join(root, "source", "skills", "review-work", "SKILL.md"), "# review-work\n");
  return root;
}

test("runtime source report prefers user-level profile and reports shadowed copies", () => {
  const repoRoot = createRepoFixture();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-workspace-"));
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-home-"));
  const pluginCachePath = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-plugin-"));

  writeFile(path.join(copilotHome, "agents", "repo-master.agent.md"), "---\nname: Repo Master\nmodel: gpt-5-mini\n---\n");
  writeFile(path.join(copilotHome, "agents", "patch-master.agent.md"), "---\nname: Patch Master\nmodel: gpt-5.4\n---\n");
  writeFile(path.join(copilotHome, "skills", "review-work", "SKILL.md"), "user-level review skill");

  writeFile(path.join(workspaceRoot, ".github", "agents", "repo-master.agent.md"), "---\nname: Repo Master Project\nmodel: gpt-5.4-mini\n---\n");
  writeFile(path.join(workspaceRoot, ".github", "skills", "review-work", "SKILL.md"), "project-level review skill");

  writeFile(path.join(pluginCachePath, "agents", "repo-master.agent.md"), "---\nname: Repo Master Plugin\nmodel: claude-sonnet-4.6\n---\n");
  writeFile(path.join(pluginCachePath, "agents", "patch-master.agent.md"), "---\nname: Patch Master Plugin\nmodel: gpt-5.4\n---\n");
  writeFile(path.join(pluginCachePath, "skills", "review-work", "SKILL.md"), "plugin review skill");

  const report = resolveRuntimeSourceReport({
    repoRoot,
    workspaceRoot,
    copilotHome,
    copilotConfigPath: path.join(copilotHome, "config.json"),
    pluginCachePath,
    xgcProfileHome: copilotHome
  });

  const repoMaster = report.agents.find((entry) => entry.id === "repo-master");
  const reviewSkill = report.skills.find((entry) => entry.id === "review-work");
  const coreRepoMaster = report.coreAgents.find((entry) => entry.id === "repo-master");

  assert.ok(repoMaster);
  assert.equal(repoMaster.winner?.layer, "user-level-profile");
  assert.equal(repoMaster.winner?.displayName, "Repo Master");
  assert.equal(repoMaster.winner?.model, "gpt-5-mini");
  assert.deepEqual(
    repoMaster.shadowed.map((entry) => entry.layer),
    ["project-level", "plugin-installed"]
  );

  assert.ok(reviewSkill);
  assert.equal(reviewSkill.winner?.layer, "user-level-profile");
  assert.deepEqual(
    reviewSkill.shadowed.map((entry) => entry.layer),
    ["project-level", "plugin-installed"]
  );
  assert.ok(coreRepoMaster);
  assert.equal(report.operatorModeExplanation, "running in X for GitHub Copilot global profile mode");
});

test("runtime source report markdown explains precedence and winners", () => {
  const repoRoot = createRepoFixture();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-workspace-md-"));
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-home-md-"));

  writeFile(path.join(copilotHome, "agents", "repo-master.agent.md"), "---\nname: Repo Master\nmodel: gpt-5-mini\n---\n");
  writeFile(path.join(copilotHome, "skills", "review-work", "SKILL.md"), "user-level review skill");

  const markdown = renderRuntimeSourceReportMarkdown(
    resolveRuntimeSourceReport({
      repoRoot,
      workspaceRoot,
      copilotHome,
      copilotConfigPath: path.join(copilotHome, "config.json"),
      xgcProfileHome: copilotHome
    })
  );

  assert.match(markdown, /Runtime Surface Resolution/);
  assert.match(markdown, /Operator mode: running in X for GitHub Copilot global profile mode/);
  assert.match(markdown, /Core Lane Winners/);
  assert.match(markdown, /user-level profile > project-level \.github > plugin-installed copy/);
  assert.match(markdown, /\| repo-master \| user-level-profile \| Repo Master \| gpt-5-mini \|/);
  assert.match(markdown, /Winning model: gpt-5-mini/);
  assert.match(markdown, /Checked layers:/);
});

test("runtime source report warns when generated outside X for GitHub Copilot global profile mode", () => {
  const repoRoot = createRepoFixture();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-workspace-raw-"));
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-home-raw-"));
  const xgcProfileHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-home-xgc-"));

  const report = resolveRuntimeSourceReport({
    repoRoot,
    workspaceRoot,
    copilotHome,
    xgcProfileHome
  });

  assert.equal(report.xgcProfileActive, false);
  assert.equal(report.operatorModeExplanation, "running outside X for GitHub Copilot global profile mode");
  assert.match(report.notes.join("\n"), /outside X for GitHub Copilot global profile mode/i);
});

test("runtime source report treats Repo Master without model frontmatter as root-selected inheritance", () => {
  const repoRoot = createRepoFixture();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-root-selected-workspace-"));
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-surface-root-selected-home-"));
  writeFile(path.join(copilotHome, "config.json"), JSON.stringify({ model: "claude-opus-4.6" }, null, 2));
  writeFile(path.join(copilotHome, "agents", "repo-master.agent.md"), "---\nname: Repo Master\n---\n");
  writeFile(path.join(copilotHome, "skills", "review-work", "SKILL.md"), "user-level review skill");

  const report = resolveRuntimeSourceReport({
    repoRoot,
    workspaceRoot,
    copilotHome,
    copilotConfigPath: path.join(copilotHome, "config.json"),
    xgcProfileHome: copilotHome
  });

  const repoMaster = report.agents.find((entry) => entry.id === "repo-master");
  assert.equal(repoMaster?.winner?.model, null);
  assert.ok(
    report.notes.some((note) =>
      note.includes("Repo Master omits static model frontmatter and inherits the active root model: claude-opus-4.6")
    )
  );
});
