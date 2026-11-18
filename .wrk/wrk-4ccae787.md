---
id: wrk-4ccae787
title: 'TW-035: Implement validated project decoding and safe load failures'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-0b0f3b9b
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 35
  source: INTENT.md
---
## Outcome

Reopen project files accurately and reject invalid input without replacing the active document.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation.

**Execution order:** 35 of 54. Phase: projects.

**Prerequisite:** [wrk-0b0f3b9b](wrk-0b0f3b9b.md) — TW-034: Implement deterministic project encoding and snapshot extraction.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement decoding, schema/version checks, reference validation, and reconstruction of stable model identities.
- Validate sizes, coordinates, layer order, registry collisions/references, annotations, and persisted settings.
- Prepare a complete new document before swapping it into the editor; define unsupported-version behavior without inventing nonexistent migrations.

## Acceptance criteria

- [ ] Encode/decode round trips preserve all document data, including hidden underlying cells and registry identities after recolor.
- [ ] Malformed/truncated files, unsupported versions, invalid bounds, and dangling references produce useful errors.
- [ ] A failed load leaves current content, history, saved path, and dirty state intact.
- [ ] Large inputs use the sparse representation and avoid unchecked allocation based solely on declared dimensions.

## Validation

- Run round-trip/golden fixture cases and corrupt-file variants for every major schema component.
- Open a full representative document and compare model equality before and after serialization.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-036: Implement native local file dialogs and atomic project reads/writes](wrk-16de7b43.md).
