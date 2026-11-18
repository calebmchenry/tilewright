---
id: wrk-fbc58697
title: 'TW-006: Build the editor shell and isolate document state from React UI state'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-4a5fb526
priority: normal
labels:
  - v1
  - foundation
  - implementation
fields:
  sequence: 6
  source: INTENT.md
---
## Outcome

Provide the interface structure and command routing that later tools can share.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Chosen technology.

**Execution order:** 06 of 54. Phase: foundation.

**Prerequisite:** [wrk-4a5fb526](wrk-4a5fb526.md) — TW-005: Add transactional commands, undo/redo, and saved-revision tracking.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Build the canvas workspace, tool controls, layer panel, color controls, annotation panel, and compact status/readout areas.
- Keep transient UI state and tool state separate from the map document; subscribe to targeted model changes.
- Centralize action enablement, focus ownership, feedback, and error reporting.

## Acceptance criteria

- [x] The canvas resizes with the window and supports Retina display scaling without changing tile coordinates.
- [x] Document changes do not require React to recreate every tile or rerender the entire document tree.
- [x] Active tool, active layer, zoom, and current color have clear visible state; unavailable actions have understandable disabled states.
- [x] Text editing in panels is distinguishable from canvas keyboard input, with a shared routing path for later shortcuts.

## Validation

- Exercise window resize and panel focus changes in the desktop app.
- Inspect model subscriptions and verify a small edit updates only the relevant UI and canvas regions.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-007: Render visible sparse tiles and ordered layers with PixiJS WebGL](wrk-c92d1a4b.md).


## Execution plan — 2026-11-18

Strategy A, executed in this session. WRK replaces the sprint ledger. Prerequisite
TW-005 is done. Read the skill, AGENTS.md, INTENT.md, README.md, ticket runner and
script, foundation decisions, model/history APIs, desktop and performance guidance.
Weather report fetched (gpt-6-astra for CS/Math; Opus 5.5 for frontend); execution
remains in this session as requested. Use pinned Node 24.22.3. No commits are
required; the repository has no initial commit and its existing files are untracked.

- [x] Phase 1: editor session, targeted model stores, shared action/focus/error
  routing, viewport and renderer invalidation contract; domain tests and checks.
- [x] Phase 2: responsive React panels and WebGL workspace integration, visible
  state/disabled reasons, Retina and focus/subscription regression coverage; checks.
- [x] Phase 3: native desktop resize/focus smoke validation, documented decisions,
  final acceptance audit and full validation evidence before marking done.

Scope boundary: TW-007 owns sparse tile rendering/compositing and TW-008 owns
navigation. This shell supplies their document/viewport/invalidation seams; drawing,
file persistence, registry management and annotation creation remain visibly
unavailable until their existing feature tickets. No new product scope is inferred.

Phase 1 validation: `npm run build`, `npm test` (45 domain tests, 3 WebGL UI tests), and `npm run format:check` all passed. Targeted snapshots, exact dirty spans, metadata routing, transient state isolation, text/IME shortcut guards, error feedback, disposal and coordinate conversion are covered.

Phase 2 validation: build, full tests (46 domain, 8 real-WebGL browser tests),
and formatting passed. Tests measure 0 React Profiler updates in tools/colors/
layers/annotations/view controls for a two-cell edit, exact buildings-layer dirty
rectangle [3,5)x[4,5), unchanged canvas identity, and targeted layer rename updates.
Window sizes 1200x800, 900x620 and 640x480 pass at DPR 1 and 2; tile (3,4) remains
stable after resize and 200% zoom. Text undo leaves document history untouched;
canvas undo/redo restores layer names. Disabled descriptions and color errors pass.
Fixed an exact zoom-label lookup and scoped hidden profiler probe inputs in tests.
CDP changes DPR/query.matches without dispatching a monitor-change event; the
same-CSS-size density test explicitly supplies that notification and verifies the
backing buffer doubles. This is a simulated notification, not a physical monitor move.


## Completed implementation and validation — 2026-11-18

All three phases and all four acceptance criteria are complete. The original
outcome, scope, work, validation and next-step text remain above; checkboxes are
checked and implementation/evidence are appended. No separate sprint ledger or
SPRINT document was created. Strategy A stayed in this session; no agents or CLI
workers were delegated, and no commits were created.

### Implementation and decisions

