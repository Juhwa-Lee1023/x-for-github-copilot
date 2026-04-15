# X for GitHub Copilot Repository Instructions

This repository is **X for GitHub Copilot**, an independent open-source orchestration harness currently designed for GitHub Copilot CLI workflows. It is not an official GitHub product, is not affiliated with or endorsed by GitHub, and does not imply support for every GitHub Copilot surface.

Current support: GitHub Copilot CLI. Planned later: broader GitHub Copilot surfaces may be explored and documented explicitly.

Internal paths, environment variables, and compatibility commands still use `xgc` naming in places such as `XGC_*`, `~/.copilot-xgc`, and `xgc_*`; keep those stable unless a dedicated compatibility migration is requested.

Treat these rules as product-specific contributor instructions, not generic engineering advice.

## Canonical Source And Mirrors

- [source/](../../source) is canonical.
- [agents/](../../agents), [skills/](../../skills), [`.github/agents/`](../../.github/agents), and [`.github/skills/`](../../.github/skills) are generated mirrors.
- If you touch canonical source, regenerate the mirrors in the same change.
- Canonical agent source may keep internal metadata, but runtime-facing mirrors must strip unsupported frontmatter before they ship.
- Canonical agent source may use source-only `modelPolicy`; generated mirrors and materialized user-level agents must never expose `modelPolicy`.
- `Repo Master` uses `root-selected`, so runtime-facing Repo Master must omit static `model:` and inherit the active user/root model. Child, review, utility, and specialist lanes still expose resolved static `model:` values.

## Runtime Architecture To Preserve

- `Repo Master` is the orchestration front door and router.
- `Repo Scout` and `Ref Index` are bounded grounding lanes.
- `Milestone` is the real planning gate and stays planner-only.
- `Triage` is the bounded plan hardener for non-trivial, ambiguous, multi-file, or risky plans.
- `Patch Master` is execution-only and should receive grounded execution packets.
- `Required Check` is bounded and optional, not an unbounded review loop.
- `Visual Forge`, `Writing Desk`, `Multimodal Look`, and `Artistry Studio` are specialist lanes for visual engineering, writing, visual artifact analysis, and creative direction.
- local-context lanes should avoid GitHub-specific context by default unless the route truly needs review or PR context.
- grounding/scouting should be chosen because it improves the handoff, not because a brittle task-name special case fired.
- global permission modes are `ask`, `work`, and `yolo`; preserve explicit one-shot Copilot CLI permission flags over X for GitHub Copilot defaults.
- once `Patch Master` starts, execution should stay closed unless a named blocker justifies one narrow reopen.
- after `Patch Master` completes, `Repo Master` should stay read-only unless it explicitly hands execution back to `Patch Master`.
- integration-class work means multi-surface, multi-session, cross-feature, or shared infrastructure/config/auth/schema/runtime work; it needs stricter execution ownership and lightweight foundation-readiness language.
- after `Patch Master` starts integration-class execution, do not reopen built-in generic agents such as `Explore Agent` or `General Purpose Agent` unless a named blocker explicitly justifies that exact reopen.
- do not close integration-class work with a `/tasks`-only Patch Master background pointer; the user-facing result needs `Execution status: ready_for_return`, `Execution status: blocked`, or an explicit incomplete state.

Do not let `Repo Master` absorb too much direct execution just because it is the public front door.

## Routing Expectations

- grounding should happen before execution when the task is cold-start, weakly scoped, or cross-layer
- project structure analysis may use scout/reference lanes when that improves grounding, but there is no fixed task-name scout-count rule
- cold-start or weakly grounded work should not jump straight to `Patch Master`
- `Milestone` should appear for real non-trivial planning work
- `Triage` should appear before execution-ready handoff when the plan is non-trivial, ambiguous, multi-file, or risky
- `Triage` should normally appear once per effective plan cycle; a second pass needs a real new blocker or changed acceptance criterion
- `Patch Master` should not receive vague raw first-turn intent as if it were already grounded
- after Triage, `Milestone` should not reopen generic `explore`, raw multi-file content dumps, or broad rediscovery unless a new concrete blocker exists
- when planning lanes delegate, prefer named X for GitHub Copilot specialists (`Repo Scout`, `Ref Index`, `Triage`) over built-in generic helpers such as `explore`, `research`, or `general-purpose`
- when work is specifically visual, writing, multimodal, or creative, route to the named specialist lane instead of treating every specialty request as generic planning or execution
- specialist lanes are required for explicit specialist-specific requests, narrow UI/visual-only work, docs/prose-only work, naming/tone/creative-direction work, or true multimodal artifact-analysis tasks; Patch Master-only swarms are acceptable for broad implementation when specialist scope is explicitly covered
- when recommended specialist lanes are not invoked, preserve explicit `covered_by_patch_master` or `skipped_with_reason` language in summaries instead of treating non-invocation as automatic failure
- after Patch Master completes, `Repo Master` should use the completion summary and avoid broad review by default
- `Ref Index` is for pre-execution grounding or narrow blocker help, not reflexive post-execution reopen
- if a task touches shared or integration-owned surfaces, the plan/handoff should name those surfaces and include `Shared-surface owner:` when changes are expected
- for integration-class tasks, `Repo Master` or `Milestone` should record `Foundation readiness:` before broad delegation or deep execution
- integration-class execution handoffs should include `Execution owner: Patch Master` and explicit blocker/recovery rules when readiness is unknown
- if the same foundation failure class repeats, record `Foundation recovery suggested:` and stop normal retry-loop routing until the base is stabilized

