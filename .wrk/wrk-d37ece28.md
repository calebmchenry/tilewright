---
id: wrk-d37ece28
title: 'TW-021: Implement straight lines and filled/outlined rectangles'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-c712564c
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 21
  source: INTENT.md
---
## Outcome

Create precise geometric terrain and building footprints.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging.

**Execution order:** 21 of 54. Phase: painting.

**Prerequisite:** [wrk-c712564c](wrk-c712564c.md) — TW-020: Implement erasing and color/registry eyedropper sampling.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement integer-tile line rasterization and filled/outlined rectangle tools using preview/commit gestures.
- Document endpoint inclusion, outline thickness, and whether brush size affects these tools.
- Support all drag directions, raw/registered colors, and bounded clipping.

## Acceptance criteria

- [x] Horizontal, vertical, diagonal, and single-point lines have predictable contiguous tile coverage.
- [x] Filled and outlined rectangles handle reverse drags, one-cell widths/heights, and an 8 by 8 footprint correctly.
- [x] Previews match committed cells, and each shape is a single undoable command.
- [x] Shapes can cross chunks while affecting only the active layer and fixed map bounds.

## Validation

- Compare rasterized cell sets for edge cases and reverse drags.
- Draw terrain and a house outline, undo/redo each, and inspect overwritten-cell restoration.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-022: Implement bounded, responsive flood fill](wrk-3af2d9eb.md).

## Execution progress — 2026-11-18

Strategy A selected by user; execution stays in this session and WRK is the sprint
record. Prerequisite wrk-c712564c is done. Read sprint-execute, AGENTS.md, INTENT.md,
README, ticket runner and relevant development, drawing, model/history, coordinate,
editor, canvas, layer, color, navigation and validation guidance. Weather report
fetched: gpt-6-astra leads its CS/Math row; no delegation/model switch is needed.

Phase checklist:
- [x] Integer shape geometry, documented decisions and domain tests.
- [x] Shipping controls, pointer integration and real-canvas tests.
- [x] Full acceptance audit, packaged validation, WRK evidence and scoped commit.

Initial unrelated work: unstaged `.wrk/wrk-58cdb442.md`, SHA-256
`372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd`; index empty. Preserve and exclude it.

Phase 1 passed: production build, 112 domain tests, 67 browser tests, and format
check. Initial new-test compile errors (unused type and incorrect registry test
API/value narrowing) were fixed before that passing run. Geometry is implemented
in `src/editor/shapes.ts`; decisions in `docs/drawing-gestures.md#lines-and-rectangles-tw-021`;
new coverage in `tests/domain/shapes.test.ts`.

## Final implementation and acceptance audit — 2026-11-18

All three phases and all four acceptance criteria are complete. Strategy A stayed
in this session; no sprint ledger, worker, separate Codex execution or next-ticket
work was used. The original ticket requirements are retained above.

Implementation and decisions:

- `src/editor/shapes.ts`: bounded integer `lineSpans` and `rectangleSpans`, and
  shipping Line/Rectangle drawing adapters. Line reuses the pencil's exact
  nearest-cell rasterizer with size 1, canonical ordering and positive-minor
  half-ties. Both endpoints are included; lines are 8-connected (diagonal cells
  may touch at corners). Rectangle endpoints normalize inclusively in every drag
  direction. Filled paints the entire footprint; Outline paints the one-tile
  inside perimeter, with thin dimensions and corners deduplicated.
- Shapes ignore brush size. Clip original geometry before sparse staging, keeping
  the line's phase and never introducing an outline on an artificial clipped
  edge. Huge off-map coordinates skip irrelevant rows/columns; no map growth.
- `src/editor/session.ts`: registers both tools, supplies L/R canvas shortcuts
  and a validated transient rectangle-style preference, default Filled.
  `src/editor/drawing.ts`: style changes cancel an active preview. Existing
  pointer capture, readiness/visibility/overview gates, replacement staging,
  atomic history and renderer invalidation remain the shared pipeline.
- `src/App.tsx`: enabled Line/Rectangle controls, Filled/Outline selector and
  endpoint/thickness/brush-size help. `src/MapCanvas.tsx`: accessible shortcuts
  and geometry help. No shape hover stamp; dragging shows the exact affected
  cells through the existing translucent overlay above all layers.
- `docs/drawing-gestures.md#lines-and-rectangles-tw-021` documents geometry,
  cancellation, selected raw/registered identity, fixed bounds and limits; README
  links it. `tests/editor-harness.tsx` exposes the ordinary drawing fixture with
  shipping tools; `tests/editor.spec.ts` verifies enabled controls.

Acceptance evidence:

1. `tests/domain/shapes.test.ts` has six cases. Exact horizontal, vertical,
   diagonal, tie and single-point golden sets pass in both directions. All 289
   endpoints in [-8,8] squared verify endpoint inclusion, count, reversal and
   8-neighbor connectivity. Clipped line sets equal filtered original geometry,
   retaining phase, including extreme safe-integer endpoints.
