---
id: wrk-13e3ba6a
title: 'TW-018: Build the drawing gesture pipeline and tool previews'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-8110dbc9
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 18
  source: INTENT.md
---
## Outcome

Share reliable input, previews, clipping, and history behavior across drawing tools.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Chosen technology.

**Execution order:** 18 of 54. Phase: painting.

**Prerequisite:** [wrk-8110dbc9](wrk-8110dbc9.md) — TW-017: Recolor registered entries across layers, history, and overview caches.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement pointer capture, tile-coordinate sampling, active-layer targeting, preview overlays, commit, and cancellation.
- Separate navigation gestures from editing and prevent panel/text input from drawing on the canvas.
- Use batched sparse cell changes and one command per completed gesture.

## Acceptance criteria

- [x] A drag that leaves the canvas, loses capture, or is canceled has documented and consistent commit/cancel behavior.
- [x] Previews do not mutate saved document state, and no-op/canceled gestures do not dirty the document.
- [x] Tools clip safely to fixed map bounds and operate across chunk boundaries.
- [x] Undo restores all affected cells, and overview zoom follows the editing policy defined in navigation.

## Validation

- Test pointer-cancel, Escape, canvas exit, rapid movement, zero-length gestures, and edge clipping.
- Verify a gesture produces one history entry and targeted render/cache invalidation.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-019: Implement the adjustable-size pencil](wrk-8e1860da.md).


## Implementation and acceptance audit — 2026-11-18

Executed sprint-execute Strategy A (Orchestrated), phase by phase in this session
without workers or a separate CLI. WRK replaces the sprint ledger; prerequisite
wrk-8110dbc9 was verified done. Read the requested skill, AGENTS.md, INTENT.md,
README, ticket-runner and relevant foundation, desktop, document/history, editor,
navigation, layer/color/registry, grid, tile/overview and performance guidance.
Fetched the skill weather report (gpt-6-astra listed for CS/Math implementation);
retained the requested in-session strategy. Only TW-018 was executed.

Completed phases and implementation locations:

1. Transient gesture/controller and domain validation: `src/editor/drawing.ts`
   provides the feature-tool adapter contract, immutable context/samples, sparse
   last-write-wins staging, safe span validation/clipping, append/replace preview
   modes and a single batched tiles command through DocumentGesture.
   `src/editor/session.ts` owns registration, action readiness and lifetime.
   `tests/domain/drawing.test.ts` verifies complete state/history isolation and
   exact undo across signed/partial bounds, storage/visual chunks and layers.
2. Canvas integration and preview rendering: `src/editor/navigation.ts` remains
   the single pointer/navigation router, including capture, coalesced samples,
   release endpoint, cancellation and focus filtering. `src/App.tsx` and
   `src/MapCanvas.tsx` expose registered tool availability/pressed state/help.
   `src/renderer/createRenderer.ts` draws a separate culled Pixi overlay;
   `mountRenderer.ts` owns its subscription and cleanup. `tests/drawing.spec.ts`,
   `tests/fixtures/drawing.ts` and the editor/tiles harnesses exercise actual
   input/controller/WebGL paths. `docs/drawing-gestures.md` records decisions,
   contracts, lifecycle and limits, linked from README/navigation/layers and
   included in the formatting commands.
3. Final validation and delivery audit: built frontend and packaged app, ran
   complete domain/browser tests, inspected the preview screenshot and native
   app, checked formatting/docs/WRK/Git and preserved the unrelated ticket edit.

Acceptance evidence:

- Capture/exit/cancel: captured canvas exit continues staging; primary release
  outside the host samples its endpoint and commits once. Pointer-cancel, actual
  releasePointerCapture loss, Escape, host/window blur, missing primary buttons,
  capture failure, teardown and context changes discard all staged paint and
  release capture. Normal capture release after commit cannot cancel that edit.
  Secondary pointers cannot cancel/finish the primary drawing gesture. Browser
  tests verify the behavior and exact before/after persisted state.
- Preview/no-op isolation: previews are frozen sparse runs outside MapDocument,
  history, saved/recovery checkpoints and React. Mid-drag snapshots preserve
  content, bounds, version, history, storage and notifications. Same-color clicks,
  entirely outside footprints and canceled gestures preserve clean saved state
  and the redo branch. Shape replacement removes its old footprint; raw and
  registered values stay distinct and erasure is null on the target layer.
- Bounds/chunks: candidate spans clip before allocation, never clamp to an edge
  or grow the map. Tests cover entry from negative outside margin, all four
  clipping sides and exclusive partial edges, rapid/coalesced movement and
  release without a preceding move. An 8x8 footprint at [60,68)² spans four
  visual chunks, writes 64 registered cells, preserves 64 underlying cells and
  registry/annotation metadata, and undoes exactly.