## Validation And Reporting

- keep validation layered and evidence-based
- keep route-level reporting conservative
- do not overclaim billing outcomes from repo-local evidence
- keep runtime source/precedence reporting easy to inspect
- if you touch LSP config generation, keep the runtime-facing config in Copilot CLI's root `lspServers` shape
- if you touch GitHub memory/PR probing, preserve neutral local-context skip behavior, early shell-level suppression flags (`--disable-builtin-mcps`, `--disable-mcp-server=github-mcp-server`, `--no-experimental`), repo+session cache scoping, conservative negative-cache reporting, and review/maintenance opt-in explicit
- if you add positive GitHub capability caching, keep it repo+session scoped, report `checked_fresh` versus `reused_from_cache` honestly, and do not claim cache reuse when the current process log still shows a fresh check
- if you touch post-execution route truth, keep root-level write/patch reopening visible in route summaries instead of folding it into generic completion language
- if you touch integration execution ownership, keep built-in generic-agent reopen after `Patch Master` visible through post-execution ownership-leak fields
- if you touch provider error handling/reporting, distinguish HTTP/2 GOAWAY / `503 connection_error` retry evidence from prompt-level planning tail-spin without adding a new runtime state machine
- if you touch session summaries, keep `updated_at` tied to the latest observed event timestamp as closely as the available hook path allows, keep `summary_authority` and `summary_authority_reasons` conservative, keep committed repo files separate from dirty working-tree files, keep session-state artifacts, validation/report artifacts, and external file changes distinct, and keep GitHub capability cache reuse visible next to retry and execution/diff evidence
- if you touch `workspace.yaml` serialization, quote string scalars conservatively; never rely on hand-written YAML scalar heuristics that omit punctuation such as `:`
- if you touch operator session truth, prefer repo-owned `.xgc/validation/workspace.yaml` only when it is current for the matching session; keep session-state copies as compatibility/fallback evidence and surface freshness mismatches instead of blindly trusting either copy
- if you touch finalization truth, keep archive completeness, finalization completeness, route/count mismatch flags, and validation-overclaim evidence visible instead of flattening them into generic success/failure
- if you touch fresh bootstrap or hook materialization, keep current `.sh` hooks behind `XGC_HOOK_SCRIPT_ROOT`, keep stale `.mjs` hook path detection in source/global validation, and keep raw/default profile legacy plugin conflicts separate from app foundation failures
- if you touch shell launch, live validation, finalizer, or reports, preserve `xgc_preflight` plus auth/model/policy preflight blocker fields so `Authorization error, you may need to run /login`, `Unable to load available models list`, and `Access denied by policy settings` stay separate from app foundation failures
- if you touch raw/default fresh-workspace behavior, keep hook-path degradation fail-open and classify stale hook-path failures as bootstrap/runtime-context issues instead of app/platform failures
- if you touch GitHub memory/PR context handling, keep missing repo identity signals, such as `GitHub repository name is required`, classified as runtime-context availability issues, not app foundation failures
- if you touch single-session finalization fallback, do not invent custom-agent route agents; keep direct raw Copilot sessions labeled through `raw_tool_events_fallback` and mark them heuristic while still using `session.shutdown.codeChanges` for repo-change truth
- if you touch surface reports, keep `latestSessionTruth` structured in JSON and mirrored in Markdown instead of reducing route/session truth to a note only
- if you touch shared-surface reporting, keep `integrationOwnedSurfacesTouched`, `sharedSurfaceChangeObserved`, `sharedSurfaceOwnerDeclared`, `sharedSurfaceConflictRisk`, `sharedSurfaceFinalIntegratorNeeded`, and foundation-readiness fields conservative and evidence-based
- if you touch provider error handling/reporting, include rate-limit and gateway evidence such as 429, `user_model_rate_limited`, 502, and Unicorn errors without treating them as proof of prompt-level routing failure
- if you touch runtime model accounting, keep requested/current/observed model fields and mixed-model flags visible so fixed custom-agent model policies are not mistaken for pure single-model execution
- if execution reached `Patch Master` but neither committed nor working-tree repo changes can be observed, surface that mismatch explicitly instead of implying a normal code-change success

If you touch routing policy, surface reporting, or shell entry behavior:

- update README and the main docs in the same change
- update `.github/instructions` in the same change
- update tests in the same change

## Read These First

- [README.md](../../README.md)
- [docs/usage.md](../../docs/usage.md)
- [docs/architecture.md](../../docs/architecture.md)
- [docs/runtime-validation.md](../../docs/runtime-validation.md)
- [docs/model-routing.md](../../docs/model-routing.md)
