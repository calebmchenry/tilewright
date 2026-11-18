---
id: wrk-c22d70cf
title: 'TW-010: Implement cached overview rendering and coherent cache invalidation'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-bba25a4a
priority: normal
labels:
  - v1
  - canvas
  - implementation
fields:
  sequence: 10
  source: INTENT.md
---
## Outcome

Keep broad views responsive using cached imagery instead of full-detail tile rendering.

## Source and scope

**Source:** INTENT.md — Map size and navigation; INTENT.md — Chosen technology.

**Execution order:** 10 of 54. Phase: canvas.

**Prerequisite:** [wrk-bba25a4a](wrk-bba25a4a.md) — TW-009: Add tile grids, emphasized 64-tile chunk boundaries, and scale readouts.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Add chunk/region overview images or an equivalent measured cache with zoom-level switching and bounded cache lifetime.
- Invalidate affected cache content for tile edits, layer visibility/order, registry recolors, document changes, and undo/redo.
- Schedule cache rebuild work so navigation remains responsive.

## Acceptance criteria

- [x] A full 100 by 100 chunk view uses overview data instead of creating millions of fine-detail objects.
- [x] Switching between overview and detail preserves layout and layer ordering without missing regions.
- [x] A change in visible or previously offscreen content appears correctly after cache refresh and revisiting the area.
- [x] Cache memory has a documented bound/eviction policy; stale rebuild results cannot overwrite a newer document state.

## Validation

- Exercise edit, reorder, recolor notification, undo, pan away/back, and document-switch invalidation with fixtures.
- Measure cache rebuild latency, overview frame time, and memory at target dimensions.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-011: Record the early populated-map rendering baseline](wrk-02942808.md).

## Execution — 2026-11-18

Strategy A, executed in this session; WRK replaces the sprint ledger. Read the
sprint-execute skill, AGENTS.md, INTENT.md, README and referenced project guidance.
Prerequisite wrk-bba25a4a is done; Node 24.22.3 is active. Weather report fetched
(gpt-6-astra for CS/math, Opus 5.5 for frontend architecture); no delegation or
model switch. The pre-existing `.wrk/wrk-58cdb442.md` edit is excluded from this
work. No repository commit convention; final scoped commit is required.

- [x] Phase 1: bounded, incremental composite overview raster/cache with domain tests.
- [x] Phase 2: Pixi zoom switching, coherent invalidation and lifecycle integration.
- [x] Phase 3: fixture pixel checks, target-size measurements, full validation,
  acceptance audit and WRK completion. Final scoped commit follows.

Phase 1 passes: build, 64 domain tests, 22 browser/WebGL tests (54.3 s), and formatting. Logs: `.wrk-runs/wrk-c22d70cf/phase1-*.log`.

Phase 2 passes: build, 64 domain tests, 25 browser/WebGL tests (53.9 s), and formatting. Real pixels verified at DPR 1/2; all existing lifecycle, navigation, model and history regressions pass. Logs: `phase2-*.log`.

## Final implementation and decisions

- `src/renderer/overview.ts`: pure overview geometry, composite raster generator,
  LRU/TTL cache, bounded scheduling and version-checked publication. Region sizes
  start at 256 world tiles and double to cap visible slots at 256; sampling adapts
  to zoom/DPR and the visible byte budget. Layer composition happens before box
  averaging, preserving underlying holes and alpha. No per-tile display objects.
- `src/renderer/overviewScene.ts`: Pixi image publication/reuse, signed camera-relative
  positioning, fractional clipping at partial map edges, explicit texture/source
  disposal, cancelable frame and expiry scheduling.
- `src/renderer/tileScene.ts`, `chunks.ts`, `createRenderer.ts`, `mountRenderer.ts`,
  `src/styles.css`: switch below 2 CSS px/tile, release detail chunks at overview,
  forward invalidations at all cached levels, preserve existing detail behavior,
  show a transient refresh status and route scheduled errors through cleanup/retry.
  The independent 8 px/tile editing gate and document model are unchanged.
- `tests/domain/overview.test.ts`, `tests/overview.spec.ts`,
  `tests/overview-scale.spec.ts`, `tests/fixtures/overview.ts`, `tests/gpu.ts`,
  and the tile harness: deterministic CPU/cache tests, independent actual WebGL
  pixels and complete populated target-map measurements. Existing GPU tracking
  is shared with the detail-scale suite. Fixtures remain test-only.
