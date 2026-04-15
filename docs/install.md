# Install

X for GitHub Copilot currently supports GitHub Copilot CLI workflows through a dedicated profile and shell shim. It is an independent open-source project, not an official GitHub product, and it should not be interpreted as a native replacement for GitHub Copilot across all surfaces.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

## Prerequisites

- Git
- Node.js 20+
- GitHub Copilot CLI installed and authenticated

## Recommended Install: npx Global X for GitHub Copilot Mode

```bash
npx x-for-github-copilot install
```

This is the primary user-facing install path.

Equivalent Bun entry:

```bash
bunx x-for-github-copilot install
```

Both commands run the packaged XGC runtime and install the same dedicated profile/shim layout. `npx` is the primary recommendation because GitHub Copilot CLI users are more likely to already have Node/npm than Bun.

## What The Packaged Install Does

The package-based install flow:

- uses the packaged runtime instead of asking the user to clone the repo first
- materializes `~/.copilot-xgc` and `~/.config/xgc`
- installs the plugin from the packaged runtime bundle
- appends the shell activation block by default
- asks which permission mode to persist unless you pass `--permission-mode`
- leaves plain `copilot` as the practical front door after a fresh shell reload

Validation after package install:

```bash
npx x-for-github-copilot doctor
```

After install, the preferred management path is the installed runtime from a sourced shell:

```bash
xgc doctor
xgc update --check
xgc update
xgc uninstall --disable-only
xgc uninstall --reset-raw-config --clear-raw-state
xgc status
```

The `npx`/`bunx` entrypoints remain valid for first install and fallback use, but daily operator management should not require a repo checkout.

## Developer / Repo-Checkout Install

If you are developing the project locally or intentionally want the repo-checkout path, use:

```bash
bash scripts/install-global-xgc.sh --write-shell-profile
```

This repo-checkout install flow:

- prepares the workspace and installs repo dependencies
- regenerates runtime mirrors from [source/](../source)
- bootstraps MCP and LSP config into [`.github/mcp.json`](../.github/mcp.json) and [lsp.json](../lsp.json)
- materializes a dedicated profile at `~/.copilot-xgc`
- copies user-level agents and skills into `~/.copilot-xgc/agents` and `~/.copilot-xgc/skills`
- installs the plugin into that profile
- installs the shell shim at `~/.config/xgc/xgc-shell.sh`
- installs the self-update entrypoint at `~/.config/xgc/xgc-update.mjs`
- appends the X for GitHub Copilot activation block to your shell startup file after creating a backup
- makes plain `copilot` enter the X for GitHub Copilot global front door through `Repo Master` in new shells
- asks which default permission mode to persist in `~/.config/xgc/profile.env` when run interactively
- writes `~/.config/xgc/install-state.json` with the installed version, update track, update policy, and last-check metadata

The runtime-facing `lsp.json` now uses Copilot CLI's required root `{ "lspServers": { ... } }` shape, and generated runtime-facing agent mirrors strip source-only frontmatter before installation/materialization.

The installer and global validation also check hook-path truth across source, mirrors, and the materialized X for GitHub Copilot profile. Current hooks use `.sh` scripts through `XGC_HOOK_SCRIPT_ROOT`; stale `.mjs` hook paths such as `scripts/pre-tool-use.mjs`, `scripts/session-start.mjs`, or `scripts/prompt-submitted.mjs`, plus unsafe direct raw/default `./scripts/hooks/*.sh` or `./scripts/*.sh` hook commands, are treated as runtime hook conflicts.

If your raw/default `~/.copilot/config.json` still has an enabled legacy dual-runtime plugin, fresh raw `copilot` runs can execute that old plugin even though this repo's hooks are current. X for GitHub Copilot reports that as a raw-profile conflict and does not edit your default Copilot config automatically during validation. Run `npm run repair:raw-hooks -- --dry-run` first to inspect planned edits, then `npm run repair:raw-hooks` to rewrite known stale hook manifests with `hooks.json.bak-*` backups. Custom or nonstandard hooks are preserved and reported as `manualReviewConflicts` instead of being deleted. In dry-run output, `wouldRepair: true` means apply mode would write files; in apply mode, nonzero exit means `unrepairedConflicts` remain. To roll back, copy the relevant backup over `hooks.json` and rerun `npm run validate:global`. If manual review remains, disable/uninstall the stale plugin or run through the X for GitHub Copilot profile/shell. `npm run validate:global -- --allow-legacy-plugins` exists only for intentional compatibility investigation.

Fresh bootstrap validation reads the raw/default Copilot config from `~/.copilot/config.json` before considering compatibility fallbacks such as a direct `config.json` under the supplied home fixture. Known legacy plugins with missing hook manifests are reported as conflicts, and unknown/neutral plugins that still call legacy X for GitHub Copilot `.mjs` hook names are surfaced for manual review rather than rewritten automatically.

