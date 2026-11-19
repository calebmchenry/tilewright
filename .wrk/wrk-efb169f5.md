---
id: wrk-efb169f5
title: 'TW-032: Add named-area browsing and scale inspection'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-dfb3bfaf
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 32
  source: INTENT.md
---
## Outcome

Make named areas discoverable and useful for navigating a large map.

## Source and scope

**Source:** INTENT.md — Intended experience; INTENT.md — Named areas and labels.

**Execution order:** 32 of 54. Phase: annotations.

**Prerequisite:** [wrk-dfb3bfaf](wrk-dfb3bfaf.md) — TW-031: Render zoom-dependent labels and annotation overlays.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Provide an area list/panel showing names and tiers with description editing or inspection.
- Add a conventional focus/reveal action for an area and show its bounds/dimensions in tiles.
- Keep annotation selection distinct from tile selection and synchronize panel/on-map feedback.

## Acceptance criteria

- [x] An author can find a house, locality, or region and navigate to its location from the panel.
- [x] Area names, descriptions, tier, and scale are inspectable even when that tier is hidden at the current zoom.
- [x] Focusing an area changes the view without moving tiles, changing its geometry, or dirtying the document.
- [x] Renaming/removal and undo update the list without stale references or accidental tile selection.

## Validation

- Navigate among distant populated areas in the large fixture and inspect dimension readouts.
- Verify selection independence and panel consistency through rename/delete/undo.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-033: Specify the versioned editable-project schema and persisted settings](wrk-eef53dd9.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), executed in this Codex session using WRK state.
Prerequisite wrk-dfb3bfaf is done. Read sprint-execute, AGENTS.md, INTENT.md,
README, ticket-runner and relevant named-area, navigation, editor, coordinate,
history, scale, development and testing guidance. Weather report fetched:
gpt-6-astra for CS/Math and opus-5.5 for frontend architecture; no delegation.
Node 24.22.3 matches the pin; build/test/format/desktop commands are available.
Recent commits use descriptive prefixes and ticket IDs. The initial index is
empty; unrelated .wrk/wrk-58cdb442.md is snapshotted and excluded.

Working checklist:
- [x] Implement focus/reveal and persistent scale inspection with domain checks.
- [x] Validate actual panel navigation on both populated large fixtures and
      rename/delete/undo consistency, including independent tile selection.
- [x] Audit all acceptance criteria, build/test/format/release checks, document
      decisions and actual evidence, then mark done and create scoped commit.

Decisions: retain the existing searchable name/tier list and explicit area editor.
Focus centers and fits the selected outline with the existing Fit padding, capped
at 100% for small areas. Valid draft geometry may be inspected without applying;
focus retains the draft and cancels an armed bounds gesture. Invalid bounds or an
unready canvas disable focus with a reason. Inspection always shows exact tile
bounds and width × height, independently of label visibility. Performance-only
limitations remain deferred to TW-049/TW-050 under AGENTS.md.


Phase 1 evidence:
- `npm run build`: PASS. Existing >500 kB bundle warning remains; no budget pass claimed.
- `npm run test:domain`: PASS, 241 tests, including three new browsing checks.
- `npm run format:check`: PASS (Prettier and rustfmt).
- Full existing browser suite is in progress; no failure observed at this checkpoint.
- `npm run build:desktop`: PASS, release macOS .app (10.63 MiB).
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: PASS (0 Rust tests).
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`: PASS.

Native release smoke on macOS 15.8.1 (24H32), arm64:
- Copied the fresh bundle outside the checkout to a unique temporary
  Tilewright TW-032.app, changed only the copy's identity/name and ad-hoc signed it.
  Existing Tilewright windows were untouched; copy path is in native-app-path.txt.
- CUA accessibility observed `tauri://localhost` and Canvas ready. Created Far
  house (Detail), bounds [240,248) × [240,248), description exactly
  “Forge downstairs.\nHome upstairs.” Focus revealed it at 100%, centered with
  purple bounds and readable selected label. Full description, exclusive bounds
  and 8 × 8 tiles were visible in the panel. Undo remained Create area after Focus.