- `docs/overview-rendering.md`: decisions, scheduling, invalidation matrix,
  memory/lifetime contract and measurement limitations. `docs/overview-baseline.json`
  retains raw final measurements plus earlier idle cold trials, fixture metadata,
  source fingerprints, all frame/refresh samples and heap/resource observations.
  README and renderer/navigation/grid/performance guides link the new behavior.
  Formatting includes the new guide; no dependency or lockfile changes.

Cache policy: visible payload <=16 MiB CPU; retained payload <=32 MiB CPU plus
an equal owned GPU RGBA payload; <=512 entries including empty regions. Only
visible entries are pinned. LRU evicts other entries; a cancelable timer expires
unused entries after 30 seconds (subject to background timer throttling). One
job adds <=2 MiB accumulation, 16 KiB workspace and 256 KiB output; a replacement
can temporarily add one 256 KiB payload before pruning. JS metadata, driver
allocations, document/history and canvas backing storage are additional.

Rebuild scheduling: one pending rAF, 4 ms cooperative slices with <=256x16 source
cells per unit and <=64 units per slice. No live document iterator survives a
yield. Job version checks plus explicit cancellation prevent old work publishing
after an edit, visibility change, bounds change, navigation cancellation or
renderer destruction. Completed offscreen images are dirtied too. Registry and
composition notifications conservatively invalidate all composite images.

Cold regions/resolution levels fill progressively over the map background with
“Refreshing map…” and aria-busy. Content refresh retains each old image until
its replacement is complete. After refresh, every visible slot is ready,
including empty slots; there is no full-map detail fallback. These implementation
choices are documented rather than asserted as additional INTENT requirements.

## Acceptance audit

- [x] Full 100x100-chunk views use overview data. Both fully populated fixtures
  load all four layers (6,620,700 and 24,025,200 occupied layer cells). Fit at
  1024x640 CSS / DPR 2 has 169 ready region slots, 166/168 sprites, zero detail
  chunks/textures and zero pending jobs. Warm pans make zero document queries
  or image rebuilds. GPU tracking observes 168/170 live textures including two
  shared Pixi textures, with four buffers.
- [x] Detail/overview switching preserves layout/order and completes every region.
  Domain geometry tests prove gap-free coverage, including negative/partial bounds,
  DPR 1/2/3 and much larger geometry-only dimensions. Actual WebGL pixels at DPR
  1/2 match opaque/alpha composition across the 256-tile seam and multiple zooms;
  signed and partial map edges crop correctly. Target pixels match the independent
  fixture recipe. All 169 slots finish; inspected both full populated PNGs show
  distributed villages/terrain/water, correct bounds and the intentionally empty
  bottom-right region without missing cache regions. Multiple LOD/detail returns
  preserve ready images and resource accounting.
- [x] Visible and previously offscreen edits refresh on revisit. Browser fixtures
  exercise edit, undo/redo, offscreen registered recolor, pan away/back, hide/show,
  reorder/undo, canvas growth and undo, and document replacement while work is
  pending. Unit tests also verify the monotonic-version guard without relying
  on notification delivery, and cancel a partially constructed image on disposal.
- [x] Cache memory/lifetime are bounded and stale work cannot overwrite newer
  content. Domain tests pan over 520 regions, enforce byte/entry caps and LRU,
  advance a deterministic expiry clock, and reject old-generation publication.
  GPU/browser checks verify owned created-minus-released counts at each measured
  level and zero contexts/textures/buffers after teardown. Replacement discards
  every old cache entry and callback. Memory qualifications are explicit above.

## Actual validation evidence

Environment: MacBookPro18,3 / Apple M1 Pro, arm64, macOS 15.8.1 (24H32), Node
24.22.3, Rust 1.100.0, Chromium version recorded in the baseline JSON. Browser
runs use Vite development, WebGL2, 1024x640 CSS / DPR 2 for target measurements.
No physical input, native populated-map timing or whole-process memory claim.

- `npm run build`: TypeScript (including DOM-free domain configuration) and Vite
  pass, 802 modules. Existing >500 kB bundle advisory remains; no errors.
