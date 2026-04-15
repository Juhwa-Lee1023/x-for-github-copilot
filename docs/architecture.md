# Architecture

X for GitHub Copilot is currently designed for GitHub Copilot CLI workflows. It is an independent open-source planning-first orchestration layer for structured grounding, execution handoff, integration governance, and operator-facing runtime truth.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

It is not an official GitHub product, is not affiliated with or endorsed by GitHub, and is not a native replacement for GitHub Copilot across all surfaces.

X for GitHub Copilot v0 is a GitHub Copilot CLI-focused orchestration harness with a planning-first control plane:

**orchestration front door -> grounding -> planning gate -> execution -> optional review gate**

## Runtime Surfaces

- **Plugin manifest**: [plugin.json](../plugin.json)
- **Canonical source**: [source/agents/](../source/agents), [source/skills/](../source/skills)
- **Generated plugin runtime surfaces**: [agents/](../agents), [skills/](../skills)
- **Generated project-level mirrors**: [`.github/agents`](../.github/agents), [`.github/skills`](../.github/skills)
- **Materialized user-level profile surfaces**: `~/.copilot-xgc/agents`, `~/.copilot-xgc/skills`
- **Hooks**: [hooks/hooks.json](../hooks/hooks.json)
- **Bootstrap-generated tooling**: [`.github/mcp.json`](../.github/mcp.json), [lsp.json](../lsp.json)
- **Runtime source report**: [scripts/report-runtime-surfaces.ts](../scripts/report-runtime-surfaces.ts)
- **Optional live runtime smoke**: [scripts/smoke-copilot-cli.ts](../scripts/smoke-copilot-cli.ts)

## Role Split

- **Repo Master** (`repo-master`) is the public orchestration front door.
- **Milestone** (`milestone`) is the real planner for non-trivial work.
- **Repo Scout** (`repo-scout`) and **Ref Index** (`ref-index`) are bounded grounding lanes.
- **Triage** (`triage`) is the bounded pre-plan gap analyzer for non-trivial or risky plans.
- **Required Check** (`required-check`) is the bounded optional high-accuracy review gate.
- **Patch Master** (`patch-master`) is the execution-only deep worker.
- **Merge Gate** (`merge-gate`) remains read-only critique.
- **Maintainer** (`maintainer`) supports todo-flow coordination.
- **Visual Forge** (`visual-forge`) handles focused visual-engineering work.
- **Writing Desk** (`writing-desk`) handles docs and structured prose.
- **Multimodal Look** (`multimodal-look`) handles read-only visual/PDF/diagram analysis.
- **Artistry Studio** (`artistry-studio`) handles naming, messaging, tone, and creative direction.

## Design Intent

The repository stays close to upstream OMO's mental model:

- orchestration is distinct from deep execution
- planning is distinct from execution
- discovery is distinct from synthesis
- critique is distinct from implementation
- runtime proof is evidence-classified, not asserted as perfect truth

X for GitHub Copilot does not lead with a premium-first orchestrator story, but it also does not frame itself as a billing classifier. The central behavior is planning-first orchestration with flexible grounding and grounded execution handoffs.

## Planning Subsystem

For non-trivial work, X for GitHub Copilot treats planning as a real subsystem rather than an optional specialist:

1. `Repo Master` routes the request.
2. `Milestone` owns the plan.
3. `Repo Scout` and optionally `Ref Index` ground the repo before major questions when useful.
4. `Triage` should run before a non-trivial or medium/high-risk plan becomes execution-ready.
5. After Triage, `Milestone` should close the planning loop with either an execution-ready handoff or an explicit blocker.
6. `Repo Master` should reuse that completed Triage result instead of re-running the same review at the root level.
7. `Triage` should normally appear once per effective plan cycle; a second pass needs a real new blocker or changed acceptance criterion.
8. `Required Check` may run for bounded high-confidence review when risk or explicit user confidence requirements justify it.
9. `Patch Master` executes only after the handoff packet is grounded.
10. Once `Patch Master` starts, execution should stay closed unless a named blocker forces a narrow re-open.
11. After Patch Master completes, `Repo Master` should run at most one narrow read-only verification batch when required evidence is missing, then answer and stop or explicitly hand execution back to `Patch Master`.

Cold-start repos should not jump directly from `Repo Master` to `Patch Master`.

The planning lane is prompt-contract driven, not a runtime state machine. It should avoid broad re-investigation after a planner or executor has clearly taken ownership, and it should not force Triage or Required Check onto trivial, well-grounded, read-only work.

Integration-class tasks get a stricter ownership contract. That means work crossing feature boundaries, coordinating multiple sessions/subsystems, or touching shared surfaces such as schema, seed/setup, auth/session/config, global shell/navigation, dependency/build config, hooks, runtime validation, or generated runtime surfaces should declare shared-surface ownership and lightweight foundation readiness before deep execution. Once `Patch Master` starts that execution packet, built-in generic agents such as `Explore Agent` or `General Purpose Agent` should not reopen the flow unless a named blocker explicitly justifies it.

