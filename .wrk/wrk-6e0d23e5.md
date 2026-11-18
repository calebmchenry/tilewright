---
id: wrk-6e0d23e5
title: 'TW-049: Meet final populated-map rendering and navigation budgets'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-74cf177c
priority: high
labels:
  - v1
  - release
  - verification
fields:
  sequence: 49
  source: INTENT.md
---
## Outcome

Confirm the complete editor remains responsive near 100 by 100 chunks.

## Source and scope

**Source:** INTENT.md — Map size and navigation; INTENT.md — Chosen technology; INTENT.md — First-version success criteria.

**Execution order:** 49 of 54. Phase: release.

**Prerequisite:** [wrk-74cf177c](wrk-74cf177c.md) — TW-048: Validate the complete drawing, rearrangement, and annotation session.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Rerun the early benchmark suite with all tools, panels, annotations, layers, and registry behavior enabled in a release-like macOS build.
- Profile detail editing, overview navigation, layer composition, label culling, cache updates, and repeated document/view changes.
- Fix regressions against the chosen budgets and document the final supported fixture envelope.

## Acceptance criteria

- [ ] Results cover approximately 6,400 by 6,400 maps with quantified populated areas and overlapping layers, not just empty canvases.
- [ ] Frame time, input latency, CPU/GPU memory, cache rebuilds, and repeated-navigation memory behavior meet documented budgets.
- [ ] Zoom transitions, registry recolors, and label tiers remain visually correct under stress.
- [ ] Any remaining limitation is measured and reconciled with core responsive-navigation requirements before closure.

## Validation

- Record reproducible release-build measurements with hardware and fixture statistics.
- Compare against the early gate and inspect long-session resource growth.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-050: Meet final large-edit and undo memory/latency budgets](wrk-e61b329b.md).

## Deferred TW-011 work — user decision, 2026-11-18

The user accepted the early baseline to prioritize feature development and
explicitly deferred performance refinement. TW-011 closes under that revised
scope; its original performance gate has not passed. This ticket retains its
existing late-backlog dependency and owns the following follow-up:

- Obtain valid presented-frame and input-to-display timing with input-ID
  correlation at fixed 60 Hz in the complete native editor. Earlier Instruments
  captures returned impossible multi-year lifetimes or no frame events; rAF and
  submission timing remain proxies. Diagnose the capture setup or use calibrated
  external capture, then repeat the documented protocol.
- Repeat populated-fixture stress navigation and visual/input correctness in the
  complete editor; inspect long-session renderer/cache resource growth.
- Use `docs/native-performance.md`, `docs/native-performance-baseline.json` and
  the compressed native performance/presentation samples as the retained baseline.
  Preserve invalid/occluded diagnostic runs as explicitly invalid evidence.
- Coordinate large-edit/history memory and scheduling work with TW-050. Do not
  require this follow-up before intervening feature tickets can complete.
