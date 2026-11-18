---
id: wrk-eeabc6ef
title: 'TW-043: Specify a separate whole-map agent-export schema'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-9b478f1c
priority: high
labels:
  - v1
  - export
  - decision
fields:
  sequence: 43
  source: INTENT.md
---
## Outcome

Define a simple, efficient map representation an agent can interpret without editor-state knowledge.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Project files and agent exports; INTENT.md — Remaining implementation decisions.

**Execution order:** 43 of 54. Phase: export.

**Prerequisite:** [wrk-9b478f1c](wrk-9b478f1c.md) — TW-042: Verify crash recovery and persistence under interruption and failure.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose the export serialization format (JSON is a candidate), schema version, coordinate conventions, and sparse whole-map encoding.
- Specify ordered/named layers and every underlying tile, registered meanings, an explicit policy for unlabeled colors, and named-area descriptions/geometry.
- Document how empty cells, map dimensions, color references, and layer visibility relate to interpretation.

## Acceptance criteria

- [ ] The export is a distinct public schema from the editable project even if both use the same serialization technology.
- [ ] An agent can determine tile locations, layer order/names, color values/meanings, and area descriptions from the export plus its schema.
- [ ] Hidden/underlying content is preserved, and unnamed colors remain interpretable through the chosen explicit policy.
- [ ] Export always covers the whole map; selected-area export and direct game-import compatibility remain deferred.

## Validation

- Write a small human-readable example containing raw colors, two overlapping layers, and house/village annotations.
- Estimate encoding size for the representative large fixture and review that no editor cache/history state is required to interpret it.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-044: Implement whole-map agent export with complete semantic content](wrk-5e43190b.md).
