# XGC Repository Instructions

This repository is a GitHub Copilot CLI-first port of Oh My OpenAgent.

## Core Rules

- Treat upstream OMO as the primary product reference.
- Treat Orchestra only as a source of anti-patterns and lessons learned.
- Keep OMO lineage visible, but prefer the GitHub-native runtime-facing names from [docs/rename-map.md](docs/rename-map.md).
- Preserve attribution and license visibility.
- Do not invent undocumented GitHub Copilot CLI plugin fields or hook types.
- Treat `source/agents/` and `source/skills/` as the only authoring source of truth.
- Treat `agents/`, `skills/`, `.github/agents/`, and `.github/skills/` as generated mirrors.

## Change Discipline

- If you change an agent profile or skill, update the canonical source and regenerate the mirrors in the same change.
- If you change install or validation scripts, update [README.md](README.md) and [docs/install.md](docs/install.md).
- If you change lineage or scope, update [UPSTREAM.md](UPSTREAM.md), [PORTING_NOTES.md](PORTING_NOTES.md), and [KNOWN_RISKS.md](KNOWN_RISKS.md).
- If you touch hooks, keep [hooks/hooks.json](hooks/hooks.json) and [.github/hooks/xgc-hooks.json](.github/hooks/xgc-hooks.json) identical and limited to documented GitHub Copilot CLI hook names.

## Runtime Scope

- GitHub Copilot CLI only
- OpenCode deferred
- No Orchestra runtime carry-over
