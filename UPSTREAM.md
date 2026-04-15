# Upstream Lineage

This repository is a GitHub Copilot CLI-first derivative port of:

- Upstream repository: [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
- Upstream reference commit: `0478d278f1f400906b67312fdeae44624c6b1481`
- Upstream branch observed during porting: default clone state as of 2026-04-03

## What Was Ported Directly In Spirit

- The main orchestrator identity centered on **Sisyphus**
- The deep execution split centered on **Hephaestus**
- Utility roles such as **Explore**, **Librarian**, and **Oracle**
- Planning and review roles such as **Prometheus**, **Atlas**, **Metis**, and **Momus**
- OMO's role-model fit philosophy and orchestration-first ergonomics
- OMO-style installation and coding-agent-friendly onboarding
- OMO-style skills for GitHub triage, release review, PR workflow, and commit discipline

## What Was Adapted

- OpenCode plugin/runtime wiring was replaced with GitHub Copilot CLI plugin structure
- Agent definitions were rewritten as Copilot CLI `.agent.md` files
- Runtime-facing agent ids were renamed to GitHub-friendly, collision-safe names such as `repo-master`, `patch-master`, and `repo-scout`
- Skills were rewritten into Copilot CLI `SKILL.md` directories
- Hooks were rewritten into Copilot CLI `hooks.json` command hooks
- Docs were rewritten for Copilot CLI users instead of OpenCode users
- Upstream built-in MCPs were mapped into [.github/mcp.json](.github/mcp.json)
- Upstream LSP inventory was narrowed into a Copilot CLI bootstrap-generated [lsp.json](lsp.json)

## Upstream MCP And LSP Inventory Used For This Port

From upstream OMO, the relevant built-in MCP and LSP surfaces were:

- MCPs:
  - `websearch`
  - `context7`
  - `grep_app`
- LSP examples and built-ins:
  - `typescript-language-server`
  - `vscode-json-language-server`
  - `yaml-language-server`
  - `bash-language-server`
  - `pyright`
  - `gopls`
  - `rust-analyzer`

XGC v0 keeps the upstream MCP set, but makes `websearch` opt-in because it needs a provider key. It also narrows the LSP bootstrap to the most practical multi-platform subset for GitHub Copilot CLI.

## What Was Not Ported

- OpenCode runtime plugins, dispatch graph logic, and billing logic
- intermediate compatibility architectures from earlier internal ports
- OpenCode-only commands, hooks, and task primitives

## Why This Exists

The goal of v0 is to create a **faithful Copilot CLI port first**, not to redesign OMO or continue earlier runtime experiments that do not belong in the GitHub Copilot CLI port.
