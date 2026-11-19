---
id: wrk-2b769ca2
title: 'TW-037: Implement document lifecycle and unsaved-change protection'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-16de7b43
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 37
  source: INTENT.md
---
## Outcome

Make New, Open, Save As, document replacement, and window closing consistent with unsaved work.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Project files and agent exports.

**Execution order:** 37 of 54. Phase: projects.

**Prerequisite:** [wrk-16de7b43](wrk-16de7b43.md) — TW-036: Implement native local file dialogs and atomic project reads/writes.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Track active document identity, path, explicit-save revision, and dirty indicator in the editor shell.
- Handle unsaved-change choices on New/Open/close, including asynchronous saves and cancellation.
- Reset document-specific tools/history/caches safely when a new document is installed.

## Acceptance criteria

- [x] A new untitled document requests a path on its first explicit save; existing documents save to their current path.
- [x] Successful save marks only the saved revision clean; edits made while saving remain dirty.
- [x] Choosing cancel or encountering a save/load error prevents destructive document replacement or closing.
- [x] Switching documents clears stale selection/renderer references while preserving the incoming document metadata.

## Validation

- Exercise New/Open/close with save, discard, cancel, and failed-save branches.
- Test undo to the saved revision, redo away from it, and edit-during-save dirty state.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow](wrk-5e7adb66.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed phase by phase in this Codex session. WRK is
the sprint record; no separate sprint document/ledger or delegation was used.
Prerequisite wrk-16de7b43 was done before implementation. Read AGENTS.md,
INTENT.md, README, the ticket runner and relevant foundation, editor/history,
canvas, desktop and project-format documents. Fetched the skill's weather report
(gpt-6-astra was its implementation/CS recommendation); continued in this session
as requested. The pre-existing edit to `.wrk/wrk-58cdb442.md` is excluded.

- [x] Phase 1: shared document coordinator, serialized operations, revision and
  identity guards, file association lifetime, and domain validation.
- [x] Phase 2: shared Save/Discard/Cancel modal, New/Open/Save/Save As routing,
  native window-close/Quit handshake and UI/native regression validation.
- [x] Phase 3: complete test suite, packaged native checks, documentation and
  acceptance review.

Implementation/decision locations:

- `src/editor/document-lifecycle.ts`: one application entry point for New, Open,
  Save, Save As and close. Every destructive operation checks identity/revision
  after asynchronous steps; canceled/failed saves or loads retain the workspace.
  Concurrent edits during Save remain dirty and stop the destructive transition.
- `src/editor/workspace.ts`, `src/editor/project-files.ts`: installation generation,
  current path, checkpoint acknowledgement, observer-safe New publication, and
  release of references to replaced sessions. Existing snapshot/history logic
  still marks only the revision actually saved clean.
- `src/App.tsx`, `src/CanvasControls.tsx`, `src/FileControls.tsx`, `src/main.tsx`:
  consistent modal choices, dirty/path UI, disabled busy actions and feedback,
  shortcut routing, generation-keyed session/renderer reset and disposal.
- `src/native/document-lifecycle.ts`, `src-tauri/src/document_lifecycle.rs`,
  `src-tauri/src/main.rs`, `src-tauri/build.rs`, the main capability and generated
  command permissions: native close is prevented before emitting an event;
  startup requests survive until consumed; only an approved frontend workflow
  invokes native exit. Cmd+Q/custom Quit also routes through this guard.
- `docs/project-format.md#document-lifecycle-tw-037` records the contract and
  decisions; README, desktop-development, canvas-creation and editor-shell docs
  link/update the controls and ownership.

Decisions: New validates dimensions before prompting. Requests arriving during
another operation are ignored, never queued against a replacement document;
retry close after pending work finishes. Explicit saves still write persisted
layer preferences even when content is clean; preference-only changes retain the
already-documented non-dirty policy. Save captures committed content only, never
applies drafts/gestures. A successful save preceding a canceled/failed Open stays
a legitimate saved checkpoint; the document itself is retained. Incoming metadata
and hidden active layer preferences are preserved while transient state resets.

Actual validation evidence:

- Phase 1: `npm run build` passed; focused lifecycle/file/loading tests **40
  passed**; complete domain suite **369 passed**.
- Final `npm test`: **369 domain tests and 134 Playwright tests passed**, no
  failures/skips/cancellations. The full browser suite completed in 7.5 minutes.
- `tests/domain/document-lifecycle.test.ts`: **25 new tests** cover every
  New/Open/close Save, Discard, Cancel, canceled-save and failed-save branch;
  edits during each transition's save; undo to saved / redo away; first-save path
  versus existing path; failed/canceled loads; superseded prompt decisions;
  duplicate/busy requests, disposal, close errors and clean-transition races.
- Focused `npx playwright test tests/project-files.spec.ts tests/canvas.spec.ts`:
  **23 passed**. Uses the shipping UI and adapter with substituted OS IPC, covering
  all three actions and choices/failures, native listener startup, failed native
  exit, save-during-edit/undo/redo, existing Save As semantics, exact incoming
  dimensions/hidden active layer, fresh undo, one canvas and one live GPU context
  after replacement. Existing loading tests check clipboard/selection/tool/draft
  clearing and complete metadata equality, including the populated frontier map.
- Final `npm run build:desktop`: passed (strict TypeScript, production Vite build,
  locked Rust release and local arm64 macOS app bundle, approximately 11.45 MiB).
- `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --locked
  --manifest-path src-tauri/Cargo.toml`: **9 passed**. Includes retained/consumed
  native close state plus the existing atomic-write/read/interruption tests.
- `CARGO_PROFILE_DEV_DEBUG=0 cargo clippy --locked --manifest-path
  src-tauri/Cargo.toml -- -D warnings`: passed. All-feature Clippy also passed
  after preserving the dedicated performance build's normal close behavior.
- `npm run format:check` and `git diff --check`: passed.
- Packaged WKWebView on macOS 15.8.1 arm64: used a copy with a unique validation
  bundle ID/name so existing app instances were untouched. Verified red-button
  close prompts, Cancel retaining the editor, Cmd+Q prompting, and canceling the
  first-save native picker retaining the edited untitled map. Saved to
  `/private/tmp/TW037-local-check.tilewright`; title/path became Saved. Made this
  test file read-only, renamed the layer, and chose Save and continue on close:
  permission feedback appeared, the same path and unsaved layer remained, and
  the window stayed open. The prior file SHA-256 remained
  `d31f03ba8034d6f9ec44d83b20b1fc0ba91ddda93864846621cfa5881ee063e7`.
  Restored write permission and repeated Cmd+Q → Save and continue: app exited;
  the complete file contained layer name `Preserve failed save`, SHA-256
  `a57a4af208238306efbf965c7dd980a561b4fbfdfec5ba275b290be35d16257b`.

Correction found by native validation: the predefined macOS Quit terminates
without Tauri's ExitRequested callback. Replaced only the application submenu's
Quit route with a custom guarded action; the other File/Edit menu wiring remains
TW-038. Rebuilt and reran native tests/Clippy, then verified actual protected Quit
and successful save-before-exit. An initial save into this machine's Documents
folder stalled on filesystem access (an independent Python directory scan also
stalled); close remained blocked while saving. Stopped only that validation
instance and repeated the successful checks on local `/private/tmp` storage.

Limits: forced process termination, Dock/OS termination and crashes are outside
the window/application-menu handshake; separate recovery remains subsequent work.
No new latency/peak-memory or performance-budget claim; existing Vite bundle-size
warning and performance refinement remain TW-049/TW-050 under AGENTS.md. No
unrelated ticket or feature was implemented.