- Visually inspected the native screenshot in tool output. This is a bundled
  WKWebView smoke on an empty tile map, not populated-map performance or a
  physical-input/offline-network test. Vite was running for concurrent browser
  validation; the observed native origin was the bundled origin. No saved native
  screenshot file is claimed. Large-map correctness is validated separately.

Focused browser checks are being added for all three tiers and distant locations
on both golden populated maps, filtered rename/delete/undo, label-to-panel feedback,
real tile-selection independence, valid drafts, invalid focus and minimum-window
layout. Initial typecheck of that test caught Playwright's recursive JsonValue
inference for tier; pass its string value explicitly, then rerun the build.


Phase 1 complete: full existing browser suite PASS, 111 tests (6.4 minutes).
No regression failure. Build after the new-test type correction also passed.
Phase 2 now uses test-only `areas-frontier` / `areas-heartland` adapters, populated
before EditorSession/history construction, with 1,089 valid named areas each.
The main app uses the unchanged production initialization path.


Phase 2 focused evidence:
- `npx playwright test tests/area-browsing.spec.ts`: first run 3 passed / 1 failed.
  The test expected tile selection to survive Undo, contradicting the existing
  `docs/selection-decisions.md` contract and shared `EditorSession.perform` route.
  Corrected the expectation: rename/focus retain the independent idle selection;
  shared Undo clears it and area restoration never recreates it. No product
  behavior change was needed. Rerun: all 4 PASS (18.9 seconds).
- Both complete 6,400 × 6,400 populated maps pass actual case-insensitive search,
  select, inspect at a hidden tier, Cancel, keyboard Focus and repeated Focus.
  Frontier has 6,620,700 occupied layer cells; heartland has 24,025,200. Both have
  1,089 areas. Visits cover house [268,276)², locality X[6016,6144) Y[5376,5504),
  region X[0,640) Y[5760,6400), and house X[6124,6132) Y[5484,5492).
  Readouts are 8×8, 128×128, 640×640, 8×8 tiles. Center and every edge are asserted
  against the real canvas size; repeat Focus is deterministic, small areas cap at
  100%, button keyboard focus remains in the panel and no tile selection appears.
- All records, bounds, layers, registry, storage counts, version, history and
  saved/recovery state remain identical through large-map browsing; zero document
  invalidations and zero page errors. Descriptions remain full multiline text.
- Actual canvas drag creates an 8×8 tile selection through the house label;
  clicking the label in Area mode synchronizes the panel. Filtered rename updates
  rows/details; Undo/Redo show current records; Delete clears selection/overlay,
  undo restores the exact ID unselected, and reselection/focus uses current data.
  Final suite also checks exact small-fixture tile runs and captures both overlays.
- Valid drafts retain name/geometry while focusing; invalid geometry disables
  Focus with an accessible reason. 640×452 layout exposes the exact 1088×1088
  region readout with signed bounds and no horizontal overflow.
- Visually inspected frontier house/locality/region, heartland distant house and
  minimum-window screenshots: readable selected names, purple bounds, correct
  populated locations, descriptions/dimensions and unchanged Saved indicator.
  Focused JSON and PNG artifacts are in focused-artifacts/ beneath the validation
  directory. These are Chromium correctness checks, not native performance claims.

Final validation is running. An initial attempt to pass --output through `npm test`
was parsed by nested npm as a test-file filter, so the UI phase reported “No tests
found”; the domain phase passed. Retained its log as final-tests-invocation-error.log
and restarted the exact documented `npm test` command without extra arguments.


Implementation / decision locations:
- `src/editor/viewport.ts`: pure `focusOnBounds` centers/fits with the existing
  camera transform and a 100% magnification cap.
