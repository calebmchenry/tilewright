---
id: wrk-9b478f1c
title: 'TW-042: Verify crash recovery and persistence under interruption and failure'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-cd70e4f4
priority: high
labels:
  - v1
  - recovery
  - verification
fields:
  sequence: 42
  source: INTENT.md
---
## Outcome

Prove that saved and unsaved work remain distinguishable under realistic failures.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Project files and agent exports; INTENT.md — First-version success criteria.

**Execution order:** 42 of 54. Phase: recovery.

**Prerequisite:** [wrk-cd70e4f4](wrk-cd70e4f4.md) — TW-041: Implement startup recovery discovery, restore, and deliberate discard.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Build fault-injection coverage for encoding/write/replace failures, abrupt exit, and save/recovery races.
- Run packaged macOS scenarios for first save, repeated save, Save As, failed Open, recovery restore, and unsaved close handling.
- Fix any partial-file, lost-revision, misleading-dirty-state, or incorrect-retention defects.

## Acceptance criteria

- [ ] The last successful explicit save remains loadable after interrupted writes and recovery attempts.
- [ ] A crash after unsaved edits restores the latest complete recovery snapshot without claiming uncaptured edits were preserved.
- [ ] Canceled/failed operations neither replace the active document nor mark unsaved work clean.
- [ ] Evidence covers overlapping layers, a recolored registry entry, independent named areas, and an untitled project.

## Validation

- Run deterministic I/O failure tests plus an actual force-quit/relaunch desktop smoke scenario.
- Compare saved file bytes and full document state at each recovery/save checkpoint.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-043: Specify a separate whole-map agent-export schema](wrk-eeabc6ef.md).
