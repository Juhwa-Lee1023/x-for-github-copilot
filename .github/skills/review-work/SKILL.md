---
name: review-work
description: Multi-pass implementation review for X for GitHub Copilot. Use after coding to review correctness, quality, and risk before handing work back.
license: See root LICENSE
---

# Review Work

Use this skill after implementation and before final sign-off.

## Review passes

1. **Correctness pass**
   - does the code do what the user asked?
   - are edge cases handled?
2. **Quality pass**
   - is the change coherent with existing patterns?
   - are tests or docs needed?
3. **Risk pass**
   - does this change alter public behavior?
   - what can still break?

## Role suggestions

- **Merge Gate** for design judgment
- **Required Check** for rejection-level critique
- **Repo Scout** for validating changed-code reach and dependency touchpoints

## Output

- findings ordered by severity
- open risks
- ship/no-ship recommendation
