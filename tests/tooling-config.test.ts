import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, repoRoot } from "./helpers.js";

test(".github/mcp.json ships an upstream-faithful default subset", () => {
  const config = readJson<{ mcpServers: Record<string, unknown> }>(".github/mcp.json");
  assert.ok(config.mcpServers);
  assert.ok(config.mcpServers.context7);
  assert.ok(config.mcpServers.grep_app);
});

test("lsp.json ships a non-empty conservative OMO subset", () => {
  const config = readJson<{ lspServers: Record<string, unknown> }>("lsp.json");
  assert.ok(config.lspServers["typescript-language-server"]);
  assert.ok(config.lspServers["vscode-json-language-server"]);
  assert.ok(config.lspServers["yaml-language-server"]);
  assert.ok(config.lspServers["bash-language-server"]);
});

test("renderer supports intentionally empty MCP and LSP selections", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-tooling-"));
  fs.mkdirSync(path.join(tmp, ".github"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".xgc", "bootstrap"), { recursive: true });
  const specPath = path.join(tmp, "spec.json");
  fs.writeFileSync(
    specPath,
    JSON.stringify(
      {
        repoRoot: tmp,
        mcp: {
          context7: { enabled: false, authEnv: null },
          grep_app: { enabled: false },
          websearch: { provider: "none" }
        },
        lsp: {}
      },
      null,
      2
    )
  );

  execFileSync("npm", ["exec", "--", "tsx", path.join(repoRoot, "scripts/render-tooling-config.ts"), specPath], {
    cwd: repoRoot
  });

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, ".github", "mcp.json"), "utf8")), {
    mcpServers: {}
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, "lsp.json"), "utf8")), { lspServers: {} });
});

test("renderer writes runtime-facing LSP config in Copilot CLI root lspServers shape", () => {
  const config = readJson<{
    lspServers: {
      "typescript-language-server": {
        command: string;
        args?: string[];
        fileExtensions: Record<string, string>;
      };
    };
  }>("lsp.json");

  assert.equal(config.lspServers["typescript-language-server"].command, "typescript-language-server");
  assert.deepEqual(config.lspServers["typescript-language-server"].args, ["--stdio"]);
  assert.equal(
    config.lspServers["typescript-language-server"].fileExtensions[".ts"],
    "typescript-language-server"
  );
});

test("renderer uses Context7's expected MCP header key", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-tooling-context7-"));
  fs.mkdirSync(path.join(tmp, ".github"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".xgc", "bootstrap"), { recursive: true });
  const specPath = path.join(tmp, "spec.json");
  fs.writeFileSync(
    specPath,
    JSON.stringify(
      {
        repoRoot: tmp,
        mcp: {
          context7: { enabled: true, authEnv: "COPILOT_MCP_CONTEXT7_API_KEY" },
          grep_app: { enabled: false },
          websearch: { provider: "none" }
        },
        lsp: {}
      },
      null,
      2
    )
  );

  execFileSync("npm", ["exec", "--", "tsx", path.join(repoRoot, "scripts/render-tooling-config.ts"), specPath], {
    cwd: repoRoot
  });

  const config = JSON.parse(fs.readFileSync(path.join(tmp, ".github", "mcp.json"), "utf8")) as {
    mcpServers: { context7: { headers: { CONTEXT7_API_KEY: string } } };
  };
  assert.equal(
    config.mcpServers.context7.headers.CONTEXT7_API_KEY,
    "$COPILOT_MCP_CONTEXT7_API_KEY"
  );
});
