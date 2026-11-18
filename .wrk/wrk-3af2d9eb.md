---
id: wrk-3af2d9eb
title: 'TW-022: Implement bounded, responsive flood fill'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-d37ece28
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 22
  source: INTENT.md
---
## Outcome

Fill connected regions without freezing the editor or crossing unintended layer boundaries.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Map size and navigation.

**Execution order:** 22 of 54. Phase: painting.

**Prerequisite:** [wrk-d37ece28](wrk-d37ece28.md) — TW-021: Implement straight lines and filled/outlined rectangles.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose and document connectivity and equality rules for empty, raw-color, and registered cells.
- Implement fill on the active layer across storage boundaries with an efficient worklist/batching strategy.
- Provide responsive progress/cancellation for large fills and atomic commit/history semantics.

## Acceptance criteria

- [ ] Enclosed regions, edge-connected regions, empty backgrounds, and registered colors fill according to the stated equality rule.
- [ ] Fill never escapes fixed bounds, changes other layers, or implicitly merges registry meanings.
- [ ] Large operations keep UI/navigation feedback responsive and can be canceled without partial document changes.
- [ ] No-op fill adds no history; successful fill is one undo step restoring all prior content.

## Validation

- Test enclosed/open regions, boundary crossing, identical replacement, cancellation, and undo/redo.
- Measure a large contiguous fill and cancellation on the populated target-scale fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-023: Define selection, clipboard, transform, and out-of-bounds semantics](wrk-7cd74024.md).
