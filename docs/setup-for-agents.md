# Setup For Coding Agents

If you are installing X for GitHub Copilot for a user, do not start with this repo-checkout script. Fetch the user install guide and follow its LLM-agent section:

```bash
curl -fsSL https://raw.githubusercontent.com/Juhwa-Lee1023/x-for-github-copilot/refs/heads/main/docs/install.md
```

Ask the user for `ask`, `work`, or `yolo`, then use `npx x-for-github-copilot install --permission-mode <mode>` and verify with a fresh shell.

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
