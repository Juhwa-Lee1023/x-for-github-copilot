## Summary

<!-- Describe what changed and why. Keep this operator-focused and concrete. -->

## Scope

<!-- Mark the areas this PR touches. -->

- [ ] Canonical agent/source prompts
- [ ] Generated runtime mirrors (`agents/`, `.github/agents/`)
- [ ] Hooks, MCP, LSP, or runtime surface generation
- [ ] Global install/materialization
- [ ] Finalization, reports, or session truth artifacts
- [ ] Model policy or routing behavior
- [ ] Documentation only
- [ ] Tests only

## Runtime Truth Checklist

<!-- Required when runtime behavior, install flow, hooks, routing, or reports change. -->

- [ ] Source-of-truth files and generated mirrors are aligned.
- [ ] Runtime-facing files do not expose internal-only fields.
- [ ] Install/global profile behavior is documented if changed.
- [ ] Session/finalization truth remains structured and non-narrative.
- [ ] Working-tree truth and committed-diff truth remain separate where relevant.
- [ ] Foundation/bootstrap/tooling failures are classified precisely where relevant.

## Model And Routing Impact

<!-- Explain any model, lane, or routing impact. If none, write "None." -->

- Root model behavior:
- Child/specialist model behavior:
- Planning/execution ownership impact:
- Specialist lane impact:

## Testing

<!-- Mark every command that was run. Leave unchecked only when not applicable and explain why. -->

- [ ] CI (`.github/workflows/ci.yml`) is green or expected to pass with this change.
- [ ] `npm run generate:surfaces:check`
- [ ] `npm run validate:config`
- [ ] `npm run typecheck`
- [ ] `npm run smoke:fresh-bootstrap`
- [ ] `npm test`
- [ ] `npm run validate`
- [ ] `npm run validate:global` (required for install/global materialization changes)
- [ ] `npm run validate:runtime` (optional live Copilot validation; explain if skipped)

## Screenshots Or Logs

<!-- Include screenshots, terminal excerpts, or report paths when the change affects operator-facing output. Remove secrets and personal data. -->

## Related Issues

<!-- Link related issues or discussions. -->
