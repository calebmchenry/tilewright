---
id: wrk-d8dced1c
title: 'TW-047: Finish editor shortcut, focus, feedback, and usability integration'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-d0e8e734
priority: normal
labels:
  - v1
  - release
  - implementation
fields:
  sequence: 47
  source: INTENT.md
---
## Outcome

Make the completed toolset behave consistently during a continuous desktop editing session.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Drawing and rearranging; INTENT.md — Local operation.

**Execution order:** 47 of 54. Phase: release.

**Prerequisite:** [wrk-d0e8e734](wrk-d0e8e734.md) — TW-046: Verify agent-export completeness with an independent consumer fixture.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Complete tool shortcuts, arrow nudging, Escape cancellation, menu enablement, and visible shortcut hints using shared actions.
- Audit focus behavior among canvas, panels, text inputs, native dialogs, and progress/restore UI.
- Provide clear button names, focus indicators, active state, dimension readouts, and actionable errors for the implemented workflows.

## Acceptance criteria

- [x] Typing in area descriptions or names never paints, nudges, deletes tiles, or steals text clipboard operations.
- [x] Undo/redo and cancel behave consistently across drawing, selection, registry, annotation, file, and recovery operations.
- [x] Active tool/layer/color, map/selection dimensions, dirty state, and long-operation progress are discoverable.
- [x] All required actions are reachable at ordinary macOS window sizes without inaccessible clipped controls.

## Validation

