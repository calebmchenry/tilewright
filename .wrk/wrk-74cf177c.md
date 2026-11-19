---
id: wrk-74cf177c
title: 'TW-048: Validate the complete drawing, rearrangement, and annotation session'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-d8dced1c
priority: normal
labels:
  - v1
  - release
  - verification
fields:
  sequence: 48
  source: INTENT.md
---
## Outcome

Prove success criteria 1 through 6 together and fix cross-feature regressions.

## Source and scope

**Source:** INTENT.md — First-version success criteria; INTENT.md — Drawing and rearranging; INTENT.md — Named areas and labels.

**Execution order:** 48 of 54. Phase: release.

**Prerequisite:** [wrk-d8dced1c](wrk-d8dced1c.md) — TW-047: Finish editor shortcut, focus, feedback, and usability integration.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Create/grow a fixed map, paint terrain/buildings, and use raw and named colors across separate layers.
- Move an 8 by 8 house three tiles with single-layer and chosen-multi-layer scope; overwrite destination content, then undo.
- Copy/paste/rotate/flip the house, label houses/village/region, zoom between tiers, and recolor grass.

## Acceptance criteria

- [x] Every starting drawing tool is exercised: sized pencil, eraser, eyedropper, fill, lines, and both rectangle modes.
- [x] The house movement restores original and overwritten content on undo while unrelated terrain remains unchanged.
- [x] All tile selection operations leave named areas/labels fixed; explicit annotation edits continue to work.
- [x] Grass recoloring propagates across visible/hidden/offscreen layers and overview images while preserving meaning.

## Validation

