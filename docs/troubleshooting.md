# Troubleshooting

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. It is an independent open-source project, not an official GitHub product, and these troubleshooting notes should not be read as support for every GitHub Copilot surface.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

## `copilot` still behaves like the raw binary

Check:

```bash
type copilot
echo "$XGC_COPILOT_PROFILE_HOME"
```

If the shim is not active, load it:

```bash
source ~/.config/xgc/xgc-shell.sh
```

If you want durable activation, rerun:

```bash
bash scripts/install-global-xgc.sh --write-shell-profile
```

If you want durable deactivation instead:

```bash
bash scripts/uninstall-global-xgc.sh --disable-only
```

`which copilot` can still point at the raw binary even when X for GitHub Copilot is active. Prefer `type copilot`; it should show a shell function that routes through the X for GitHub Copilot shim.

## Why did my terminal show `done node "$updater" --check --if-due --quiet`?

That line means your shell loaded an XGC shim copy that started its updater in the shell job table instead of detaching it cleanly. Current XGC shim copies are supposed to keep the once-per-day compatible-update check quiet, so this message usually means the active shim is stale.

What it means:

- `xgc_update --check` logic is also used for a quiet once-per-day background check
- current shim copies detach that check so zsh should not print a later `done node "$updater" ...` line
- if you still see the line, your shell is sourcing an older or manually modified shim

This is not raw GitHub Copilot CLI behavior. It means the XGC shell shim is still loaded in the current shell.

To confirm:

```bash
type copilot
echo "$XGC_COPILOT_PROFILE_HOME"
```

To fix:

```bash
bash scripts/install-global-xgc.sh --write-shell-profile
exec zsh
```

If you do not want automatic compatibility checks at all:

```bash
printf '\nexport XGC_AUTO_UPDATE_MODE=off\n' >> ~/.config/xgc/profile.env
exec zsh
```

To stop it:

```bash
bash scripts/uninstall-global-xgc.sh --disable-only
```

To return all the way to login-only raw Copilot:

```bash
bash scripts/uninstall-global-xgc.sh --reset-raw-config --clear-raw-state
```

Then open a new terminal or run `exec zsh`.

## Live TUI auth/model preflight blockers

For long product prompts, first run from a sourced shell:

```bash
source ~/.config/xgc/xgc-shell.sh
type copilot
xgc_preflight
copilot
```

If the TUI or `xgc_preflight` reports `Authorization error, you may need to run /login`, the X for GitHub Copilot profile is not authenticated for prompt generation. Run:

```bash
copilot --config-dir "$XGC_COPILOT_PROFILE_HOME" login
```

If it reports `Unable to load available models list` or `Access denied by policy settings`, the account/model/policy entitlement is not ready. Fix the Copilot plan, organization policy, or model availability before sending a long prompt. On failure, `xgc_preflight` writes the raw diagnostic output to `.xgc/validation/preflight-diagnostic.log` in the current workspace so the exact provider message is not lost. X for GitHub Copilot reports these as `preflight_blocker_observed`, `copilot_auth_failure_observed`, `copilot_model_list_failure_observed`, or `copilot_policy_failure_observed` and keeps them separate from app/platform foundation failures.

These checks are intentionally different from `npm run validate:global`. Global validation proves profile materialization and hook truth; it does not prove live auth or model entitlement.

## Why did this task go directly to Patch Master?

Possible reasons:

- the request already looked grounded and execution-ready
- the target file set was already clear
- the prompt explicitly asked for direct implementation
- route evidence was incomplete, so the validator could not prove the earlier grounding or planning stages

Check:

```bash
npm run validate:runtime
```

Look at:

- `observedPlanningChain`
- `observedPlannerBeforeExecutor`
- `observedTriageBeforeExecutor`
- `observedGroundingBeforeExecutor`

If those fields are weak or unproven, treat that as missing route evidence, not automatic proof that the planner was skipped.

## Why were specialist lanes not invoked?

This can be valid.

Current contract:

- Patch Master-only swarms are acceptable when they still cover the required implementation scope
- specialist lanes are required for explicit specialist-specific requests, narrow UI/visual-only work, docs/prose-only work, naming/tone/creative-direction work, or true multimodal artifact analysis such as screenshots, PDFs, diagrams, or mockups
- Multimodal Look should not be required for visual polish, visual notes, mockup-inspired styling, or “validate UI if available” wording unless an actual screenshot/PDF/image/diagram/mockup artifact is supplied or explicitly referenced
- otherwise specialist lanes are usually recommended helpers, not mandatory blockers

Treat non-invocation as a reporting question first:

- was the specialist scope covered by Patch Master?
- or was it skipped with an explicit reason?

Missing specialist invocation is a route regression only when a required specialist lane was clearly needed and no valid coverage/skip reason was provided.

