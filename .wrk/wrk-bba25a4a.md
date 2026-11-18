---
id: wrk-bba25a4a
title: 'TW-009: Add tile grids, emphasized 64-tile chunk boundaries, and scale readouts'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-58cdb442
priority: normal
labels:
  - v1
  - canvas
  - implementation
fields:
  sequence: 9
  source: INTENT.md
---
## Outcome

Make individual cells, chunk boundaries, and region dimensions easy to assess.

## Source and scope

**Source:** INTENT.md — First-version scope; INTENT.md — Intended experience; INTENT.md — Map size and navigation.

**Execution order:** 09 of 54. Phase: canvas.

**Prerequisite:** [wrk-58cdb442](wrk-58cdb442.md) — TW-008: Implement pan, anchored zoom, fit-to-map, and coordinate conversion.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Render ordinary tile lines and distinguish boundaries every 64 tiles using color or line weight.
- Keep grid overlays aligned with the coordinate contract and readable at relevant zoom levels.
- Show map dimensions, cursor tile position, and selected rectangle size when available; communicate scale in tiles/chunks.

## Acceptance criteria

- [x] Tile lines align with tile edges at multiple zoom levels and Retina scales, including non-multiple-of-64 map bounds.
- [x] Chunk lines are visibly distinct; dense distant lines adapt to zoom without obscuring overview content.
- [x] An 8 by 8 footprint can be measured in tiles, and chunk boundaries do not constrain drawing or movement.
- [x] Overlays do not mutate map data or become exported tile content.

## Validation

- Verify overlays at coordinates around 0, 63, 64, 127, and map edges.
- Inspect detail and overview screenshots against the same known-dimension fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-010: Implement cached overview rendering and coherent cache invalidation](wrk-c22d70cf.md).

## Execution — 2026-11-18

Strategy A, executed in this session; WRK replaces the sprint ledger. Prerequisite
wrk-58cdb442 is marked done. Its pre-existing uncommitted status change is preserved
and excluded from this ticket's commit. Read AGENTS.md, sprint-execute, INTENT,
README and the referenced project guidance. Weather report fetched (gpt-6-astra
for CS/math; Opus 5.5 for frontend architecture); no delegation or model switch.
Node 24.22.3 is active. No repository commit convention; final commit is requested.

- [x] Phase 1: adaptive, viewport-bounded tile/chunk grid and pixel alignment tests.
- [x] Phase 2: tile/chunk readouts and transient Inspect rectangle measurement.
- [x] Phase 3: known-fixture detail/overview screenshots, full validation, acceptance
  audit and WRK completion. Final scoped commit required below.

Implementation choice: Select/drawing/movement tools belong to later tickets.
Inspect drag will measure a rectangle without editing tiles, so the 8×8 scale
example is usable now; a transient rectangle display seam supports later tools.

Phase 1 validation passed: build, 58 domain tests, 18 browser/WebGL tests
(47.0 s), formatting. Logs: `phase1-{build,tests,format}.log` in
`.wrk-runs/wrk-bba25a4a/`.

Phase 2 validation passed after a real drag-release fix: build, 59 domain tests,
22 browser/WebGL tests (54.5 s), formatting. Normal pointer release also emits
lostpointercapture; treating that as cancellation cleared the stationary cursor
readout. The handler now distinguishes completed from interrupted gestures.
Both cancelled and unexpectedly lost captures restore the prior rectangle.
Initial failure retained in `phase2-tests.log`; passing logs are
`phase2-fixed-{build,tests}.log` and `phase2-format.log`.

Inspected known-fixture DPR-2 detail and overview PNGs: all eight rows/columns
of the gold footprint are countable; the cyan x/y=64 crossing is distinct;
ordinary lines disappear at fit while partial edges and footprint remain visible.

## Final implementation and decisions

- `src/renderer/grid.ts`: shared grid-scale policy and viewport-only line geometry,
  fixed world-zero 64-tile lattice, signed coordinates, independent partial map
  boundary, device-pixel line alignment and map/viewport clipping.
- `src/renderer/createRenderer.ts`: separate disposable Pixi grid and rectangle
  Graphics above tile containers. No content writes, tile texture baking, ticker
  or document-owned overlay state. `mountRenderer.ts` subscribes to and disposes
  the transient rectangle updates.
- `src/editor/measurement.ts`, `session.ts`, `navigation.ts`: inclusive/reversed
  rectangle normalization, validated transient bounds and Inspect drag with capture,
  cancellation, Escape, blur, camera/tool-change cleanup. Existing Pan/Space/middle
  inputs take precedence. `setRectangle` is a display seam for future tools;
  measuring does not claim an implemented editable tile selection.
- `src/App.tsx`, `MapCanvas.tsx`, `styles.css`: exact tile/chunk map dimensions,
  signed pointer chunk/local coordinates, rectangle dimensions, actual grid spacing,
  measurement help and wrapping small-window readouts.
- `tests/domain/grid.test.ts`, `measurement.test.ts`, `tests/grid.spec.ts`,
  `tests/fixtures/grid.ts`, and the editor/tile harnesses: mathematical, WebGL pixel,
  interaction, content-isolation and screenshot evidence. Fixtures/probes remain
  test-only. Existing command movement and target-scale suites also pass.
- `docs/grid-and-scale.md`: decision/behavior/validation record; README and existing
  editor, navigation, renderer and desktop guides link/describe the feature.
  Package formatting commands include the new guide; no dependency/lockfile change.