- History/invalidation/overview: one completed effective gesture produces one
  tiles command, one transaction and one undo step. Overwritten and formerly
  empty cells restore exactly. WebGL DPR 1/2 tests show zero tile queries, detail
  builds or uploads during preview; a crossing at x=64 rebuilds exactly two
  affected target-layer detail chunks. Only one retained overview region rebuilds
  on return, with no preview pixels baked into caches. Undo/redo restore actual
  pixels, including underlying terrain after erasure. The existing 8 CSS px/tile
  gate blocks drawing at overview scale; navigation and history remain usable.
  Hidden targets cannot begin, and changing layer/visibility cancels a preview.

Implementation choices within scope:

- Tool algorithms, adjustable sizes and shortcuts remain TW-019 onward. Feature
  modules register synchronous adapters before mounting controls; test-only
  adapters exercise the complete production pipeline without shipping a partial
  pencil or starting the next ticket. Shipped drawing buttons remain unavailable
  until their feature adapters are installed. No separate sprint file was created.
- A preview shows the affected footprint above all layers, using 55% paint tint
  with white outline or faint red erasure fill/outline. It is not an exact final
  composite when other layers cover the target. Registration identity is resolved
  directly; there is no RGB-to-registry inference.
- A primary gesture can start in canvas margin outside the map, enter it and
  clip normally. Inspect keeps its existing inside-map start rule. Wheel is
  ignored during drawing; Space or WebKit pinch start cancels drawing before
  navigation. No auto-pan or automatic canvas growth is added.

Actual validation (MacBookPro18,3 / Apple M1 Pro / 16 GiB, arm64,
macOS 15.8.1 build 24H32, Node 24.22.3, Rust 1.100.0):

- Phase 1 `npm run build`, `npm test` (96 domain + 51 Chromium, 3.1 minutes
  browser time), and `npm run format:check` — PASS. Initial focused assertions
  were corrected to compare copied colors by value and expect separate net
  notification spans where original cell values differ; no product defect.
- Focused integration: `npx playwright test tests/drawing.spec.ts
  tests/navigation.spec.ts tests/grid.spec.ts` — PASS, 15 tests in 23.4 seconds.
- Expanded domain: `node --test tests/domain/drawing.test.ts` — PASS, 5 tests,
  including registered-paint/four-chunk/erasure coverage.
- Final `npm run build` — PASS, both TypeScript configurations and Vite.
- Final `npm test` — PASS, 97 domain tests and 59 Chromium/Playwright tests
  (3.3 minutes browser time), zero failures/cancellations/skips. Includes both
  complete populated 6,400-square fixtures and existing history/cache/lifecycle
  regressions. Unavailable-WebGL logging is expected in its successful retry test.
- Final `npm run format:check` — PASS, Prettier and Rust formatting.
- `npm run build:desktop` — PASS, locked release arm64 Tauri build, 10.61 MiB
  .app. Copied with ditto outside the repository, confirmed no port-1420 listener,
  then launched. Native WKWebView at tauri://localhost showed Canvas ready.
  Inspect drag produced a 6x5 measurement; Escape cleared it; H/Pan drag and F
  worked, showing Fit at 8.77% and the 8-pixel overview editing message. Undo/redo
  remained unavailable after these view-only actions. Native window zoom resized
  from 2400x1600 to 3024x1888 screenshot pixels with Canvas ready. Cmd+W closed
  the process (procNotFound on observation); reopening showed a fresh 100%
  Inspect map and Canvas ready. Networking was not disabled.
- Visually inspected the DPR-2 drawing preview screenshot and native detail/Fit
  views. Local documentation target audit — PASS, 32 relative targets across
  changed guides/README. `git diff --check` and `wrk validate` — PASS (57 tickets).

Limitations: sparse staging stores one Map entry per candidate cell and sorts/
coalesces per sample; preview updates and commit remain synchronous. Very large
footprints can consume substantial temporary memory/time. These refinements
remain TW-050; rendering/presentation and the pre-existing >500 kB Vite bundle
warning remain TW-049. No new performance budget, native presented-frame latency,
physical-memory or physical pen/trackpad-delivery pass is claimed. Native smoke
exercises lifecycle and shared navigation/Inspect routing; drawing adapters are
validated in Chromium and domain tests until the shipping tool tickets install
them. These limitations do not block functional delivery under AGENTS.md.

Logs, body-update inputs and packaged-app location are under ignored
`.wrk-runs/wrk-13e3ba6a-validation/`; Playwright screenshots/results are under
`test-results/`. The screenshot filenames include drawing-preview-dpr1.png and
drawing-preview-dpr2.png. Automated checks and this tracked audit retain the
functional evidence; historical performance baseline reports were not overwritten.

All four acceptance criteria are met. Original ticket requirements are preserved
above with acceptance boxes checked. The initially unstaged unrelated
`.wrk/wrk-58cdb442.md` remains byte-for-byte unchanged (SHA-256
372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd) and is excluded
from the ticket commit. The initial index was empty. The completion commit includes
only TW-018 implementation, tests, documentation and this WRK update, with
wrk-13e3ba6a in its message.
