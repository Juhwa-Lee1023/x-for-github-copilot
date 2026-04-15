# Porting Notes

This repository ports Oh My OpenAgent into a GitHub Copilot CLI-first layout.

## Platform Assumption Shift

Upstream OMO assumes:

- OpenCode plugin runtime
- OpenCode/Claude Code compatible hooks
- OpenCode skill discovery
- OpenCode-centric install and provider configuration

XGC v0 assumes:

- GitHub Copilot CLI plugin packaging through `plugin.json`
- Copilot CLI custom agents through `.agent.md`
- Copilot CLI skills through `SKILL.md`
- Copilot CLI hooks through `.github/hooks/*.json` or plugin-provided hook configs
- GitHub Copilot built-in agent precedence, so custom runtime-facing ids must avoid collisions with built-ins such as `explore`, `task`, `code-review`, `general-purpose`, and `research`

## What Stayed Close To Upstream

- Agent responsibilities and orchestration philosophy
- Main orchestrator versus deep worker split
- Cheap discovery and reference compression roles
- Planning and critique roles
- Workflow-oriented skills

## What Changed For Copilot CLI

- The repo ships a root [plugin.json](plugin.json)
- Canonical agent definitions live under [source/agents/](source/agents) and are generated into [agents/](agents) and [.github/agents](.github/agents)
- Canonical skill definitions live under [source/skills/](source/skills) and are generated into [skills/](skills) and [.github/skills](.github/skills)
- Runtime-facing agent ids are GitHub-native:
  - `repo-master`
  - `patch-master`
  - `repo-scout`
  - `ref-index`
  - `merge-gate`
  - `milestone`
  - `maintainer`
  - `triage`
  - `required-check`
- Hooks are defined in [hooks/hooks.json](hooks/hooks.json)
- MCP config is now generated into [.github/mcp.json](.github/mcp.json) from an upstream-faithful subset:
  - `context7`
  - `grep_app`
  - optional `websearch` via Exa or Tavily
- LSP config is now generated into [lsp.json](lsp.json) from an upstream-faithful but conservative subset:
  - `typescript-language-server`
  - `vscode-json-language-server`
  - `yaml-language-server`
  - `bash-language-server`
  - optional `pyright`
  - optional `gopls`
  - optional `rust-analyzer`
- `scripts/bootstrap-xgc-stack.sh` is the OMO-style interactive bootstrap pass for MCP/LSP selection, optional dependency install, and config generation
- `scripts/smoke-copilot-cli.ts` adds an optional, bounded live runtime smoke for GitHub Copilot CLI

## Runtime Honesty

This repository validates structure, file wiring, and install flow coherence.

It does **not** claim full runtime parity with OMO or with any specific OpenCode behavior.

It also does **not** claim authoritative GitHub Copilot billing truth. XGC now records local Copilot CLI result-event usage when live validation emits it, but local structural checks, transcript exports, and runtime smoke evidence are still not the same thing as provider-side premium request accounting. See [KNOWN_RISKS.md](KNOWN_RISKS.md).
