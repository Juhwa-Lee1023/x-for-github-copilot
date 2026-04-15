import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_MODEL_POLICIES,
  DEFAULT_ROOT_MODEL,
  resolveAgentModelPolicy
} from "../scripts/lib/model-policy.js";
import { classifySpecialistRoute } from "../scripts/lib/specialist-routing.js";
import { renderRuntimeAgentContent } from "../scripts/lib/runtime-surfaces.js";
import { readText, repoRoot } from "./helpers.js";

function modelFromContent(content: string) {
  const match = content.match(/^model:\s*(.+)$/m);
  const value = match?.[1].trim();
  if (!value) return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

const rootCases = [
  "gpt-5.4",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "gpt-5-mini",
  "gpt-4.1",
  "acme-ultra-preview"
];

test("parent-aware model policy resolves every agent for supported and unknown roots", () => {
  for (const rootModel of rootCases) {
    assert.equal(resolveAgentModelPolicy({ agentId: "repo-master", rootModel }), rootModel);
    assert.equal(
      resolveAgentModelPolicy({ agentId: "milestone", rootModel }),
      rootModel === "claude-opus-4.6" ? "claude-opus-4.6" : "claude-sonnet-4.6"
    );
    assert.equal(
      resolveAgentModelPolicy({ agentId: "triage", rootModel }),
      rootModel === "claude-opus-4.6" ? "claude-opus-4.6" : "claude-sonnet-4.6"
    );
    assert.equal(
      resolveAgentModelPolicy({ agentId: "maintainer", rootModel }),
      rootModel === "claude-opus-4.6" ? "claude-opus-4.6" : "claude-sonnet-4.6"
    );
    assert.equal(resolveAgentModelPolicy({ agentId: "patch-master", rootModel }), "gpt-5.4");
    assert.equal(resolveAgentModelPolicy({ agentId: "merge-gate", rootModel }), "gpt-5.4");
    assert.equal(resolveAgentModelPolicy({ agentId: "required-check", rootModel }), "gpt-5.4");
    assert.equal(resolveAgentModelPolicy({ agentId: "multimodal-look", rootModel }), "gpt-5.4");
    assert.equal(
      resolveAgentModelPolicy({ agentId: "repo-scout", rootModel }),
      rootModel === "gpt-5-mini" || rootModel === "gpt-4.1" ? "gpt-5-mini" : "gpt-5.4-mini"
    );
    assert.equal(
      resolveAgentModelPolicy({ agentId: "ref-index", rootModel }),
      rootModel === "gpt-5-mini" || rootModel === "gpt-4.1" ? "gpt-5-mini" : "gpt-5.4-mini"
    );
    assert.equal(resolveAgentModelPolicy({ agentId: "visual-forge", rootModel }), "google/gemini-3.1-pro");
    assert.equal(resolveAgentModelPolicy({ agentId: "artistry-studio", rootModel }), "google/gemini-3.1-pro");
    assert.equal(resolveAgentModelPolicy({ agentId: "writing-desk", rootModel }), "google/gemini-3-flash");
  }
});

test("policy-bearing source agents render runtime-safe model frontmatter without leaking modelPolicy", () => {
  for (const [agentId, modelPolicy] of Object.entries(AGENT_MODEL_POLICIES)) {
    const content = readText(`source/agents/${agentId}.agent.md`);
    assert.match(content, new RegExp(`^modelPolicy: ${modelPolicy}$`, "m"));
    const rendered = renderRuntimeAgentContent(content, {
      agentId,
      rootModel: "claude-opus-4.6"
    });
    assert.doesNotMatch(rendered, /^modelPolicy:/m);
    if (agentId === "repo-master") {
      assert.equal(modelFromContent(rendered), null);
    } else {
      assert.equal(modelFromContent(rendered), resolveAgentModelPolicy({ agentId, rootModel: "claude-opus-4.6" }));
    }
  }
});

test("every source agent has a known modelPolicy mapping and runtime-safe rendering", () => {
  const sourceAgentIds = fs
    .readdirSync(path.join(repoRoot, "source", "agents"))
    .filter((entry) => entry.endsWith(".agent.md"))
    .map((entry) => path.basename(entry, ".agent.md"))
    .sort();
  assert.deepEqual(sourceAgentIds, Object.keys(AGENT_MODEL_POLICIES).sort());

  for (const agentId of sourceAgentIds) {
    const content = readText(`source/agents/${agentId}.agent.md`);
    assert.match(content, /^modelPolicy: /m, `${agentId} must declare source-only modelPolicy`);
    const rendered = renderRuntimeAgentContent(content, { agentId, rootModel: DEFAULT_ROOT_MODEL });
    assert.doesNotMatch(rendered, /^modelPolicy:/m, `${agentId} leaked source-only modelPolicy`);
    assert.equal(
      modelFromContent(rendered),
      agentId === "repo-master" ? null : resolveAgentModelPolicy({ agentId, rootModel: DEFAULT_ROOT_MODEL })
    );
  }
});

test("runtime rendering preserves unknown root model only for root-selected Repo Master", () => {
  const repoMaster = renderRuntimeAgentContent(readText("source/agents/repo-master.agent.md"), {
    agentId: "repo-master",
    rootModel: "acme-ultra-preview"
  });
  const milestone = renderRuntimeAgentContent(readText("source/agents/milestone.agent.md"), {
    agentId: "milestone",
    rootModel: "acme-ultra-preview"
  });
  assert.equal(modelFromContent(repoMaster), null);
  assert.equal(modelFromContent(milestone), "claude-sonnet-4.6");
});

test("runtime rendering omits root-selected model instead of serializing unsafe root text", () => {
  const rendered = renderRuntimeAgentContent(readText("source/agents/repo-master.agent.md"), {
    agentId: "repo-master",
    rootModel: "gpt-4.1\nuser-invocable: false"
  });

  assert.equal(modelFromContent(rendered), null);
  assert.doesNotMatch(rendered, /^model:\s*gpt-4\.1$/m);
  assert.doesNotMatch(rendered, /^user-invocable:\s*false$/m);
  assert.match(rendered, /^user-invocable:\s*true$/m);
});

test("specialist route helper maps intents without replacing planning-first routing", () => {
  assert.equal(classifySpecialistRoute("polish the responsive CSS layout")?.agentId, "visual-forge");
  assert.equal(classifySpecialistRoute("rewrite the onboarding docs and release notes")?.agentId, "writing-desk");
  assert.equal(classifySpecialistRoute("analyze this screenshot and PDF diagram")?.agentId, "multimodal-look");
  assert.equal(classifySpecialistRoute("suggest naming and tone options")?.agentId, "artistry-studio");
  assert.equal(classifySpecialistRoute("fix the auth callback bug"), null);
  assert.equal(classifySpecialistRoute("copy the generated files into the fixture directory"), null);
  assert.equal(classifySpecialistRoute("tone down noisy retry logging in the shell wrapper"), null);
  assert.equal(classifySpecialistRoute("verify voice input permissions are not requested"), null);
});

test("default runtime root remains conservative when no model is configured", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-model-policy-"));
  assert.ok(tempRoot);
  assert.equal(DEFAULT_ROOT_MODEL, "claude-sonnet-4.6");
});