## Why didn’t I see Milestone or Triage?

That can be normal if:

- the task was small and already grounded
- the task was read-only and already grounded

It can also mean the task escalated too early.

Use runtime validation and inspect:

- `observedFrontDoorHandledDirectly`
- `observedPlanningChain`
- `routeConfidence`

If the task was clearly non-trivial and `Milestone` or `Triage` still never appeared, treat that as a route regression worth fixing.

## Why did planning seem stuck after Triage?

That usually means the Triage consult finished, but Milestone reopened more investigation or a long model call before producing the final handoff.

Expected behavior is now:

- Triage returns a bounded `READY_WITH_NOTES` or `NOT_READY` critique
- Milestone incorporates those findings
- Milestone runs at most one narrow verification batch if a concrete blocking fact is missing
- Milestone does not invoke generic `explore` or request raw full-file dumps after Triage
- Milestone ends with either `Execution-ready handoff for Patch Master` or `Blocked before execution`

If you see repeated broad reads/searches, generic `explore`, or multi-file verbatim content dumps after Triage, treat that as planning tail-spin rather than normal route behavior.

Milestone should now prefer named X for GitHub Copilot specialists over built-in generic helpers:

- delegated discovery should go to `Repo Scout`
- docs-heavy or setup-heavy compression should go to `Ref Index`
- bounded plan critique should go to `Triage`

If you see `explore`, `research`, or other built-in generic helper behavior standing in for those lanes, treat that as planner/helper drift and inspect the active runtime surfaces.

## Why did Triage run twice?

That is a route regression unless new facts appeared after the first Triage review.

Expected behavior:

- Milestone runs Triage before finalizing a non-trivial plan
- Repo Master reuses the Triage result embedded in Milestone's handoff
- Repo Master calls Triage again only if scope, risk, or acceptance criteria changed materially after the handoff

The route/reporting layer now makes that easier to prove with:

- `triageInvocationCount`
- `triageDuplicateObserved`
- `triageDuplicateAllowedReason`
- `executionReadyHandoffSeenBeforeSecondTriage`

If the same plan is triaged twice without new facts, tighten Repo Master's reuse-completed-review behavior.

## Why did it keep working after Patch Master completed?

That usually means the root lane reopened broad validation instead of closing from Patch Master's completion summary.

Expected behavior:

- Patch Master reports changed files, checks run, acceptance-criteria status, and remaining risks
- Repo Master may run at most one narrow verification/read batch if required evidence is missing or contradictory
- if `read_agent` is available, Repo Master should use it to fetch Patch Master's result before deciding the turn is closed
- if `read_agent` is unavailable but raw visible evidence shows `Execution status: ready_for_return` or `Execution status: blocked`, Repo Master should report that visible completion or blocker with a clearly labeled result-read gap instead of silently reopening execution
- Repo Master should not reopen `Repo Scout`, `Ref Index`, `Milestone`, or `Triage` unless Patch Master named a concrete blocker
- integration-class work should not bounce from `Patch Master` into built-in generic agents such as `Explore Agent` or `General Purpose Agent`
- Repo Master then gives the final answer and stops

If you see broad file review or repeated validation after Patch Master already reported success, treat it as post-execution tail-spin.

Runtime validation now makes this easier to spot with:

- `observedExecutionPhasePure`
- `postExecutionPlannerReopenAgents`
- `postExecutionGenericAgentObserved`
- `postExecutionBuiltInAgentObserved`
- `postExecutionGenericAgents`
- `postExecutionOwnershipLeakObserved`
- `ownershipLeakAllowedReason`
- `executionOwner`
- `ownershipTransferredToExecution`
- `backgroundExecutionAgentObserved`
- `backgroundExecutionAgentUnresolved`
- `backgroundExecutionAgentIds`
- `backgroundAgentsStarted`
- `backgroundAgentsCompleted`
- `backgroundAgentsRead`
- `blockingBackgroundAgentsUnresolved`
- `executionOwnerResultRead`
- `postExecutionCompletionGapObserved`

If `postExecutionOwnershipLeakObserved` is true and `ownershipLeakAllowedReason` is empty, treat it as an unexplained execution-ownership leak.

If `ownershipLeakAllowedReason` is `named_blocker`, `narrow_follow_up`, or `user_requested_review`, the report saw a conservative explanation in the transcript. That does not prove the reopen was ideal, but it distinguishes an explained narrow reopen from a silent generic-helper tail-spin.

This is not a hard runtime dispatch block. X for GitHub Copilot narrows the prompt contract and then detects/fails unexplained reopens in smoke/final reporting; it cannot currently intercept every Copilot agent-selection decision before it happens.

