---
id: wrk-5e7adb66
title: 'TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow'
status: done
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

- [x] Cmd+S explicitly updates the current project file and requests a destination only when appropriate.
- [x] Menu and shortcut invocations use the same save/history/clipboard paths and cannot create duplicate concurrent saves.
- [x] Text fields retain standard editing behavior; arrow keys and clipboard shortcuts do not also edit the map while text has focus.
- [x] Cancel/failure preserves unsaved state and visible feedback; shortcuts work in the packaged desktop context.

## Validation

- Run a desktop New -> draw -> Cmd+S -> edit -> Cmd+S -> Open sequence and compare content.
- Check keyboard behavior with canvas, name input, description input, and modal dialog focus.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-039: Define recovery cadence, identity, retention, and restore policy](wrk-dbdc0004.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session without delegation.
WRK is the sprint record; no separate sprint document or ledger was created.
Prerequisite wrk-2b769ca2 was done. Read AGENTS.md, INTENT.md, README,
ticket-runner, desktop/foundation/editor/history/project-format guidance and the
prior ticket's validation. Fetched the skill weather report (gpt-6-astra was its
CS/implementation recommendation); continued in this session as requested.
The pre-existing edit to `.wrk/wrk-58cdb442.md` is excluded from this ticket.

- [x] Phase 1: shared application actions, current-session routing, operation
  gates, menu labels/enabled states, and domain validation.
- [x] Phase 2: native File/Edit menus, AppKit text editing, native picker focus,
  shared New dialog, and browser/packaged validation with fixes.
- [x] Phase 3: final complete validation, acceptance review and documentation.

Implementation and decisions:

- `src/editor/application-actions.ts`: common New/Open/Save/Save As dispatcher;
  file buttons, DOM shortcuts and native menu events call the existing lifecycle
  coordinator. Undo/Redo/Cut/Copy/Paste call `EditorSession.perform`, shared with
  the existing toolbar/selection controls. Menu subscriptions rebind after session
  replacement, so old history and clipboard cannot leak into new documents.
- `src/native/application-menu.ts`, `src/main.tsx`: one lifetime outside React,
  actual DOM focus checks at invocation, modal guards, native event disposal and
  ordered/coalesced menu-state IPC. A disabled/busy shortcut is consumed without
  triggering a second handler. Browser-only file shortcuts retain actionable
  desktop-required feedback while file buttons remain disabled.
- `src/App.tsx`, `src/CanvasControls.tsx`, `src/FileControls.tsx`,
  `src/editor/document-lifecycle.ts`: New from File/Cmd+N opens the same dimension
  form as New map; saves/open use one coordinator and one unsaved-change flow.
  Removed the separate file keyboard listener. Existing lifecycle/file/history
  code still owns serialization, snapshot/checkpoint acknowledgement and errors.
- `src-tauri/src/application_menu.rs`, `main.rs`, `document_lifecycle.rs`,
  `project_files.rs`: native File New/Open/Save/Save As and Edit Undo/Redo/Cut/Copy/
  Paste with conventional Command accelerators. Retained protected Quit/Close
  and standard View/Window menus. The native text bridge accepts only five fixed
  editing selectors and calls the current AppKit responder. A scoped native
  file-panel guard swaps in predefined Edit actions and disables File, restoring
  the custom submenu afterward. Hidden custom menu state continues to update.
- `src-tauri/Cargo.toml`/lock, `build.rs`, `capabilities/main.json`, generated
  permissions: reuse already-locked objc2/AppKit versions and add only menu-state
  and fixed text-edit commands to the local main-window capability. No arbitrary
  selector/script/filepath authority or JavaScript clipboard access was added.
- `docs/project-format.md#fileedit-menus-and-shortcuts-tw-038` documents ownership,
  labels, focus, operation gating, native panel behavior and source references;
  README/editor-shell/desktop-development link/update the integration.

Decisions: New uses Cmd+N; map Redo uses Cmd+Shift+Z. Clipboard shortcuts act on
canvas/non-text panel focus and keep tile data separate from system text.
File shortcuts work in text fields; editor modals block file/map actions while
retaining native text editing. Undo/Redo labels identify the next map operation;
text labels are generic and the native responder determines applicability.
Save writes even clean documents to persist layer preferences. Only first Save
and Save As prompt for destinations. Busy actions are ignored, not queued;
cancel and failure do not clear dirty work. No recovery or cross-document
clipboard scope was added.

Actual validation evidence:

- Phase 1: `npm run build` passed; complete domain suite **372 passed**.
- Focused existing file/canvas UI suite: **23 passed**. Added menu/clipboard/focus
  scenarios: **3 passed** after correcting the expected Pencil history label.
