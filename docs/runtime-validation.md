# Runtime Validation

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. Runtime validation is scoped to that surface unless broader GitHub Copilot surfaces are explicitly documented later.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

X for GitHub Copilot is an independent open-source project, not an official GitHub product or a native replacement for GitHub Copilot across all surfaces.

X for GitHub Copilot uses runtime validation to prove **route behavior** and **capability behavior** as honestly as the GitHub Copilot CLI runtime allows.

It does **not** use runtime validation to claim a universal cost guarantee.

## Validation Layers

1. `npm run validate`
   structural validation only
2. `npm run validate:global`
   validates the dedicated X for GitHub Copilot profile, shell wrappers, and active winning surfaces
3. `npm run validate:runtime`
   runs bounded live Copilot CLI sessions and captures route and capability evidence
4. `npm run report:surfaces`
   reports the active winning layer, path, display name, model, and shadowed copies

## What Live Runtime Validation Tries To Prove

Runtime validation is trying to prove:

- which lane was entered
- whether `Repo Master` handled a small request directly or delegated
- whether grounding appeared before execution when a route used execution
- whether `Milestone` and, when appropriate for non-trivial or risky planning, `Triage` appeared before `Patch Master`
- whether `Triage` stayed bounded to one effective plan cycle unless a real new blocker emerged
- whether execution stayed closed once `Patch Master` started
- whether built-in generic agents reopened after `Patch Master` in integration-class work
- whether `Ref Index` was used for docs-heavy entry
- whether capability evidence points to the selected tool path or an alternate one
- whether GitHub memory/PR probing was skipped, allowed, or disabled after observed 404s
- whether a provider transport retry such as HTTP/2 GOAWAY / `503 connection_error` was observed and whether the run recovered
- whether specialist-lane intent was handled honestly as required, recommended, covered by Patch Master, or intentionally skipped with reason

That route-level truth is more useful than simplistic billing claims.

## Route-Level Summary Fields

Per runtime case, the report records route-level fields such as:

- `observedFrontDoorHandledDirectly`
- `observedPlanningChain`
- `routeAgents`
- `routeSummary`
- `keyAgents`
- `routeSummarySource`
- `observedScoutCount`
- `repoScoutInvocationCount`
- `triageInvocationCount`
- `patchMasterInvocationCount`
- `requiredCheckInvocationCount`
- `builtInGenericAgentInvocationCount`
- `triageDuplicateObserved`
- `triageDuplicateAllowedReason`
- `executionReadyHandoffSeenBeforeSecondTriage`
- `observedPlannerBeforeExecutor`
- `observedTriageBeforeExecutor`
- `observedRefIndex`
- `observedGroundingBeforeExecutor`
- `observedExecutionPhasePure`
- `postExecutionPlannerReopenAgents`
- `postExecutionGenericAgentObserved`
- `postExecutionBuiltInAgentObserved`
- `postExecutionGenericAgents`
- `postExecutionBuiltInAgents`
- `postExecutionOwnershipLeakObserved`
- `ownershipLeakAllowedReason`
- `postExecutionRootWriteObserved`
- `postExecutionRootPatchObserved`
- `postExecutionRootWriteCount`
- `integrationClassTaskObserved`
- `foundationReadinessAssessed`
- `foundationReadinessUnknown`
- `foundationRiskRaised`
- `githubMemoryEnabledProbe`
- `githubMemoryPromptProbe`
- `prLookup`
- `githubMemoryEnabledCheck`
- `githubMemoryEnabledCheckCached`
- `githubMemoryEnabledCheckCount`
- `githubMemoryEnabledCheckSource`
- `prContextCheck`
- `prContextCheckCached`
- `prContextCheckCount`
- `prContextCheckSource`
- `prLookupCheck`
- `prLookupCheckCached`
- `prLookupCheckSource`
- `githubCapabilityCacheHits`
- `githubCapabilityCacheMisses`
- `observedMemoryProbeSuppressed`
- `observedPrProbeSuppressed`
- `providerRetryObserved`
- `providerRetryActive`
- `providerRetryState`
- `providerRetryRecovered`
- `providerRetryCount`
- `providerRetryReason`
- `userAbortObserved`
- `subagentFailureObserved`
- `terminalProviderFailureObserved`
- `lastProviderTransportError`
- `lastProviderRetryAt`
- `activeAgentDuringRetry`
- `routeConfidence`

