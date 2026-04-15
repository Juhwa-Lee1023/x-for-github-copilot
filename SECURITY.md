# Security Policy

## Supported Versions

Security fixes target the current `main` branch unless maintainers announce a supported release line.

## Reporting A Vulnerability

Do not disclose sensitive security details in a public issue.

Preferred reporting path:

1. Use GitHub private vulnerability reporting for this repository if it is enabled.
2. If private reporting is unavailable, open a public issue with only a minimal statement such as "I need a private channel for a security report." Do not include exploit details, secrets, tokens, or private logs in that issue.

Maintainers will triage the report, ask for reproduction details in a private channel, and coordinate a fix or disclosure plan when appropriate.

## Scope

In scope:

- installer behavior that can write unsafe shell/profile state
- plugin or hook materialization that can execute unexpected commands
- accidental disclosure of local paths, tokens, session logs, or private repository data
- runtime validation or reporting behavior that can expose sensitive data

Out of scope:

- GitHub Copilot CLI service availability, authentication, or billing issues outside this project
- vulnerabilities in third-party tools unless this project configures them unsafely
- reports without enough information to reproduce or reason about impact

## Handling Sensitive Artifacts

Before sharing logs or session artifacts:

- remove tokens, API keys, cookies, and OAuth material
- remove private repository names and proprietary source snippets
- remove personal local paths when they are not required for reproduction
- prefer short excerpts over full raw terminal logs

## Dependency Security

This repository intentionally has a small Node.js toolchain. When dependency updates are needed, include lockfile changes and run:

```bash
npm run validate
```
