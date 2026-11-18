---
id: wrk-0d9194dc
title: 'TW-030: Implement named-area creation, descriptions, tiers, and explicit editing'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-353fa9ca
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 30
  source: INTENT.md
---
## Outcome

Let authors attach meaning and descriptions to areas independently of tile content.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Chosen technology.

**Execution order:** 30 of 54. Phase: annotations.

**Prerequisite:** [wrk-353fa9ca](wrk-353fa9ca.md) — TW-029: Decide named-area geometry, label placement, and zoom thresholds.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement stable annotation IDs, selected geometry, name, description, tier, and label-placement data.
- Build annotation create/select/rename/describe/change-tier/edit-bounds/delete controls and area overlays.
- Route explicit annotation edits through command history without coupling them to tile tools.

## Acceptance criteria

- [ ] House, village, and region areas can be created and edited with independent descriptions and tiers.
- [ ] Annotation creation/edit/removal is undoable and marks the document dirty appropriately.
- [ ] Tile moves, cuts, pastes, rotations, and flips leave all annotation data unchanged even when enclosing an area.
- [ ] Invalid geometry or missing required fields receives clear feedback and no partial document update.

## Validation

- Test annotation lifecycle, explicit geometry edits, history, and tier validation.
- Run all tile selection operations around fully enclosed and partially overlapping named areas and assert unchanged annotation records.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-031: Render zoom-dependent labels and annotation overlays](wrk-dfb3bfaf.md).
