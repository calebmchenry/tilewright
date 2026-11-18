---
id: wrk-0b0f3b9b
title: 'TW-034: Implement deterministic project encoding and snapshot extraction'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-eef53dd9
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 34
  source: INTENT.md
---
## Outcome

Serialize a coherent editable document without losing content or blocking the interface unnecessarily.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Chosen technology.

**Execution order:** 34 of 54. Phase: projects.

**Prerequisite:** [wrk-eef53dd9](wrk-eef53dd9.md) — TW-033: Specify the versioned editable-project schema and persisted settings.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement the chosen project encoder and revision-consistent snapshot boundary in TypeScript.
- Encode sparse ordered layers, registry associations, annotations, dimensions, and chosen editor settings.
- Separate document serialization from native paths/dialogs and avoid exposing transient preview state.

## Acceptance criteria

- [ ] Equivalent documents encode deterministically under the chosen schema/ordering conventions.
- [ ] Hidden layers, raw colors, empty-vs-occupied distinctions, and full annotation metadata are preserved.
- [ ] A snapshot represents one committed document revision even when editing continues during an asynchronous save.
- [ ] Preview gestures, transient selection overlays, and nonpersisted UI state are excluded intentionally.

## Validation

- Encode small golden fixtures and a representative large map; verify all expected schema fields.
- Edit during asynchronous snapshot/encoding and confirm the resulting file is a coherent revision.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-035: Implement validated project decoding and safe load failures](wrk-4ccae787.md).
