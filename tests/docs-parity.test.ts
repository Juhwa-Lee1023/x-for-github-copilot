import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { exists, listDir, readText, repoRoot } from "./helpers.js";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const markdownFiles = [
  "README.md",
  ...listDir("docs").map((name) => path.join("docs", name)),
  ".github/instructions/repo-instructions.md",
  "PORTING_NOTES.md",
  "KNOWN_RISKS.md"
];

test("README stays concise while preserving install, support, and lineage boundaries", () => {
  const readme = readText("README.md");
  assert.match(readme, /^# X for GitHub Copilot/m);
  assert.match(readme, /currently designed for\s*\**GitHub Copilot CLI\**\s*workflows/i);
  assert.match(readme, /Current support:\s*GitHub Copilot CLI/i);
  assert.match(readme, /Planned later:\s*broader GitHub Copilot surfaces/i);
  assert.match(readme, /independent open-source project/i);
  assert.match(readme, /OMO-inspired port|OMO lineage/i);
  assert.match(readme, /front door -> grounding -> planning -> execution -> optional review -> truthful final state/i);
  assert.match(readme, /## Start Now/);
  assert.match(readme, /### For Humans/);
  assert.match(readme, /### For LLM Agents/);
  assert.match(readme, /npx x-for-github-copilot install/i);
  assert.match(readme, /bunx x-for-github-copilot install/i);
  assert.match(readme, /explicit\s*\/\s*strong-indirect\s*\/\s*weak\s*\/\s*unproven|explicit.*strong-indirect.*weak.*unproven/i);
  assert.match(readme, /does not promise universal premium-request reduction/i);
  assert.match(readme, /Planning-first orchestration, specialist work lanes, integration governance, and runtime truth for GitHub Copilot CLI/i);
  assert.match(readme, /Install and configure X for GitHub Copilot by following the instructions here/i);
  assert.match(readme, /https:\/\/raw\.githubusercontent\.com\/Juhwa-Lee1023\/x-for-github-copilot\/refs\/heads\/main\/docs\/install\.md/i);
  assert.match(readme, /use `curl` to fetch the installation guide, not WebFetch/i);
  assert.match(readme, /ask the user which default permission mode to persist/i);
  assert.match(readme, /npx --yes x-for-github-copilot install --permission-mode <mode> --reasoning-effort xhigh --reasoning-effort-cap high/i);
  assert.match(readme, /`--yes` before the package name/i);
  assert.match(readme, /npx --yes x-for-github-copilot doctor/i);
  assert.match(readme, /Plain `copilot` is the intended front door/i);
  assert.match(readme, /## Read Next/);
  assert.match(readme, /\[docs\/install\.md\]\(docs\/install\.md\)/);
  assert.match(readme, /\[docs\/usage\.md\]\(docs\/usage\.md\)/);
  assert.match(readme, /\[docs\/agents\.md\]\(docs\/agents\.md\)/);
  assert.match(readme, /\[docs\/model-routing\.md\]\(docs\/model-routing\.md\)/);
  assert.match(readme, /\[docs\/runtime-validation\.md\]\(docs\/runtime-validation\.md\)/);
  assert.match(readme, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
  assert.match(readme, /\[SECURITY\.md\]\(SECURITY\.md\)/);
  assert.doesNotMatch(readme, /Formerly `sisyphus`/);
  assert.doesNotMatch(readme, /Formerly `librarian`/);
  assert.doesNotMatch(readme, /`repo-master` was `sisyphus`/);
});

test("primary product docs do not teach intermediate or legacy runtime-facing names", () => {
  const primaryDocs = [
    readText("README.md"),
    readText("docs/install.md"),
    readText("docs/usage.md"),
    readText("docs/runtime-validation.md"),
    readText("docs/architecture.md"),
    readText("docs/command-reference.md"),
    readText("docs/model-routing.md"),
    readText("docs/agents.md"),
    readText("docs/troubleshooting.md"),
    readText(".github/instructions/repo-instructions.md")
  ].join("\n");

  const disallowed = [
    "Docs Master",
    "Plan Master",
    "Review Master",
    "docs-master",
    "plan-master",
    "review-master",
    "sisyphus",
    "hephaestus",
    "librarian",
    "oracle",
    "prometheus"
  ];

  for (const label of disallowed) {
    assert.doesNotMatch(primaryDocs, new RegExp(`\\b${escapeRegex(label)}\\b`, "i"));
  }

  assert.doesNotMatch(primaryDocs, /cheap entry|cheap front-door/i);
  assert.match(primaryDocs, /planner-only|planning gate/i);
  assert.match(primaryDocs, /Triage.*bounded|bounded.*Triage/is);
  assert.match(primaryDocs, /Required Check.*bounded|bounded.*Required Check/is);
  assert.match(primaryDocs, /Visual Forge/);
  assert.match(primaryDocs, /Writing Desk/);
  assert.match(primaryDocs, /Multimodal Look/);
  assert.match(primaryDocs, /Artistry Studio/);
  assert.match(primaryDocs, /parent-aware model policy|Parent-Aware Model Policy/i);
  assert.match(primaryDocs, /copilot_raw/);
  assert.match(primaryDocs, /xgc_update/);
  assert.match(primaryDocs, /npx x-for-github-copilot install/i);
  assert.match(primaryDocs, /npx --yes x-for-github-copilot install/i);
  assert.match(primaryDocs, /Ok to proceed\? \(y\)/i);
  assert.match(primaryDocs, /npx x-for-github-copilot uninstall/i);
  assert.match(primaryDocs, /npx x-for-github-copilot doctor/i);
  assert.match(primaryDocs, /uninstall-global-xgc\.sh/);
  assert.match(primaryDocs, /xgc_plan/);
  assert.match(primaryDocs, /xgc_triage/);
  assert.match(primaryDocs, /xgc_check/);
  assert.match(primaryDocs, /xgc_preflight/);
  assert.match(primaryDocs, /type copilot/);
  assert.match(primaryDocs, /clear-raw-state|reset-raw-config/);
  assert.match(primaryDocs, /Authorization error, you may need to run \/login/);
  assert.match(primaryDocs, /Unable to load available models list/);
  assert.match(primaryDocs, /Access denied by policy settings/);
  assert.match(primaryDocs, /validate:global.*does not prove.*auth.*model entitlement/is);
});

test("internal relative markdown links point to real files", () => {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const file of markdownFiles) {
    const content = readText(file);
    for (const match of content.matchAll(linkPattern)) {
      const target = match[1];
      if (target.startsWith("http") || target.startsWith("#")) continue;
      const clean = target.split("#")[0];
      const resolved = path.resolve(repoRoot, path.dirname(file), clean);
      const relativeResolved = path.relative(repoRoot, resolved);
      const validationArtifactsRoot = path.join(".xgc", "validation");
      // Generated validation artifacts are intentionally not tracked in fresh clones.
      if (relativeResolved === validationArtifactsRoot || relativeResolved.startsWith(`${validationArtifactsRoot}${path.sep}`)) continue;
      assert.ok(exists(relativeResolved), `${file} -> ${target}`);
    }
  }
});
