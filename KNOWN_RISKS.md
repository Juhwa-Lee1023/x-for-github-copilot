# Known Risks

## 1. Structural Parity Is Stronger Than Runtime Parity

This repository validates packaging, mirrors, docs, and installation flow coherence. It does not claim one-to-one runtime parity with upstream OMO.

The optional live smoke improves runtime confidence, but it is still bounded and environment-dependent.

## 2. Copilot CLI Surface Differences

GitHub Copilot CLI does not expose every OpenCode runtime primitive that upstream OMO assumes. Some orchestration behaviors are therefore represented through prompts and skills rather than through a custom runtime.

## 3. Model Routing Is Guidance-First In v0

Agent profiles include model recommendations, but not every environment will expose the same model catalog or selection behavior.

## 4. MCP And LSP Are Conservative

The repository now bootstraps and live-validates a real MCP/LSP subset instead of leaving empty placeholders.

Recent live checks with the official GitHub Copilot CLI confirmed:

- plugin install plus `copilot plugin list` visibility succeeded
- external docs and public code-search probes produced explicit or strong-indirect runtime proof
- TypeScript code-aware probes produced correct diagnostics and symbol explanations, but not every run exposed a directly named language-server invocation

The setup still stays conservative in these ways:

- `websearch` is opt-in because it depends on Exa or Tavily credentials
- language-server config is generated from upstream OMO defaults, but public Copilot CLI documentation exposes less LSP detail than upstream OpenCode
- structural validation can prove config coherence, not end-to-end runtime parity on every machine
- live runtime validation preserves proof strength honestly, so some capability cases may still land at `strong-indirect`, `weak`, or `unproven` when the Copilot transcript does not expose direct invocation markers
- even when a selected MCP or LSP is installed and configured, Copilot may choose an alternate built-in tool path that satisfies the same task instead

## 5. Hooks Are Lightweight

The hook layer is intentionally shallow in v0. It focuses on traceability and safe shell entry points rather than on building a hidden runtime.

Hook logs are therefore supporting evidence, not authoritative proof by themselves.
Transcript and stdout artifacts are usually stronger than hook payloads when they disagree.

## 6. Local Runtime Evidence Is Not Billing Truth

Even when live Copilot CLI smoke is enabled:

- the runtime report can record Copilot CLI result-event usage such as `premiumRequests`, but that is still local CLI-reported evidence
- local transcript exports are not authoritative provider billing truth
- local command counts are not the same unit as GitHub Copilot premium request accounting
- delegated or child prompts may be separate billing candidates at the provider layer

XGC documents and validates local behavior conservatively. It does not pretend to know provider-side billing state from local runtime evidence alone.
