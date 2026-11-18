---
id: wrk-8110dbc9
title: 'TW-017: Recolor registered entries across layers, history, and overview caches'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-230b4c1d
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 17
  source: INTENT.md
---
## Outcome

Change a registered shade once and update every associated tile without repainting.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — First-version success criteria.

**Execution order:** 17 of 54. Phase: painting.

**Prerequisite:** [wrk-230b4c1d](wrk-230b4c1d.md) — TW-016: Implement the named color registry and stable tile associations.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement entry color changes using stable associations, including currently offscreen and hidden content.
- Update active color UI, visible rendering, overview cache invalidation, and undo/redo behavior.
- Avoid scanning all possible tile positions when propagating a registry change.

## Acceptance criteria

- [ ] Changing grass recolors all grass tiles across the map while retaining the same entry identity and meaning.
- [ ] Other registered entries and unrelated raw colors are unaffected according to the recorded collision/adoption policy.
- [ ] Undo/redo restores both entry appearance and all affected rendered views, including cached overviews.
- [ ] Pan away/back, toggle a hidden layer, and zoom out after recoloring all show the new color without stale tiles.

## Validation

- Run a cross-layer/offscreen recolor fixture including a conflicting-color attempt and history operations.
- Measure recolor and cache refresh latency on the target-scale populated fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-018: Build the drawing gesture pipeline and tool previews](wrk-13e3ba6a.md).