## What The Global Profile Means

Global X for GitHub Copilot mode uses:

- dedicated profile: `~/.copilot-xgc`
- dedicated config home: `~/.config/xgc`
- shell integration: `~/.config/xgc/xgc-shell.sh`
- self-update entrypoint: `~/.config/xgc/xgc-update.mjs`
- optional secret/env file: `~/.config/xgc/env.sh`

This is a practical GitHub Copilot CLI front door for this project, not a built-in default replacement for GitHub Copilot.

Plain `copilot` in X for GitHub Copilot mode enters through the `Repo Master` orchestration front door unless you explicitly pass `--agent`.

`env.sh` is intended for runtime secrets such as MCP/API keys. The shell shim preserves operational settings such as `PATH`, `XGC_COPILOT_PROFILE_HOME`, `XGC_COPILOT_CONFIG_HOME`, `XGC_COPILOT_RAW_BIN`, `XGC_HOOK_SCRIPT_ROOT`, and `XGC_PERMISSION_MODE` around `env.sh` loading so a stale secret file cannot silently redirect the active profile, raw binary, command search path, or permission mode.

## Version Tracks And Updates

X for GitHub Copilot keeps version state in `~/.config/xgc/install-state.json`.

Default update policy:

- `0.x` releases: auto-update compatibility is patch-only within the current minor track
- `1.x+` releases: auto-update compatibility expands to minor and patch updates within the current major line

That means a `0.1.x` install can auto-apply `0.1.y`, but it should not auto-jump to `0.2.0` without an explicit operator decision.

Useful commands:

```bash
xgc update --check
xgc update
```

- `xgc update --check` checks the latest compatible GitHub release for the current installed track
- `xgc update` applies the latest compatible release and re-materializes the profile

The default install state uses `autoUpdateMode: check`, so the project is prepared for safe compatibility checks first rather than unattended upgrades.

When the shell shim is loaded in an interactive shell, that default `check` mode performs at most one quiet compatibility check per day. If an operator later chooses `apply`, only the latest compatible release on the current track is applied automatically.

Current shell shim copies detach that background check cleanly, so opening a new terminal should not print zsh job-completion noise. If you still see a line such as `[4] + done node "$updater" --check --if-due --quiet`, the active shim is stale or manually modified; rerun `bash scripts/install-global-xgc.sh --write-shell-profile` to refresh it, or set `XGC_AUTO_UPDATE_MODE=off` in `~/.config/xgc/profile.env` if you do not want automatic checks at all.

## Permission Mode

During interactive install, X for GitHub Copilot asks which permission mode should be the default:

- `ask`
  no default approval flags; Copilot CLI prompts normally
- `work`
  pre-approves common write/git/gh/node/npm/pnpm/npx/tsx work, selected low-risk repo discovery commands such as `rg`, `ls`, and `printf`, plus selected MCP work and selected GitHub URLs, while still denying obvious high-risk commands such as `shell(rm)` and `shell(git push)`. Content-reading or rewriting helpers such as `cat`, `find`, `head`, `tail`, and `sed` remain approval-gated because Copilot CLI approvals are not repo-path-scoped.
- `yolo`
  passes Copilot CLI's `--allow-all`; this is fully unattended and least safe

For non-interactive install, X for GitHub Copilot falls back to `ask` unless you pass a mode explicitly. For agent-driven or OMO-style copy-paste install from a plain Copilot TUI, the prompt should tell the agent to ask the user for `ask` / `work` / `yolo` before starting the shell tool, then pass that selection through `--permission-mode`. That avoids the hidden installer `read` prompt that can otherwise stall inside Copilot's shell tool:

```text
Install X for GitHub Copilot from the current repository. Before running the installer, ask me which default permission mode to persist (`ask`, `work`, or `yolo`) and wait for my selection. After I answer, run bash scripts/install-global-xgc.sh --write-shell-profile --permission-mode <my selection>. Then verify in a fresh interactive shell that `type copilot` resolves to the X for GitHub Copilot shim, `copilot plugin list` shows xgc, and `npm run validate:global` passes. After that, explain how I start using it from a new shell: open a new terminal or run `exec zsh`, use plain `copilot` as the front door, use `copilot_raw` to bypass XGC, and use `xgc_mode ask|work|yolo` to change the current shell mode. Report the exact commands, exit codes, validation results, and the short post-install usage notes.
```

You can still run the installer directly when you already know the mode:

```bash
bash scripts/install-global-xgc.sh --permission-mode work
```

You can change the current shell without reinstalling:

```bash
xgc_mode ask
xgc_mode work
```

