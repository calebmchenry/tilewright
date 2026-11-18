---
id: wrk-cd70e4f4
title: 'TW-041: Implement startup recovery discovery, restore, and deliberate discard'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-ff878665
priority: normal
labels:
  - v1
  - recovery
  - implementation
fields:
  sequence: 41
  source: INTENT.md
---
## Outcome

Let the author recover unsaved work after a crash with clear control over what is restored.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — First-version success criteria.

**Execution order:** 41 of 54. Phase: recovery.

**Prerequisite:** [wrk-ff878665](wrk-ff878665.md) — TW-040: Write atomic local recovery snapshots without touching project files.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Discover and validate recoverable snapshots at startup and present document identity, timestamps, and relevant saved-file context.
- Implement restore/discard actions under the recovery policy, including untitled projects and unavailable original paths.
- Handle invalid/stale entries without preventing normal application launch or silently destroying useful data.

## Acceptance criteria

- [ ] Recoverable work is offered clearly after a crash and can be restored into an editable document.
- [ ] Restore does not overwrite the original project file; explicit Save remains a separate deliberate action.
- [ ] Discard targets the selected recovery data and does not delete the saved project.
- [ ] Recovered layers, registry associations, annotations, bounds, and chosen settings match the captured revision.

## Validation

- Force-quit after unsaved changes, relaunch, restore, compare the model, then explicitly save.
- Exercise discard, stale/corrupt recovery, missing original file, and multiple available recovery candidates.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-042: Verify crash recovery and persistence under interruption and failure](wrk-9b478f1c.md).
