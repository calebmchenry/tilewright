---
id: wrk-dbdc0004
title: 'TW-039: Define recovery cadence, identity, retention, and restore policy'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-5e7adb66
priority: high
labels:
  - v1
  - recovery
  - decision
fields:
  sequence: 39
  source: INTENT.md
---
## Outcome

Specify crash recovery that preserves unsaved work independently of explicit saves.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Remaining implementation decisions.

**Execution order:** 39 of 54. Phase: recovery.

**Prerequisite:** [wrk-5e7adb66](wrk-5e7adb66.md) — TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose a local recovery location, document identity scheme, debounce/interval policy, and snapshot retention/cleanup rules.
- Specify recovery metadata for untitled/saved documents, newer-than-save detection, and a clear restore/discard interface.
- Define behavior for explicit save, normal quit, deliberate discard, failed snapshot, stale data, and corrupted recovery entries.

## Acceptance criteria

- [ ] Recovery files never silently replace or update the last explicitly saved project.
- [ ] Policy covers untitled work and documents whose path changes through Save As.
- [ ] A restored revision has clearly defined path/dirty behavior and still requires an explicit save to update a project file.
- [ ] Cadence and retention are documented implementation choices with bounded disk use and measurable overhead.

## Validation

- Walk through crash before first save, crash after additional unsaved edits, save during snapshot, and normal discard.
- Confirm the restore policy preserves a readable last-save copy and makes conflicting/stale versions understandable.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-040: Write atomic local recovery snapshots without touching project files](wrk-ff878665.md).
