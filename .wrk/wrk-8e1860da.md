---
id: wrk-8e1860da
title: 'TW-019: Implement the adjustable-size pencil'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-13e3ba6a
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 19
  source: INTENT.md
---
## Outcome

Paint continuous freehand tile strokes with an adjustable footprint.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Intended experience.

**Execution order:** 19 of 54. Phase: painting.

**Prerequisite:** [wrk-13e3ba6a](wrk-13e3ba6a.md) — TW-018: Build the drawing gesture pipeline and tool previews.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose a conventional brush shape, size range, and even-size anchor rule; display the footprint preview.
- Interpolate pointer movement in tile coordinates to avoid gaps and deduplicate repeated writes.
- Paint the active layer using either a raw color or a selected registry identity.

## Acceptance criteria

- [x] A one-tile pencil and larger sizes paint the expected integer-cell footprint.
- [x] Fast diagonal and horizontal strokes remain continuous across chunk boundaries.
- [x] One stroke is one undo step, preserving overwritten content and all unaffected layers.
- [x] Brush size changes and edge clipping never expand the canvas or leave preview pixels in the document.

## Validation

- Test stationary dabs, fast strokes, even/odd sizes, edges, registry paint, and raw-color paint.
- Draw and undo terrain/building strokes in the packaged development app.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-020: Implement erasing and color/registry eyedropper sampling](wrk-c712564c.md).

## Implementation and acceptance audit — 2026-11-18

Executed sprint-execute Strategy A in this session, using WRK instead of a sprint
ledger. Verified prerequisite wrk-13e3ba6a is done; read the skill, AGENTS.md,
INTENT.md, README, ticket-runner and the referenced desktop, foundation, document,
history, editor, canvas, layer, color/registry, navigation, grid, rendering and
performance guidance. Fetched the skill weather report (gpt-6-astra listed for
CS/Math implementation); retained the requested in-session strategy. No workers,
separate Codex invocation or next ticket were used.

Completed phases and implementation/decision locations:

1. Brush geometry and command validation: `src/editor/pencil.ts` supplies square
   stamps, exact integer interpolation, bounded off-map traversal and the shipping
   DrawingTool. `tests/domain/pencil.test.ts` validates footprints, interpolation,
   raw/registered values, clipping, deduplication and complete undo/redo.
2. Controls and input/render integration: `src/editor/session.ts` registers the
   pencil in every session, owns validated transient size and routes B / [ / ].
   `src/App.tsx` exposes sizes and `src/MapCanvas.tsx` updates canvas help.
   `src/editor/drawing.ts` adds an optional tool hover footprint separate from
   gesture/history; `src/editor/navigation.ts` clears/suppresses it for navigation
   and refreshes stationary-pointer size changes. `src/renderer/createRenderer.ts`
   and `mountRenderer.ts` render/subscribe/dispose the separate hover overlay.
   `tests/pencil.spec.ts` and `tests/editor-harness.tsx` use the shipping adapter;
   `tests/editor.spec.ts` now expects Pencil enabled and Eraser still unavailable.
3. Final acceptance audit: full build/tests/format, packaged desktop build and
   WKWebView painting/undo observations, documentation and scoped Git review.
   Decisions and coverage are in `docs/drawing-gestures.md#adjustable-pencil-tw-019`,
   linked from README. No separate sprint document was created.

Acceptance evidence:

- Exact integer footprints: square sizes 1–32, default 1. Top-left offset is
  `-floor((size - 1) / 2)`. Odd sizes center on the pointed tile; even sizes add
  the extra row/column below/right. Stationary tests cover 1, 2, 3, 4, 31 and 32;
  native observations cover size 5 terrain and size 2 buildings. Hover and stroke
  previews display those same clipped cells.
- Continuous strokes: nearest-cell 8-connected interpolation (diagonal cells can
  meet at corners) includes both endpoints in every octant. Canonical major-axis
  ordering and positive minor-axis half-ties make reversal identical. Tests cross
  signed 32-tile storage and 64-tile visual boundaries from -64 through 129 with
  one fast horizontal/diagonal sample. Overlapping stamps and retracing produce
  unique staged cells. Very distant outside endpoints skip irrelevant major-axis
  positions without changing line phase, using exact integer arithmetic.
- One stroke, one undo: tests assert one transaction/invalidation and one undo
  step, exact overwritten/empty restoration, unchanged underlying terrain, and
  complete redo. Raw paint remains raw even when its bytes match Grass; explicit
  registry paint stores the Grass ID. Browser tests compare the entire canvas
  screenshot byte-for-byte before painting and after undo, and after commit/redo,
  at DPR 1 and 2. Metadata and fixed bounds are never commands in this tool.
