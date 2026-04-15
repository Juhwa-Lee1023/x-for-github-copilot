# Rename Map

XGC keeps OMO lineage explicit, but the runtime-facing agent ids are renamed to be more GitHub-native and to avoid collisions with GitHub Copilot built-in agents.

| OMO name | XGC runtime id | XGC display name | Reason |
| --- | --- | --- | --- |
| `sisyphus` | `repo-master` | Repo Master | Front-door orchestrator with a GitHub-friendly name |
| `hephaestus` | `patch-master` | Patch Master | Deep implementation worker with an execution-oriented name |
| `explore` | `repo-scout` | Repo Scout | Avoids collision with the built-in `explore` agent |
| `librarian` | `ref-index` | Ref Index | Documentation and reference work should read like indexing, not a generic master role |
| `oracle` | `merge-gate` | Merge Gate | Review and judgment now read like GitHub-native merge readiness |
| `prometheus` | `milestone` | Milestone | Planning should sound like roadmap staging, not another master role |
| `atlas` | `maintainer` | Maintainer | Coordination and keeping work moving aligns better with GitHub maintenance language |
| `metis` | `triage` | Triage | Scope and gap detection reads more naturally as triage |
| `momus` | `required-check` | Required Check | Blocking critique now sounds like a GitHub status gate |

Only the two main roles keep the `Master` suffix:

- `Repo Master`
- `Patch Master`

Everything else was renamed to reduce repetition in the Copilot CLI menu and to sound closer to GitHub workflows.

The old OMO names remain visible in explicit lineage and migration documents such as:

- upstream attribution
- porting notes
- migration notes
- anti-pattern and history docs

They are no longer part of the primary runtime-facing agent surfaces.
