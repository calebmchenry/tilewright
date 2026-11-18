---
id: wrk-e811af32
title: 'TW-015: Decide registry identity, existing-color adoption, and collision behavior'
status: todo
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-2357ea93
priority: high
labels:
  - v1
  - painting
  - decision
fields:
  sequence: 15
  source: INTENT.md
---
## Outcome

Resolve how unique named colors and stable tile associations behave before implementing registry editing.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Remaining implementation decisions.

**Execution order:** 15 of 54. Phase: painting.

**Prerequisite:** [wrk-2357ea93](wrk-2357ea93.md) — TW-014: Provide arbitrary color selection and distinguish empty cells from painted colors.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Define registering a color already used by raw tiles, adding/renaming/removing entries, and the identity assigned to future strokes.
- Choose explicit handling for duplicate entry colors and recoloring an entry to a color used by another entry or unregistered tiles.
- Specify exact-color normalization and how cancellation or failure leaves the document unchanged.

## Acceptance criteria

- [ ] One entry retains its identity and meaning through color changes; tiles remain attached by identity rather than accidental RGB equality.
- [ ] Document examples for raw-color adoption, duplicate registration, same-color recolor, conflicting recolor, and removal of an in-use entry.
- [ ] The chosen collision policy preserves unique registered colors without silently conflating distinct meanings.
- [ ] Choices are recorded as implementation decisions; export handling for unnamed colors remains owned by the export-schema task.

## Validation

- Work through grass, mountain, and wall examples across at least two layers.
- Translate the decision table into concrete cases for the following registry implementation tickets.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-016: Implement the named color registry and stable tile associations](wrk-230b4c1d.md).
