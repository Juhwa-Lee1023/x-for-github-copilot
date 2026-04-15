# Anti-Patterns

Lessons intentionally not carried forward from Orchestra-era work:

## 1. Do Not Rebuild A Custom Runtime Too Early

This repository does not ship a bespoke dispatch graph, billing engine, or multi-runtime control plane.

## 2. Do Not Hide Upstream Lineage

OMO attribution is explicit and central.

## 3. Do Not Pretend Copilot CLI Supports More Than It Does

Only official Copilot CLI primitives are used:

- `plugin.json`
- `.agent.md`
- `SKILL.md`
- hooks
- MCP/LSP config extension points

## 4. Do Not Flatten Away The Role Split

The OMO roles still exist, but the runtime-facing ids are GitHub-native and collision-safe. Keep the split; do not force the mythology into the primary runtime UX when the platform already has built-in agents with overlapping names.

## 5. Do Not Claim Runtime Guarantees That Have Not Been Proved

Validation in this repository is structural and installation-oriented unless explicitly stated otherwise.