- `src/editor/session.ts`, `store.ts`, `useStore.ts`: one session outside React,
  document/history ownership, cached targeted summary stores, independent transient
  UI/tool preferences, active-layer reconciliation, action enablement/reasons,
  command dispatch and shared success/error/committed-observer-failure feedback.
- `src/editor/focus.ts`, `viewport.ts`: event-target focus classification, shared
  text/IME-safe shortcut routing and CSS-pixel world conversion. Layer-name/hex
  drafts and annotation search remain local panel state. No document content is
  stored in React, and no React tile elements are created.
- `src/App.tsx`, `src/styles.css`, `src/MapCanvas.tsx`, `src/main.tsx`: responsive
  tools, color, layers, annotations, zoom and compact readouts; active/disabled
  state and accessible reasons; text input vs canvas ownership; rename/undo/redo,
  color input validation and area filtering; one stable session and disposable
  renderer with shared error reporting and retry.
- `src/editor/invalidation.ts`, `src/renderer/bindDocument.ts`: exact dirty
  layer/world rectangles, separate registry/annotation IDs, composition/bounds
  flags and no canvas invalidation for a layer name alone. Tile edits route
  directly from model to canvas, without document revision props in React.
- `src/renderer/createRenderer.ts`, `mountRenderer.ts`: shell boundary/origin
  geometry, shared viewport transform, ResizeObserver and re-armed DPR media query,
  density-aware backing buffer, disposal of subscriptions/listeners/GPU resources,
  canceled initialization and renderer error/retry lifecycle.
- `tests/domain/editor.test.ts`: eight added pure-controller regressions.
  `tests/editor.spec.ts`, `editor-harness.tsx`, `editor.html`: five added real-WebGL
  shell checks, with test-only session/invalidation capture and React Profiler
  panel probes. Existing renderer tests/harness updated for named canvas status
  and the new workspace width/session, retaining all teardown/failure coverage.
- [Editor shell decisions/API and validation](../docs/editor-shell.md), README,
  desktop development and performance guides document ownership, usage and scope.
  `package.json` adds the shell document to formatting commands. No dependency,
  lockfile, Rust/native permission, model/history algorithm or fixture changes.

Implementation choices: Inspect is initially active; the existing new-map default
remains one `Layer 1` in 256x256 bounds. Current color starts at #91BAA1 and is an
opaque six-digit tool preference. Shell zoom offers 50/100/200/400% with 24 CSS px
per tile at 100% and a 24px inset about the fixed origin. TW-008 owns anchored zoom,
pan and fit. Unimplemented drawing, selection, creation, metadata editing and
saving actions visibly explain why they are disabled. Saving never marks a
checkpoint without I/O. Metadata lists use a string name or stable ID without
inventing later feature schemas. Removed active layers fall back to the top
remaining layer. These choices are documented, not new product requirements.

### Acceptance evidence

1. **Resize/Retina:** browser checks cover 1200x800, 900x620, 640x480 and 640x452
   content viewports at DPR 1 and 2. The canvas matches its available host; backing
   dimensions equal CSS dimensions times DPR. The same CSS-relative point reports
   tile (3,4) at every size, and the transformed point remains (3,4) at 200% zoom.
   No horizontal/vertical document overflow or horizontal sidebar overflow remains.
   A density-only test doubles the backing buffer with fixed CSS bounds. CDP updates
   DPR/query matches but emits no resolution event, so that test explicitly emits
   the monitor-change notification; it is not a physical monitor-move measurement.
2. **Targeted updates:** a two-cell buildings edit sends exactly one canvas bridge
   invalidation with `[3,5) x [4,5)`, no composition/bounds/metadata invalidations,
   and retains the identical canvas element. Actual React Profiler updates are
   **0 tools, 0 colors, 0 layers, 0 annotations, 0 view controls**. Undo/history
   controls update. Renaming a layer updates the layer probe while the other four
   remain at zero. Unit tests separately assert unchanged cached snapshot identities,
   one history notification per edit, exact cross-boundary spans and undo/redo spans,
   targeted registry/annotation events and subscription disposal.
3. **Visible state and availability:** active Inspect/layer pressed state, zoom,
   current swatch/hex and unsaved status are visible. Disabled Pencil exposes the
   exact accessible reason. Undo/redo enablement follows history, and Save reports
   unavailable without changing the saved checkpoint. Invalid color text reports
   a shared alert; a valid color updates the preference without a document command.