- Size and clipping isolation: invalid sizes reject; valid size changes are view
  preferences and cancel pending strokes without consuming redo. Bounds remain
  unchanged at every edge and partial/signed corner. Same-color and outside-only
  gestures preserve history/checkpoints. Hover and accumulated preview leave
  document runs/version/history/invalidations unchanged before release. Escape,
  capture loss, navigation, overview and hidden-layer gates retain TW-018 behavior.
  Text/IME/modifier shortcuts cannot change the brush. No preview pixels enter
  tile or overview caches; the existing cache regression tests still pass.

Actual validation on MacBookPro18,3 / Apple M1 Pro / 16 GiB, arm64,
macOS 15.8.1 (24H32), Node 24.22.3, Rust 1.100.0:

- Phase 1: `npm run build`, `npm test` (101 domain + 59 Chromium tests, browser
  time 3.3 minutes), and `npm run format:check` — PASS.
- Focused integration: 18 tests passed; one new test initially timed out because
  its registry selector used “Choose Grass” instead of the actual accessible
  name “Paint with Grass”. Corrected the test. `npx playwright test
  tests/pencil.spec.ts` — PASS, all 3 tests in 5.7 seconds. No product workaround.
- `node --test tests/domain/pencil.test.ts` — PASS, 5 tests.
- Final `npm run build` — PASS, both TypeScript configurations and Vite.
- Final `npm test` — PASS, 102 domain and 62 Chromium/Playwright tests (3.4 minutes
  browser time), zero failures/cancellations/skips. Includes both complete populated
  6,400-square fixtures and all existing gesture/history/cache/lifecycle checks.
- Final `npm run format:check` — PASS, Prettier and Rust formatting.
- `npm run build:desktop` — PASS, locked release arm64 Tauri app, 10.61 MiB.
  A final rebuild after removing temporary diagnostics also passed, as did format
  and diff checks. The diagnostic statement was removed exactly; the shipped
  source is the same source that passed the full suite above.
- Native packaged smoke: copied the ordinary embedded-assets app outside the repo,
  verified no port-1420 listener, and launched at tauri://localhost with Canvas
  ready. On Terrain, painted a green #91baa1 5x5 stationary stroke. On Buildings
  above it, painted a gray #808080 2x2 stationary stroke at the same pointed tile.
  The building appeared above the terrain. One Undo Pencil removed only the gray
  footprint, revealing the complete green terrain; the next Undo Pencil emptied
  the canvas while preserving both layer names/order. The next undo label was
  Rename layer, confirming the two strokes were two steps. Also observed native
  size selection, hover geometry, Inspect measurement, and a fresh ready session
  after closing/reopening the first validation instance. Networking was not disabled.
- Visually inspected the DPR-2 diagonal preview screenshot and native footprint/
  layer/undo screenshots. `git diff --check` and `wrk validate` — PASS (57 tickets).

Native-input validation limitation: automated `app.drag` moves in WKWebView arrived
as `pointermove, buttons=0, button=-1, pointer=mouse, trusted=true`. A temporary
on-screen diagnostic established this; TW-018's existing missing-button guard
correctly canceled those gestures. The diagnostic is absent from the final source
and final app. Native smoke therefore verifies stationary terrain/building strokes
and their undo, not continuous native drag delivery or physical pen/mouse/trackpad
input. Continuous fast horizontal/diagonal strokes are verified through the real
Chromium pointer path and pure domain tests. No native continuous-drag pass is
claimed, and the cancellation guard was not weakened to accommodate automation.

Other limitations: staging still keeps sparse per-cell entries and coalesces on
samples; large gestures and commit remain synchronous. Rendering/presentation,
including the pre-existing >500 kB Vite warning, remain TW-049; large edit/history/
memory refinement remains TW-050 under AGENTS.md. No new latency, physical-memory,
or performance-budget pass is claimed. These are implementation decisions within
this ticket, not new confirmed product requirements.

Logs, native app path and body-update input are under ignored
`.wrk-runs/wrk-8e1860da-validation/`. Browser screenshots are under `test-results/`
with pencil-hover, pencil-stroke-preview and pencil-committed DPR 1/2 filenames.
Historical performance baselines were not changed.

All four acceptance criteria are met, with original requirements preserved above
and the native automation evidence limit explicitly recorded. The original
unstaged `.wrk/wrk-58cdb442.md` is unchanged (SHA-256
372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd) and excluded from
this ticket's commit. The initial index was empty. Only TW-019 implementation,
tests, documentation and this WRK update belong in the completion commit, whose
message includes wrk-8e1860da.
