---
id: wrk-13e3ba6a
title: 'TW-018: Build the drawing gesture pipeline and tool previews'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-8110dbc9
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 18
  source: INTENT.md
---
## Outcome

Share reliable input, previews, clipping, and history behavior across drawing tools.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Chosen technology.

**Execution order:** 18 of 54. Phase: painting.

**Prerequisite:** [wrk-8110dbc9](wrk-8110dbc9.md) — TW-017: Recolor registered entries across layers, history, and overview caches.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement pointer capture, tile-coordinate sampling, active-layer targeting, preview overlays, commit, and cancellation.
- Separate navigation gestures from editing and prevent panel/text input from drawing on the canvas.
- Use batched sparse cell changes and one command per completed gesture.

## Acceptance criteria

- [ ] A drag that leaves the canvas, loses capture, or is canceled has documented and consistent commit/cancel behavior.
- [ ] Previews do not mutate saved document state, and no-op/canceled gestures do not dirty the document.
- [ ] Tools clip safely to fixed map bounds and operate across chunk boundaries.
- [ ] Undo restores all affected cells, and overview zoom follows the editing policy defined in navigation.

## Validation

- Test pointer-cancel, Escape, canvas exit, rapid movement, zero-length gestures, and edge clipping.
- Verify a gesture produces one history entry and targeted render/cache invalidation.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-019: Implement the adjustable-size pencil](wrk-8e1860da.md).
