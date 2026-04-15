# Migration Notes

This repository is a fresh start built as a GitHub Copilot CLI-first port of OMO.

## What To Expect

- XGC v0 is a GitHub Copilot CLI-first port of OMO
- The public front door is still orchestration-first, now exposed as `repo-master`
- OpenCode-specific runtime behavior is intentionally absent
- Billing, dispatch graphs, and compatibility policies are intentionally deferred

## Migration Guidance

- Keep upstream OMO prompt intent unless Copilot CLI forces adaptation
- Prefer skills and custom agents over inventing new runtimes
- Treat this repository as a clean port, not an adapter layer
- Use [docs/rename-map.md](docs/rename-map.md) if you came from OMO or older mythology-based prompts
