# Usage

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. Broader GitHub Copilot surfaces may be explored later, but they are not implied by the current docs or commands.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

X for GitHub Copilot is an independent open-source project, not an official GitHub product or a native replacement for GitHub Copilot across all surfaces.

## Default Entry

In X for GitHub Copilot global profile mode, plain `copilot` is the practical front door for GitHub Copilot CLI workflows.

The shell shim does two things:

- sets `COPILOT_HOME=~/.copilot-xgc`
- injects `--agent repo-master` only when no explicit `--agent` is present

If plain `copilot` still behaves like the raw binary, your shell probably has not loaded `~/.config/xgc/xgc-shell.sh` yet. Verify with:

```bash
type copilot
echo $XGC_COPILOT_PROFILE_HOME
```

When X for GitHub Copilot mode is active:

- `type copilot` shows a shell function
- `XGC_COPILOT_PROFILE_HOME` is `~/.copilot-xgc`

`type copilot` is the authoritative activation check. `which copilot` may still print the raw GitHub Copilot CLI binary because shell functions do not replace the filesystem executable.

Use `copilot_raw` when you want the raw GitHub Copilot CLI behavior with no X for GitHub Copilot profile or agent injection.

If you want to stop loading the XGC shell shim in new terminals, use:

```bash
bash scripts/uninstall-global-xgc.sh --disable-only
```

If you want to return to login-only raw Copilot CLI state, use:

```bash
bash scripts/uninstall-global-xgc.sh --reset-raw-config --clear-raw-state
```

## Recommended Entrypoints

- `copilot`
  X for GitHub Copilot profile + `repo-master` by default
- `xgc`
  same default behavior as `copilot`
- `xgc_scout`
  X for GitHub Copilot profile + `repo-scout`
- `xgc_plan`
  X for GitHub Copilot profile + `milestone`
- `xgc_triage`
  X for GitHub Copilot profile + `triage`
- `xgc_patch`
  X for GitHub Copilot profile + `patch-master`
- `xgc_review`
  X for GitHub Copilot profile + `merge-gate`
- `xgc_check`
  X for GitHub Copilot profile + `required-check`
- `xgc_mode`
  switches the current shell between `ask`, `work`, and `yolo` Copilot permission modes
- `xgc_update`
  checks or applies the latest compatible X for GitHub Copilot release for the current install track
- `xgc_preflight`
  optional live prompt-readiness check for the X for GitHub Copilot profile before long real TUI sessions
- `copilot_raw`
  raw GitHub Copilot CLI binary, no X for GitHub Copilot shim

If background updater notifications in zsh are undesirable for a period, disable the shell shim instead of treating raw Copilot as broken:

```bash
bash scripts/uninstall-global-xgc.sh --disable-only
```

## Specialist Roles

- **Repo Master** (`repo-master`): orchestration front door and router
- **Repo Scout** (`repo-scout`): bounded file, symbol, route, and validation-anchor discovery
- **Ref Index** (`ref-index`): docs, config, spec, and setup-context compression
- **Milestone** (`milestone`): planner-only gate for non-trivial work
- **Triage** (`triage`): bounded pre-plan gap analyzer for non-trivial or risky plans
- **Patch Master** (`patch-master`): execution-only implementation worker
- **Merge Gate** (`merge-gate`): read-only critique and architecture judgment
- **Required Check** (`required-check`): bounded optional high-accuracy review gate
- **Maintainer** (`maintainer`): todo-flow coordinator
- **Visual Forge** (`visual-forge`): UI/UX, CSS, layout, accessibility, visual polish, and responsive behavior
- **Writing Desk** (`writing-desk`): docs, onboarding, release notes, changelogs, and structured prose
- **Multimodal Look** (`multimodal-look`): read-only screenshot, PDF, diagram, mockup, and visual artifact analysis
- **Artistry Studio** (`artistry-studio`): naming, tone, messaging, creative concepts, and aesthetic direction

## Recommended Flow

1. Start with `copilot` or `xgc`.
2. Let `Repo Master` decide whether the task is already grounded, needs discovery, needs planning, or is ready for execution.
3. Use `Repo Scout` and `Ref Index` when repo grounding or reference compression is useful.
4. Route non-trivial work through `Milestone`.
5. Let `Triage` harden non-trivial, ambiguous, multi-file, or risky plans before they become execution-ready.
6. Hand real implementation to `Patch Master`.
7. Once `Patch Master` starts, keep execution closed unless a named blocker requires narrow follow-up context.
8. Use `Merge Gate` or `Required Check` when risk or confidence demands it.

Use specialist lanes by explicit agent when the work is focused enough:

```bash
copilot --agent visual-forge
copilot --agent writing-desk
copilot --agent multimodal-look
copilot --agent artistry-studio
```

For broad implementation, let Repo Master or Milestone decide where specialist input fits so planning and execution ownership stay clear.

Specialist invocation contract:

- Patch Master-only swarms are acceptable for broad implementation work
- specialist lanes are required for explicit specialist-specific requests, narrow UI/visual-only work, docs/prose-only work, naming/tone/creative-direction work, or true multimodal artifact-analysis tasks
- otherwise specialist lanes are recommended; summaries should still report whether that scope was covered by Patch Master or skipped with a reason
- if the operator explicitly asks for a single Copilot session or says not to fan out, summaries preserve that scope and do not mark absent specialist lanes as missing

