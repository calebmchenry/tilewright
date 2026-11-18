---
id: wrk-230b4c1d
title: 'TW-016: Implement the named color registry and stable tile associations'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-e811af32
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 16
  source: INTENT.md
---
## Outcome

Let authors give colors meaningful names while preserving freeform painting.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Chosen technology.

**Execution order:** 16 of 54. Phase: painting.

**Prerequisite:** [wrk-e811af32](wrk-e811af32.md) — TW-015: Decide registry identity, existing-color adoption, and collision behavior.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Build registry add/name/edit/remove UI and model commands following the collision/adoption contract.
- Allow selecting a registry entry for painting and display its name alongside its current swatch.
- Implement association/adoption and safe removal behavior consistently across all layers.

## Acceptance criteria

- [ ] Named entries have stable IDs, unique canonical colors under the chosen policy, and user-readable names.
- [ ] Registry operations apply to hidden and visible layers without losing underlying data.
- [ ] Raw colors remain usable; registration/adoption/removal has exactly the documented effect on existing tiles.
- [ ] Operations are atomic, undoable, and emit targeted notifications; rejected collisions leave document/history unchanged.

## Validation

- Test every collision/adoption decision case and undo/redo with multiple layers.
- Create grass, mountain, and stone-wall entries and inspect tile associations independently of rendered colors.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-017: Recolor registered entries across layers, history, and overview caches](wrk-8110dbc9.md).
