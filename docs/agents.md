# Agents

X for GitHub Copilot currently supports GitHub Copilot CLI workflows. Its agents are part of an independent open-source orchestration layer, not an official GitHub product or a native replacement for GitHub Copilot across all surfaces.

- Current support: GitHub Copilot CLI
- Planned later: broader GitHub Copilot surfaces

X for GitHub Copilot keeps role boundaries sharp. The point of these agents is not more names; it is cleaner routing and easier runtime inspection.

## Front Door And Grounding Lanes

### Repo Master

Runtime id: `repo-master`

Orchestration front door and router. It should keep the public entry UX stable, identify whether work is already grounded, and route non-trivial or weakly grounded work into planning instead of absorbing everything itself.

Repo Master should reuse completed planning reviews. If Milestone already ran Triage and returned a handoff with those findings incorporated, Repo Master should not call Triage again unless new facts materially change scope, risk, or acceptance criteria. After Patch Master starts, Repo Master should not reopen built-in generic agents such as `Explore Agent` or `General Purpose Agent` by default; after Patch Master completes, Repo Master should use the execution summary, run at most one narrow verification batch if required evidence is missing, and then close the user turn. For integration-class work, Repo Master should not close with a `/tasks`-only background pointer or a completion notice alone; it should retrieve and consume the blocking background result or report incomplete execution.

### Repo Scout

Runtime id: `repo-scout`

Bounded discovery lane. It exists to find candidate files, symbols, routes, tests, and pattern anchors before planning or execution when grounding would materially improve the handoff.

### Ref Index

Runtime id: `ref-index`

Reference-compression lane. It exists to turn docs, config, setup notes, and specs into a usable working brief before planning or execution.

## Planning Lanes

### Milestone

Runtime id: `milestone`

Planner-only gate for non-trivial work. Milestone should produce an execution-ready plan, not implement the task.
After Triage returns, Milestone should close the planning loop by producing either an execution-ready Patch Master handoff or an explicit blocked-before-execution result. It should not reopen generic `explore`, raw multi-file dumps, or broad rediscovery after Triage.
For integration-class tasks, Milestone should name shared/integration-owned surfaces, include `Shared-surface owner:` when needed, record `Foundation readiness:`, set `Execution owner: Patch Master`, and include blocker/recovery rules when readiness is unknown before handing off execution.

### Triage

Runtime id: `triage`

Bounded pre-plan gap analyzer for non-trivial, ambiguous, multi-file, or risky plans. Triage exists to catch hidden assumptions, weak acceptance criteria, missing constraints, and underexplored risks before execution when those risks actually exist.
Its critique should stay one-pass, bounded, and verdict-oriented so the planner can fold it into one final handoff instead of reopening broad investigation.

## Execution Lane

### Patch Master

Runtime id: `patch-master`

Execution-only deep worker. Patch Master should receive grounded execution packets, not vague first-turn intent.
Its final summary should include what changed, changed files, implementation decisions, checks run, acceptance-criteria status, residual risks, whether review is recommended, and whether the result is ready for Repo Master to return to the user without reopening broad validation.
For integration-class packets, Patch Master owns the execution phase and should prefer bounded local reading over delegating to generic helpers. If a shared surface changes, its summary should echo the declared shared-surface owner or say that none was declared. Its integration completion must resolve to `Execution status: ready_for_return` or `Execution status: blocked`, not only background progress.
Patch Master should also report raw validation failures even when a wrapper claims success, and should separate committed repo files from dirty working-tree files when it can observe that distinction.
Patch Master should reject JSON-shaped task envelopes for execution handoffs, report malformed task payloads as blockers, and mark execution blocked when implementation was claimed but no repo working-tree or committed repo diff is observed.
Patch Master should avoid interactive terminal tools and prompt-prone scaffold commands. Use non-interactive reads/checks and explicit scaffold flags or temporary scaffold directories. For `npx`/`npm exec` scaffolds, install-confirmation flags must come before the package name, for example `npx --yes create-next-app@14 ...`; `npx create-next-app@14 ... --yes` can still hang because npm never received the confirmation flag. Missing Copilot built-in agents such as `task` are runtime/tooling blockers, not a reason to bounce execution into generic helper lanes.

## Review And Judgment Lanes

### Merge Gate

Runtime id: `merge-gate`

Read-only critique and architecture judgment lane. Best for tradeoffs, risk review, and merge-readiness thinking without editing code.

### Required Check

Runtime id: `required-check`

Bounded optional high-accuracy review gate. Best for plans or high-risk execution handoffs that need an explicit `OKAY` or `REJECT` style review. It is not part of the default path for ordinary low-risk work.

## Coordination Lane

### Maintainer

Runtime id: `maintainer`

Todo-flow coordinator for decomposition and sequencing when the work needs disciplined staging.

## Specialist Lanes

### Visual Forge

Runtime id: `visual-forge`

Visual-engineering lane for UI/UX implementation, CSS, layout, responsive behavior, interaction polish, accessibility, visual hierarchy, and design consistency. It should use screenshots/browser validation when available and report visual risks such as responsiveness, contrast, and layout fragility.

### Writing Desk

Runtime id: `writing-desk`

Writing lane for docs, README work, onboarding guides, release notes, migration notes, changelogs, and structured prose. It should prioritize clarity and technical correctness, avoid invented guarantees, and adapt structure to the intended audience.

### Multimodal Look

Runtime id: `multimodal-look`

Read-only visual/PDF/diagram analysis lane. It should separate observed facts from inferred interpretation and document limitations when the runtime cannot directly inspect a provided artifact.

### Artistry Studio

Runtime id: `artistry-studio`

Creative lane for naming, tone, messaging, copy concepts, creative concepts, and aesthetic direction. It should produce concrete options with brief rationale and preserve factual constraints from planning or writing lanes.

## Architecture Reminder

The intended runtime shape is:

**Repo Master -> Repo Scout / Ref Index when useful -> Milestone when planning is needed -> Triage for non-trivial or risky plans -> Patch Master -> optional Required Check**

Specialist lanes can be used before, during, or after planning when their expertise improves the handoff, but they do not replace Milestone's planning ownership or Patch Master's execution ownership.

Not every task needs every lane. But the boundaries still matter:

- grounding should stay bounded and useful
- planning should stay planning
- execution should stay execution
- review should stay bounded and judgment-focused
- integration-owned shared surfaces and foundation readiness should be called out deliberately for broad cross-surface work
- repeated same-class foundation failures should switch the plan into a recovery posture instead of another normal retry loop
- committed repo changes should be summarized separately from uncommitted working-tree files when the executor can observe that distinction
- validation-overclaim and archive-completeness signals should be treated as operator confidence signals, not as replacement runtime state machines