Scout swarms are available when they are useful, especially for cold-start or broad discovery. They are not forced through hardcoded task-name rules.

Not every task needs every lane. For trivial, well-grounded, low-risk, or read-only work, `Repo Master` can answer or route lightly without forcing `Triage` or `Required Check`.

For integration-class work, such as multi-session product work or changes touching schema, seed/setup, auth/session/config, global shell/navigation, dependency/build config, hooks, runtime validation, or generated runtime surfaces, the handoff should also name shared surfaces, declare `Shared-surface owner:` when those files change, state `Foundation readiness:`, and set `Execution owner: Patch Master` before broad delegation. Patch Master should return `Execution status: ready_for_return` or `Execution status: blocked`; a `/tasks`-only background pointer is not a complete user-facing result. If the same foundation failure class repeats, prefer an explicit recovery handoff over another normal retry loop.

When validating long integration work, read raw command output as well as wrapper status. If a harness records `validation_exit=0` but the output contains Playwright, build, seed, typecheck, or connection failures, X for GitHub Copilot reports that as validation overclaim and keeps the failure visible in session truth.

## Permission Mode

The global installer persists one default permission mode:

- `ask`
  normal Copilot permission prompts
- `work`
  pre-approves common write, Git/GitHub CLI, Node/npm/pnpm/npx/tsx, selected low-risk repo discovery commands such as `rg`, `ls`, and `printf`, plus selected URL/tool usage while keeping selected deny rules; content-reading or rewriting helpers such as `cat`, `find`, `head`, `tail`, and `sed` still prompt because approvals are not repo-path-scoped
- `yolo`
  passes `--allow-all`

Switch the current shell without reinstalling:

```bash
xgc_mode ask
xgc_mode work
```

Use `xgc_mode yolo` only in an isolated workspace where you explicitly want unattended `--allow-all` behavior.

Explicit Copilot permission flags on a command line win over the X for GitHub Copilot default.

## Update Policy

Installed version and update-track state live in `~/.config/xgc/install-state.json`.

Default compatibility rules:

- `0.x`: patch updates only within the current minor track, such as `0.1.2 -> 0.1.9`
- `1.x+`: minor and patch updates within the current major line, such as `1.2.3 -> 1.5.1`

Practical commands:

```bash
xgc_update --check
xgc_update
```

`xgc_update --check` reports the newest compatible release for the current track. `xgc_update` downloads that compatible release from GitHub, re-materializes the dedicated profile, and refreshes the installed shell/update surfaces.

With the default `autoUpdateMode: check`, interactive shells also perform a quiet once-per-day compatible release check in the background. Setting `autoUpdateMode: apply` upgrades only within the current compatibility track.

## Validation Expectations

X for GitHub Copilot treats validation in layers:

1. `npm run validate`
   non-live preflight: generated surfaces, config, typecheck, fresh-bootstrap smoke, and tests
2. `npm run validate:global`
   global profile only
3. `npm run validate:runtime`
   live Copilot CLI route and capability evidence
4. `npm run report:surfaces`
   active runtime-source precedence report

For a real interactive TUI stress run, use a sourced X for GitHub Copilot shell and launch plain `copilot`; do not treat `copilot --model ...` as equivalent coverage for the user-facing path. `xgc_preflight` is the lightweight live check for auth/model readiness before spending a long prompt.

Live validation is conservative:

- `explicit` means runtime evidence names the selected capability directly
- `strong-indirect` means route or capability evidence is strong but not perfectly direct
- `weak` means plausible but thin
- `unproven` means the run completed but attribution could not be proven

Runtime validation also reports when:

- execution reopened planner/reference lanes after `Patch Master`
- execution reopened built-in generic agents such as `Explore Agent` or `General Purpose Agent` after `Patch Master`
- integration-owned/shared surfaces changed without clear ownership language
- foundation readiness was unknown or risky for integration-class work
- committed repo changes were hidden by a clean working tree
- repeated foundation failures suggested recovery but the route continued as if execution were normal
- GitHub memory/PR probes were skipped or disabled after `404`
- provider retry was active, recovered, or failed after HTTP/2 GOAWAY / `503 connection_error`

Do not treat structural validation or local usage events as provider-side billing truth.

Per-case runtime summaries also distinguish:

- repo working-tree changes
- `.xgc` planning/session-state changes
- validation/report artifacts

That separation matters because Copilot CLI `codeChanges` can underreport real repo edits or overemphasize state files such as `plan.md`.

## Raw/Default Copilot Context

If you run the raw binary directly, such as `/opt/homebrew/bin/copilot`, you can bypass X for GitHub Copilot profile materialization and hit stale/default runtime config.

Use this quick check:

```bash
type copilot
echo "$XGC_COPILOT_PROFILE_HOME"
```

If needed, repair and re-activate:

```bash
npm run validate:global
npm run repair:raw-hooks -- --dry-run
npm run repair:raw-hooks
bash scripts/install-global-xgc.sh --write-shell-profile
source ~/.config/xgc/xgc-shell.sh
```

Interpretation guidance:

- stale hook-path failures in raw/default fresh workspaces are bootstrap/runtime-context issues
- missing GitHub repo identity in fresh local repos is a GitHub-context availability issue, not an app failure