If `backgroundExecutionAgentUnresolved` is true, Patch Master ownership was transferred but the session evidence still looks like background-only progress, for example a `/tasks` pointer without a concrete `Execution status: ready_for_return` or `Execution status: blocked`. Treat the user-facing result as incomplete until Patch Master returns a ready/blocked summary.

If `backgroundAgentUnresolvedObserved` is true but `backgroundExecutionAgentUnresolved` is false, a non-execution background lane such as Milestone, Triage, or a specialist lane was still not observed as completed/read. That is not a Patch Master ownership leak by itself, but it is still operator-relevant: a large build that never reaches Patch Master should be reported as incomplete rather than `completed_without_repo_changes`.

If `postExecutionCompletionGapObserved` is true, the background execution owner may have completed but its result was not observed as read/consumed before finalization. A completion notification alone is not a usable Patch Master closure; retrieve the agent result, then close with the changed files, checks, acceptance status, and remaining risks. If retrieval is not possible but visible evidence still shows `Execution status: ready_for_return` or `Execution status: blocked`, report the visible outcome with a labeled result-read gap instead of treating the route as unresolved. If neither the result nor visible completion/blocker evidence can be recovered, report the route as incomplete or partial.

If `execution_handoff_without_observed_repo_diff` or `patch_master_handoff_without_completion_observed` is true, the session reached execution ownership but did not show enough repo-diff/completion evidence to call the run successful. If `malformed_task_payload_observed` is true, fix the delegation packet format first: use plain markdown bullets, not JSON-shaped task envelopes.

If `agent_model_policy_mismatch_observed` is true, the generated/materialized policy may still be correct, but the live Copilot runtime reported a child agent model that did not match the resolved policy. Treat that as runtime truth to investigate rather than assuming the static agent file was honored. If the run intentionally used one TUI-selected model and `mixed_model_session_observed` / `non_requested_model_usage_observed` are false, this mismatch is advisory and should not by itself make the task outcome look partial. Use `observed_runtime_models` for session-level TUI model truth; use `observed_agent_tool_models` and `observed_model_metric_models` only as child-tool or aggregate telemetry.

If `interactiveCommandHangObserved` is true, inspect `interactiveCommandHangCommands` for pagers/editors (`view`, `vim`, `less`, `more`, `nano`), scaffold commands that can prompt, or `posix_spawn failed`. For `npx`/`npm exec` scaffold commands, use `npx --yes create-next-app@14 ...`-style confirmation before the package name; `npx create-next-app@14 ... --yes` may still wait on npm's install prompt in a hidden TTY. Patch Master should switch to non-interactive reads/scaffolds or report a tooling blocker instead of waiting silently. If `missingBuiltInAgentObserved` is true, do not retry Copilot built-in `task`/generic helper lanes; use named X for GitHub Copilot lanes or bounded local checks.

## Fresh workspace raw/default hook failures

If fresh standalone workspaces show repeated hook execution failures, first confirm whether the run used X for GitHub Copilot profile routing or raw/default Copilot profile routing.

Common pattern:

- run used `/opt/homebrew/bin/copilot` directly or otherwise bypassed the X for GitHub Copilot shim
- active raw/default profile still points at stale or repo-relative hook script paths

Repair flow:

```bash
type copilot
echo "$XGC_COPILOT_PROFILE_HOME"
npm run validate:global
npm run repair:raw-hooks -- --dry-run
npm run repair:raw-hooks
bash scripts/install-global-xgc.sh --write-shell-profile
```

Interpretation:

- this is bootstrap/runtime-context drift, not app/platform foundation failure
- current X for GitHub Copilot hook commands are expected to fail open when local hook scripts are missing in raw/default fresh workspaces
- stale raw/default plugin manifests can still contain old `.mjs` hooks or unsafe direct `./scripts/hooks/*.sh` / `./scripts/*.sh` calls; `npm run repair:raw-hooks` rewrites known stale hook manifests after creating backups
- `repair:raw-hooks` is intentionally conservative: deprecated X for GitHub Copilot hook names can be removed, canonical hook names can be rewritten, and nonstandard/custom hooks are preserved as `manualReviewConflicts`
- unknown or neutral plugins that call legacy X for GitHub Copilot `.mjs` hook names are intentionally reported for manual review instead of being auto-rewritten; validate that they are stale before disabling or editing them
- in dry-run output, `wouldRepair: true` means apply mode would change files; `repairComplete: false` is expected until the apply command runs and no `unrepairedConflicts` remain
- in apply mode, a nonzero exit means at least one conflict still needs manual review or could not be safely repaired
- to roll back a repair, copy the relevant `hooks.json.bak-*` file back over `hooks.json`, then rerun `npm run validate:global`
- hook drift should not masquerade as app breakage; it should surface as `bootstrap-hook-path`, `hookExecutionFailureObserved`, or `runtimeConfigMismatchObserved`

