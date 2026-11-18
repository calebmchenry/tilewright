---
id: wrk-ebb7c04f
title: 'TW-028: Verify selection invariants and large multi-layer operations'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-286859eb
priority: normal
labels:
  - v1
  - selection
  - verification
fields:
  sequence: 28
  source: INTENT.md
---
## Outcome

Close correctness and responsiveness gaps across the complete rearrangement workflow.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Map size and navigation; INTENT.md — First-version success criteria.

**Execution order:** 28 of 54. Phase: selection.

**Prerequisite:** [wrk-286859eb](wrk-286859eb.md) — TW-027: Implement 90-degree rotation and horizontal/vertical flips.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Add integration/property-based cases that compose selection, move, cut/paste, rotation, flip, and undo/redo.
- Exercise populated selections crossing chunk boundaries and spanning multiple overlapping layers.
- Profile snapshot, preview, commit, and history memory for representative large selections; fix observed defects.

## Acceptance criteria

- [ ] A sequence followed by undo returns the exact original document, including overwritten content, registry identities, and unrelated layers.
- [ ] Destination-hole preservation and same-layer overwrite behavior remain correct after composed transforms.
- [ ] Large gestures meet the documented responsiveness/memory budgets or use explicit responsive progress/cancellation.
- [ ] The 8 by 8 house / three-tile move scenario has repeatable evidence for single-layer and chosen-multi-layer variants.

## Validation

- Run deterministic generated operation sequences with fixed seeds and cell-by-cell equality assertions.
- Record large-selection measurements and perform a desktop interaction smoke test.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-029: Decide named-area geometry, label placement, and zoom thresholds](wrk-353fa9ca.md).