4. **Focus/routing:** browser and native checks distinguish Text editing from
   Canvas keyboard. Text undo does not undo map commands; canvas Cmd/Ctrl+Z and
   Shift+Z restore/reapply layer rename. Enter commits a rename while preserving
   focus in the same input. IME, already-prevented events, editable roles and outside
   focus are guarded by the shared routing seam, ready for later shortcuts.

### Actual final validation

Machine: **TW-M1Pro-16**, Apple M1 Pro / arm64 macOS **15.8.1 (24H32)**;
Node **24.22.3** selected locally through PATH; existing Rust **1.100.0** pin.
No global toolchain or OS settings were changed.

Final combined log: `.wrk-runs/wrk-fbc58697-validation.log` (ignored local artifact).
Every command completed successfully after the fixes below:

- `npm run build`: both strict TypeScript configurations and Vite passed;
  **794 modules**, main asset `index-B1TKUYUW.js` **656.90 kB / 195.58 kB gzip**.
- `npm test`: **46/46 domain tests**, 0 failures/skips, **2809.268792 ms**;
  **8/8 browser tests in 8.0 s**. Complete representative model fixtures still
  match their existing golden content. Expected unavailable-WebGL error logging
  is followed by passing retry/disposal checks.
- `npm run format:check`: configured Prettier and Rust formatting passed.
- `npm run build:desktop`: release build passed; native compile **10.54 s**;
  `src-tauri/target/release/bundle/macos/Tilewrite.app`, **10.58 MiB**.
- `git diff --check`: passed. `wrk validate`: **Valid project: 56 tickets**.
- Final Python audit: **24 implementation/test/doc/config files** have final
  newlines, no trailing whitespace or developer-specific paths; local documentation
  links resolve. Production assets contain no `editorProbe` test global.
- `lsof -nP -iTCP:1420 -sTCP:LISTEN` returned no listeners for native validation.
  Existing Vite large-bundle and Playwright color-environment advisories remain
  non-failing; no warnings were suppressed.

Package-lock SHA-256:
`54acb86baa19877731ea3afdaa439712c696bbd91e6c27b9ade3dc71a632cc4a`

Final main JavaScript asset SHA-256:
`7b2da0fedaa9bf9d9381b30ccf018074827e74febd8c6194acafc74d7007d3fa`

### Actual packaged macOS observations

Launched the release `.app` directly, at `tauri://localhost`, with Vite stopped.
Native accessibility trees and Retina screenshots verified the complete shell,
Canvas ready, active Inspect/layer, 100% zoom, current color, disabled reasons and
one canvas. The initial 1200x800 window produced a 2400x1600 physical screenshot.
Resized to 900x620 and 640x480 (including the native 28px title bar). Final minimum
layout keeps both status lines visible, has no outer page scrollbar or clipped tool
labels, and scrolls the sidebars independently to expose color/annotation controls.
At the minimum size, clicking the CSS-relative tile center reports **Tile 3,4**;
resizing to 900x620 and clicking the same host-relative point still reports **3,4**.

Renamed Layer 1 to Terrain with Enter; native focus stays in the layer text field
and the readout says Text editing. Typing village in the area search and Cmd+Z
clears that text while Terrain remains the layer name. Clicking the canvas then
Cmd+Z restores Layer 1 and shows Canvas keyboard; Shift+Cmd+Z restores Terrain.
Quit/relaunch returned to Canvas ready with the expected fresh unsaved document.
These are WKWebView observations, separate from Chromium automation.

Native checks found and fixed three issues before completion: remounting the name
input lost focus; narrow tool columns clipped labels; the native title bar plus
a fixed CSS minimum height hid feedback. Also contained visually hidden disabled
help within its action element so it cannot create outer-page scroll overflow.
Regression coverage now checks retained input focus, sidebar overflow and 452px
content height. Pointer-down now updates the coordinate readout as well as focus.
All final validations above ran after these code fixes.

### Scope and handoff

No acceptance requirement is deferred. Canvas-region validation is the shell's
exact invalidation contract: the shell renders only boundary/origin geometry,
so tile edits do not repaint that geometry. TW-007 remains responsible for actual
sparse tile rendering, culling, color resolution and compositing. This ticket does
not claim rendered-tile correctness or target-scale GPU performance. Network was
not disabled and no physical monitor move was performed; no such claim is made.
No historical performance baseline was overwritten. No other ticket was worked
on. No blockers remain; the outer runner may select the successor.
