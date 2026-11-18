---
id: wrk-353fa9ca
title: 'TW-029: Decide named-area geometry, label placement, and zoom thresholds'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-ebb7c04f
priority: normal
labels:
  - v1
  - annotations
  - decision
fields:
  sequence: 29
  source: INTENT.md
---
## Outcome

Specify a minimal annotation model that supports useful labels at three map scales.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Remaining implementation decisions.

**Execution order:** 29 of 54. Phase: annotations.

**Prerequisite:** [wrk-ebb7c04f](wrk-ebb7c04f.md) — TW-028: Verify selection invariants and large multi-layer operations.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose area geometry, coordinate/boundary rules, label anchoring/placement, and editing interactions.
- Define Detail, Locality, and Region visibility ranges and behavior at threshold transitions.
- Choose a conventional overlap/readability policy and explicitly decide whether any hierarchy is needed for v1.

## Acceptance criteria

- [ ] Only the three author-selected tiers are required; custom tiers are deferred.
- [ ] At close view houses can be labeled; farther out locality/region labels replace detail clutter.
- [ ] Document examples for overlapping areas, empty descriptions, zoom boundaries, and labels near map edges.
- [ ] Named areas remain independent of tile-selection operations; nesting is not treated as an established user requirement.

## Validation

- Evaluate a house, village, and region on the same map at several zoom levels.
- Confirm the chosen model can be represented in both editable project and agent-export schemas.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-030: Implement named-area creation, descriptions, tiers, and explicit editing](wrk-0d9194dc.md).
