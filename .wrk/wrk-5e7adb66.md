---
id: wrk-5e7adb66
title: 'TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-2b769ca2
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 38
  source: INTENT.md
---
## Outcome

Make conventional desktop commands reachable through menus and shortcuts.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — First-version success criteria.

**Execution order:** 38 of 54. Phase: projects.

**Prerequisite:** [wrk-2b769ca2](wrk-2b769ca2.md) — TW-037: Implement document lifecycle and unsaved-change protection.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Wire Open, Save, Save As, New, Undo, Redo, Cut, Copy, and Paste to shared application actions.
- Implement Cmd+S with first-save path prompting and existing-file updates, using appropriate menu labels and enabled states.
- Respect native text-field editing and focus when routing keyboard commands.

## Acceptance criteria

- [ ] Cmd+S explicitly updates the current project file and requests a destination only when appropriate.
- [ ] Menu and shortcut invocations use the same save/history/clipboard paths and cannot create duplicate concurrent saves.
- [ ] Text fields retain standard editing behavior; arrow keys and clipboard shortcuts do not also edit the map while text has focus.
- [ ] Cancel/failure preserves unsaved state and visible feedback; shortcuts work in the packaged desktop context.

## Validation

- Run a desktop New -> draw -> Cmd+S -> edit -> Cmd+S -> Open sequence and compare content.
- Check keyboard behavior with canvas, name input, description input, and modal dialog focus.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-039: Define recovery cadence, identity, retention, and restore policy](wrk-dbdc0004.md).
