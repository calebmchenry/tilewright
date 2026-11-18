---
id: wrk-c92d1a4b
title: 'TW-007: Render visible sparse tiles and ordered layers with PixiJS WebGL'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-fbc58697
priority: normal
labels:
  - v1
  - canvas
  - implementation
fields:
  sequence: 7
  source: INTENT.md
---
## Outcome

Draw the map accurately while limiting fine-detail work to visible content.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Map size and navigation; INTENT.md — Chosen technology.

**Execution order:** 07 of 54. Phase: canvas.

**Prerequisite:** [wrk-fbc58697](wrk-fbc58697.md) — TW-006: Build the editor shell and isolate document state from React UI state.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement viewport culling, visible-chunk lifecycle, layer compositing, and incremental updates from document notifications.
- Resolve raw colors and registry references through a shared color lookup; display empty cells without hiding lower-layer content.
- Bound GPU resources and clean up obsolete geometry/textures when views or documents change.

## Acceptance criteria

- [x] Visible tiles appear as solid-colored game cells with correct order and underlying-layer visibility.
- [x] Offscreen content does not produce a full-map set of display objects or per-frame iteration over all tile positions.
- [x] Small edits invalidate the affected render data; layer order/visibility changes update composition accurately.
- [x] Document switch, resize, and renderer teardown release owned resources and preserve model/render separation.

## Validation

- Compare rendering against small fixtures with overlapping layers, empty cells, and boundary tiles.
- Pan across a representative large map and record visible resource counts and memory behavior.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-008: Implement pan, anchored zoom, fit-to-map, and coordinate conversion](wrk-58cdb442.md).


## Execution plan — 2026-11-18

Strategy A in this Codex session, with WRK replacing the sprint ledger. TW-006
is done. Read AGENTS.md, skill, INTENT, README, ticket runner and referenced
foundation/model/history/editor/desktop/performance guidance. Weather report
fetched (gpt-6-astra for CS/Math, Opus 5.5 for frontend); no delegation.
The existing staged and unstaged prerequisite work is preserved. No commits
are requested or required. Use the pinned local Node 24.22.3 toolchain.

- [x] Phase 1: visible chunk/color queries and sparse WebGL tile rendering;
  validate model boundaries, composition and build/tests/format.
- [x] Phase 2: targeted tile/registry invalidation, visibility, resource lifecycle
  and document replacement; validate incremental updates and disposal.
- [x] Phase 3: fixture pixel comparisons, representative large-map pan/resource
  and memory measurements, documentation, final validation and acceptance audit.

Implementation choices will be recorded below. Navigation controls, overview
caches, grid overlays and layer/registry feature management remain later tickets.

Phase 1 validation: `npm run build`, `npm test` (48 domain tests, 8 WebGL
browser tests), and `npm run format:check` all passed. Added chunk/lookup
regressions; existing full fixture readbacks and sparse model oracle still pass
after bounded partition lookup optimization.

Phase 2 validation: build, full tests (49 domain, 11 real-WebGL browser),
and formatting passed. Exact GPU-readback tests cover raw/registered/missing
colors, holes, black/white/zero-alpha/half-alpha paint, negative/32/64/partial
boundaries, both DPRs, erasure/undo/redo, cross-chunk edits, layer reorder/removal,
visibility, shared recoloring, growth, resize, replacement and double disposal.
One test expectation was corrected from 2 to 3 recolored chunk uploads: the
fixture's original grass cell also lies in a viewport-intersecting cache chunk.
No production failure was hidden by that change; all three affected chunks are
correctly rebuilt, and other chunks remain cached.


## Completed implementation and validation — 2026-11-18

All three phases and all four acceptance criteria are complete. Original outcome,
source/scope, work, validation and next-step text are preserved above. Strategy A
stayed in this session; no separate sprint document/ledger, workers, commits or
other-ticket changes were created. Existing staged/unstaged prerequisite edits
were preserved. No blockers or deferred acceptance items remain.

### Implementation and decisions

- `src/renderer/chunks.ts`: half-open CSS viewport culling with map-bounds clipping,
  negative coordinates and partial chunks; bounded chunk rasterization to one
  premultiplied RGBA texel per cell, with registry-use tracking. Render chunks are
  32×32 (independent of the visual 64×64 lattice); occupied chunks use 4,096 bytes
  each for the GPU texture and an equal CPU pixel buffer. Empty chunks have no
  sprite/texture. No per-tile display objects or full-map allocation.
- `src/renderer/colors.ts`: common raw/registered lookup. The opaque registry seam
  uses an eight-digit `rgba` property; missing/malformed references show magenta
  without changing model identities. Black/white remain occupied; empty and
  zero-alpha cells reveal lower layers; partial alpha uses source-over blending.
  Final registry schemas, collision/deletion UX remain their existing tickets.