- Run a keyboard/mouse walkthrough across every tool and major focus context.
- Resize the desktop window and check error/cancel states with populated panels and long names.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-048: Validate the complete drawing, rearrangement, and annotation session](wrk-74cf177c.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session without delegation.
WRK state replaces the sprint ledger. Prerequisite wrk-d0e8e734 is done.
Read the sprint-execute skill, AGENTS.md, ticket runner, INTENT.md, README,
desktop/foundation/editor-shell and relevant drawing, selection, registry,
annotation, file/recovery and testing guidance. Fetched the skill weather report
(gpt-6-astra coding recommendation); retained the requested in-session strategy.

- [x] Phase 1: shared tool shortcuts, visible hints, Escape and history cancellation.
- [x] Phase 2: focus restoration, compact layout, state and error discoverability.
- [x] Phase 3: complete keyboard/mouse and native walkthrough, final regression,
  acceptance review and implementation/validation evidence.

Phase 1 validation: pinned Node 24.22.3; `npm run build`, 496/496 domain tests,
47/47 focused Chromium UI tests (editor, drawing, transforms, project-file/menu/
recovery workflows), and `npm run format:check` passed. Initial domain failures
caught cancellation ordering, which was fixed; two old canvas-only tool-key
assertions were updated for the explicit non-text-panel shortcut policy.
Local ignored logs: `.wrk-runs/wrk-d8dced1c-validation/`.

Phase 2 validation: build, 496/496 domain tests and formatting passed; 36/36
focused usability/project-file tests passed after fixing the recovery opener
lost during asynchronous scanning. Native checks found WKWebView button-focus,
window-focus readout and replacement-canvas ownership gaps; these are fixed.
A broader regression found footer reflow during mouse-down at minimum size:
reserving focus-readout width keeps the clicked button in place. Shape visual
comparisons now use the same keyboard-focus outline (unfocused before/after
screenshots were byte-identical); exact pixel/content assertions remain intact.
The final focused recheck passed 17/17 registry, shapes and usability tests.

### Implementation and decisions

- `src/editor/shortcuts.ts`, `src/ShortcutHint.tsx`, `src/App.tsx`: common tool
  vocabulary and visible hints, including Areas (A); active tool/layer/color
  readouts. Tool letters work from canvas/non-text panels; arrows, Enter,
  brackets, zoom and Space-pan retain canvas ownership. Text/select/IME/modal
  contexts keep native editing and clipboard behavior.
- `src/editor/session.ts`, `src/editor/navigation.ts`,
  `src/editor/application-actions.ts`: shared Escape cancellation, undo/redo
  cancels uncommitted drawing/fill/drafts before committed history; cancelable
  export Escape precedes editor previews outside text/modal contexts. Existing
  native menu/atomic publication gates are retained.
- `src/editor/focus.ts`, `src/App.tsx`, `src/MapCanvas.tsx`,
  `src/AnnotationPanel.tsx`, `src/CanvasControls.tsx`, `src/FileControls.tsx`,
  `src/SelectionPanel.tsx`, `src/RecoveryPanel.tsx`: restore abandoned focus
  after temporary controls/dialogs, retain the async recovery opener, focus
  native mouse/accessibility button activation, preserve implicit form Enter,
  and refresh focus after native dialogs/window activation or canvas replacement.
- `src/styles.css`: constrain grid/header intrinsic width, wrap long labels,
  scroll panels/toolbars/dialogs/footer, cap progress/feedback height, reserve
  focus-readout width to prevent mouse-down layout movement. All controls remain
  reachable at 1200×800, 900×620 and 640×452 content sizes.
- `tests/usability.spec.ts`, `tests/project-files.spec.ts`,
  `tests/domain/editor.test.ts`: continuous all-tool session, exact content and
  history checks, text/clipboard/IME isolation, export/modal cancellation,
  opener restoration, WK-style button focus, populated long-name/error layouts.
  `tests/domain/selection.test.ts` and `tests/domain/shapes.test.ts` reflect the
  deliberate panel tool-key policy; `tests/shapes.spec.ts` normalizes focus for
  unchanged exact screenshot comparisons.
- `docs/editor-shell.md` (Complete editing-session integration),
  `docs/project-format.md` and README document the focus/shortcut/cancel contract.
  No project schema, dependency or native Rust changes.

### Native walkthrough evidence

Built the release Tauri `.app` on macOS 15.8.1 arm64 with pinned Node 24.22.3
and Rust 1.100.0. The local validation config changes only app name, identifier,
window title and sizes; `app.tilewright.tw047` keeps validation recovery separate
from the normal application. Final build command:
`npx tauri build --config .wrk-runs/wrk-d8dced1c-validation/tauri.walkthrough.conf.json --bundles app -- --locked`.
TypeScript/Vite and release bundling passed; app size 12.41 MiB.

Used test-generated files in `/tmp`, including a 32×32 populated map with three
layers, long layer/color/area names and multiline descriptions. Verified actual
WKWebView/AppKit behavior using mouse clicks and keyboard commands:

- Pencil, Eraser, Line and Rectangle single-tile commits, Fill, named-color
  Eyedropper, Select arrow nudge and tile copy/paste/rotation preview cancellation;
  undo/redo and saved/unsaved feedback; Inspect, Pan, Areas and Fit shortcuts.
- Layer/area/description and registry-name text editing, arrow/backspace and
  Cmd+A/C/X/V/Z remain in text; area Escape removes only the draft and restores
  New area. Invalid blank name/out-of-map bounds show errors without applying.
- Grow, registry and recovery Escape restore their openers. Invalid area Apply
  retains button focus and subsequent Escape restores New area.
- Actual native Save filename editing/clipboard, Save As, Open, cancelable export
  picker; File menu disabled during AppKit picker and enabled afterward. Export
  Escape reports canceled/no output changed. Save wrote test output and reported
  Saved. Successful Open focused its replacement canvas.
- Loader rejected an invalid fixture with an actionable unused-palette-entry
  error while preserving the current map; corrected fixture loaded successfully.
- Resized the actual window from 1200×800 to native minimum 640×480 (640×452
  content), scrolled populated panels, reached header/panel/form actions, and
  inspected long-name/error/cancel states without horizontal clipping. The final
  rebuilt app repeated minimum-window mouse Register color → Escape successfully
  after the fixed-width focus readout change. Validation app was closed.

Native continuous drag injection in this environment delivers missing-button
moves and cannot establish a valid held gesture (also documented by earlier
selection/drawing tickets). No native continuous-drag success is claimed.
Real single-click/native keyboard actions above and browser captured-gesture
checks at DPR 1/2 provide the actual evidence; capture-safety guards were retained.

### Final validation and acceptance review

- `npm test`: **496/496 domain tests and 152/152 Chromium UI tests passed**
  (UI 7.4 minutes, no failures or retries). This final run includes every tool,
  file/menu/recovery integration, DPR 1/2 visual/gesture and target-scale tests.
  The 259 source/test/doc/config files recorded in `final-source.sha256` were
  verified unchanged afterward. Log: `final-test.log`.
- Frontend strict TypeScript checks and Vite production build passed both phase
  builds and the final release desktop build. Log: `native-build-final.log`.
- `npm run format:check`: Prettier and `cargo fmt --check` passed.
  Log: `final-format.log`.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: **31/31 passed**
  in the final default parallel recheck; a serial run also passed 31/31.
  The initial parallel attempt had one recovery-store ownership/locking error;
  both unchanged-code reruns passed. This transient is retained in
  `final-rust.log`, with passing evidence in `final-rust-serial.log` and
  `final-rust-recheck.log`; no native source was changed.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`:
  passed. Log: `final-clippy.log`.
- `git diff --check` passed; `wrk validate` passed (57 tickets).
- The earlier broad UI run had 149 passes and three failures: minimum-window
  registry click reflow and two shape focus-outline screenshot mismatches.
  All were resolved as described above; the unchanged final full run passes.
  An earlier regression was intentionally interrupted to incorporate native
  focus findings and is not counted as a pass. Logs are retained locally.

Acceptance evidence: typing/clipboard isolation is covered by exact persistent
content/history snapshots plus native text editing; cancellation/undo/redo by
shared-action/domain and full UI workflows; state/progress/error discoverability
by tool/color/dimension/dirty/export/recovery assertions and native inspection;
reachability by populated long-name/error layouts at three sizes and native
minimum-window resizing/mouse checks. All four criteria are satisfied.

Performance limitations remain under the accepted baseline. The production build
retains Vite's large-chunk advisory; this ticket makes no new performance-budget
claim. Rendering/presentation refinement remains TW-049 (`wrk-6e0d23e5`), and
large edit/history/memory refinement remains TW-050 (`wrk-e61b329b`). Functional
correctness and data-integrity validations above passed.

Commit scope includes only this implementation, its tests/docs and this WRK
record. The pre-existing `.wrk/wrk-58cdb442.md` status edit is preserved outside
the commit. No next ticket is executed in this session.