Defaults: tile lines are 1 CSS pixel and fade from 22% opacity at 12 px/tile to
zero at 6 px/tile; cyan chunk lines are 2 CSS pixels at 65% opacity. Distant grids
sample every 2/4/8/... chunks to keep at least 24 CSS pixels between lines and
explicitly report that stride. This never changes what a chunk means. Line centers
are within half a device pixel of exact transformed edges. Map dimension chunk
values are exact width/64 and height/64, not rounded intersected-chunk counts.

## Acceptance audit

- [x] Tile edges align at multiple zooms/Retina densities, including partial bounds.
  Pure tests cover DPR 1/1.5/2/3, fractional camera offsets, zoom 1/3, 1/2, 1,
  1.37 and 8; coordinates -64, -1, 0, 63, 64, 127 and 128. Actual WebGL pixel
  samples at DPR 1/2 and zoom 1/3, 1/2, 1, 1.37 and 4 verify line widths,
  neighboring unchanged tile pixels and ordinary/chunk contrast. Right/bottom
  non-multiple edges 131/133 have visible borders with unchanged outside pixels.
  Growing bounds toward negative coordinates preserves the visible chunk lattice.
- [x] Chunk lines are visibly distinct and distant lines adapt. Inspected all four
  known-fixture detail/overview PNGs at DPR 1/2: ordinary cells are countable in
  detail, cyan chunk crossings remain distinct over the gold building, and tile
  lines disappear at overview while map edges/river/buildings remain visible.
  Inspected populated heartland overview: 100×100-chunk map retains content and
  shows a sparse grid every 8 chunks (512 tiles), stated in its footer. Pure
  6400×6400 and 6,400,000-square layout tests bound the major-line count.
- [x] An 8×8 footprint is measurable across chunks. Browser Inspect reverse-drag
  from (67,67) to (60,60) yields [60,68)² and the exact 8×8 readout at both DPRs.
  Domain tests verify an 8×8 measurement offset three tiles and negative/edge
  rectangles. The existing `8 by 8 multilayer move by three tiles restores
  overwritten destinations and leaves annotations fixed` history test passes,
  as do cross-chunk paint/undo renderer checks. Grid code adds no domain bounds
  restriction or chunk snapping. Native Inspect also measured 8×8 across the
  central x/y=128 chunk crossing. Tile editing/movement UI remains its later scope.
- [x] Overlays cannot become map/export tile data. Domain and browser before/after
  comparisons preserve all occupied runs, version, storage and history through
  measurements/navigation/cancellation. Grid geometry reads only bounds/view.
  Neither grid nor rectangle is part of MapDocument or command/checkpoint data.
  Export codecs are not yet implemented; no export round-trip is claimed. The
  authoritative whole-map iteration consumed by future exports stays identical.

## Actual final validation evidence

Environment: MacBookPro18,3, arm64, macOS 15.8.1 (24H32), Node 24.22.3,
Rust 1.100.0. Strategy A executed locally; no worker/CLI delegation.

- `npm run build`: both TypeScript configurations and Vite pass, 800 modules.
  Existing advisory about a minified bundle exceeding 500 kB remains; no build
  errors. Log: `.wrk-runs/wrk-bba25a4a/final-build.log`.
- `npm test`: **59/59 domain tests and 22/22 browser/WebGL tests**, no skips or
  failures; browser suite **57.6 s**. Includes both complete populated 6400²
  frontier/heartland maps, four layers, navigation/resource/disposal regression
  coverage and all existing model/history tests. Log: `final-tests.log`.
- `npm run format:check`: Prettier and Rust formatting pass. Log: `final-format.log`.
- `npm run build:desktop`: release compile **10.74 s**; bundled
  `src-tauri/target/release/bundle/macos/Tilewright.app`, **10.60 MiB**. The app
  source is unchanged after this build (only test assertions/docs followed).
  Log: `final-desktop-build.log`.
- `git diff --check` passes. `wrk validate`: **Valid project: 57 tickets**.
  Production bundle scan has no editorProbe, tileProbe, gridDocument or populated
  fixture identifiers. Source hashes: `source-hashes.json` in the same directory.

Screenshot artifacts retained under `.wrk-runs/wrk-bba25a4a/`:
`grid-detail-dpr1.png`, `grid-overview-dpr1.png`, `grid-detail-dpr2.png`,
`grid-overview-dpr2.png`. All use the same 196×198 known fixture, bounds
[-65,131) × [-65,133), with the 8×8 [60,68)² footprint on a separate layer.
Final target-map overview PNGs and navigation JSON reports are retained alongside
these; `artifact-hashes.json` records SHA-256. These local validation artifacts
are ignored, not production assets. The ticket retains this durable evidence summary.

Native WKWebView smoke: with no listener on Vite port 1420, launched the fresh
packaged app at `tauri://localhost`. Observed one ready canvas at Retina, grid
lines at 100%, 256×256 tile / 4×4 chunk readout, Inspect 8×8 measurement, Fit at
8.77% with ordinary lines removed and distinct 64-tile boundaries, 100% return,
Escape clearing, and another exact 8×8 measurement straddling the central chunk
intersection. Undo/Redo stayed disabled and map dimensions unchanged. Native
screenshots visibly confirmed eight rows/columns and the amber measurement outline.
This used CUA-synthesized input and an empty default document, not physical input
or populated native performance. Networking was not disabled; no new offline
network or frame/memory-budget claim is made.

No unresolved acceptance failures or blockers. TW-010 overview caching and later
selection/drawing/export tools retain their existing scope. Final commit must
contain this ticket's implementation and WRK record only, with wrk-bba25a4a in its
message; the pre-existing `.wrk/wrk-58cdb442.md` status change is excluded.
