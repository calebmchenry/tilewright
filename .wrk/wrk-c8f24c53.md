---
id: wrk-c8f24c53
title: 'TW-053: Document editing workflows, file formats, recovery, and maintenance commands'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-9d52b8c7
priority: normal
labels:
  - v1
  - release
  - documentation
fields:
  sequence: 53
  source: INTENT.md
---
## Outcome

Make the shipped editor and its implementation decisions understandable without conversation history.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Project files and agent exports; INTENT.md — Local operation; INTENT.md — Remaining implementation decisions.

**Execution order:** 53 of 54. Phase: release.

**Prerequisite:** [wrk-9d52b8c7](wrk-9d52b8c7.md) — TW-052: Produce and verify a self-contained offline macOS release build.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Write concise user guidance for navigation, grid/chunks, layers, free/named colors, drawing, selections/transforms, and label tiers.
- Explain Save/Save As/Cmd+S, separate recovery, whole-map agent export, and where documented schema examples live.
- Document development/build/check commands, representative benchmarks, final decisions, and measured limitations.

## Acceptance criteria

- [ ] Instructions match actual menu labels/shortcuts and include the layered-house movement and grass-recolor examples.
- [ ] File format documentation explains coordinates, ordering, raw/registered colors, annotations, versions, and project/export differences.
- [ ] Users can understand recovery restore/discard without assuming it silently autosaves the project file.
- [ ] The product is consistently called Tilewright; deferred features and implementation choices are not presented as delivered requirements.

## Validation

- Follow the guide from a clean checkout and a packaged-app launch, checking all referenced commands and paths.
- Validate schema examples against actual codecs/consumer and reconcile documented budgets with final measurements.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-054: Accept Tilewright v1 against every intent success criterion](wrk-8a0ffb09.md).