- `npm test`: **64/64 domain tests, 27/27 browser/WebGL tests**, no skips/failures;
  final browser suite 1.8 minutes. Includes all earlier model/history/grid/input/
  resource regressions plus both populated overview runs.
- `npm run format:check`: Prettier and Rust formatting pass.
- `npm run build:desktop`: release build **10.69 s**, local `.app` **10.60 MiB**.
- `git diff --check` passes; `wrk validate`: **Valid project: 57 tickets**.
  Production dist scan contains no tileProbe/editorProbe/overviewDocument/
  populatedDocument/frontier-v1 test identifiers. Final measurement source hashes
  exactly match current source files.

Logs: `.wrk-runs/wrk-c22d70cf/final-{build,tests,format,desktop-build}.log`.
Source hashes: `source-hashes.json` there. Raw final scale JSON/PNGs are copied
under `final-scale/`; earlier idle scale artifacts under `initial-scale/`.
The committed baseline JSON retains the actual numeric evidence independently
of these ignored local artifacts.

| Browser measurement | frontier-v1 | heartland-v1 |
| --- | ---: | ---: |
| Idle cold refresh wall time (earlier trial) | 4,275.3 ms | 5,274.7 ms |
| Cold refresh while panning every rAF (final suite) | 7,671.1 ms | 9,745.0 ms |
| Pan CPU submission p95 during cold rebuild | 0.4 ms | 0.4 ms |
| Cold raster work / maximum measured slice | 584.1 / 4.3 ms | 978.4 / 4.3 ms |
| Warm CPU submission p95, three 120-frame passes | 0.6 / 0.5 / 0.5 ms | 0.6 / 0.6 / 0.5 ms |
| Warm rAF interval p95, same passes | 31.9 / 31.5 / 31.5 ms | 31.1 / 33.4 / 31.0 ms |
| Edit / undo / redo refresh p95, 20 each | 66.7 / 67.0 / 69.5 ms | 67.0 / 67.1 / 67.0 ms |
| Cold cache CPU payload (equal GPU payload) | 10.375 MiB | 10.500 MiB |
| Largest retained payload across measured LODs (each CPU/GPU) | 16.125 MiB | 16.500 MiB |

All 60 edit/undo/redo operations per fixture rebuild exactly one affected region.
Warm pans query/rebuild zero tiles. CDP post-GC usedSize plus backingStorageSize
is recorded separately in the raw report: after cold overview, 10,437,256 +
51,295,657 bytes (frontier), 16,229,364 + 143,119,785 bytes (heartland). After
replacement these fall to approximately 6.6 MB + 18.5 MB in both cases. These are
browser heap/backing-storage observations, not physical process/GPU footprint.

Performance limitation for TW-011: initial refresh exceeds the provisional 2 s
usable-overview budget, and warm rAF p95 exceeds the 16.7 ms proxy threshold.
These browser runs do **not** pass or establish the native release performance
gate. Cooperative rebuilds keep individual measured work slices near 4 ms and
navigation submission small; cold generation and native presentation remain
follow-up performance work. This ticket requires measuring these values, not
passing TW-011's separate gate. No slow samples were removed.

Validation failure resolved: initial heartland pixel-oracle sampling landed
exactly on a nearest-filter texel boundary at world (100,100). CPU double and
GPU float precision selected opposite neighbors. The independent oracle now
samples strictly away from ties and asserts that condition; production code was
not changed to hide the failure. Debug failures remain in `phase3-*.log`; both
corrected target checks and the complete final suite pass.

Native smoke: stopped Vite (no port-1420 listener), opened the rebuilt bundled
app at `tauri://localhost`, confirmed the new Map refresh accessibility node and
fresh empty document. Verified ready canvas, Fit at 8.77%, keyboard zoom through
the new cache threshold to 5.61%, arrow pan, correctly aligned 4x4 chunk outline,
and return to 100% detail with ordinary grid lines. No error screen or document
edits; Undo/Redo stayed disabled. This is CUA-synthesized empty-map WKWebView
smoke, not physical trackpad input or populated native performance. Networking
was not disabled; no new offline claim is made.

All ticket acceptance criteria are satisfied; no implementation blocker remains.
TW-011 retains its existing performance-gate scope. Commit this implementation
and WRK record together with wrk-c22d70cf in the message. Preserve the pre-existing
`.wrk/wrk-58cdb442.md` status change outside that commit.