2. Both rectangle modes match an independent per-cell predicate for widths and
   heights 1/2/8 in every drag direction. An 8x8 Filled footprint is 64 cells;
   Outline is 28. One-cell axes are solid and clicks are single cells, without
   duplicates. Clip-versus-filter comparisons cover all edges and corners;
   an enclosing off-map outline yields no invented map-edge walls.
3. Domain tests replace intermediate endpoints and compare the complete preview
   cell set with the eventual stored values. Each raw/registered Line, Filled and
   Outline commit emits one event and one undo command. Whole-document before/
   after runs verify exact overwritten raw/registered/empty restoration and redo.
   No-op, cancellation and identical repaint preserve redo/checkpoints; preview
   leaves version/history/content unchanged. Registered shapes retain IDs through
   recoloring. Hidden targets, overview, readiness, text/IME/modifier routing,
   transient style cancellation and fresh-session reset are covered.
4. Domain shapes cross signed 32-cell storage and 64-cell visual boundaries;
   every cell of the active layer is compared with the expected result, including
   untouched cells. Underlying runs and fixed bounds stay unchanged. Browser tests
   draw registered 8x8 terrain and a raw reverse-dragged house outline across
   x=64/y=64, undo/redo each, compare complete stored runs, and assert exact full
   canvas screenshot equality after undo and redo at DPR 1 and 2. Existing raw
   terrain and registered building cells are restored, including overwritten
   house-edge cells. Preview shrinking leaves no trail. Additional shipping tests
   verify Line's original anchor, release-only endpoint and size-32 independence,
   thin/click rectangles, corner clipping, outside no-ops, Escape/style cancellation,
   disabled hidden-layer tools and the 640x452 layout. Inspected the DPR-2 house
   preview and committed terrain/house screenshots visually as well.

Actual validation on MacBookPro18,3 / 16 GiB / arm64, macOS 15.8.1 (24H32),
Node 24.22.3 and Rust 1.100.0:

- Phase 1: `npm run build`, `npm test` (112 domain + 67 Chromium cases), and
  `npm run format:check` passed. Initial new-test TypeScript errors were corrected
  before proceeding, as recorded above.
- Phase 2 focused run: 7 passed, 2 failed due to new assertions comparing monotonic
  version/invalidation counters against the snapshot before undo/redo. Corrected
  the tests to capture the post-redo snapshot immediately before house preview;
  no product fix was needed. Rebuilt successfully, then
  `npx playwright test tests/shapes.spec.ts` passed all 4 cases (8.0 seconds).
  All 5 editor-shell cases passed in the initial focused run.
- Final `npm test`: PASS, **113 domain + 71 Chromium/Playwright cases**, zero
  failures, cancellations or skips. Browser suite 3.9 minutes; includes complete
  populated target maps and all drawing, history, registry, layer, rendering,
  cache, lifecycle and React subscription regressions.
- `npm run format:check`: PASS (Prettier and Rust formatting).
- `npm run build:desktop`: PASS, locked arm64 release Tauri app, 10.61 MiB;
  repeated production TypeScript/Vite build also passed.
- Native packaged smoke: copied the ordinary embedded-assets app using `ditto`
  into a fresh temporary directory outside the checkout. WKWebView opened
  `tauri://localhost`, Canvas ready, and enabled Line/Rectangle. Filled and Outline
  single-cell clicks painted #91baa1 at (2,2). Selected Outline through the native
  selector; undo removed its cell and redo restored it. A #808080 Line click
  overwrote the same cell; Cmd+Z visibly restored green and Cmd+Shift+Z restored
  gray. R selected Rectangle and preserved Outline. Native window zoom resized
  the canvas and preserved the gray tile. Cmd+W exited (the subsequent AX read
  returned procNotFound). After the full tests ended, `lsof` found no listener on
  port 1420; reopening the copied package showed a fresh Canvas ready and enabled
  shape tools without a development server.
- `git diff --check` and `wrk validate`: PASS (57 tickets). The unrelated ticket
  retains the initial SHA-256 above; the index remained empty before scoped staging.

Validation limits and deferred work:

Native click/key/selector/resize/lifecycle observations are distinct from Chromium
pointer drags. Two native automation drag attempts produced focus but no drag
edit; continuous native/physical mouse, pen and trackpad coverage is not claimed.
All shape drag algorithms and the shipping capture/release route are covered by
domain and real Chromium input tests. Networking was not disabled; the stopped-
server package restart is not a network-disabled test. No new performance budget
pass is claimed. Existing per-cell sparse preview staging, synchronous history
and large-footprint memory/time refinement stay with TW-050; preview presentation
and the existing Vite >500 kB bundle warning stay with TW-049 under AGENTS.md.
Historical performance baselines were not changed.

Logs, body-update inputs, native copy path and environment record are under
ignored `.wrk-runs/wrk-d37ece28-validation/`. Browser screenshots are under
`test-results/shapes-*`; native observations are in this session's tool transcript.
The completion commit includes only this ticket's code, tests, decisions and WRK
record, and includes wrk-d37ece28 in its message. Unrelated staged/unstaged work
is excluded and preserved.