Foundation readiness is intentionally lightweight, but repeated same-class foundation failures are not normal progress. Repeated schema/db, dependency/tooling, build/typecheck, auth/session, or startability failures should trigger a recovery posture instead of another broad execution loop.

Specialist-lane contract is intentionally narrow:

- specialist lanes are required for explicit specialist-specific requests, narrow UI/visual-only work, docs/prose-only work, naming/tone/creative-direction work, or genuine multimodal artifact analysis
- for broad implementation prompts, specialist lanes are usually recommended and can be covered by Patch Master execution swarms
- non-invoked recommended specialist lanes should be reported as covered or skipped-with-reason, not auto-classified as route failure

## Grounding And Swarm Use

`Repo Scout` and `Ref Index` remain available grounding lanes. A scout wave can be useful when the repo is unfamiliar, the file set is unclear, or the task is broad enough to shard.

The runtime should choose scout usage because it helps the work, not because a brittle task-name special case fired. Structure or architecture analysis can use scout/reference lanes, but it is not hardcoded to a fixed scout count.

## Runtime Hygiene

X for GitHub Copilot keeps neutral runtime-hygiene fixes that are independent of routing policy:

- runtime-facing `lsp.json` uses the Copilot CLI `{ "lspServers": { ... } }` shape
- generated runtime agent mirrors strip internal-only frontmatter such as `target` and `metadata`
- local-context lanes avoid GitHub-specific memory/PR probes by default unless the selected route truly needs GitHub context
- the global shell shim adds early local-context suppression flags, including `--disable-builtin-mcps`, `--disable-mcp-server=github-mcp-server`, and `--no-experimental`
- GitHub memory/PR 404s are suppressed and cached conservatively at repo-local boundaries using repo+session probe scope, with later reports surfacing `disabled_after_404` instead of repeating the same failing evidence forever
- successful GitHub capability checks are also memoized conservatively per repo+session when runtime validation can prove them from the current process log, so later summaries can distinguish `checked_fresh` from `reused_from_cache`
- repeated successful memory-enable and PR-context checks are counted as effective probe episodes instead of raw repeated log lines, and later reports surface fresh-vs-cached reuse explicitly
- completed sessions also seed repo-local success hints for later shell invocations so review-oriented runs can suppress repeated experimental memory checks earlier without disabling GitHub MCP review context
- planning lanes should delegate to named X for GitHub Copilot specialists such as `Repo Scout`, `Ref Index`, and `Triage` rather than falling back to built-in generic helpers like `explore`
- provider transport retries such as HTTP/2 GOAWAY / `503 connection_error` are reported separately from planning or review tail-spin
- runtime summaries separate repo working-tree changes from session-state artifacts, validation/report artifacts, and external file changes, and also surface GitHub capability cache reuse plus retry evidence alongside execution-vs-diff mismatches
- session summaries distinguish committed repo files from dirty working-tree files when start/end HEAD evidence is available, so a clean working tree after a commit is not reported as "no repo change"
- session summaries expose `session_outcome`, `validation_status`, `working_tree_clean`, and committed/uncommitted repo-change booleans as operator truth signals
- session summaries expose `summaryAuthority` / `summary_authority` as an authority grade: `authoritative`, `finalized_with_gaps`, `partial`, `heuristic`, or `failed`
- the hook finalizer writes structured `workspace.yaml` truth and a derived session-state `SESSION_SUMMARY.txt`; the text file is for operator readability, while `workspace.yaml` remains the structured source
- child-lane `subagentStop` hooks are not treated as full session completion without `session.shutdown`, and user aborts, subagent failures, and terminal provider failures downgrade summary authority instead of being hidden behind a stale success label
- hook-path truth is checked across source manifests, generated mirrors, materialized `~/.copilot-xgc` hook scripts, and raw/default Copilot profile conflicts. X for GitHub Copilot-owned hooks use current `.sh` scripts through `XGC_HOOK_SCRIPT_ROOT`; stale `.mjs` hook commands and unsafe direct workspace-relative `.sh` hook commands are reported as bootstrap/runtime config problems, not as app foundation failures.
- live Copilot auth/model/policy readiness is a separate truth layer. `xgc_preflight` catches blockers such as `Authorization error, you may need to run /login`, `Unable to load available models list`, and `Access denied by policy settings` before a long real TUI prompt, while `validate:global` stays focused on non-live profile/materialization truth.
- live single-model TUI runs may report agent-model-policy mismatches when Copilot applies the operator-selected model across child agents; X for GitHub Copilot records the mismatch but only treats it as a summary-authority downgrade when session-level mixed or non-requested model usage is observed. Child-agent tool telemetry and aggregate shutdown model metrics are preserved separately from the operator-selected TUI model truth.
- for raw/default fresh workspaces, missing local hook scripts should degrade fail-open so stale hook-path drift is surfaced as bootstrap/runtime context noise rather than app breakage
- missing GitHub repo identity in fresh local repos, such as `GitHub repository name is required`, is reported as runtime-context unavailability for GitHub memory/PR features, not as app/platform foundation failure
- provider pipe failures such as `write EPIPE` are classified as `runtime-transport` unless separate app-level failure evidence exists
- route summaries can use a conservative direct-session fallback when raw events contain tool execution or `session.shutdown.codeChanges` but no custom-agent route. In that case `route_agents` remains empty, `route_summary_source` is `raw_tool_events_fallback`, and the summary is marked heuristic rather than pretending a Repo Master/Milestone/Patch Master route occurred.
- session summaries expose finalization and archive quality separately through `finalization_complete`, `finalization_partial`, `finalization_error`, `archive_completeness`, and `archive_completeness_reasons`
- validation summaries flag overclaims when wrapper status reports success but raw logs still contain build, seed, typecheck, Playwright, or server-readiness failures
- validation and foundation classifiers ignore prompt/planning checklists and advisory handoff text, so a planned command list does not become a false app-foundation failure until execution evidence exists
- background Patch Master execution is surfaced with `backgroundExecutionAgentObserved`, `backgroundExecutionAgentUnresolved`, and `backgroundExecutionAgentIds` so `/tasks`-only progress does not look like a completed turn
- broader unresolved background planning/specialist work is surfaced with `backgroundAgentUnresolvedObserved` and `backgroundAgentUnresolvedIds`; a large product request that never reaches Patch Master is incomplete, not a clean `completed_without_repo_changes` success
- repo-owned `.xgc/validation/workspace.yaml` is the preferred operator-facing session truth snapshot when it is current for the matching session. The hook finalizer still refreshes the matching session-state `workspace.yaml` for compatibility; reports compare freshness and fall back to the session-state copy when it is newer.
- session truth snapshots are refreshed from hook-time evidence so `updated_at`, route summary, invocation counts, file-change summary, and probe/retry notes stay closer to the actual end of the run
- if execution reached `Patch Master` but no repo working-tree diff was observed, runtime reports expose that mismatch explicitly instead of folding it into a generic success bucket
- if root-level write tools reopen after `Patch Master` completes, runtime reports flag that as an execution-ownership regression
- if built-in generic agents reopen after `Patch Master` starts, runtime reports flag `postExecutionOwnershipLeakObserved` and preserve the generic agent names
- integration-owned surface changes and foundation-readiness signals are reported conservatively as operator hints, not as a new state machine
- latest-session reports surface integration-class, foundation-readiness, shared-surface owner, shared-surface review, and shared-surface conflict fields from the selected current `workspace.yaml` instead of reducing them to a single note
- undeclared shared-surface changes surface conflict/review signals so integration-owned files do not look like ordinary slice-local edits
- shared-surface reports can recommend a final integrator when shared files changed without an explicit owner or during integration-class work
- repeated foundation failure classes surface `foundationRecoverySuggested` as an honesty signal, not as an automated recovery state machine
- model/provider instability such as 429 rate limits and 502 gateway errors is counted separately from planning behavior
- post-execution ownership-leak reporting is a detection/validation mechanism, not a hard dispatch blocker inside Copilot's agent selector
- hook-time summary finalization failures are recorded in `hooks.log` as `finalizeSessionSummary` status lines instead of disappearing silently
- `npm run report:surfaces` remains precedence-focused, but includes a structured `latestSessionTruth` object and matching Markdown section when `.xgc/validation/workspace.yaml` or a fallback session-state `workspace.yaml` is available so source precedence and route/session pointers are not completely split across reports

