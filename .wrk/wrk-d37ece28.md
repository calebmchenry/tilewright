---
id: wrk-d37ece28
title: 'TW-021: Implement straight lines and filled/outlined rectangles'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-c712564c
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 21
  source: INTENT.md
---
## Outcome

Create precise geometric terrain and building footprints.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging.

**Execution order:** 21 of 54. Phase: painting.

**Prerequisite:** [wrk-c712564c](wrk-c712564c.md) — TW-020: Implement erasing and color/registry eyedropper sampling.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement integer-tile line rasterization and filled/outlined rectangle tools using preview/commit gestures.
- Document endpoint inclusion, outline thickness, and whether brush size affects these tools.
- Support all drag directions, raw/registered colors, and bounded clipping.

## Acceptance criteria

- [ ] Horizontal, vertical, diagonal, and single-point lines have predictable contiguous tile coverage.
- [ ] Filled and outlined rectangles handle reverse drags, one-cell widths/heights, and an 8 by 8 footprint correctly.
- [ ] Previews match committed cells, and each shape is a single undoable command.
- [ ] Shapes can cross chunks while affecting only the active layer and fixed map bounds.

## Validation

- Compare rasterized cell sets for edge cases and reverse drags.
- Draw terrain and a house outline, undo/redo each, and inspect overwritten-cell restoration.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-022: Implement bounded, responsive flood fill](wrk-3af2d9eb.md).