## `GitHub repository name is required` during memory checks

In fresh local repos without GitHub identity, this is usually a runtime-context issue:

- missing GitHub remote/repo identity for the current workspace
- GitHub memory/PR context is unavailable for that session

Treat this as bootstrap/runtime context, not app failure. For local implementation routes, GitHub memory/PR probing should be skipped or suppressed rather than treated as a product defect.

## `env.sh` changed my X for GitHub Copilot profile, raw binary, or permission mode

`~/.config/xgc/env.sh` should carry secrets and API keys, not shell-control settings. Current shim behavior preserves `PATH`, `XGC_COPILOT_PROFILE_HOME`, `XGC_COPILOT_CONFIG_HOME`, `XGC_COPILOT_RAW_BIN`, `XGC_HOOK_SCRIPT_ROOT`, `XGC_PERMISSION_MODE`, and `XGC_REASONING_EFFORT` while loading `env.sh`, so a stale secret file should not override the active profile, raw binary, command search path, permission mode, or reasoning-effort override. `profile.env` may persist raw binary, hook root, permission defaults, and reasoning-effort defaults, but it must not redirect the dedicated profile/config homes away from `~/.copilot-xgc` and `~/.config/xgc`. Use `xgc_mode ask|work|yolo`, `XGC_REASONING_EFFORT=off`, or one-shot Copilot CLI flags for a single shell/session.

## Why does validation complain that root patched after Patch Master?

That is a narrower but more serious execution-ownership regression.

Expected behavior now:

- `Patch Master` owns implementation and patching
- `Repo Master` may do bounded read-only finalization after Patch Master returns
- if more implementation is still needed, `Repo Master` should explicitly hand execution back to `Patch Master`
- root should not silently become a second executor

Runtime validation and session summaries now expose this directly with:

- `postExecutionRootWriteObserved`
- `postExecutionRootPatchObserved`
- `postExecutionRootWriteCount`

If any of those fire, treat the run as a route/ownership problem even if the final answer still claimed success.

## Why does the surface report show a different winner layer than I expected?

GitHub Copilot CLI still uses first-found-wins precedence:

1. user-level profile copies
2. project-level `.github` copies
3. installed plugin copies

Run:

```bash
npm run report:surfaces
```

Then inspect:

- winner layer
- winner path
- winner display name
- winner model
- shadowed copies
- explanation

That report is the stronger local source of truth for active runtime source/precedence.

When a recent `.xgc/validation/workspace.yaml` exists, the same surface report also includes a latest-session truth note with the current route, ownership-leak flag, execution-without-diff flag, and file-bucket counts. Treat that repo-owned validation snapshot as the preferred operator-facing session truth source only when it is current for the matching session. Session-state `workspace.yaml` files under `~/.copilot-xgc/session-state` remain fallback/compatibility inputs, and reports should call out freshness mismatches when the two copies disagree.

## Why do I still see 1 premium request in one task and 2 in another?

Because X for GitHub Copilot does not promise universal premium-request reduction.

Different tasks can differ in:

- grounding quality
- planning needs
- implementation scope
- route evidence and escalation timing
- the provider’s final billing behavior

Repo-local logs are stronger for route truth than for billing truth.

That means X for GitHub Copilot can often tell you:

- whether grounding happened
- whether planning happened before execution
- whether the active runtime surface matched the expected role

But exact provider billing still lives outside repo-local proof.

## Why is Copilot still asking for tool permission?

Check the active X for GitHub Copilot permission mode:

```bash
xgc_mode
```

Modes are:

- `ask`
  no default approval flags; prompts are expected
- `work`
  routine write/git/gh/node/npm/pnpm/npx/tsx plus selected low-risk repo discovery commands such as `rg`, `ls`, and `printf` are pre-approved, with selected denies still applied. Commands such as `cat`, `find`, `head`, `tail`, and `sed` still prompt because Copilot CLI approvals are not repo-path-scoped.
- `yolo`
  Copilot CLI receives `--allow-all`

Switch the current shell:

```bash
xgc_mode work
```

If you pass explicit permission flags such as `--allow-all`, `--allow-tool`, or `--deny-tool`, X for GitHub Copilot does not add its mode defaults for that invocation.

## Why did structure analysis skip Repo Scout?

That is not automatically a bug.

Structure or architecture analysis can be handled directly when the request is narrow and already grounded, or delegated to `Repo Scout` / `Ref Index` when discovery or reference compression would improve the answer. X for GitHub Copilot no longer uses a hardcoded task-name rule that forces a fixed scout count for these prompts.

If a structure-analysis task was broad, cold-start, or weakly grounded and still skipped discovery, inspect:

- whether `Repo Master` was the active winning surface
- whether subagent events were missing from stdout/hooks
- whether the prompt asked only for a narrow explanation or for a broader repo map
- whether the route should have gone through `Milestone` before execution

## Why were GitHub memory or PR probes skipped?

That can now be intentional.

Local-context lanes such as `Repo Master`, `Repo Scout`, `Ref Index`, `Milestone`, `Triage`, and `Patch Master` no longer expose GitHub-specific runtime context by default.

That means ordinary local-context work can show:

- `githubMemoryEnabledProbe: skipped_for_route`
- `githubMemoryPromptProbe: skipped_for_route`
- `prLookup: skipped_for_route`

This is not a failure by itself. It is a runtime-noise reduction measure for tasks that do not need GitHub memory or PR context.

GitHub-oriented review/coordination lanes can still allow that context when needed.

## Why did `Memory enablement check: enabled` repeat so many times?

That is the newer efficiency/noise problem, not the older repeated `404` problem.

Runtime validation now keeps a conservative repo+session cache for successful GitHub capability checks when it can prove them from the current process log. Later cases from the same repo+session should now prefer reporting:

- `githubMemoryEnabledCheck: reused_from_cache`
- `githubMemoryEnabledCheckCached: true`
- `githubMemoryEnabledCheckSource: session_cache`
- `githubMemoryEnabledCheckCount: 0`

instead of repeatedly treating every later case as a fresh memory-enable check.

Completed sessions now also refresh a repo-local probe cache summary so later runs can reuse safe success hints without claiming cross-repo truth.

Important:

- X for GitHub Copilot only claims cache reuse when the current case did not emit a fresh check line again.
- check counts are effective probe episodes, not raw repeated identical log lines, so adjacent repeated success lines should collapse into one count
- PR capability is more conservative. If the current case still emitted a fresh PR lookup line, the report should keep `prLookupCheck: checked_fresh` even if an earlier case already succeeded.
- repo-local reporting still cannot prove that the provider never performed hidden internal checks.

## Why does validation say `strong-indirect` instead of `explicit`?

Because X for GitHub Copilot is intentionally conservative.

`strong-indirect` usually means:

- the route or capability is strongly implied
- but the strongest possible direct naming evidence was not present

Examples:

- a docs-heavy task clearly used a tool path that solved the docs question, but the selected MCP was not directly named
- a code-aware task clearly used compiler or code-navigation evidence, but the named LSP was not directly exposed

That is not failure. It is a stronger honesty boundary.

## Why does validation mention `disabled_after_404` for GitHub probes?

Because GitHub memory and PR probing can fail with repeated `404` noise on repositories or task classes that do not actually need those paths.

X for GitHub Copilot now treats that as a reason to stop treating those probes as healthy route evidence in the same validation flow. For local-context lanes, the global shim also starts Copilot with the earliest practical repo-local suppression flags:

- `--disable-builtin-mcps`
- `--disable-mcp-server=github-mcp-server`
- `--no-experimental`

## Why does the session summary say only state or artifact files changed?

The final session summary now separates observed file effects into:

- `repo_working_tree_files`
- `committed_repo_files`
- `session_state_files`
- `validation_artifact_files`
- `external_files`

Use those fields together with:

- `updated_at`
- `latest_event_at`
- `route_summary`
- `route_summary_source`
- `triage_invocation_count`
- `patch_master_invocation_count`
- `repo_working_tree_changed`
- `repo_code_changed`
- `working_tree_clean`
- `validation_status`
- `session_outcome`
- `execution_claim_without_observed_repo_diff`

If `repo_working_tree_files` is empty but `committed_repo_files` is populated, the run changed repo code and committed it. If both repo buckets are empty but `session_state_files` or `validation_artifact_files` is populated, the run likely changed only state/reporting artifacts. If `updated_at` trails the raw event stream by a large margin, treat that as a stale-summary bug rather than proof that nothing happened.

For outcome classification, baseline bookkeeping files such as `events.jsonl` and `workspace.yaml` are not enough by themselves to mark an error run as `partial-success`. The finalizer uses repo changes, validation artifacts, or explicitly useful session artifacts such as `plan.md` / checkpoint indexes for that signal.

If `.xgc/validation/workspace.yaml` did not refresh at all, inspect the repo-local `.xgc/logs/hooks.log` for `finalizeSessionSummary` lines and then check the matching session-state `workspace.yaml` as fallback evidence. A `skipped` or `failed` status means the hook path ran but summary finalization could not complete, for example because `python3` was unavailable or the finalizer exited non-zero. The finalizer also writes a session-state `SESSION_SUMMARY.txt` derived from `workspace.yaml`; if it is missing while `workspace.yaml` refreshed, treat that as an operator-artifact gap rather than proof that execution failed.

