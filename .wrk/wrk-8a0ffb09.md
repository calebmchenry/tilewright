---
id: wrk-8a0ffb09
title: 'TW-054: Accept Tilewright v1 against every intent success criterion'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-c8f24c53
priority: high
labels:
  - v1
  - release
  - verification
fields:
  sequence: 54
  source: INTENT.md
---
## Outcome

Close the backlog only when the complete intended local map-design session works in the packaged app.

## Source and scope

**Source:** INTENT.md — First-version success criteria; INTENT.md — Deferred scope; INTENT.md — Remaining implementation decisions.

**Execution order:** 54 of 54. Phase: release.

**Prerequisite:** [wrk-c8f24c53](wrk-c8f24c53.md) — TW-053: Document editing workflows, file formats, recovery, and maintenance commands.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Run a release acceptance session covering all eight numbered success criteria and the populated target-scale requirement.
- Trace each intent requirement and open implementation decision to delivered behavior, documented decisions, and verification evidence.
- Fix remaining in-scope acceptance failures and capture the exact release artifact/revision, commands, fixture, and outcomes.

## Acceptance criteria

- [ ] Create/grow, all drawing tools, separate layers, arbitrary/registered colors, the 8 by 8 house move, undo of overwritten cells, and selection transforms all pass.
- [ ] Labels change with zoom, annotations stay independent, and registered grass recolors across layers without losing its meaning.
- [ ] Cmd+S and reopen preserve editable information; forced-crash recovery restores unsaved work separately from the last explicit save.
- [ ] Whole-map export preserves coordinates, named layer order, underlying content, raw/registered meanings, and named-area descriptions.
- [ ] Representative populated 100 by 100 chunk maps meet agreed responsiveness budgets, and the packaged macOS app works offline with no separate server.
- [ ] No required behavior remains untested or unresolved; any intentionally deferred scope matches INTENT.md.

## Validation

- Run the documented automated checks and final desktop acceptance checklist with evidence linked in the completion notes.
- Verify each preceding ticket is done and every first-version requirement has a concrete passing result.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.
