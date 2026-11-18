---
id: wrk-e61b329b
title: 'TW-050: Meet final large-edit and undo memory/latency budgets'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-6e0d23e5
priority: normal
labels:
  - v1
  - release
  - verification
fields:
  sequence: 50
  source: INTENT.md
---
## Outcome

Keep substantial painting and rearrangement operations responsive and safely reversible.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Map size and navigation; INTENT.md — First-version success criteria.

**Execution order:** 50 of 54. Phase: release.

**Prerequisite:** [wrk-6e0d23e5](wrk-6e0d23e5.md) — TW-049: Meet final populated-map rendering and navigation budgets.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Profile large strokes, rectangles, connected fills, multi-layer move/copy/rotate/flip, recolors, and undo/redo on representative maps.
- Fix unnecessary dense allocations, full-document copying, long main-thread stalls, and stale asynchronous work.
- Verify progress/cancellation and history limits behave consistently after optimizations.

## Acceptance criteria

- [ ] Operations meet the chosen latency/memory budgets or provide documented responsive progress with safe cancellation.
- [ ] Optimizations preserve destination holes, same-layer overwrite rules, exact inverses, registry identity, and annotation independence.
- [ ] History retention remains bounded and does not silently corrupt saved-revision/dirty state.
- [ ] Repeated large operations and undo/redo do not leak document, clipboard, or renderer resources.

## Validation

- Run timing/memory benchmarks alongside semantic equality assertions.
- Cancel large operations at several stages and verify unchanged or fully committed state according to the action contract.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-051: Meet large-project save, load, recovery, and export budgets](wrk-7eef1f66.md).

## Deferred TW-011 work — user decision, 2026-11-18

The user accepted the early baseline to prioritize feature development and
explicitly deferred performance refinement. TW-011 closes under that revised
scope; its original performance gate has not passed. This ticket retains its
existing late-backlog dependency and owns the following follow-up:

- Revise large-command scheduling/acknowledgement and remeasure. The 1024²
  synchronous path reached 118 ms against a 50 ms main-thread budget; heartland
  also exceeded the 100 ms acknowledgement/completion target.
- Isolate 20-cycle edit/undo memory-growth cases. The earlier 155.11 / 100.27 MiB
  retained growth followed 20 trials of each of three sizes (60 total), so it
  cannot establish the 100 MiB / 20-cycle target. Investigate retained history
  and allocator capacity, then remeasure with process-group/shared accounting.
- Preserve transaction atomicity, exact undo/redo and data integrity while
  improving responsiveness. Coordinate real presentation timing with TW-049.
- Reuse `docs/native-performance.md`, its baseline JSON and compressed raw
  samples. These findings are future refinement work, not prerequisites for
  intervening feature tickets.