If `summary_authority` is `failed`, treat the summary as finalizer or terminal-failure evidence rather than task truth by itself. Look for `summary_authority_reasons`, `finalization_error`, `archive_completeness_reasons`, committed repo files, validation artifacts, and raw events before deciding whether the run produced useful work.

If only the session-state `workspace.yaml` exists, runtime reports should mark the truth source as a fallback rather than silently treating it as the preferred operator snapshot. If both copies exist and disagree, use the freshness fields (`workspaceTruthFreshnessMismatchObserved`, `workspaceTruthFreshnessReason`, and `alternateWorkspaceYamlPath`) to decide which summary is current before treating the disagreement as a finalization/reporting bug.

`--excluded-tools` only accepts concrete tool ids, not MCP server ids. Using `github-mcp-server` there will make Copilot CLI reject the session before it starts.

X for GitHub Copilot also keeps a repo+session probe cache. If the same repository already hit a memory or PR `404` in the current session, later runs should surface `disabled_after_404` for that probe kind instead of repeatedly treating the same failing endpoint as fresh route evidence. Cached PR lookup failures now also suppress GitHub MCP exposure earlier on later runs unless you explicitly opt back into GitHub context for that command.

Separate from that failure cache, runtime validation now also reports safe positive cache reuse for repo+session-scoped GitHub checks. That is why a report can show:

- `githubMemoryEnabledCheck: reused_from_cache`
- `prContextCheck: reused_from_cache`
- `githubCapabilityCacheHits: 1` or higher

without claiming that every provider-side GitHub check disappeared completely.

Important:

- this does **not** mean provider billing was proven one way or another
- it means the repo-local route/reporting layer saw those probes fail and downgraded them accordingly
- it also does **not** guarantee the provider will never perform a hidden internal probe; if it does, the runtime report should make that noise visible instead of treating it as useful route evidence

## Why did Patch Master look frozen after planning finished?

Check the process log before assuming planning tail-spin.

If the log contains:

- `Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request`
- `503 {"error":{"message":"HTTP/2 GOAWAY connection terminated","type":"connection_error"}}`
- `SocketError: HTTP/2: "GOAWAY"`

then the active work may be waiting on provider transport retry/recovery, not Milestone or Triage.

Runtime validation surfaces this as:

- `providerRetryObserved`
- `providerRetryActive`
- `providerRetryState`
- `providerRetryRecovered`
- `providerRetryCount`
- `providerRetryReason`
- `lastProviderTransportError`
- `lastProviderRetryAt`
- `activeAgentDuringRetry`

Interpretation:

- planning tail-spin usually shows repeated planning/review agents reopening work after a handoff should be done
- provider retry usually shows a transport warning/error while an agent such as `Patch Master` is active, followed by more model request boundaries
- `providerRetryState: retry-in-progress` means the run may look stalled even though the provider is still retrying
- `providerRetryState: recovered-after-retry` means the delay was real but the run later recovered
- `providerRetryState: terminal-failure-after-retry` means the run ended in a provider/network failure, not a planner loop
- hard failure usually shows a terminal `Failed to get response from the AI model; retried ...` message or an aborted request after the retry signal

If `workspace.yaml`, `report:surfaces`, or a bundle matrix shows `userAbortObserved: true`, `subagentFailureObserved: true`, or `terminalProviderFailureObserved: true`, treat the session as stopped/incomplete unless there is later committed/validated recovery evidence. A child `subagentStop` hook only proves that one lane stopped; it is not a whole-session success boundary unless `session.shutdown` is also present. Prompt text, handoff prose, assistant reasoning, and tool-request descriptions that list future commands such as `npm install` or `npx playwright test` are intentionally ignored for validation/foundation failure classification unless those commands actually ran; executed `tool.execution_complete` output is the stronger validation source.

## Why does the runtime summary say only state files changed?

Because Copilot CLI's `session.shutdown.codeChanges` can emphasize plan/session artifacts such as `plan.md` or underreport repo edits.

Runtime validation now separates:

- repo working-tree files
- session-state files under `.xgc` or `~/.copilot-xgc/session-state`
- validation/report artifact files
- external files outside those roots
- shared or integration-owned surfaces such as schema, seed/setup, auth/session/config, global shell/navigation, dependency/build config, hooks, runtime validation, or generated runtime surfaces

If execution reached `Patch Master` but no repo working-tree diff was observed, the report also surfaces:

- `executionClaimWithoutObservedRepoDiff`

Do not treat an empty working-tree bucket as proof that no code changed. A session may have committed changes and left the tree clean. Check `committed_repo_files`, `repo_code_changed`, `repo_changes_committed`, `repo_changes_uncommitted`, `working_tree_clean`, `session_start_head`, and `session_end_head`.

