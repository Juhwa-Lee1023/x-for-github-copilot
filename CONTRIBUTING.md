# Contributing

Thanks for helping improve X for GitHub Copilot. This project is an independent GitHub Copilot CLI-focused orchestration layer, so contributions should preserve the planning-first workflow, runtime truth, and generated-surface discipline.

## Before You Start

- Search existing issues and pull requests before opening new work.
- Keep changes focused. Avoid broad rewrites unless the issue explicitly calls for them.
- Do not include secrets, private repository names, local machine paths, or raw user logs in commits.
- Use English for public issues, pull requests, and docs unless a maintainer asks otherwise.

## Development Setup

```bash
npm ci
npm run validate
```

Use Node.js 20 or newer.

## Source Of Truth

Canonical authoring files live in:

- `source/agents/`
- `source/skills/`
- `scripts/lib/`
- `scripts/hooks/`
- `docs/`

Generated runtime mirrors live in:

- `agents/`
- `skills/`
- `.github/agents/`
- `.github/skills/`

If you change canonical agents or skills, regenerate and check mirrors:

```bash
npm run generate:surfaces
npm run generate:surfaces:check
```

Do not hand-edit generated mirrors as the only source of a behavior change.

## Validation

Run the relevant checks before opening a pull request:

```bash
npm run generate:surfaces:check
npm run validate:config
npm run typecheck
npm run smoke:fresh-bootstrap
npm test
npm run validate
```

Run global profile validation when you touch install, shell, plugin, or materialization behavior:

```bash
npm run validate:global
```

Live Copilot validation is optional because it depends on local authentication and account/model access:

```bash
npm run validate:runtime
```

If you skip a relevant check, explain why in the pull request.

## Pull Request Expectations

Pull requests should include:

- a concise summary of the user/operator problem solved
- clear notes about model policy, routing, or runtime truth impact
- generated surface changes when canonical surfaces changed
- tests or validation output for the changed behavior
- docs updates when user-facing behavior changes

Keep operator-facing summaries structured and truthful. Do not replace structured runtime truth with narrative-only reporting.

## Issue Reports

Use the issue templates. For bugs, include exact commands, model selection, validation output, and short redacted logs where possible. For setup/runtime issues, `npm run validate:global` output is usually the most useful first artifact.

## Code Of Conduct

Be direct, technical, and respectful. Critique code and behavior, not people. Maintainers may close issues or pull requests that are hostile, spammy, unrelated to the project, or unsafe to investigate publicly.
