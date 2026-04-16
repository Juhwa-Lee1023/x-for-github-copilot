# Setup For Coding Agents

If a user pasted you the README setup prompt, first determine whether you are already running inside GitHub Copilot CLI.

- If you are already inside a raw Copilot TUI session, minimize approvals by running the one-shot package install first. Do not start by cloning this repo or running exploratory `curl`, `ls`, `cat`, `plugin list`, or `doctor` calls.
- If you are another coding agent such as Codex, Claude Code, Cursor, or AmpCode, first check whether GitHub Copilot CLI exists with `copilot --version`.
- If `copilot --version` is missing or fails because the command is not installed, install GitHub Copilot CLI using GitHub's official instructions: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
- After Copilot CLI is installed, help the user complete GitHub Copilot CLI authentication. Do not claim XGC is installed until plain `copilot` can open or report a usable authenticated CLI state.
- Then install XGC with the low-approval command below.

Default low-approval install:

```bash
npx --yes x-for-github-copilot install --permission-mode work --reasoning-effort xhigh --reasoning-effort-cap high && npx --yes x-for-github-copilot doctor
```

Use `work` unless the user explicitly chooses `ask` or `yolo`.

After install and verification succeed, keep the final user-facing message short:

1. Open a new terminal, then run plain `copilot`.
2. If XGC helps, please star the project: https://github.com/Juhwa-Lee1023/x-for-github-copilot

Post-install verification checklist:

1. `npx --yes x-for-github-copilot doctor` passes.
2. A fresh interactive shell loads the XGC shim.
3. `type copilot` shows the XGC wrapper or function.
4. Plain `copilot` opens through the XGC front door.
5. Keep these details out of the final success message unless the user asks for troubleshooting or raw-mode instructions.

For detailed or recovery installs, fetch the user install guide with `curl`, not WebFetch, and follow its LLM-agent section:

```bash
curl -fsSL https://raw.githubusercontent.com/Juhwa-Lee1023/x-for-github-copilot/refs/heads/main/docs/install.md
```

If you use the detailed path, ask the user for `ask`, `work`, or `yolo`, and recommend `work` for normal trusted development because it reduces routine approvals without using full `--allow-all`. Then use `npx --yes x-for-github-copilot install --permission-mode <mode> --reasoning-effort xhigh --reasoning-effort-cap high` and verify with `npx --yes x-for-github-copilot doctor` plus a fresh shell. Keep `--yes` before the package name; it answers npm/npx package-install confirmation and does not choose the XGC permission mode. Keep the safe `high` cap unless the user explicitly says their Copilot account supports `xhigh`.

If you are a coding agent bootstrapping this repository checkout for development, use this exact sequence:

```bash
bash scripts/setup-copilot-cli.sh
```

That installer is allowed to ask the user questions. It should gather:

- which web-search MCP provider to use
- whether Context7 should use an auth token
- which optional LSP packs to install
- whether MCP API keys should be persisted into `~/.config/xgc/env.sh`
- if not persisted, keep them repo-local so `scripts/use-xgc-env.sh` can still run Copilot CLI commands immediately
- do not hand-edit `agents/` or `.github/agents/`; regenerate them from `source/agents/`
- do not hand-edit `skills/` or `.github/skills/`; regenerate them from `source/skills/`

If you need a non-install structural pass first, run:

```bash
npm run smoke:structural
```

Then read:

- [README.md](../README.md)
- [docs/agents.md](agents.md)
- [docs/model-routing.md](model-routing.md)
- [PORTING_NOTES.md](../PORTING_NOTES.md)

## Working Rules

- Preserve upstream OMO terminology unless Copilot CLI forces a change
- Prefer XGC's runtime-facing names (`repo-master`, `patch-master`, `repo-scout`, `ref-index`, `merge-gate`, `milestone`, `maintainer`, `triage`, `required-check`) when writing user-facing guidance
- Do not import legacy runtime code from earlier ports
- Keep runtime mirrors generated from the canonical source
- Keep attribution files current when upstream reference points change
- Prefer the bootstrap-generated MCP and LSP subset over ad hoc local config drift