If `summary_authority` is `finalized_with_gaps`, `partial`, or `heuristic`, read `summary_authority_reasons` before trusting the summary as complete. Common reasons include missing process-log evidence, unavailable git start/end HEADs, route fallback reconstruction, or unresolved background execution.

Also check `archive_completeness` and `archive_completeness_reasons`. A session can have useful committed output while the archive grade is still `partial` because raw events, a matching process log, validation evidence, or finalizer evidence was missing. Treat that as calibrated confidence, not as proof that the product work failed.

If `validation_overclaim_observed` is true, trust `validation_command_failures` over a wrapper-level `validation_exit=0` or `state=done`. This usually means the harness or session script recorded success even though raw output still showed a Playwright, seed, build, typecheck, or server-readiness failure.

Planned validation checklists are not validation evidence. If a prompt or handoff merely says to run `npm test`, `npm run build`, `npx playwright test`, or a seed command, X for GitHub Copilot should not report validation or app-foundation failure unless executed command output, process/runtime errors, or archived validation artifacts prove it.

If the raw log shows early failures followed by strong later success evidence such as passing tests, build, Playwright, or smoke checks, the finalizer may classify validation as passed and clear the overclaim flag. Wrapper-only success lines are intentionally weaker and do not hide later raw failures.

If `validation_recovered_after_failures_observed` is true, read `validation_recovery_source` and `validation_recovered_command_failures` together. That means earlier raw failures were preserved for audit, but later repo-owned validation artifacts such as `.xgc/validation/**/RESULTS.env` or log exit codes proved the final checked state.

If `model_identity_mismatch_observed` is true during an actual TUI model-switch test, compare `requested_runtime_model` with `post_prompt_observed_runtime_models`. The requested model should be the last TUI-selected model before the prompt; child-agent policy models may still appear after the prompt and should be interpreted alongside `agent_model_policy_mismatch_observed`.

If a bundle matrix shows `Validation Conflict: yes`, compare `Validation` with `External Validation`. That means archived `validation-logs` and `workspace.yaml` disagree. Prefer the conflict as an operator warning: do not manually overwrite either value until you know whether the workspace summary was stale or the external logs belong to a different run.

If logs show `Cannot find module ... scripts/pre-tool-use.mjs`, `scripts/session-start.mjs`, `scripts/prompt-submitted.mjs`, or `bash: ./scripts/hooks/pre-tool-use.sh: No such file or directory`, treat it as a stale hook bootstrap problem rather than an app foundation failure. Current X for GitHub Copilot hooks are `.sh` scripts loaded through `XGC_HOOK_SCRIPT_ROOT`; old `.mjs` paths or direct workspace-relative `.sh` paths usually mean the raw/default Copilot profile still has a stale plugin manifest enabled. Run `npm run validate:global` to confirm. Then run `npm run repair:raw-hooks`, disable/uninstall the stale plugin from the raw Copilot profile, or run through the X for GitHub Copilot shell/profile. X for GitHub Copilot reports this as `bootstrapFailureObserved`, `hookExecutionFailureObserved`, `legacyHookPluginConflictObserved`, or `runtimeConfigMismatchObserved`, separate from `appFoundationFailureObserved`.

If `source ~/.config/xgc/xgc-shell.sh` fails in zsh with `BASH_SOURCE[0]: parameter not set`, `bad option: -P`, or `X for GitHub Copilot shell shim could not find the raw GitHub Copilot CLI binary` even though `whence -p copilot` returns a real binary, the shell profile is loading an old shim copy. Refresh the global materialization with `npm run materialize:global` or reinstall with `bash scripts/install-global-xgc.sh --write-shell-profile`, then restart the shell. A current shim should auto-discover the raw binary in zsh without a manual `XGC_COPILOT_RAW_BIN` export, and a current materialization run should write or preserve an executable `XGC_COPILOT_RAW_BIN` in `~/.config/xgc/profile.env` when one is available.

If logs show `Error: write EPIPE`, classify it as runtime transport noise unless there is separate build/test/app evidence. X for GitHub Copilot reports it as `runtime-transport` so operator summaries do not confuse a Copilot process pipe failure with application foundation failure.

If shared files changed, inspect:

- `integrationOwnedSurfacesTouched`
- `sharedSurfaceChangeObserved`
- `sharedSurfaceOwnerDeclared`
- `sharedSurfaceConflictRisk`
- `sharedSurfaceReviewRecommended`
- `sharedSurfaceFinalIntegratorNeeded`

If `sharedSurfaceOwnerDeclared` is false, the run may still be correct, but the handoff was missing useful ownership language for integration work. If `sharedSurfaceFinalIntegratorNeeded` is true, expect a final integration owner to review those shared files before treating parallel-session output as settled.

