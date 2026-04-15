import test from "node:test";
import assert from "node:assert/strict";
import { exists, listFilesRecursive, readText } from "./helpers.js";

const skills = [
  "github-triage",
  "pre-publish-review",
  "work-with-pr",
  "review-work",
  "git-master"
];

for (const skill of skills) {
  test(`canonical skill exists and has frontmatter: ${skill}`, () => {
    const file = `source/skills/${skill}/SKILL.md`;
    assert.ok(exists(file));
    const content = readText(file);
    assert.match(content, /^---/);
    assert.match(content, /name:/);
    assert.match(content, /description:/);
  });
}

test("generated runtime skill surfaces match canonical source", () => {
  const canonicalFiles = listFilesRecursive("source/skills");
  const pluginFiles = listFilesRecursive("skills");
  const githubFiles = listFilesRecursive(".github/skills");

  assert.deepEqual(pluginFiles, canonicalFiles);
  assert.deepEqual(githubFiles, canonicalFiles);

  for (const file of canonicalFiles) {
    const canonical = readText(`source/skills/${file}`);
    assert.equal(readText(`skills/${file}`), canonical);
    assert.equal(readText(`.github/skills/${file}`), canonical);
  }
});
