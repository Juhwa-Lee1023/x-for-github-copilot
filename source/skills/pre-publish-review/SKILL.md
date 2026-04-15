---
name: pre-publish-review
description: Multi-pass pre-publish review for X for GitHub Copilot. Use before tagging or publishing when you want a structured release gate.
license: See root LICENSE
---

# Pre-Publish Review

This is a faithful Copilot CLI adaptation of OMO's release-review workflow.

## Goal

Review unpublished changes before a release and surface correctness, compatibility, and release-risk findings.

## Suggested flow

1. Determine the comparison base:
   - last version tag
   - last release branch point
   - or `origin/main` if there is no release tag yet
2. Inspect:
   - `git log`
   - `git diff --stat`
   - `git diff`
   - package metadata
3. Run a **review pass**:
   - correctness
   - public API and config changes
   - testing gaps
   - documentation gaps
4. Call **Merge Gate** or **Required Check** for a second opinion if the release is high-risk.
5. Write a go/no-go summary with explicit blocking issues.

## Release questions

- What changed?
- What is user-facing?
- What can break?
- What still lacks tests or docs?
- Is the proposed version bump justified?

## Output

- release scope
- version-bump recommendation
- blockers
- non-blocking risks
- publish recommendation
