# Why XGC Uses A Dedicated Profile And Shell Shim

This note collects the practical reasons users could not previously treat XGC, or one of its custom agents, as the real default GitHub Copilot CLI experience.

It is intentionally conservative. The point is to separate:

- platform constraints we do not control
- repo choices we can improve
- the practical mechanism XGC now uses to behave like the default entrypoint

As of **April 6, 2026**, the honest position is:

- users still cannot set an XGC custom agent as the official built-in Copilot default through a documented GitHub setting
- users can now get a practical global XGC default through a dedicated Copilot profile plus a shell shim

## Short Version

The biggest usability problem was never plugin installation alone.

The plugin installed correctly and the custom agents were visible, but GitHub Copilot CLI still treated:

- its built-in main experience
- its mode switching UI
- its custom agent selection flow

as separate things.

That meant users did not automatically land in `repo-master` just because `xgc` was installed.

XGC now solves that practically with:

- `~/.copilot-xgc`
- user-level XGC agents and skills under that profile
- a shell shim that makes `copilot` use that profile and inject `--agent repo-master` only when needed
- a profile-local hook bundle under `~/.config/xgc/hooks` so hooks do not depend on the current repository's `./scripts/hooks`

## Platform Facts That Still Matter

### 1. GitHub Copilot CLI already has built-in agents

According to the GitHub Copilot CLI command reference, built-in agents include:

- `explore`
- `task`
- `code-review`
- `general-purpose`
- `research`

Built-in agents are always present and cannot be overridden.

Practical consequence:

- XGC must avoid runtime-facing names that collide with built-ins
- XGC still does not replace GitHub's built-in agent system internally

### 2. Custom agents are still selected separately from the built-in default UX

GitHub documents three supported ways to use a custom agent in Copilot CLI:

- use `/agent` in the interactive UI
- reference the agent in a prompt
- use `--agent <id>`

Practical consequence:

- GitHub still does not expose a documented "make this custom agent the built-in default" setting
- XGC cannot honestly claim to replace the official Copilot default internally

### 3. Shift+Tab mode switching is not the same thing as selecting a custom agent

The bottom-bar mode switch is about the CLI's operating mode, not about replacing the built-in default agent with a plugin-defined custom agent.

Practical consequence:

- users can see custom agents in selection surfaces
- but the mode bar is not the mechanism that makes XGC the practical default

### 4. Project and user agents can beat plugin agents

GitHub's plugin reference says:

- custom agents and skills use first-found-wins
- plugin agents have lower priority than personal or project-level agents
- project-level or personal definitions can silently mask plugin definitions with the same id

Practical consequence:

- plugin installation alone does not guarantee that the plugin-provided copy is the one actually used
- XGC therefore materializes user-level agent and skill copies into `~/.copilot-xgc`
- project-level agents from the current repository may still appear, but XGC-owned ids are intentionally made user-level so they keep precedence

### 5. There is still no documented global config key for "default custom agent"

GitHub Copilot CLI exposes settings such as:

- `model`
- `hooks`
- `custom_agents.default_local_only`

It does not expose a documented setting that says:

- "use `repo-master` as the built-in default for all sessions"

Practical consequence:

- XGC must use a launcher or shell shim if it wants default-like usability

## What XGC Changed

### Before

Before global XGC mode, users still had to do one of:

- `copilot --agent repo-master`
- `/agent` and then select `Repo Master`
- mention `repo-master` in the prompt

That meant the architecture said `repo-master` was the front door, but the shell UX did not.

### Now

XGC now ships a practical default entry layer:

- `~/.copilot-xgc/`
- `~/.config/xgc/`
- `~/.config/xgc/xgc-shell.sh`

Once installed and sourced:

- `copilot` uses `COPILOT_HOME=~/.copilot-xgc`
- `copilot` injects `--agent repo-master` only when no explicit `--agent` is present
- `copilot --agent ...` remains fully respected
- `copilot --config-dir ...` bypasses XGC mode
- `copilot_raw` calls the raw GitHub Copilot CLI binary
- `xgc`, `xgc_scout`, `xgc_patch`, and `xgc_review` provide explicit shortcuts

## What Counts As A Real Fix Versus A Fake Fix

### Not a real fix

These do not make XGC the practical default by themselves:

- only documenting `repo-master`
- only telling users to use `/agent`
- only relying on prompt mention
- pretending the Shift+Tab mode switch now belongs to XGC

### Realistic fix

The honest product-grade answer is:

- a dedicated profile
- user-level materialized XGC agents and skills
- a reversible shell shim
- an escape hatch via `copilot_raw`

This does not claim that GitHub's own default agent was replaced. It claims that users can now type `copilot` and land in XGC mode by default in their shell.

## The Current Honest Position

As of **April 6, 2026**, the most truthful statement is:

- GitHub Copilot CLI still does not expose a documented "make this custom agent the official default" setting
- XGC therefore does not claim to replace the official built-in default
- XGC does provide a practical global default through `~/.copilot-xgc` plus a shell shim
- users can bypass it at any time with `copilot_raw` or an explicit `--config-dir`

## References

- [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Invoking custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-agents/invoke-custom-agents)
- [Creating and using custom agents for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [README](../README.md)
- [Install](install.md)
- [Usage](usage.md)
- [Architecture](architecture.md)