## Precedence

GitHub Copilot CLI loads surfaces in first-found-wins order. In X for GitHub Copilot global profile mode the practical order is:

1. user-level copies under `COPILOT_HOME`
2. project-level `.github/agents` and `.github/skills`
3. installed plugin copies

That is why X for GitHub Copilot keeps:

- one canonical authoring source under `source/`
- generated plugin surfaces under `agents/` and `skills/`
- generated project-level mirrors under `.github/`
- materialized user-level copies under `~/.copilot-xgc`

`npm run report:surfaces` shows which copy actually won at runtime.

## Model Materialization

Canonical source agents may include internal `modelPolicy` frontmatter. Generated runtime mirrors and user-level materialized agents never expose `modelPolicy`. Most child, review, utility, and specialist lanes receive a resolved static `model:` value. `Repo Master` deliberately omits runtime-facing `model:` because `root-selected` must inherit the user-selected root model rather than pinning the front door to the materialization-time default.

Repo/project mirrors resolve against the default root model. Global profile materialization resolves against the active profile/root model so `Repo Master` can remain root-selectable while planner, executor, utility, and specialist lanes keep their intended model policy.

Session truth also records the requested runtime model, current shutdown model, observed runtime model list, and mixed/non-requested model flags. That distinction matters for stress tests: a top-level `--model` selection can still invoke custom agents with static resolved models unless the run deliberately disables those helper tools.

## What This Repository Does Not Do

- It does not recreate earlier intermediate runtime architectures that do not belong in the GitHub Copilot CLI port.
- It does not ship a billing or quota subsystem.
- It does not target OpenCode in v0.
- It does not claim provider-side billing truth from local logs.
