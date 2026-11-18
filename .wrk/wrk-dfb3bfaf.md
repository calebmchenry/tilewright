---
id: wrk-dfb3bfaf
title: 'TW-031: Render zoom-dependent labels and annotation overlays'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-0d9194dc
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 31
  source: INTENT.md
---
## Outcome

Show the appropriate names at tile, village, and region scales without overwhelming the map.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Chosen technology.

**Execution order:** 31 of 54. Phase: annotations.

**Prerequisite:** [wrk-0d9194dc](wrk-0d9194dc.md) — TW-030: Implement named-area creation, descriptions, tiers, and explicit editing.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement label culling, tier visibility thresholds, placement, and readable text styling through PixiJS.
- Update labels for annotation edits and camera changes with bounded resource use.
- Keep selected-area outlines/labels understandable while drawing tools and selections are active.

## Acceptance criteria

- [ ] Detail, Locality, and Region labels follow the documented ranges and transition predictably during zoom.
- [ ] A far-out view avoids a cluttered collection of house labels while showing relevant larger areas.
- [ ] Names and descriptions remain document data even when labels are culled or hidden.
- [ ] Tile transforms do not shift labels or area bounds; annotation edits invalidate only affected visuals.

## Validation

- Check screenshots at each tier and immediately above/below visibility thresholds.
- Profile navigation with a representative concentration of named areas and verify label resources are released on document changes.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-032: Add named-area browsing and scale inspection](wrk-efb169f5.md).
