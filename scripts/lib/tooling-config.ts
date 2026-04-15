import fs from "node:fs";
import path from "node:path";

export type ToolingSpec = {
  repoRoot?: string;
  mcp?: {
    context7?: {
      enabled?: boolean;
      authEnv?: string | null;
    };
    grep_app?: {
      enabled?: boolean;
    };
    websearch?: {
      provider?: "none" | "exa" | "tavily" | string;
    };
  };
  lsp?: Record<string, boolean>;
};

type LspDefinition = {
  command: string;
  args?: string[];
  fileExtensions: Record<string, string>;
};

const lspDefinitions = {
  "typescript-language-server": {
    command: "typescript-language-server",
    args: ["--stdio"],
    fileExtensions: {
      ".ts": "typescript-language-server",
      ".tsx": "typescript-language-server",
      ".js": "typescript-language-server",
      ".jsx": "typescript-language-server",
      ".mjs": "typescript-language-server",
      ".cjs": "typescript-language-server",
      ".mts": "typescript-language-server",
      ".cts": "typescript-language-server"
    }
  },
  "vscode-json-language-server": {
    command: "vscode-json-language-server",
    args: ["--stdio"],
    fileExtensions: {
      ".json": "vscode-json-language-server",
      ".jsonc": "vscode-json-language-server"
    }
  },
  "yaml-language-server": {
    command: "yaml-language-server",
    args: ["--stdio"],
    fileExtensions: {
      ".yaml": "yaml-language-server",
      ".yml": "yaml-language-server"
    }
  },
  "bash-language-server": {
    command: "bash-language-server",
    args: ["start"],
    fileExtensions: {
      ".sh": "bash-language-server",
      ".bash": "bash-language-server",
      ".zsh": "bash-language-server",
      ".ksh": "bash-language-server"
    }
  },
  pyright: {
    command: "pyright-langserver",
    args: ["--stdio"],
    fileExtensions: {
      ".py": "pyright",
      ".pyi": "pyright"
    }
  },
  gopls: {
    command: "gopls",
    fileExtensions: {
      ".go": "gopls"
    }
  },
  "rust-analyzer": {
    command: "rust-analyzer",
    fileExtensions: {
      ".rs": "rust-analyzer"
    }
  }
} satisfies Record<string, LspDefinition>;

export function renderToolingConfig(spec: ToolingSpec) {
  const mcpServers: Record<string, unknown> = {};

  if (spec.mcp?.context7?.enabled) {
    const server: Record<string, unknown> = {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      tools: ["*"]
    };

    if (spec.mcp.context7.authEnv) {
      server.headers = {
        CONTEXT7_API_KEY: `$${spec.mcp.context7.authEnv}`
      };
    }

    mcpServers.context7 = server;
  }

  if (spec.mcp?.grep_app?.enabled) {
    mcpServers.grep_app = {
      type: "http",
      url: "https://mcp.grep.app",
      tools: ["*"]
    };
  }

  if (spec.mcp?.websearch?.provider === "exa") {
    mcpServers.websearch = {
      type: "http",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
      tools: ["web_search_exa"],
      headers: {
        "x-api-key": "$COPILOT_MCP_EXA_API_KEY"
      }
    };
  }

  if (spec.mcp?.websearch?.provider === "tavily") {
    mcpServers.websearch = {
      type: "http",
      url: "https://mcp.tavily.com/mcp/",
      tools: ["*"],
      headers: {
        Authorization: "Bearer $COPILOT_MCP_TAVILY_API_KEY"
      }
    };
  }

  const lspServers: Record<string, LspDefinition> = {};
  for (const [id, enabled] of Object.entries(spec.lsp ?? {})) {
    if (!enabled) continue;
    const definition = lspDefinitions[id as keyof typeof lspDefinitions];
    if (definition) {
      lspServers[id] = definition;
    }
  }

  return {
    mcpServers,
    lspServers,
    selectedTooling: {
      generatedAt: new Date().toISOString(),
      upstreamInventory: {
        mcps: ["websearch", "context7", "grep_app"],
        lspCandidates: Object.keys(lspDefinitions)
      },
      selected: {
        mcpServers: Object.keys(mcpServers),
        lspServers: Object.keys(lspServers)
      },
      notes: [
        "This file records the selected GitHub Copilot CLI MCP and LSP subset for X for GitHub Copilot.",
        "websearch remains optional because it needs a provider key.",
        "Runtime-facing LSP config is rendered in Copilot CLI's root { lspServers } shape."
      ]
    }
  };
}

export function writeToolingArtifacts(spec: ToolingSpec) {
  const repoRoot = path.resolve(spec.repoRoot ?? process.cwd());
  const { mcpServers, lspServers, selectedTooling } = renderToolingConfig(spec);

  fs.mkdirSync(path.join(repoRoot, ".github"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, ".xgc", "bootstrap"), { recursive: true });

  fs.writeFileSync(
    path.join(repoRoot, ".github", "mcp.json"),
    `${JSON.stringify({ mcpServers }, null, 2)}\n`
  );

  fs.writeFileSync(path.join(repoRoot, "lsp.json"), `${JSON.stringify({ lspServers }, null, 2)}\n`);

  fs.writeFileSync(
    path.join(repoRoot, ".xgc", "bootstrap", "selected-tooling.json"),
    `${JSON.stringify(selectedTooling, null, 2)}\n`
  );
}