- `src/renderer/tileScene.ts`: ordered layer containers, visible chunk lifecycle,
  nearest-filtered textures, cached empty slots, reuse on small pan and reorder,
  exact layer/region invalidation, per-chunk registry dependencies, one rebuild
  per affected chunk per notification, fresh hidden/offscreen reads, and explicit
  texture/source/container release. Numeric profiling snapshots expose no GPU
  objects. No render ticker or offscreen cache accumulates with navigation.
- `src/domain/document.ts`: bounded queries probe the smaller of the query
  partition lattice and occupied index; detail queries avoid scanning all distant
  partitions. Existing public ordering/mutation/storage contracts are unchanged.
- `src/renderer/createRenderer.ts`, `mountRenderer.ts`: integrate the tile scene,
  camera-relative sprite placement, DPR-aware surface resizing, document/view/
  visibility subscriptions, document-change error cleanup/retry, context teardown
  and pending-init cancellation. Resize only reallocates the surface when size or
  DPR changes. Document replacement retains the established new-session contract.
- `src/editor/session.ts`, `focus.ts`, `src/App.tsx`, `src/styles.css`: transient
  layer visibility plus an accessible Show active layer checkbox; hide/show never
  changes content/history. Removed IDs are discarded; restoring a removed layer
  shows it. Checkbox focus correctly reports Panel controls. Broader layer settings
  and persistence remain later work.
- `src/MapCanvas.tsx`: removes the centered shell placeholder now that it would
  obscure real tiles; keeps accessible help. Removed the decorative origin marker
  from renderer geometry. Existing status/error/retry behavior remains.
- `tests/domain/render-chunks.test.ts`, `tests/domain/editor.test.ts`: pure culling,
  color/raster and visibility-state regressions. `tests/tiles-harness.ts`,
  `tiles.html`, `tiles.spec.ts`, `tiles-scale.spec.ts`: test-only model fixtures,
  WebGL pixel readback, query/upload/resource accounting, replacement/disposal,
  complete target-scale maps, independent recipe comparisons and repeated pan.
  `tests/editor.spec.ts` adds checkbox/focus/no-history coverage. Production bundle
  contains no tileProbe/editorProbe/rendererProbe globals.
- [Renderer decisions and measurement protocol](../docs/tile-renderer.md),
  [retained benchmark evidence](../docs/renderer-baseline.json), README and the
  model/editor/desktop/performance guides document the integration and limits.
  `package.json` includes the renderer guide in format commands. No dependency,
  lockfile, Rust, native permission or CSP changes.

Resource bounds are proportional to viewport chunk coverage and shown layers,
not the map's distant content or pan history. For W×H CSS pixels, Z zoom and L
shown layers, cached slots are bounded by
`L*(ceil(W/(24*Z*32))+1)*(ceil(H/(24*Z*32))+1)`, reduced by map clipping.
Full-map distant zoom/overview cache performance is TW-010, not claimed here.
TW-008 retains navigation input/anchored zoom/fit ownership; tests exercise the
existing viewport store directly without implementing successor-ticket controls.

### Acceptance audit

1. **Correct visible composition:** real WebGL readPixels tests at DPR 1 and 2
   match known raw/reference colors, black, white, missing-reference magenta,
   empty cells, fully transparent paint and a half-alpha blue-over-red pixel
   `[127,0,128,255]`. Test cells cross 32- and 64-tile boundaries, negative chunks
   (including -65), and the partial 101×70 right/bottom edge. Both representative
   maps additionally match 432 independently generated pixel expectations each
   across overlap, sparse and guaranteed-empty windows. Layer reorder, hide/show,
   erase, undo/redo, removal/restoration and registry recolor produce expected pixels.
2. **Visible-only work:** complete models have 6,620,700 and 24,025,200 occupied
   layer cells, but each pan step has at most 48 visible layer/chunk slots/queries.
   Twenty within-coverage pan updates perform zero new queries/builds/uploads.
   Offscreen edits leave all renderer counters, including render count, unchanged.
   Sparse document queries use direct partition lookup and no full-map tile scan.
3. **Incremental updates:** one small visible edit uploads one chunk; a two-cell
   edit across x=31/32 uploads two. Registry recolor refreshes referencing visible
   chunks across layers (including a reference in a partially visible chunk),
   without repainting stored tile values. Reorder creates/uploads no textures.
   Hidden edits/recolors are fresh when shown. Existing React Profiler/subscription
   tests continue to pass with no unrelated panel updates for a tile edit.
4. **Ownership/lifetime:** viewport shrink releases obsolete chunks; map growth
   refreshes clipped edges while retaining camera/model coordinates; document
   replacement destroys every old chunk texture/source. Final teardown yields
   zero live tracked WebGL contexts/textures/buffers and no canvas. Existing
   Strict Mode, repeated mount/unmount, cancellation, observer/listener/frame
   cleanup, failure/retry and density tests pass. Model imports remain free of
   React/Pixi/DOM, and visibility does not create history entries.

### Actual final validation

Machine TW-M1Pro-16: MacBookPro18,3 / Apple M1 Pro, arm64, 16 GiB RAM,
macOS 15.8.1 (24H32). Local pinned Node 24.22.3; existing Rust 1.100.0.
No global toolchain, network or OS settings changed.

