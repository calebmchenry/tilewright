---
id: wrk-2b769ca2
title: 'TW-037: Implement document lifecycle and unsaved-change protection'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-16de7b43
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 37
  source: INTENT.md
---
## Outcome

Make New, Open, Save As, document replacement, and window closing consistent with unsaved work.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Project files and agent exports.

**Execution order:** 37 of 54. Phase: projects.

**Prerequisite:** [wrk-16de7b43](wrk-16de7b43.md) — TW-036: Implement native local file dialogs and atomic project reads/writes.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Track active document identity, path, explicit-save revision, and dirty indicator in the editor shell.
- Handle unsaved-change choices on New/Open/close, including asynchronous saves and cancellation.
- Reset document-specific tools/history/caches safely when a new document is installed.

## Acceptance criteria

- [ ] A new untitled document requests a path on its first explicit save; existing documents save to their current path.
- [ ] Successful save marks only the saved revision clean; edits made while saving remain dirty.
- [ ] Choosing cancel or encountering a save/load error prevents destructive document replacement or closing.
- [ ] Switching documents clears stale selection/renderer references while preserving the incoming document metadata.

## Validation

- Exercise New/Open/close with save, discard, cancel, and failed-save branches.
- Test undo to the saved revision, redo away from it, and edit-during-save dirty state.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow](wrk-5e7adb66.md).