- Final focused `node --test tests/domain/application-actions.test.ts`: **4
  passed**. Final focused `npx playwright test tests/editor.spec.ts
  tests/project-files.spec.ts`: **27 passed** (33.5 seconds).
- Final `npm test`: **373 domain tests and 137 Playwright tests passed**, no
  failures/skips/cancellations; browser portion completed in **7.0 minutes**.
- `npm run build:desktop`: passed after all code fixes (strict TypeScript,
  production assets, locked Rust release, local arm64 macOS app, 11.49 MiB).
- Final `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --locked
  --manifest-path src-tauri/Cargo.toml`: **9 passed**. Final Clippy with
  `CARGO_PROFILE_DEV_DEBUG=0`, `--locked`, `-- -D warnings` passed in normal and
  `--all-features` configurations. `npm run format:check` and
  `git diff --check` passed.
- New domain tests cover menu/shortcut save serialization, first/current/Save As
  destination behavior, dirty checkpoints, text/IME/modal gates, session/history
  rebinding, cancellation/failure retry, disposal and browser-only feedback.
  Shipping-UI tests substitute only OS IPC: exact drawn content survives save/
  edit/save/open/save; simultaneous menu/shortcut calls produce one picker/write;
  clipboard actions share selection placement and history; name, description and
  modal focus cannot edit the map; native listener startup and close checks remain.

Packaged validation on macOS 15.8.1 arm64 used uniquely identified local app
copies to avoid touching other running instances. The production WKWebView used
embedded assets, independent of the browser test server.

- File New and Cmd+N reached the dimension dialog; creating the map retained the
  existing Save/Discard/Cancel protection. Drew a tile, used Cmd+S, canceled the
  first native picker and observed the same untitled unsaved map/Undo Pencil.
- Saved to `/private/tmp/TW038-roundtrip.tilewright`: one raw-color tile at
  (14,11), SHA-256 `b89edad98c9a8b153be4fbc9f500b0e6c323846475e8d5764af605bc4ffc4524`.
  Renamed the layer to `Saved from Cmd S` and pressed Cmd+S while its name field
  had focus: no picker, same path became Saved, SHA-256
  `b5a4075f1059daf2ad9c6aa73946cfaeab9a82edf7cab4c9d00f1c9c8ae87711`.
  Cmd+O reopened that file with a fresh empty history and the correct layer name.
  Another Cmd+S produced byte-for-byte identical bytes (not just matching pixels).
- Made that test file read-only, renamed its layer and pressed Cmd+S. The edited
  layer stayed visible/unsaved at the same path, permission feedback appeared,
  and the previous SHA-256 was unchanged. Restored the test file's permissions.
- Name-field Cmd+C/X/V and Cmd+Z/Shift+Z edited only native text; the map stayed
  Saved and its Rename layer history stayed intact. Description-field copy/cut/
  paste and arrows retained the draft without changing map history. On canvas,
  Cmd+Z undid exactly one map rename, and Edit > Redo Rename layer restored it.
- Native Edit showed correct enabled/disabled selection actions and history
  labels. Selected one occupied tile; Cmd+C copied, Edit > Cut cut, Cmd+Z
  restored, Cmd+V previewed, Right nudged and Enter committed one Paste at
  X [129,130), Y [127,128). New's modal width field retained copy/cut/paste/arrows;
  Cmd+S there opened no save panel and left the map selection/history unchanged.
  Cmd+Shift+S opened Save As, and cancel preserved the unsaved map/path/feedback.
- Native file-panel Edit > Select All/Cut/Paste edited/restored the filename;
  File was disabled until the panel closed. The automation did not reliably
  inject clipboard keystrokes into the OS panel, so that check is menu evidence,
  not an additional OS-panel keyboard claim. Packaged editor text fields and
  HTML modal keyboard behavior were directly verified as above.

Corrections during validation: the first native build looked up nested items
through the root menu (Tauri lookup is not recursive), leaving them disabled;
retained explicit submenu handles fixed this. File panels require predefined
native Edit items because their modal loop can suspend the custom-event route;
the scoped menu guard handles that focus boundary. An initial complete browser
run found one missing browser-only unavailable-save message (**136 passed, 1
failed**); the shared dispatcher now routes unavailable file shortcuts to the
existing feedback path without enabling buttons or bypassing modals.

Limits: local unsigned/ad-hoc validation is not distribution/notarization testing.
No new latency, peak memory or performance-budget claim; the existing Vite bundle
warning and performance refinement remain TW-049/TW-050 per AGENTS.md. No other
ticket or feature was implemented.
