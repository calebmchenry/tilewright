---
id: wrk-efb169f5
title: 'TW-032: Add named-area browsing and scale inspection'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-dfb3bfaf
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 32
  source: INTENT.md
---
## Outcome

Make named areas discoverable and useful for navigating a large map.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Named areas and labels.

**Execution order:** 32 of 54. Phase: annotations.

**Prerequisite:** [wrk-dfb3bfaf](wrk-dfb3bfaf.md) — TW-031: Render zoom-dependent labels and annotation overlays.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Provide an area list/panel showing names and tiers with description editing or inspection.
- Add a conventional focus/reveal action for an area and show its bounds/dimensions in tiles.
- Keep annotation selection distinct from tile selection and synchronize panel/on-map feedback.

## Acceptance criteria

- [ ] An author can find a house, locality, or region and navigate to its location from the panel.
- [ ] Area names, descriptions, tier, and scale are inspectable even when that tier is hidden at the current zoom.
- [ ] Focusing an area changes the view without moving tiles, changing its geometry, or dirtying the document.
- [ ] Renaming/removal and undo update the list without stale references or accidental tile selection.

## Validation

- Navigate among distant populated areas in the large fixture and inspect dimension readouts.
- Verify selection independence and panel consistency through rename/delete/undo.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-033: Specify the versioned editable-project schema and persisted settings](wrk-eef53dd9.md).
