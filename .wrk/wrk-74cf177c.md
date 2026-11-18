---
id: wrk-74cf177c
title: 'TW-048: Validate the complete drawing, rearrangement, and annotation session'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-d8dced1c
priority: normal
labels:
  - v1
  - release
  - verification
fields:
  sequence: 48
  source: INTENT.md
---
## Outcome

Prove success criteria 1 through 6 together and fix cross-feature regressions.

## Source and scope

**Source:** INTENT.md — First-version success criteria; INTENT.md — Drawing and rearranging; INTENT.md — Named areas and labels.

**Execution order:** 48 of 54. Phase: release.

**Prerequisite:** [wrk-d8dced1c](wrk-d8dced1c.md) — TW-047: Finish editor shortcut, focus, feedback, and usability integration.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Create/grow a fixed map, paint terrain/buildings, and use raw and named colors across separate layers.
- Move an 8 by 8 house three tiles with single-layer and chosen-multi-layer scope; overwrite destination content, then undo.
- Copy/paste/rotate/flip the house, label houses/village/region, zoom between tiers, and recolor grass.

## Acceptance criteria

- [ ] Every starting drawing tool is exercised: sized pencil, eraser, eyedropper, fill, lines, and both rectangle modes.
- [ ] The house movement restores original and overwritten content on undo while unrelated terrain remains unchanged.
- [ ] All tile selection operations leave named areas/labels fixed; explicit annotation edits continue to work.
- [ ] Grass recoloring propagates across visible/hidden/offscreen layers and overview images while preserving meaning.

## Validation

- Retain repeatable automated model/integration coverage plus a concise desktop walkthrough result.
- Compare full document state after undo/redo and record screenshots at close/locality/region views.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-049: Meet final populated-map rendering and navigation budgets](wrk-6e0d23e5.md).
