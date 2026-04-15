# Model Routing

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. It is an independent open-source project, not an official GitHub product, and it does not claim support for every GitHub Copilot surface.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

X for GitHub Copilot treats model choice as a role contract, not a prestige story or a billing engine.

## Current Routing Philosophy

- `Repo Master` is the orchestration front door.
- `Repo Scout` and `Ref Index` are bounded grounding lanes.
- `Milestone`, `Triage`, `Patch Master`, `Merge Gate`, and `Required Check` use stronger lanes when planning, execution, or judgment needs them.
- Scout swarms remain available when useful, but fixed task-name fan-out is not a product rule.
- Local runtime evidence is not provider billing truth.

## Current Lane Intent

- **Repo Master**
  orchestration-first front door
- **Repo Scout**
  bounded grounding and file discovery
- **Ref Index**
  doc/reference compression
- **Milestone**
  planner-only gate for non-trivial work
- **Triage**
  bounded gap-analysis lane for non-trivial, ambiguous, multi-file, or risky plans before execution
- **Patch Master**
  execution-only lane when the handoff is grounded
- **Merge Gate** / **Required Check**
  review and judgment lanes
- **Visual Forge**
  visual-engineering lane for UI/UX, layout, responsive behavior, accessibility, and visual polish
- **Writing Desk**
  writing lane for docs, guides, release notes, changelogs, and structured prose
- **Multimodal Look**
  read-only visual/PDF/diagram analysis lane
- **Artistry Studio**
  creative lane for naming, tone, messaging, and aesthetic direction

## Parent-Aware Model Policy

GitHub Copilot custom-agent `model` frontmatter is static when present. X for GitHub Copilot therefore keeps source-only `modelPolicy` in canonical agents. Child, review, utility, and specialist lanes receive resolved static `model:` values in generated runtime mirrors and materialized user-level profile agents. `Repo Master` is the exception: because its policy is `root-selected`, runtime-facing Repo Master omits `model:` so Copilot uses the model selected by the user or active root runtime.

Default repo/project mirrors resolve against `claude-sonnet-4.6`. User-level global profile agents resolve against the active profile model.

| Agent group | Policy | Runtime model |
| --- | --- | --- |
| `Repo Master` | `root-selected` | no static `model:`; inherits active user/root model |
| `Milestone`, `Triage`, `Maintainer` | `claude-follow-opus` | `claude-opus-4.6` only when root is Opus; otherwise `claude-sonnet-4.6` |
| `Patch Master`, `Merge Gate`, `Required Check`, `Multimodal Look` | `fixed-gpt54` | `gpt-5.4` |
| `Repo Scout`, `Ref Index` | `mini-follow-cheap-root` | `gpt-5-mini` only when root is `gpt-5-mini` or `gpt-4.1`; otherwise `gpt-5.4-mini` |
| `Visual Forge`, `Artistry Studio` | `fixed-gemini31-pro` | `google/gemini-3.1-pro` |
| `Writing Desk` | `fixed-gemini3-flash` | `google/gemini-3-flash` |

GitHub's supported-models documentation remains the authority for model availability and premium behavior. X for GitHub Copilot records these as runtime policy IDs and avoids making billing claims from local routing alone.

## What X for GitHub Copilot Is Not Claiming

X for GitHub Copilot is **not** claiming:

- every task will use fewer premium requests
- local route evidence is identical to provider billing truth
- a selected MCP or LSP was deterministically used unless the evidence supports that
- scout fan-out has a guaranteed exact observable count on every run

## Current GitHub Billing References

GitHub’s current documentation remains the source of truth for premium-request semantics and model multipliers:

- [About premium requests](https://docs.github.com/en/copilot/managing-copilot/monitoring-usage-and-entitlements/about-premium-requests)
- [Supported AI models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

X for GitHub Copilot uses those docs as context. It does not hard-code a fake billing model.

## Practical Interpretation

Current X for GitHub Copilot intent is:

- route non-trivial work into planning rather than ungrounded execution
- use grounding lanes when file sets, docs, or references are unclear
- keep execution in `Patch Master` after the packet is concrete
- keep review gates bounded
- report local evidence conservatively

The product story is:

**orchestration front door -> grounding -> planning gate -> execution -> optional review**
