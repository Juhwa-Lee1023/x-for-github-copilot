---
name: github-triage
description: Read-only GitHub issue and PR triage for X for GitHub Copilot. Use when asked to triage open issues or pull requests without taking mutating GitHub actions.
license: See root LICENSE
---

# GitHub Triage

This skill ports the spirit of OMO's GitHub triage workflow into GitHub Copilot CLI.

## Goal

Review open GitHub issues and pull requests, classify them, and produce an evidence-backed report without mutating GitHub state.

## Non-negotiable rules

- Never comment, merge, close, label, or edit issues and pull requests.
- Never call write actions through `gh api`.
- Every recommendation must cite evidence from:
  - `gh` output
  - repository files
  - commit history

## Suggested flow

1. Resolve repository identity with `gh repo view`.
2. Fetch open issues and pull requests with `gh issue list` and `gh pr list`.
3. If the runtime supports subagent invocation comfortably, fan out bounded review tasks with Repo Scout or Merge Gate.
4. Otherwise batch items into small groups and say explicitly that batching was used.
5. Produce a triage report grouped by:
   - bugs
   - feature requests
   - questions
   - PRs ready for review
   - PRs blocked or risky

## Output

- repository name
- item counts
- per-item findings
- evidence links
- recommended next actions
