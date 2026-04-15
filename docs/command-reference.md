# Command Reference

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. It is an independent open-source project, not an official GitHub product, and the `xgc` command names below are internal compatibility shorthands rather than a claim to support every GitHub Copilot surface.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

## Shell Entrypoints

- `npx x-for-github-copilot install`
  interactive/manual packaged runtime install that materializes the dedicated XGC profile and shell shim without requiring a repo clone first
- `npx --yes x-for-github-copilot install --permission-mode <mode> --reasoning-effort xhigh --reasoning-effort-cap high`
  agent/scripted packaged runtime install; `--yes` must appear before the package name because it answers npm/npx package-install confirmation, while `--permission-mode` chooses XGC's persisted permission behavior
- `bunx x-for-github-copilot install`
  same packaged runtime install path through Bun for humans who specifically prefer Bun
- `copilot`
  enters X for GitHub Copilot global profile mode through the `Repo Master` orchestration front door unless you pass an explicit `--agent`
- `copilot_raw`
  bypasses the X for GitHub Copilot shim and calls the raw GitHub Copilot CLI binary
- `xgc`
  same default X for GitHub Copilot front-door behavior as `copilot`
- `xgc doctor`
  installed-runtime validation against the active XGC state
- `xgc update`
  installed-runtime compatible update apply
- `xgc uninstall`
  installed-runtime uninstall/disable entrypoint
- `xgc status`
  installed-runtime install-state and runtime-store summary
- `xgc_scout`
  routes directly to the bounded grounding lane `Repo Scout`
- `xgc_plan`
  routes directly to the planner-only lane `Milestone`
- `xgc_triage`
  routes directly to the bounded gap-analysis lane `Triage`
- `xgc_patch`
  routes directly to the execution lane `Patch Master`
- `xgc_review`
  routes directly to the read-only critique lane `Merge Gate`
- `xgc_check`
  routes directly to the bounded high-accuracy review lane `Required Check`
- `xgc_mode`
  prints or switches the current shell permission mode: `ask`, `work`, or `yolo`
- `xgc_effort_cap`
  prints or switches the current shell reasoning-effort cap: `low`, `medium`, `high`, or `xhigh`
- `XGC_REASONING_EFFORT`
  environment override for the desired reasoning-effort flag injected into XGC Copilot runs; default requests `xhigh`, and `off` disables injection
- `XGC_REASONING_EFFORT_CAP`
  environment cap for the injected reasoning effort; default is `high` for account/subscription safety, and `xhigh` should be used only when the account supports it
- `xgc_update`
  compatibility alias for `xgc update`
- `xgc_preflight`
  runs a tiny live prompt-readiness check against the X for GitHub Copilot profile so auth/model blockers are caught before long real TUI sessions

## Repository Scripts

- [scripts/install-global-xgc.sh](../scripts/install-global-xgc.sh)
  installs the dedicated X for GitHub Copilot profile and optional shell activation from a repo checkout or packaged runtime
- [scripts/uninstall-global-xgc.sh](../scripts/uninstall-global-xgc.sh)
  disables shell activation, uninstalls the dedicated XGC profile/config homes, or resets raw Copilot CLI back to login-only state depending on flags
- [scripts/setup-workspace.sh](../scripts/setup-workspace.sh)
  installs dependencies and regenerates runtime mirrors from `source/`
- [scripts/setup-copilot-cli.sh](../scripts/setup-copilot-cli.sh)
  installs the plugin into the active profile without making X for GitHub Copilot the global front door
- [scripts/generate-runtime-surfaces.sh](../scripts/generate-runtime-surfaces.sh)
  regenerates runtime mirrors from canonical source
- [scripts/validate-plugin.sh](../scripts/validate-plugin.sh)
  runs structural validation, typecheck, and tests
- [scripts/repair-raw-copilot-hooks.ts](../scripts/repair-raw-copilot-hooks.ts)
  repairs known stale raw/default Copilot hook manifests after a `--dry-run` preview
- [scripts/smoke-test.sh](../scripts/smoke-test.sh)
  runs fast structural smoke and points at optional live runtime validation

## Diagnostics

- `npm run validate`
  structural validation
- `npm run validate:global`
  dedicated X for GitHub Copilot profile and shim validation
- `npm run repair:raw-hooks -- --dry-run`
  previews raw/default Copilot hook manifest repairs without writing backups or changing files; `wouldRepair: true` means apply mode would write, while `repairComplete: false` is expected when conflicts still exist in dry-run output
- `npm run repair:raw-hooks`
  rewrites known stale X for GitHub Copilot hook commands with `hooks.json.bak-*` backups; exits nonzero if custom/nonstandard hooks remain in `manualReviewConflicts` or `unrepairedConflicts`
- `npm run validate:runtime`
  bounded live Copilot CLI route and capability validation
- `npm run report:surfaces`
  active winner-layer and winner-model transparency
- `npm run update:check`
  repo-local update check using the installed X for GitHub Copilot state
- `npm run update:apply`
  repo-local compatible update apply using the installed X for GitHub Copilot state
- `npm run uninstall:global -- --disable-only`
  removes the XGC shell startup block but keeps `~/.copilot-xgc` and `~/.config/xgc`
- `npm run uninstall:global -- --reset-raw-config --clear-raw-state`
  removes XGC shell/profile state and recreates raw `~/.copilot/config.json` as login-only
- `npm run release:manifest`
  generates release-manifest and track metadata for tagged releases
