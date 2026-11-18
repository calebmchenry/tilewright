---
id: wrk-0b310dfe
title: 'TW-024: Implement rectangular selections and explicit multi-layer inclusion'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-7cd74024
priority: normal
labels:
  - v1
  - selection
  - implementation
fields:
  sequence: 24
  source: INTENT.md
---
## Outcome

Let the author choose a tile rectangle and exactly which layers it affects.

## Source and scope

**Source:** INTENT.md — First-version scope; INTENT.md — Map use and meaning; INTENT.md — Drawing and rearranging.

**Execution order:** 24 of 54. Phase: selection.

**Prerequisite:** [wrk-7cd74024](wrk-7cd74024.md) — TW-023: Define selection, clipboard, transform, and out-of-bounds semantics.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement rectangle creation, selection overlay, bounds/dimension readout, deselect, and tool switching behavior.
- Default selection scope to the active layer and expose an explicit set of additional layers.
- Capture tile payloads by layer with empty positions distinguished from occupied cells.

## Acceptance criteria

- [ ] An 8 by 8 rectangle is selectable precisely, including across chunk boundaries and at map edges.
- [ ] Walls and furniture can be included together while terrain stays excluded; changing the active layer does not silently broaden an existing selection.
- [ ] Selection alone does not modify tiles, mark the document dirty, or add a history entry.
- [ ] Named areas and labels are never included, even when fully enclosed by the rectangle.

## Validation

- Test reverse drags, one-cell/empty selections, changing layer scope, and boundary clipping.
- Verify overlays, tile counts, and dimensions against known multilayer fixtures.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-025: Implement overlap-safe selection dragging and whole-tile nudging](wrk-9bab6495.md).
