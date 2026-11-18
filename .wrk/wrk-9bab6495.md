---
id: wrk-9bab6495
title: 'TW-025: Implement overlap-safe selection dragging and whole-tile nudging'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-0b310dfe
priority: high
labels:
  - v1
  - selection
  - implementation
fields:
  sequence: 25
  source: INTENT.md
---
## Outcome

Move selected tiles precisely and restore all affected content with undo.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — First-version success criteria.

**Execution order:** 25 of 54. Phase: selection.

**Prerequisite:** [wrk-0b310dfe](wrk-0b310dfe.md) — TW-024: Implement rectangular selections and explicit multi-layer inclusion.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement snapped drag previews and arrow-key nudges using immutable source snapshots and per-layer atomic changes.
- Clear moved source cells, apply occupied destinations, and preserve holes according to the selection contract.
- Handle overlap, cancellation, boundaries, and multi-layer commits through history.

## Acceptance criteria

- [ ] An 8 by 8 house moves exactly three tiles by drag or nudges, with walls/furniture together and terrain untouched.
- [ ] Occupied cells overwrite destination cells on the same layer; holes preserve prior destination content, including during overlap.
- [ ] Undo/redo restores source and overwritten destination cells across every included layer.
- [ ] Dragging/snapping never automatically grows the canvas; annotations remain at their exact original bounds and label positions.

## Validation

- Assert exact before/after/inverse cell maps for overlapping moves in all directions, holes, empty selections, and multiple layers.
- Run the intent house-movement example interactively and verify cancellation and out-of-bounds policy.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-026: Implement cut, copy, paste, and repeated selection placement](wrk-54aa1866.md).
