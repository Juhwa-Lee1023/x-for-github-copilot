# X for GitHub Copilot

**Planning-first orchestration, specialist work lanes, integration governance, and runtime truth for GitHub Copilot CLI.**

X for GitHub Copilot is currently designed for **GitHub Copilot CLI** workflows.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

> X for GitHub Copilot is an independent open-source project.
> It is not an official GitHub product, is not affiliated with or endorsed by GitHub, and should not be interpreted as a native replacement for GitHub Copilot across all surfaces.

## Start Now

### For Humans

Paste this into your LLM agent session:

```text
Install and configure X for GitHub Copilot by following the instructions here:
https://raw.githubusercontent.com/Juhwa-Lee1023/x-for-github-copilot/refs/heads/main/docs/install.md
```

Or read the [installation guide](docs/install.md), but the recommended path is to let an agent do it. Installation touches Copilot profile and shell startup files; agents are better at copying exact flags and verifying fresh-shell behavior.

Manual install:

```bash
npx x-for-github-copilot install
```

Bun equivalent:

```bash
bunx x-for-github-copilot install
```

### For LLM Agents

Important: use `curl` to fetch the installation guide, not WebFetch. WebFetch can summarize away required flags and verification steps.

```bash
curl -fsSL https://raw.githubusercontent.com/Juhwa-Lee1023/x-for-github-copilot/refs/heads/main/docs/install.md
```

Then follow the guide exactly:

- ask the user which default permission mode to persist: `ask`, `work`, or `yolo`
- run `npx x-for-github-copilot install --permission-mode <mode>`
- verify with `npx x-for-github-copilot doctor`, then a fresh interactive shell
- explain how to start: open a new terminal and run plain `copilot`
- mention `copilot_raw` for bypassing XGC and `xgc_mode ask|work|yolo` for changing the current shell mode

You do not need to call subagents with slash commands. Plain `copilot` is the intended front door; XGC handles routing from there.

## Why This Exists

GitHub Copilot CLI is already powerful, but longer multi-step work benefits from stronger structure:

- a clear front door
- bounded grounding before planning
- explicit execution ownership
- specialist lanes for writing, visual engineering, and multimodal analysis
- better integration governance for shared files and large changes
- more trustworthy final summaries than raw chat alone

The intended route is simple:

**front door -> grounding -> planning -> execution -> optional review -> truthful final state**

It is also designed to mix models by lane instead of forcing one model to do everything:

- stronger planning and review lanes can stay on the model family that fits them best
- execution lanes can stay stable and predictable
- specialist lanes can use models that are better suited for writing, visual work, or multimodal analysis

This project started as an OMO-inspired port and now diverges where GitHub Copilot runtime behavior, CLI ergonomics, profile materialization, and operator-facing truth require it.

## Read Next

- Installation: [docs/install.md](docs/install.md)
- Usage: [docs/usage.md](docs/usage.md)
- Agents and specialist lanes: [docs/agents.md](docs/agents.md)
- Model policy and routing: [docs/model-routing.md](docs/model-routing.md)
- Runtime validation and finalization truth: [docs/runtime-validation.md](docs/runtime-validation.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

## Runtime Truth

X for GitHub Copilot treats runtime truth as a first-class concern.

It distinguishes between:

- route truth
- file-change truth
- committed diff truth
- summary authority
- archive completeness
- explicit / strong-indirect / weak / unproven evidence

It does not promise universal premium-request reduction, and it keeps local route evidence separate from provider billing truth.

Details: [docs/runtime-validation.md](docs/runtime-validation.md)

## Upstream Lineage

This project remains an explicit derivative of the OMO lineage:

- upstream: [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
- lineage notes: [UPSTREAM.md](UPSTREAM.md), [PORTING_NOTES.md](PORTING_NOTES.md), [MIGRATION_NOTES.md](MIGRATION_NOTES.md)

## License

[MIT](LICENSE)
