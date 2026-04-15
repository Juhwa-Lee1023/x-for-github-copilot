---
name: work-with-pr
description: End-to-end PR workflow for X for GitHub Copilot. Use when the user wants implementation to land as a branch and pull request with validation.
license: See root LICENSE
---

# Work With PR

This skill ports the spirit of OMO's PR workflow into GitHub Copilot CLI.

## Goal

Take a task from implementation through pull request creation and validation.

## Suggested flow

1. Create an isolated branch.
2. If the repo is unfamiliar, use Repo Master plus Repo Scout before coding.
3. Hand deep implementation to Patch Master once the scope is grounded.
4. Keep commits atomic and meaningful.
5. Push the branch.
6. Open a PR with `gh pr create`.
7. Validate with local checks and GitHub checks.
8. If review feedback arrives, iterate until the PR is ready.

## Rules

- Do not mix unrelated cleanup into the PR.
- Do not claim CI passed if you only ran local checks.
- Keep the PR body factual and concise.
- Prefer one clear branch over repeated rebasing games.

## Output

- branch name
- commits made
- PR URL
- checks run
- unresolved risks
