---
id: wrk-8e1860da
title: 'TW-019: Implement the adjustable-size pencil'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-13e3ba6a
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 19
  source: INTENT.md
---
## Outcome

Paint continuous freehand tile strokes with an adjustable footprint.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Intended experience.

**Execution order:** 19 of 54. Phase: painting.

**Prerequisite:** [wrk-13e3ba6a](wrk-13e3ba6a.md) — TW-018: Build the drawing gesture pipeline and tool previews.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose a conventional brush shape, size range, and even-size anchor rule; display the footprint preview.
- Interpolate pointer movement in tile coordinates to avoid gaps and deduplicate repeated writes.
- Paint the active layer using either a raw color or a selected registry identity.

## Acceptance criteria

- [ ] A one-tile pencil and larger sizes paint the expected integer-cell footprint.
- [ ] Fast diagonal and horizontal strokes remain continuous across chunk boundaries.
- [ ] One stroke is one undo step, preserving overwritten content and all unaffected layers.
- [ ] Brush size changes and edge clipping never expand the canvas or leave preview pixels in the document.

## Validation

- Test stationary dabs, fast strokes, even/odd sizes, edges, registry paint, and raw-color paint.
- Draw and undo terrain/building strokes in the packaged development app.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-020: Implement erasing and color/registry eyedropper sampling](wrk-c712564c.md).
