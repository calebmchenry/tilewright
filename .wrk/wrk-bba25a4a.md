---
id: wrk-bba25a4a
title: 'TW-009: Add tile grids, emphasized 64-tile chunk boundaries, and scale readouts'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-58cdb442
priority: normal
labels:
  - v1
  - canvas
  - implementation
fields:
  sequence: 9
  source: INTENT.md
---
## Outcome

Make individual cells, chunk boundaries, and region dimensions easy to assess.

## Source and scope

**Source:** INTENT.md — First-version scope; INTENT.md — Intended experience; INTENT.md — Map size and navigation.

**Execution order:** 09 of 54. Phase: canvas.

**Prerequisite:** [wrk-58cdb442](wrk-58cdb442.md) — TW-008: Implement pan, anchored zoom, fit-to-map, and coordinate conversion.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Render ordinary tile lines and distinguish boundaries every 64 tiles using color or line weight.
- Keep grid overlays aligned with the coordinate contract and readable at relevant zoom levels.
- Show map dimensions, cursor tile position, and selected rectangle size when available; communicate scale in tiles/chunks.

## Acceptance criteria

- [ ] Tile lines align with tile edges at multiple zoom levels and Retina scales, including non-multiple-of-64 map bounds.
- [ ] Chunk lines are visibly distinct; dense distant lines adapt to zoom without obscuring overview content.
- [ ] An 8 by 8 footprint can be measured in tiles, and chunk boundaries do not constrain drawing or movement.
- [ ] Overlays do not mutate map data or become exported tile content.

## Validation

- Verify overlays at coordinates around 0, 63, 64, 127, and map edges.
- Inspect detail and overview screenshots against the same known-dimension fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-010: Implement cached overview rendering and coherent cache invalidation](wrk-c22d70cf.md).
