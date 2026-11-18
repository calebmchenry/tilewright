---
id: wrk-7eef1f66
title: 'TW-051: Meet large-project save, load, recovery, and export budgets'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-e61b329b
priority: normal
labels:
  - v1
  - release
  - verification
fields:
  sequence: 51
  source: INTENT.md
---
## Outcome

Validate efficient durable workflows at the same scale as editing.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation; INTENT.md — Map size and navigation.

**Execution order:** 51 of 54. Phase: release.

**Prerequisite:** [wrk-e61b329b](wrk-e61b329b.md) — TW-050: Meet final large-edit and undo memory/latency budgets.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Measure project size, encode/decode/write time, peak memory, recovery overhead, and agent-export size/time on representative maps.
- Optimize snapshotting/serialization/native transfer where measurements show avoidable stalls or excessive copies.
- Repeat corruption/interruption and independent-export-consumer checks after optimization.

## Acceptance criteria

- [ ] Whole-map operations preserve every layer, registry association, named area, and chosen project setting at target dimensions.
- [ ] Save/load/export and periodic recovery meet the documented budgets with responsive feedback for long actions.
- [ ] Recovery never alters explicitly saved files, and export remains a distinct whole-map schema.
- [ ] Reported results include occupied-cell counts, layer counts, encoded bytes, timing, and peak memory; dense worst cases are characterized honestly.

## Validation

- Round-trip the largest representative fixture, restore its unsaved revision, and independently validate its agent export.
- Repeat failed/interrupted writes and edit-during-save scenarios after performance fixes.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-052: Produce and verify a self-contained offline macOS release build](wrk-9d52b8c7.md).
