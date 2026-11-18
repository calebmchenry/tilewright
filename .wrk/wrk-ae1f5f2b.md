---
id: wrk-ae1f5f2b
title: 'TW-045: Add native agent-export action, progress, and reliable output writes'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-5e43190b
priority: normal
labels:
  - v1
  - export
  - implementation
fields:
  sequence: 45
  source: INTENT.md
---
## Outcome

Let an author save an agent-readable whole-map result as a separate local file.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation.

**Execution order:** 45 of 54. Phase: export.

**Prerequisite:** [wrk-5e43190b](wrk-5e43190b.md) — TW-044: Implement whole-map agent export with complete semantic content.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Provide a clearly named Export for Agent action and native destination dialog with the chosen format/extension.
- Integrate snapshot/codec output, responsive progress and cancellation for large exports, and reliable file replacement.
- Keep export lifecycle distinct from project save/recovery state and prevent accidental overwriting of the active project path.

## Acceptance criteria

- [ ] Export writes the complete current committed map to a separate chosen file, including unsaved edits.
- [ ] Export does not mark the project saved, change its active path, replace its project file, or discard recovery state.
- [ ] Cancellation and write failures give clear feedback and leave no apparently successful partial export.
- [ ] The operation works offline in the packaged app and remains responsive for target-scale maps.

## Validation

- Export an unsaved edited project, then inspect dirty state, original project bytes, recovery data, and output.
- Test cancel, existing destination, unwritable location, and large-export progress.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-046: Verify agent-export completeness with an independent consumer fixture](wrk-d0e8e734.md).
