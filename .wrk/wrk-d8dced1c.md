---
id: wrk-d8dced1c
title: 'TW-047: Finish editor shortcut, focus, feedback, and usability integration'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-d0e8e734
priority: normal
labels:
  - v1
  - release
  - implementation
fields:
  sequence: 47
  source: INTENT.md
---
## Outcome

Make the completed toolset behave consistently during a continuous desktop editing session.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Drawing and rearranging; INTENT.md — Local operation.

**Execution order:** 47 of 54. Phase: release.

**Prerequisite:** [wrk-d0e8e734](wrk-d0e8e734.md) — TW-046: Verify agent-export completeness with an independent consumer fixture.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Complete tool shortcuts, arrow nudging, Escape cancellation, menu enablement, and visible shortcut hints using shared actions.
- Audit focus behavior among canvas, panels, text inputs, native dialogs, and progress/restore UI.
- Provide clear button names, focus indicators, active state, dimension readouts, and actionable errors for the implemented workflows.

## Acceptance criteria

- [ ] Typing in area descriptions or names never paints, nudges, deletes tiles, or steals text clipboard operations.
- [ ] Undo/redo and cancel behave consistently across drawing, selection, registry, annotation, file, and recovery operations.
- [ ] Active tool/layer/color, map/selection dimensions, dirty state, and long-operation progress are discoverable.
- [ ] All required actions are reachable at ordinary macOS window sizes without inaccessible clipped controls.

## Validation

- Run a keyboard/mouse walkthrough across every tool and major focus context.
- Resize the desktop window and check error/cancel states with populated panels and long names.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-048: Validate the complete drawing, rearrangement, and annotation session](wrk-74cf177c.md).