- Retain repeatable automated model/integration coverage plus a concise desktop walkthrough result.
- Compare full document state after undo/redo and record screenshots at close/locality/region views.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-049: Meet final populated-map rendering and navigation budgets](wrk-6e0d23e5.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session without delegation.
WRK state replaces the sprint ledger. Prerequisite wrk-d8dced1c is done.
Read sprint-execute, AGENTS.md, ticket runner, INTENT.md, README and relevant
foundation, desktop, editor, drawing, selection, annotation, registry, history,
canvas, navigation, overview and testing guidance. Fetched the weather report
(gpt-6-astra coding recommendation); retained requested in-session execution.

- [x] Phase 1: repeatable empty-map drawing and complete document history coverage.
- [x] Phase 2: composed UI sessions, rendered label tiers and recolored overview images.
- [x] Phase 3: native walkthrough, final regression and acceptance review complete.

### Implementation and decisions

- `tests/fixtures/complete-session.ts`: deterministic session through shipping
  controllers, starting at 128×128 with Terrain/Walls/Furniture. Twenty-one
  authoring transactions produce 6,814 occupied cells, two named colors, four
  complete named areas and a 6,464×6,464 canvas. Explicit growth admits negative
  coordinates and a distant meadow at (6016,6016). An asymmetric 8×8 house with
  erased door, filled interior and furniture has occupied movement destinations.
- `tests/domain/complete-session.test.ts`: both movement scopes; an independent
  cell oracle compares the complete populated document after a three-tile move;
  exact full-document snapshots after every authoring undo/redo and composed
  copy/paste/cut/rotation/flip undo/redo. Annotations remain fixed; explicit area
  geometry/description edits work; raw/registered identity and hidden/offscreen
  recolor resolution are checked. Snapshots include bounds, ordered layers, every
  run, registry and all area fields; monotonic revisions/transient UI state are
  intentionally excluded. Visibility remains the existing independent preference.
- `tests/complete-session.spec.ts`: two continuous mouse/keyboard sessions exercise
  every starting drawing tool, both house scopes, transformed paste, full undo/redo,
  explicit description editing and registry controls. Two additional DPR 1/2 cases
  assert actual rendered label IDs and exact WebGL pixels at 12, 1 and 0.5 CSS
  px/tile, near and distant, hidden/shown, after recolor/undo/redo. Cache checks warm
  both locations/resolutions before each action and revisit them BEFORE changing
  visibility, so a visibility refresh cannot mask registry invalidation defects.
- `tests/editor-harness.tsx`, `tests/tiles-harness.ts`: load the same authored
  session in the existing editor and renderer harnesses.
- `scripts/complete-session-fixture.ts`: emits an ordinary deterministic project
  for the desktop walkthrough, refusing to overwrite an existing destination.
- `docs/complete-session.md`, README, package formatting commands: repeatable
  checks, walkthrough, snapshot interpretation and explicit validation limits.
  `docs/evidence/tw048/` retains seven unedited native/Chromium close, locality,
  region and composed-session screenshots plus their SHA-256/size manifest.

No production code, project schema, native Rust or dependency change was needed.
The initial fixture's Storehouse is a destination annotation; the composed UI
session fills it with the transformed copy. Existing full selection-operation
independence/oracle and target-scale populated fixtures remain part of the suite.

### Phase validation and corrections

- Phase 1: build, 498/498 domain tests and formatting passed. The initial format
  invocation caught two newly edited harness files; they were formatted and the
  check passed. Logs: `phase1-build.log`, `phase1-domain.log`, `phase1-format.log`.
- Phase 2: strict TypeScript/Vite build passed. First UI iterations exposed test
  mistakes: brush size is a select, the tool readout displays hex while the color
  association shows meaning, and pixel sample positions overlapped label text.
  Corrected the tests/fixture sample positions without weakening pixel assertions.
  `phase2-ui-controls.log` passed 2/2 UI sessions; the renderer recheck passed both
  DPR cases. Final stronger cache validation passed all 4/4 new UI tests in 25.5s
  (`phase2-final-ui.log`). No observed product failure was hidden or bypassed.
- First full regression: `npm test` passed 498/498 domain and 156/156 Chromium UI
  tests (8.2 minutes, no failures/retries), log `final-test.log`. The stronger cache
  assertion was added during review; the final complete rerun passed below.
- `npm run build` and `npm run format:check` passed after the final test change;
  logs `final-build.log`, `final-format.log`.
- Native `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 31/31 passed.
  `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings` passed.
  Logs `final-rust.log`, `final-clippy.log`.
- Regenerated the project with `node scripts/complete-session-fixture.ts` and
  compared it byte-for-byte with the file opened natively: identical. The native
  walkthrough did not overwrite its source fixture.
- `git diff --check` and `wrk validate` (57 tickets) passed before finalization.

All logs and the source hash inventory are retained locally in
`.wrk-runs/wrk-74cf177c-validation/`.

### Native desktop walkthrough

Built the release Tauri app with pinned Node 24.22.3 and Rust 1.100.0 on macOS
15.8.1 arm64. Command:
`npx tauri build --config .wrk-runs/wrk-74cf177c-validation/tauri.walkthrough.conf.json --bundles app -- --locked`.
Build and app bundling passed (12.41 MiB). The overlay changes only product name,
identifier (`app.tilewright.tw048`) and window title/size, isolating test recovery.
Frontend and native production code remain unchanged.

Observed through actual WKWebView/AppKit UI:

- Created 128×128 map, grew left/top to 192×192, and exercised growth history.
  Opened `/tmp/tilewright-tw048.tilewright` through the native picker; all three
  layers, four annotations and 101×101 chunks appeared.
- Focused the house at 100%, verified 8×8 bounds/description, deselected it and
  observed ordinary house labels. At 12.5%, Willow Village replaced house labels;
  Fit showed Green Reach. Retained native screenshots for all three views.
- Named eyedropper selected Grass identity; 3×3 pencil, eraser, one-cell line,
  filled/outlined rectangles and a 36-cell fill committed. Six drawing undos
  returned to Saved. Three single-tile arrow nudges and three undos returned to
  Saved. Native copy/paste accepted rotation and flip before placement at (72,60).
- Explicit description Apply displayed new text with unchanged 8×8 area bounds.
  Registry editing changed Grass to #557755; undo restored #335C46 and an available
  Redo restored #557755 and the map appearance. A rapid Undo/Redo pair was briefly
  rejected with existing 'Finishing document action; try the edit again' feedback;
  retrying when available succeeded. No native async action is claimed completed
  merely from its initial key press.
- Closed the isolated validation app, discarded only disposable unsaved test
  changes, and verified it was absent from the running-app inventory.

Native held-drag injection canceled selection, as already recorded in TW-047.
No native 8×8 continuous-drag success is claimed. Exact house movement, overwrite
restoration and transforms are proved by model and Chromium pointer tests, with
existing DPR 1/2 gesture coverage; native clicks/keyboard/menu checks supplement
that evidence. This limitation does not weaken the functional assertions.

Performance remains the accepted working baseline: this small authored fixture
checks distant-coordinate integration, not representative population or budgets.
The full suite includes established complete populated maps. The Vite large-chunk
advisory remains; rendering/presentation refinement belongs to TW-049
(wrk-6e0d23e5), and large edit/history/memory refinement to TW-050 (wrk-e61b329b).
No additional ticket was executed or created.

The pre-existing `.wrk/wrk-58cdb442.md` edit is preserved outside the commit.

### Final acceptance review

- Final `npm test` on the strengthened tests: **498/498 domain and 156/156
  Chromium UI tests passed**, no failures or retries; UI elapsed 11.0 minutes.
  Log: `final-test-recheck.log`. All 192 files in `final-source.sha256` were
  verified unchanged afterward. Final production build and formatting passed;
  native 31/31 tests and Clippy results remain as recorded above.
- **All starting drawing tools:** controller-authored fixture plus both complete
  UI sessions exercise sized pencil, eraser, identity-preserving eyedropper,
  bounded fill, line, filled rectangle and outline rectangle. Native clicks and
  the 36-cell fill supplement the captured-pointer automation.
- **House movement and data integrity:** both scopes move the exact 8×8 house
  three tiles. The independent whole-document cell oracle checks overwritten
  destinations, the empty door, sparse furniture and every unrelated cell.
  Full document snapshots match after undo/redo; Terrain stays unchanged.
- **Annotation independence and explicit edits:** complete records stay fixed
  through composed selection operations and every history step; the existing
  operation matrix covers all live/paste variants. Explicit geometry/description
  commands and real UI Apply remain functional. Rendered tier IDs and retained
  native/browser screenshots confirm close/locality/region behavior.
- **Grass propagation:** stable Grass identity/meaning and unchanged raw paint
  are asserted across visible/hidden/offscreen layers. Actual WebGL readback
  verifies both cached overview resolutions before any visibility refresh, plus
  detailed and hidden/shown views after recolor/undo/redo.

All four acceptance criteria and the required repeatable automation, desktop
walkthrough, full undo/redo comparisons and three-view screenshots are satisfied.
The native drag-injection and deferred performance limitations are explicitly
recorded above. Only this ticket's implementation and WRK record are in commit
scope; the unrelated pre-existing ticket edit is preserved.