Runtime surface and session-bundle reports should now carry `integrationClassTaskObserved`, `foundationReadinessUnknown`, `sharedSurfaceOwnerDeclared`, and `sharedSurfaceReviewRecommended` next to the older conflict/final-integrator fields. If those are missing from a report while present in `.xgc/validation/workspace.yaml`, treat that as a reporting bug rather than a runtime-agent issue.

## Specialist Lane Routing

Use specialist lanes when the route is too focused for a full planner/executor handoff but needs expert behavior:

- `visual-forge` for UI/UX, layout, CSS, responsive behavior, accessibility, and visual polish
- `writing-desk` for docs, onboarding, release notes, changelogs, and structured prose
- `multimodal-look` for read-only screenshot, PDF, diagram, mockup, or visual artifact analysis
- `artistry-studio` for naming, tone, messaging, and creative direction

If a generated or materialized agent still shows `modelPolicy:` in runtime-facing frontmatter, regenerate surfaces and reinstall/materialize the global profile. `modelPolicy` belongs only in canonical source.

If runtime-facing `repo-master.agent.md` shows a static `model:` line, regenerate surfaces and reinstall/materialize the global profile. Repo Master is `root-selected` and should inherit the user-selected root model; static child/specialist `model:` lines remain expected.

Use the observed workspace change summary before assuming the run only touched planning artifacts.

## What does foundation readiness mean?

Foundation readiness is a lightweight integration-task signal, not a universal preflight checklist.

For integration-class tasks, Repo Master or Milestone should say whether the baseline is known enough before broad delegation or deep integration execution. The summary may surface:

- `foundationReadinessAssessed`
- `foundationReadinessUnknown`
- `foundationRiskRaised`
- `repeatedFoundationFailureObserved`
- `foundationRecoverySuggested`
- `foundationFailureClasses`
- `bootstrapFailureObserved`
- `runtimeConfigMismatchObserved`
- `legacyHookPluginConflictObserved`
- `appFoundationFailureObserved`
- `validationPortConflictObserved`
- `validationServerReadinessFailureObserved`

If readiness is unknown, validate basics such as dependencies, build/test baseline, schema/auth/session state, and whether the project can start before parallelizing more work. If `validationPortConflictObserved` is true, free or change the occupied dev-server port before rerunning browser smoke. If `validationServerReadinessFailureObserved` is true, check whether the server actually started before trusting Playwright failures. If `foundationRecoverySuggested` is true, stop normal retry loops and stabilize the repeated failure class first.

X for GitHub Copilot does not replace Copilot CLI's provider retry behavior. It records and reports it so a transient network/provider retry does not look like a silent hang. Rate-limit and gateway evidence such as `user_model_rate_limited`, 429s, 502s, or Unicorn errors should be read as provider/model instability, not as proof that the planning lane itself was looping.

## Why does the report say I am outside X for GitHub Copilot profile mode?

The surface report now states that plainly.

If it says you are outside X for GitHub Copilot profile mode, the winning surfaces may reflect:

- the raw/default Copilot profile
- a project-level `.github` layer
- or plugin-installed copies without user-level X for GitHub Copilot precedence

Fix by:

```bash
source ~/.config/xgc/xgc-shell.sh
npm run report:surfaces
```

## Why does validation say route evidence is weak or unproven?

Because route-level reporting is also evidence-rated.

Route confidence depends on:

- emitted subagent events
- emitted model updates
- transcript evidence
- hook snapshots

If those signals are sparse, X for GitHub Copilot will not pretend it saw more than it did.

## How do I inspect the current winning surface and model quickly?

Run:

```bash
npm run report:surfaces
```

This is the fastest operator check for:

- active `COPILOT_HOME`
- X for GitHub Copilot profile mode active or not
- current winner layer for `repo-master`, `repo-scout`, `ref-index`, `milestone`, `triage`, `patch-master`, and `required-check`
- winner model declarations

## How do I validate structure versus runtime?

Structure only:

```bash
npm run validate
```

Global X for GitHub Copilot profile and shim:

```bash
npm run validate:global
```

If this reports `profile agents file set drifted`, `profile skills file set drifted`, content drift for `~/.copilot-xgc`, or shell-shim drift under `~/.config/xgc`, treat it as installed profile materialization drift, not a product-code failure. Re-materialize the profile, which also refreshes `xgc-shell.sh`, and rerun the global validator:

```bash
npm run materialize:global
npm run validate:global
```

Live runtime evidence:

```bash
npm run validate:runtime
```

Remember:

- structural validation proves repo integrity
- route-level runtime evidence is the repo’s stronger runtime truth source
- provider billing is still outside repo-local proof

## How do I bypass X for GitHub Copilot for one command?

Use:

```bash
copilot_raw
```

or:

```bash
copilot --config-dir /tmp/raw-profile ...
```
