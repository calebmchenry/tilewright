---
id: wrk-eef53dd9
title: 'TW-033: Specify the versioned editable-project schema and persisted settings'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-efb169f5
priority: high
labels:
  - v1
  - projects
  - decision
fields:
  sequence: 33
  source: INTENT.md
---
## Outcome

Define an efficient, complete editable document format before implementing file I/O.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation; INTENT.md — Remaining implementation decisions.

**Execution order:** 33 of 54. Phase: projects.

**Prerequisite:** [wrk-efb169f5](wrk-efb169f5.md) — TW-032: Add named-area browsing and scale inspection.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose serialization technology, file extension, versioning, efficient sparse encoding, validation rules, and compatibility/error policy.
- Specify dimensions/coordinates, all ordered layers and tiles, raw colors, stable registry IDs/names/colors/associations, and annotation geometry/descriptions/tiers/label settings.
- Decide which editor settings persist, which remain session-local, and whether undo history is intentionally excluded.

## Acceptance criteria

- [ ] A written schema and small annotated example account for every state needed to reopen and continue editing.
- [ ] Layer order and hidden underlying content are explicit; dimensions do not require a dense 40,960,000-cell array per layer.
- [ ] The format distinguishes empty, raw-color, and registered cells and preserves identity across recoloring.
- [ ] Project and agent-export purposes are separate; recovery metadata and explicit-save state are not conflated with exported map meaning.

## Validation

- Map a mixed multilayer/annotation fixture into the schema and back by inspection.
- Review unsupported versions, truncation, invalid references, and very large declared sizes before implementation.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-034: Implement deterministic project encoding and snapshot extraction](wrk-0b0f3b9b.md).