Interpret them conservatively:

- they describe observed route evidence from transcripts, stdout, and hooks
- they do not claim exact hidden internal Copilot routing
- they do not claim exact provider-side billing outcomes
- `observedExecutionPhasePure: false` means planner/reference lanes or built-in generic agents reopened after `Patch Master` was already observed
- `postExecutionOwnershipLeakObserved: true` means execution ownership leaked after `Patch Master` started; for integration-class tasks, unexplained `Explore Agent` or `General Purpose Agent` reopen is treated as a problem
- post-execution ownership-leak fields are detection and validation signals, not a hard runtime dispatch block; prompt contracts reduce the chance of a reopen, while smoke/final summaries make any observed reopen visible
- `executionOwner` and `ownershipTransferredToExecution` show when `Patch Master` became the execution owner for the observed route
- `backgroundExecutionAgentObserved`, `backgroundExecutionAgentUnresolved`, and `backgroundExecutionAgentIds` surface background-only Patch Master progress such as `/tasks`; unresolved background execution should not be treated as a completed handoff
- `backgroundAgentUnresolvedObserved` and `backgroundAgentUnresolvedIds` are broader operator-truth fields for any background task that was started but not observed as completed or read. They can explain why a planning-only or partially finalized run is incomplete even when Patch Master ownership was never transferred.
- `backgroundAgentsStarted`, `backgroundAgentsCompleted`, and `backgroundAgentsRead` separate background progress from actual result retrieval
- `executionOwnerResultRead: false` with `postExecutionCompletionGapObserved: true` means the execution owner appears to have completed but the root/finalizer did not observe its result being consumed before finalization; if visible evidence still shows `Execution status: ready_for_return` or `Execution status: blocked`, treat that as a labeled result-read gap rather than an unresolved execution state
- `blockingBackgroundAgentsUnresolved` lists background execution/specialist agents that still make the route incomplete or partial
- `interactiveCommandHangObserved` and `interactiveCommandHangCommands` surface terminal patterns such as `view`, pager/editor usage, risky scaffold commands, or `posix_spawn failed`; these are runtime/tooling symptoms, not app foundation failures by default
- `missingBuiltInAgentObserved` and `missingBuiltInAgentNames` capture Copilot runtime attempts to load unavailable built-in agents such as `task`
- `observedMemoryProbeSuppressed` and `observedPrProbeSuppressed` reflect the GitHub probe policy that was active when the case started; fresh failures discovered during the same run are still reported as fresh checks rather than retroactively relabeled as pre-run suppression
- `postExecutionRootWriteObserved: true` means root-level write ownership leaked back after `Patch Master` completed; that is treated as a routing regression, not normal finalization
- `triageDuplicateObserved: true` means the same run invoked `Triage` more than once; if `executionReadyHandoffSeenBeforeSecondTriage: true` and `triageDuplicateAllowedReason` is empty, treat that as an unexplained duplicate review pass
- `routeSummarySource` means route reconstruction preferred `subagent.started` and only fell back to `selected`/`completed` when the stronger event was missing

## Integration-Class Reporting

An integration-class task is work that crosses feature boundaries, coordinates multiple sessions/subsystems, or touches shared infrastructure such as schema, migrations, seed/setup, auth/session/config, global shell/navigation, top-level routing, dependency/build config, hooks, runtime validation, or generated runtime surfaces.

Runtime reports keep this lightweight:

- `integrationOwnedSurfacesTouched` lists repo files that match conservative shared-surface path patterns
- `sharedSurfaceChangeObserved` means at least one such file changed
- `sharedSurfaceOwnerDeclared` means the transcript or prompt explicitly named a shared-surface owner
- `sharedSurfaceConflictRisk` means shared surfaces changed without an explicit owner declaration
- `sharedSurfaceReviewRecommended` means shared surfaces changed and deserve deliberate review/finalization
- `foundationReadinessAssessed`, `foundationReadinessUnknown`, and `foundationRiskRaised` reflect explicit foundation-readiness language, not a hidden preflight state machine
- `repeatedFoundationFailureObserved` and `foundationRecoverySuggested` mean the same foundation failure class, such as schema/db, dependency/tooling, build/typecheck, auth/session, or startability, repeated enough that normal retry loops should stop and recovery should be explicit
- `preflightBlockerObserved`, `preflightBlockerKind`, `preflightBlockerReason`, `copilotAuthFailureObserved`, `copilotModelListFailureObserved`, and `copilotPolicyFailureObserved` capture live prompt-readiness blockers such as `Authorization error, you may need to run /login`, `Unable to load available models list`, or `Access denied by policy settings`
- `validationPortConflictObserved` and `validationServerReadinessFailureObserved` call out startability evidence such as `EADDRINUSE`, connection refusal, or a dev server that did not become ready

For integration-class work, `Patch Master -> Explore Agent` and `Patch Master -> General Purpose Agent` are surfaced as ownership leaks unless the raw evidence contains an explicit `ownership leak allowed reason:` marker, a concrete named blocker, a narrow follow-up, or a user-requested review. Generic phrases such as `blocker: none` do not allow the leak.

The surface and bundle reports mirror these governance fields from `.xgc/validation/workspace.yaml` so operators do not need to reopen raw events for basic questions such as whether the run was integration-class, whether foundation readiness was unknown, whether a shared-surface owner was declared, or whether shared-surface review is recommended.

Specialist-lane interpretation stays conservative:

- Patch Master-only swarms are acceptable when they still provide broad implementation coverage
- specialist lanes are required for explicit specialist-specific requests, narrow UI/visual-only work, docs/prose-only work, naming/tone/creative-direction work, or genuine multimodal artifact analysis
- `Multimodal Look` is required only for actual visual/PDF/image/diagram artifact interpretation; visual polish, visual notes, mockup-inspired styling, or “if available” UI validation wording alone should not make it required
- for ordinary large implementation prompts, specialist lanes are usually recommended, not mandatory blockers
- reports should distinguish `covered by Patch Master` from `skipped with reason` instead of turning all non-invocation into hard failure

## Model Policy Validation

Canonical source agents may contain source-only `modelPolicy`, but generated runtime mirrors and materialized user-level agents must not expose it. Validation checks resolved static `model:` values for child/specialist lanes because GitHub custom-agent model frontmatter is static when present. Repo Master is validated differently: runtime-facing Repo Master should omit `model:` so the front door inherits the active root model selected by the operator.

Validation covers:

- `Repo Master` omits static `model:` in the materialized profile and therefore follows the active root model
- Claude planning lanes promote to Opus only when the root is `claude-opus-4.6`
- GPT execution/review lanes stay fixed to `gpt-5.4`
- utility lanes downshift to `gpt-5-mini` only for `gpt-5-mini` / `gpt-4.1` roots
- specialist lanes resolve to their fixed visual, writing, multimodal, or artistry models
- live session telemetry may still reveal a Copilot runtime mismatch; reports surface `agent_model_policy_mismatch_observed`, count, and mismatch strings instead of claiming static policy enforcement succeeded

## Capability-Level Summary

For MCP and LSP cases, X for GitHub Copilot still records:

- `proofStrength`
- `capabilityPath`
- selected capability versus alternate tool path
- observed tools
- transcript, stdout, stderr, and hook snapshot paths

That means X for GitHub Copilot can distinguish:

- selected capability clearly used
- alternate built-in tool path likely used
- plausible but weak evidence
- unproven capability attribution

## LSP And Runtime Surface Hygiene

Structural validation checks two runtime-surface hygiene rules that showed up in live logs:

- runtime-facing `lsp.json` must use the Copilot CLI root `{ "lspServers": { ... } }` shape
- runtime-facing generated agent mirrors strip internal-only frontmatter such as `target` and `metadata`

Canonical source under [source/agents/](../source/agents) may still keep internal metadata. Generated runtime mirrors under [agents/](../agents) and [`.github/agents/`](../.github/agents) must not leak those fields.

## Proof Labels

X for GitHub Copilot keeps four proof labels:

- `explicit`
- `strong-indirect`
- `weak`
- `unproven`

Use them literally:

- `explicit`
  transcript, stdout, or route events clearly name the thing being claimed
- `strong-indirect`
  the claim is strongly supported, but not directly named in the strongest possible way
- `weak`
  the evidence points in the right direction but attribution is thin
- `unproven`
  the run succeeded or completed, but the claimed route or capability was not proven

Hook payloads alone are still supporting evidence, not authoritative proof.

## Capability Path Labels

`capabilityPath` is separate from proof strength.

- `selected`
  evidence points at the selected MCP or LSP
- `alternate`
  an alternate built-in or other code-aware path appears to have satisfied the task
- `none`
  the task completed but the tool path could not be attributed

This matters because route success and capability attribution are not the same thing.

## GitHub Memory And PR Probe Reporting

Local-context lanes do not need GitHub memory or PR context on every pass.

Runtime validation reports:

- `githubMemoryEnabledProbe`
- `githubMemoryPromptProbe`
- `prLookup`
- `githubMemoryEnabledCheck`
- `githubMemoryEnabledCheckCached`
- `githubMemoryEnabledCheckCount`
- `githubMemoryEnabledCheckSource`
- `prContextCheck`
- `prContextCheckCached`
- `prContextCheckCount`
- `prContextCheckSource`
- `prLookupCheck`
- `prLookupCheckCached`
- `prLookupCheckSource`
- `githubCapabilityCacheHits`
- `githubCapabilityCacheMisses`

Interpret them conservatively:

- `skipped_for_route`
  the current route does not need GitHub memory or PR context, so X for GitHub Copilot suppresses those probes as early as the repo-local runtime boundary allows
- `disabled_after_404`
  the validation flow has already observed a 404 for the same repo+session+probe scope and should not treat repeated attempts as healthy route evidence
- `allowed_for_review_context`
  the route is GitHub-context-oriented, such as review, PR, or maintenance, so probing may be appropriate if the cache is clean

The global X for GitHub Copilot shell shim also passes early suppression flags for local-context lanes:

- `--disable-builtin-mcps`
- `--disable-mcp-server=github-mcp-server`
- `--no-experimental`

X for GitHub Copilot also keeps a conservative repo+session probe cache. If the same repository already produced `memory enabled`, `memory prompt`, or PR lookup `404`s in the current session, later reports should surface `disabled_after_404` instead of treating repeated failures as useful route evidence. When cached PR failures exist, the shell shim now suppresses GitHub MCP exposure earlier even for review-oriented lanes unless the operator explicitly re-enables GitHub context for that run.

When X for GitHub Copilot has already observed a successful `Memory enablement check: enabled` line for the same repo+session during runtime validation, later review-oriented cases reuse that success conservatively and report:

- `githubMemoryEnabledCheck: reused_from_cache`
- `githubMemoryEnabledCheckCached: true`
- `githubMemoryEnabledCheckSource: session_cache`

That lets later cases suppress repeated experimental memory checks while still leaving GitHub MCP context available when the route needs review or PR context.

Operator-facing GitHub capability counts are now **effective probe episodes**, not raw repeated identical log lines. Adjacent repeated success or failure lines for the same capability collapse into one fresh check episode so the report tracks repeated work rather than simple log spam.

Completed sessions also seed repo-local success hints into the shell shim cache so a later review-oriented invocation can start with `--no-experimental` earlier when prior process logs already proved memory enablement. That shell-level hint is intentionally weaker than the route report:

- it reduces repeated successful memory-enable checks on later invocations
- it does not claim provider-side internals changed
- it does not claim per-case `reused_from_cache` unless the current process log actually avoided a fresh line

`prLookupCheck` is also tracked in the same repo+session cache, but X for GitHub Copilot stays conservative there:

- if the current case still emitted a fresh PR lookup line, the report says `checked_fresh`
- only cases that actually avoided a fresh PR lookup line should say `reused_from_cache`

That distinction matters because X for GitHub Copilot should not claim cache reuse when the current process log still shows a fresh provider-side PR check.

If a repo+session already had a cached success and the current case still emitted a fresh success episode for the same capability, runtime validation surfaces that as a regression signal instead of flattening it into normal cache reuse.

This is the earliest practical repo-local boundary X for GitHub Copilot can control. It still does not prove that the provider will never perform hidden internal checks, so repeated provider-side 404s are reported conservatively instead of being hidden.

## Raw/Default Copilot Bootstrap Context

Runtime validation also separates bootstrap/runtime-context issues from app failure:

- stale raw/default Copilot hook paths, legacy plugin hook drift, or missing local hook scripts are bootstrap/runtime-context issues
- X for GitHub Copilot-owned hook commands should fail open when expected hook scripts are unavailable in raw/default fresh workspaces
- raw/default plugin manifests that directly call `./scripts/hooks/*.sh` or `./scripts/*.sh` without the `XGC_HOOK_SCRIPT_ROOT` fail-open guard are reported as raw-profile hook conflicts; `npm run repair:raw-hooks -- --dry-run` previews changes and `npm run repair:raw-hooks` can rewrite known stale manifests with backups
- hook repair reports `repairComplete`, `manualReviewConflicts`, and `unrepairedConflicts`; nonstandard/custom hooks are not deleted automatically
- hook repair also reports `wouldRepair` and `changesApplied`; dry-run mode can show `wouldRepair: true` and `repairComplete: false` because no files were changed yet
- apply mode exits nonzero when `manualReviewConflicts` or other `unrepairedConflicts` remain
- missing GitHub repo identity, such as `GitHub repository name is required`, is a runtime-context signal for that workspace, not proof of app/platform failure
- `Authorization error, you may need to run /login`, `Unable to load available models list`, and `Access denied by policy settings` are classified as Copilot auth/model/policy preflight blockers, not app failures
- `write EPIPE` / broken-pipe evidence is classified as `runtime-transport` unless separate app evidence proves an application failure
- app foundation failure signals should stay focused on app-level classes such as schema/build/startability/auth-session runtime behavior
- validation and foundation failures are derived from executed command output, process/runtime errors, and archived validation artifacts; planned validation checklists, task prompts, and planner handoff text are not failure evidence by themselves

`npm run validate:global` is intentionally non-live for account/model entitlement. It proves materialized profile and hook truth. Use `xgc_preflight` from a sourced X for GitHub Copilot shell before long real TUI sessions when the operator needs to prove that the X for GitHub Copilot profile can actually send a prompt. When `xgc_preflight` fails, it preserves the raw provider output in `.xgc/validation/preflight-diagnostic.log` for the current workspace.

## Provider Retry Reporting

Provider transport instability is different from planning tail-spin.

Runtime validation now reports:

- `providerRetryObserved`
- `providerRetryActive`
- `providerRetryState`
- `providerRetryRecovered`
- `providerRetryCount`
- `providerRetryReason`
- `lastProviderTransportError`
- `lastProviderRetryAt`
- `activeAgentDuringRetry`

These fields are intended to make a run that hit HTTP/2 GOAWAY or `503 connection_error` look like a provider retry/recovery path, not like unexplained planner drift.

Interpretation:

- `providerRetryObserved: true` means the process log explicitly showed a retryable provider transport signal.
- `providerRetryActive: true` means the latest evidence still looks like retry/recovery in progress rather than a clean finish.
- `providerRetryState: recovered-after-retry` means the run recovered after the transient provider error.
- `providerRetryState: retry-in-progress` means the log ended while retry/recovery still looked active.
- `providerRetryState: terminal-failure-after-retry` means the run failed after retryable provider transport errors.
- `providerRetryRecovered: true` means a later completion boundary was observed after the retry signal.
- `providerRetryRecovered: false` means a terminal model failure was observed after the retry signal.
- `providerRetryRecovered: null` means no retry was observed or recovery could not be proven.
- `providerRetryCount` means observed retry attempts; when Copilot CLI reports an explicit terminal count such as `retried 5 times`, X for GitHub Copilot uses that count instead of only counting warning incidents.
- `userAbortObserved`, `subagentFailureObserved`, and `terminalProviderFailureObserved` keep stopped or provider-failed sessions from being promoted to authoritative success just because a child lane emitted `subagentStop`.
- A `subagentStop` hook is not by itself a whole-session completion boundary. It can refresh already-terminal truth after `session.shutdown`, but without `session.shutdown` it remains partial child-lane evidence.

X for GitHub Copilot does not implement a new provider retry engine here. It reports the current Copilot CLI behavior so operators can distinguish transient transport recovery from prompt-level tail-spin.

These fields are route/reporting truth. They do not claim perfect visibility into every hidden provider-side retry.

## Runtime Report Artifacts

By default, runtime validation writes:

- `.xgc/validation/runtime-validation.json`
- `.xgc/validation/runtime-validation.md`

It also writes route/source artifacts under `.xgc/validation/artifacts/`.

Per-case runtime summaries now separate:

- repo working-tree changes
- session-state changes, including `.xgc` and `~/.copilot-xgc/session-state` artifacts
- validation/report artifact changes
- external file changes outside the active repo and X for GitHub Copilot state/report roots

In the JSON and markdown reports, this separation is expressed directly through:

- `repoWorkingTreeFiles`
- `committedRepoFiles`
- `workingTreeOnlyDiffObserved`
- `sessionStateFiles`
- `validationArtifactFiles`
- `externalFiles`
- `integrationOwnedSurfacesTouched`
- `sharedSurfaceChangeObserved`
- `sharedSurfaceOwnerDeclared`
- `sharedSurfaceConflictRisk`
- `repoCodeChanged`
- `workingTreeClean`

Commit-related fields in smoke/runtime reports are conservative. When a source only has CLI-reported modified files or workspace snapshot drift, committed-file fields may be reported as `unobserved` rather than `none`; the session finalizer is the git-aware path that can populate committed repo files.

This matters because `session.shutdown.codeChanges` can underreport real repo edits or overemphasize planning/session artifacts such as `plan.md`.

Runtime reports now also flag `executionClaimWithoutObservedRepoDiff` when execution reached `Patch Master` but no repo code change could be observed from the available workspace snapshots. The session finalizer also compares `session_start_head` and `session_end_head` when available, so a clean working tree after a commit is no longer flattened into "no repo change."

The preferred operator-facing session truth source is the repo-owned `.xgc/validation/workspace.yaml` snapshot when it is current for the matching session. The hook finalizer writes the same structured state to the matching `~/.copilot-xgc/session-state/<session-id>/workspace.yaml` for compatibility and also emits a derived `SESSION_SUMMARY.txt` beside that session-state snapshot for quick human reading. Surface and bundle reports compare the available copies and expose freshness mismatch fields instead of blindly treating a stale repo-owned snapshot as authoritative.

Session summaries are refreshed from hook-time evidence. They now aim to keep:

- `updated_at` close to the latest observed event timestamp
- `latest_event_at`, `session_start_head`, and `session_end_head` when available so stale summaries and clean-but-committed runs are easier to spot. If the session-start hook did not preserve `session_start_head`, the finalizer may recover it from the latest git commit before `created_at` and marks that with `session_start_head_source: git-before-created-at`.
- final route agents and route summary closer to the raw event sequence
- `summary_route_heuristic_mismatch`, `summary_timestamp_stale`, and `summary_finalization_status` when the previous summary was stale, route reconstruction changed, or finalization was partial/heuristic
- `summary_authority` and `summary_authority_reasons` to distinguish `authoritative`, `finalized_with_gaps`, `partial`, `heuristic`, and `failed` summaries
- `finalization_complete`, `finalization_partial`, `finalization_error`, `archive_completeness`, and `archive_completeness_reasons` so archive/session quality is graded separately from task outcome
- `route_summary_available`, `route_summary_derived_from_raw_events`, `route_summary_heuristic`, `summary_route_count_mismatch`, and `summary_capability_count_mismatch` so route/count drift does not masquerade as authoritative truth
- direct single-session fallback fields such as `direct_tool_execution_observed`, `tool_execution_count`, `write_tool_count`, `bash_tool_count`, `session_shutdown_observed`, `session_shutdown_code_changes_observed`, and `session_shutdown_files_modified` when raw Copilot events contain tool execution and shutdown code-change evidence but no `subagent.started` route
- explicit invocation counts for `Repo Scout`, `Triage`, `Patch Master`, and `Required Check`
- built-in generic-agent invocation counts and post-execution ownership-leak fields
- repo working-tree files separate from session-state and validation/report artifacts
- committed repo files separate from dirty working-tree files when `session_start_head` and `session_end_head` allow it
- `committed_diff_source` to show whether committed repo truth came from a git start/end range, `git log --since`, `session.shutdown.codeChanges`, or only dirty working-tree evidence
- `session_outcome`, `session_outcome_detail`, `validation_status`, `working_tree_clean`, `repo_changes_committed`, and `repo_changes_uncommitted` as first-class operator signals
- `validation_overclaim_observed` and `validation_command_failures` when wrapper status says success but raw validation output still contains build, seed, typecheck, Playwright, or connection failures
- `validation_recovered_after_failures_observed`, `validation_recovery_source`, and `validation_recovered_command_failures` when repo-owned validation artifacts prove a later clean validation run after raw intermediate failures
- post-execution root write/patch regressions visible
- duplicate-`Triage` and GitHub capability cache reuse visible
- repeated foundation failure and recovery-suggested signals visible
- bootstrap/tooling failure classes separate from app foundation failure classes, including `bootstrap-hook-path`, `runtime-config-mismatch`, `tooling-materialization`, `legacy-plugin-conflict`, `hook-execution`, and `runtime-transport`
- validation startability signals such as port conflicts and server-readiness failures visible
- probe/retry summaries attached to the same final summary path, including model rate-limit / 429 and provider 502 evidence when present
- runtime model truth visible through `requested_runtime_model`, `session_current_model`, `observed_runtime_models`, `post_prompt_observed_runtime_models`, `mixed_model_session_observed`, `non_requested_model_usage_observed`, `model_identity_mismatch_observed`, and agent-level model-policy mismatch fields so model-policy handoffs do not masquerade as pure single-model runs. For actual TUI sessions, `requested_runtime_model` is the latest model selected before the user prompt, not the default model emitted at TUI startup. `observed_runtime_models` is session-level model truth; child-agent telemetry is kept separately as `observed_agent_tool_models`, with aggregate shutdown metrics in `observed_model_metric_models`.
- Patch Master handoff truth visible through `execution_handoff_without_observed_repo_diff`, `patch_master_handoff_without_completion_observed`, and `malformed_task_payload_observed`

The hook finalizer writes flat YAML with JSON-quoted string scalars. This is intentionally conservative: values with colons, hashes, braces, quotes, leading/trailing whitespace, or boolean/null-like text remain parseable and do not corrupt either `workspace.yaml` copy.

On terminal `agentStop` and `subagentStop` hooks, the finalizer briefly waits for a trailing `session.shutdown` event before writing the final truth snapshot. Copilot can append shutdown/code-change evidence immediately after the stop hook begins, so this small settle window prevents direct single-session summaries from missing shutdown evidence by a race.

If hook-time finalization cannot run, `hooks.log` records a `finalizeSessionSummary` status line with `skipped` or `failed` instead of silently hiding the missing summary refresh. Hook logs are usually repo-local at `<workspace>/.xgc/logs/hooks.log`, not under the global profile session-state directory.

