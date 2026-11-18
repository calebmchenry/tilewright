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