Final combined log: `.wrk-runs/wrk-c92d1a4b-validation.log`.
Native build log: `.wrk-runs/wrk-c92d1a4b/desktop-build.log`.

- `npm run build`: both strict TypeScript configurations and Vite pass;
  797 modules; `index-Cy1LQmcg.js` 662.47 kB / 197.44 kB gzip.
- `npm test`: **49/49 domain tests**, no failures/skips, 2882.527167 ms;
  **13/13 browser/WebGL tests in 24.3 s**, including both full populated maps.
  Complete existing fixture golden readbacks and independent model oracle pass.
- `npm run format:check`: Prettier and Rust formatting pass. New evidence JSON
  and renderer guide also formatted/checked explicitly after recording results.
- `npm run build:desktop`: release/native compile passes in 11.58 s;
  bundled `src-tauri/target/release/bundle/macos/Tilewrite.app`, 10.58 MiB.
- `git diff --check` passes. `wrk validate`: Valid project: 56 tickets.
- Audit confirms original ticket prose preserved, implementation/test/docs have
  final newlines and no trailing whitespace/developer-specific paths; new local
  documentation links resolve; no test probe globals in production JavaScript.
- Existing Vite large-bundle and Playwright color-environment advisories remain
  non-failing. The unavailable-WebGL regression intentionally logs its failure
  before its successful retry/disposal checks.

Package-lock SHA-256:
`54acb86baa19877731ea3afdaa439712c696bbd91e6c27b9ade3dc71a632cc4a`

Final main asset SHA-256:
`4162c7612bb7e65768d761c2b811fde53fad07276fe28ab13de0e96d10b3a9db`

### Actual target-scale measurements

Both complete fixture models use 6,400×6,400 bounds and four ordered layers.
Canvas: 800×600 CSS pixels, DPR 1, 50% zoom (12 pixels/tile). Each runs three
83-position sweeps spanning populated regions, distant chunks, the empty corner,
and the same final viewport. Source/fixture hashes, all CPU submission samples,
post-GC snapshots and replacement counts are in `docs/renderer-baseline.json`.
Raw per-position reports and detail screenshots are preserved under
`.wrk-runs/wrk-c92d1a4b/` even when later tests replace `test-results/`.

| Fixture | Occupied cells | Max slots | Max tile textures | Tile GPU bytes / CPU pixel bytes | Max live GL textures / buffers | Replacement releases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frontier-v1 | 6,620,700 | 48 | 27 | 110,592 / 110,592 | 29 / 2 | 461 of 461 |
| heartland-v1 | 24,025,200 | 48 | 28 | 114,688 / 114,688 | 30 / 2 | 1,315 of 1,315 |

The empty region has **zero tile textures** on every sweep. The two extra live
GL textures are Pixi overhead; live buffer counts stay at two. Repeated sweeps
keep the same resource maxima. GPU context destruction leaves all tracked counts
at zero. Exact texture-byte accounting excludes driver/shared allocations.

Post-GC V8 used heap / backing storage (bytes), after each sweep:

- Frontier used heap: 9,625,836 → 9,708,196 → 9,779,588;
  backing storage: **40,386,836 on all three sweeps**. After replacement by an
  empty document: used heap 6,013,056; backing storage 7,980,068.
- Heartland used heap: 15,434,760 → 15,625,052 → 15,682,944;
  backing storage: **132,083,988 on all three sweeps**. After replacement:
  used heap 6,023,448; backing storage 7,980,068.

CPU view-update/submission p95 (nearest-rank, per sweep) was approximately
0.5/0.5/0.4 ms for frontier and 0.7/0.6/0.5 ms for heartland; maxima ≤1.3 ms.
These are development Chromium CPU submissions, **not presented-frame latency,
native WKWebView memory, physical GPU allocation, or full editor budget passes**.
The graphics backend was not separately identified. Small used-heap increases
include runtime/test instrumentation; constant backing storage and exact live
resource accounting provide the bounded-lifetime evidence.

### Native smoke and corrections

With Vite stopped (`lsof` found no listener on port 1420), launched the release
.app at `tauri://localhost`, quit/relaunched, and verified Canvas ready, one canvas,
and the Show active layer checkbox. Native hide/show changes its checked state
without enabling Undo; final-build focus reads Panel controls. Retina screenshot
is 2400×1600 for the 1200×800 native window. The final canvas has no centered
placeholder obscuring tile content. This smoke uses the fresh empty document;
actual populated pixels/resource measurements above are Chromium, not native.
Networking was not disabled, so no new offline-network claim is made.

Two validation corrections preceded the final pass: registry upload expectation
included a third referencing chunk already present in the fixture, and the scale
suite JSON import gained Node's required `type: json` attribute. Native inspection
then found/fixed checkbox focus classification; a regression verifies the corrected
readout and no history entry. The centered placeholder was removed to keep real
content unobstructed. Final tests and packaged build ran after these changes.

No additional feature work was performed. The outer runner may select TW-008.