Explicit Copilot CLI permission flags such as `--allow-all`, `--allow-tool`, or `--deny-tool` still win for a single invocation.

### Unsafe Unattended Mode

`yolo` maps to Copilot CLI's `--allow-all`. Use it only for an isolated workspace where you explicitly want unattended execution and understand that Copilot will not ask before running tools.

```bash
bash scripts/install-global-xgc.sh --permission-mode yolo
xgc_mode yolo
```

## Shell Activation And Preview Mode

The recommended package command and the repo-checkout command both append the X for GitHub Copilot shell activation block after creating a backup. That is what makes plain `copilot` enter the X for GitHub Copilot global front door automatically in new shells.

## Start Using It After Install

Once install and validation succeed, the normal operator flow is short:

1. Open a new terminal or run `exec zsh`
2. Run plain `copilot`
3. Use `/model` only if you want to switch the current root model

Useful follow-up commands:

```bash
copilot
copilot_raw
xgc_mode ask
xgc_mode work
xgc_mode yolo
```

- `copilot` enters the X for GitHub Copilot front door in a new shell
- `copilot_raw` bypasses X for GitHub Copilot and opens raw GitHub Copilot CLI
- `xgc_mode ...` changes the current shell's permission mode without reinstalling

If you just finished installing from a coding-agent session, the agent should not stop at "install succeeded." It should also tell you to open a fresh shell, run plain `copilot`, and mention `copilot_raw` plus `xgc_mode ask|work|yolo`.

For the current shell only, activate manually:

```bash
source ~/.config/xgc/xgc-shell.sh
```

The shell shim is expected to be sourceable from both bash and zsh, including zsh sessions with `set -u` / `nounset` enabled. It should also find the raw Copilot binary from a plain zsh session without requiring `XGC_COPILOT_RAW_BIN`; the shim uses a zsh-safe path lookup before falling back to bash-style lookup. `npm run materialize:global` now also records a resolvable raw Copilot binary in `~/.config/xgc/profile.env` when it can find one, and preserves an existing executable raw-binary setting on later materialization runs. If sourcing the shim prints `BASH_SOURCE[0]: parameter not set`, `bad option: -P`, or cannot find the raw binary even though `/opt/homebrew/bin/copilot` exists, the active shim copy is stale; rerun `npm run materialize:global` or `bash scripts/install-global-xgc.sh --write-shell-profile`, then open a fresh shell.

If you want a preview-only run without writing your shell startup file, omit `--write-shell-profile`:

```bash
bash scripts/install-global-xgc.sh
```

Preview-only mode shows:

- which shell startup file it would touch
- whether the X for GitHub Copilot block is already present
- the exact block it would append
- how to activate manually

If you already installed preview-only from a repo checkout and want to append the activation block later:

```bash
bash scripts/install-global-xgc.sh --write-shell-profile
```

## Disable, Uninstall, And Return To Raw Copilot

There are three distinct cases:

### 1. Disable XGC shell activation, but keep the installed profile

```bash
npx x-for-github-copilot uninstall --disable-only
```

Use this when you want plain raw `copilot` in new shells but you do not want to delete `~/.copilot-xgc` or `~/.config/xgc`.

### 2. Uninstall the dedicated XGC profile/config homes

```bash
npx x-for-github-copilot uninstall
```

This removes the shell activation block plus:

- `~/.copilot-xgc`
- `~/.config/xgc`

It leaves your raw `~/.copilot/config.json` alone unless you also request a raw reset.

### 3. Return to login-only raw Copilot CLI

```bash
npx x-for-github-copilot uninstall --reset-raw-config --clear-raw-state
```

This is the strongest raw revert path. It:

- removes the XGC shell activation block
- uninstalls `~/.copilot-xgc` and `~/.config/xgc`
- clears raw Copilot local runtime state under `~/.copilot`
- recreates `~/.copilot/config.json` in login-only form, preserving only `last_logged_in_user` and `logged_in_users`

Backups are written to `~/xgc-uninstall-backup-<timestamp>`.

## Post-Uninstall Verification Checklist

After disable/uninstall/raw-revert:

1. Open a new terminal or run `exec zsh`
2. Run `type copilot`
3. Run `echo "$XGC_COPILOT_PROFILE_HOME"`
4. Run `copilot plugin list`

Expected raw results:

- `type copilot` should resolve to `/opt/homebrew/bin/copilot`
- `XGC_COPILOT_PROFILE_HOME` should be empty
- `copilot plugin list` should not show `xgc`

If you still see XGC shell behavior or a background updater job line after that, the active shell has probably not been reloaded yet or another shell startup file is still sourcing an old shim.

## Planning-Friendly Shortcuts

Once the shim is active, these wrappers are available:

- `xgc`
- `xgc_scout`
- `xgc_plan`
- `xgc_triage`
- `xgc_patch`
- `xgc_review`
- `xgc_check`
- `copilot_raw`

That means planning is as easy to enter as scouting or patching.

## Alternative Install Paths

Project-local plugin install only:

```bash
bash scripts/setup-copilot-cli.sh
```

Workspace prep only:

```bash
bash scripts/setup-workspace.sh
```

Tooling bootstrap only:

```bash
bash scripts/bootstrap-xgc-stack.sh
```

## Validation After Install

Structural validation:

```bash
npm run validate
```

Fresh bootstrap/materialization smoke only:

```bash
npm run smoke:fresh-bootstrap
```

Global X for GitHub Copilot validation:

```bash
npm run validate:global
```

This checks the installed X for GitHub Copilot profile, source/mirror hook manifests, materialized hook scripts, and raw/default Copilot profile conflicts. It fails when the raw/default Copilot profile can still materialize stale legacy `.mjs` hook commands or unsafe direct workspace-relative `.sh` hook commands, while keeping that separate from source/mirror hook manifest drift. Use `npm run smoke:fresh-bootstrap` for the isolated bare-workspace bootstrap smoke.

`validate:global` proves profile materialization, mirror integrity, hook-path truth, and raw/default stale-plugin conflict detection. It does not prove that GitHub Copilot auth or model entitlement is ready for a live prompt. Before a long real TUI run, source the shim and run the live readiness check:

```bash
source ~/.config/xgc/xgc-shell.sh
type copilot
xgc_preflight
copilot
```

If `xgc_preflight` reports `Authorization error, you may need to run /login`, run `copilot --config-dir "$XGC_COPILOT_PROFILE_HOME" login` and complete the device flow. If it reports `Unable to load available models list` or `Access denied by policy settings`, fix the Copilot account, organization policy, subscription, or model entitlement before starting the product prompt. These are pre-generation readiness blockers, not product implementation failures.

If `validate:global` reports profile mirror drift such as `profile agents file set drifted`, or shell shim drift such as stale GitHub suppression flags, the installed `~/.copilot-xgc` / `~/.config/xgc` surfaces are stale relative to this repo checkout. Re-materialize the profile, which also refreshes the installed shell shim, then validate again:

```bash
npm run materialize:global
npm run validate:global
```

Live runtime validation:

```bash
npm run validate:runtime
```

Runtime surface inspection:

```bash
npm run report:surfaces
```

Those checks now also confirm:

- the installed/profile LSP config is in the valid runtime shape
- runtime-facing agent mirrors are clean and do not leak internal-only frontmatter
- the active winner layer and agent-level model policy are easy to inspect, while the X for GitHub Copilot profile intentionally avoids a persistent root `model`
- fresh bootstrap materialization keeps hooks, agents, skills, MCP, LSP, and finalizer-safe `workspace.yaml` output aligned without live Copilot access
- the hook finalizer can produce the preferred repo-owned `.xgc/validation/workspace.yaml` operator truth snapshot, while session-state `workspace.yaml` remains compatibility/fallback evidence and reports compare freshness when both copies exist
- specialist agents and parent-aware model policy materialize without leaking source-only `modelPolicy`; Repo Master omits static `model:` for root-selected inheritance, while child/specialist lanes expose resolved static `model:` values

## Confirm Which Profile And Surface Are Active

Check the shell wrappers:

```bash
type copilot
type copilot_raw
echo "$XGC_COPILOT_PROFILE_HOME"
```

Use `type copilot` as the activation check. `which copilot` can still show the raw executable because shell functions are not filesystem binaries; that is normal as long as `type copilot` shows the X for GitHub Copilot wrapper function.

Check the active winning runtime surfaces:

```bash
npm run report:surfaces
```

Synthesize results for existing session directories or extracted bundles:

```bash
npm run report:session-bundle -- --bundle-root /path/to/extracted/session-bundle
```

That report tells you:

- whether X for GitHub Copilot profile mode is active
- which layer won for each core lane
- the winner path
- the winner display name
- the winner agent model when one is declared by that runtime surface
- which lower-precedence copies were shadowed
- latest matching session truth, including `updated_at`, `latest_event_at`, start/end HEAD evidence, summary authority, archive completeness, validation overclaim, committed-vs-working-tree counts, ownership leaks, shared-surface risk, and foundation recovery hints when `workspace.yaml` is available

## Operator Journey

The intended operator path is:

1. install with `install-global-xgc.sh --write-shell-profile`
2. open a new shell, or activate the shim manually for the current shell
3. inspect winners with `npm run report:surfaces`
4. validate structure with `npm run validate`
5. run live runtime checks with `npm run validate:runtime` when you want route or capability evidence
