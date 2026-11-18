---
id: wrk-d0e8e734
title: 'TW-046: Verify agent-export completeness with an independent consumer fixture'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-ae1f5f2b
priority: normal
labels:
  - v1
  - export
  - verification
fields:
  sequence: 46
  source: INTENT.md
---
## Outcome

Demonstrate that the export communicates map meaning without relying on editor internals.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Project files and agent exports; INTENT.md — First-version success criteria.

**Execution order:** 46 of 54. Phase: export.

**Prerequisite:** [wrk-ae1f5f2b](wrk-ae1f5f2b.md) — TW-045: Add native agent-export action, progress, and reliable output writes.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Create a small standalone consumer/validator or test decoder using only the published export schema.
- Build a golden map with terrain, walls, furniture, hidden underlying tiles, raw colors, recolored registry entries, and named areas.
- Document a concise example of how an agent reads coordinates, layers, meanings, and descriptions.

## Acceptance criteria

- [ ] The independent consumer reconstructs every exported occupied cell and its layer identity/order.
- [ ] Assertions prove that hidden content, unlabeled colors, registry meanings, and area descriptions are neither omitted nor conflated.
- [ ] The consumer requires no project-file decoder, rendering cache, React state, or application server.
- [ ] Schema errors are detectable, examples match actual output, and the large-map representation remains sparse/efficient.

## Validation

- Compare consumer reconstruction to the source document and include negative schema cases.
- Review the example export as an agent-facing artifact and verify each success-criterion datum is locatable.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-047: Finish editor shortcut, focus, feedback, and usability integration](wrk-d8dced1c.md).