- `src/editor/session.ts`: `revealBounds` validates contained bounds and routes
  only through the transient viewport/pointer stores; no document command.
- `src/editor/annotations.ts`: `focusReason`/`focus` validate readiness and current
  identity, retain valid draft fields, cancel armed drawing, reject invalid bounds.
  `overlayBounds(false)` excludes an active pointer preview when validating focus.
- `src/AnnotationPanel.tsx`, `src/styles.css`: Focus area with disabled reasons,
  exact width × height after Apply/Cancel and explicitly half-open tile bounds.
  Existing searchable name/tier/ID list and notification-driven editing are reused.
- `tests/domain/area-browsing.test.ts`: three domain checks covering geometry,
  data/selection/checkpoint independence, draft and stale/unready/disposed guards.
- `tests/area-browsing.spec.ts`, `tests/editor-harness.tsx`: four real-browser
  checks with complete populated fixture adapters, all tiers and distant locations,
  actual mouse selection/label clicks, filtered lifecycle and minimum window.
- `docs/named-area-decisions.md#browsing-and-scale-inspection-tw-032`, README:
  discoverability, focus geometry/draft behavior, exact scale, existing Undo tile
  deselection policy, implementation/test locations and performance limitations.

Final build and formatting pass. Final domain suite passes 241 tests (4.4 seconds).
The final 115-test browser suite has passed all four new checks and is continuing.
Reviewed the new independent-selection screenshot: the renamed area matches the
panel and centered outline while the retained tile selection covers the same 8×8
footprint; exact tile runs are unchanged. Local Markdown file targets pass and
`git diff --check` passes. `wrk validate` passes (57 tickets). Unrelated ticket
bytes match the initial snapshot; no unrelated files are staged.


## Final acceptance audit and validation — 2026-11-18

All four acceptance criteria are met:
- Find/navigate house, locality and region: real panel search/select/keyboard Focus
  on both complete golden maps visits distant populated locations with exact fit.
- Inspect every field/scale at hidden tiers: full name/description/tier, signed
  bounds and dimensions are checked before Focus, including the read-only panel.
- Focus is transient: complete domain tile runs/metadata and history/checkpoints
  remain unchanged; large-map version/state and zero document events are verified.
- Rename/removal/Undo stay current: stable IDs, filtered rows, details, on-map
  feedback and deletion/restore are tested. Focus/rename retain idle tile selection;
  existing global Undo clears it, and no area action accidentally creates one.

Final commands on the final source:
- `npm run build`: PASS (strict TypeScript + Vite).
- `npm test`: PASS, 241 domain tests (4.4 s), 115 Chromium/WebGL tests (6.4 min).
- `npm run format:check`: PASS, Prettier and rustfmt.
- `npm run build:desktop`: PASS on the same final production source. Only test
  additions and documentation changed after that build/native smoke.
- Rust test and Clippy: PASS as recorded above; Rust has zero unit tests.
- README/named-area Markdown file targets: PASS.
- `git diff --check`: PASS; `wrk validate`: PASS, 57 tickets.

Final logs and copied screenshots/reports are retained under
`.wrk-runs/wrk-efb169f5-validation/` (ignored validation artifacts), including
`final-build.log`, `final-tests.log`, `final-format.log`, `desktop-build.log`,
`rust-test.log`, `rust-clippy.log`, `focused-artifacts/` and `final-artifacts/`.
Native screenshot observation is recorded above; it was not saved as a PNG.
The initial unrelated `.wrk/wrk-58cdb442.md` edit remains byte-identical and is
excluded from the commit. The initial Git index was empty.

No blocker or unresolved functional failure remains. The existing bundle warning,
synchronous list/label work, and lack of new native presentation/physical-memory
measurements do not claim a performance pass; refinement remains TW-049/TW-050
as authorized. Scope is only TW-032. All implementation, decisions and validation
are complete; mark done and create the requested scoped commit containing this
WRK record before reporting completion.