This is still conservative hook-time evidence, not a new runtime state machine.

When a session has no custom-agent route because it ran as a single raw Copilot session, X for GitHub Copilot does not invent `route_agents`. It may still report `route_summary: Direct Copilot Session` with `route_summary_source: raw_tool_events_fallback` when raw tool events prove useful work happened, or `route_summary_source: session_shutdown_code_changes_fallback` when the only execution proof is `session.shutdown.codeChanges`. Both remain heuristic direct-session summaries, not evidence that the planning-first custom-agent path ran.

Validation status is ordered by decisive evidence rather than by a simple “any failure anywhere” scan. Executed shell results from `tool.execution_complete` are preferred over assistant reasoning, tool-request descriptions, and prompt handoff prose. A strong later pass such as successful tests, build, Playwright, smoke output, or an explicit “all required validation commands passed” completion can recover from earlier transient failures, while wrapper-only success markers such as `validation_exit=0` still do not override later raw failure evidence. Operational progress noise such as “background agent still running” wait messages or fresh-root `git rev-parse HEAD` bookkeeping failures is not treated as product validation failure evidence.

The separate surface report writes:

- `.xgc/validation/surface-resolution.json`
- `.xgc/validation/surface-resolution.md`

The surface report remains primarily a precedence report, but it now includes a structured `latestSessionTruth` JSON object and matching Markdown section when a recent `.xgc/validation/workspace.yaml` or fallback session-state `workspace.yaml` is available. That object carries freshness timestamps, start/end HEAD evidence, route, authority, archive completeness, outcome/finalization/validation state, user-abort/subagent-failure/provider-terminal-failure signals, validation-overclaim signals, requested/current/observed runtime model truth, mixed-model flags, committed and working-tree counts, ownership leak flags, background execution flags, shared-surface risk, foundation recovery state, route/count mismatch flags, the selected `workspace.yaml` path, a `workspaceTruthSource` value, and freshness mismatch fields when the repo-owned and session-state copies disagree.

For already-collected session directories or extracted bundles, `npm run report:session-bundle -- --bundle-root <path>` reads existing `workspace.yaml` files and writes `SESSION_RESULTS.json` plus `SESSION_MATRIX.md`. If a bundle contains both `.xgc/validation/workspace.yaml` and session-state copies for the same session id, the report prefers the fresher/current evidence and records missing raw artifacts as archive-completeness reasons. When `session_state_files` says `.xgc/logs/hooks.log` was produced, the bundle report expects that hook log to be archived too and flags `hooks_log` when it is missing. The bundle report also discovers sibling `validation-logs` directories, reports their `externalValidationStatus`, and sets `validationStatusConflictObserved` instead of hiding disagreement between archived validation logs and stale workspace truth. The bundle report surfaces the same core governance truth as runtime reporting, including route source, committed diff source, user aborts, subagent failures, terminal provider failures, execution ownership, ownership leaks, foundation readiness/risk, bootstrap/tooling/app foundation flags, shared-surface final-integrator need, and route/capability mismatch fields. The command does not create, delete, unzip, or clean archives; it only synthesizes operator truth from available artifacts.

## Runtime Source Reporting

The surface report exists because precedence is easy to misread.

For each core lane it shows:

- winner layer
- winner path
- winner display name
- winner model
- shadowed copies
- a short explanation of why that surface won

It also states plainly whether the report was generated:

- in X for GitHub Copilot global profile mode
- or outside X for GitHub Copilot global profile mode

## Bounded Honesty

X for GitHub Copilot does not promise:

- universal premium-request reduction
- deterministic scout fan-out
- deterministic use of a selected MCP or LSP
- provider-side billing truth from local logs alone

It does try to prove:

- planning-before-execution route discipline
- whether grounding appeared before execution
- whether prompt-contract boundaries were followed well enough to avoid obvious planning/review tail-spin
- runtime source precedence
- evidence-classified capability usage

Use the reports that way.
