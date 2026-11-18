# Visible tile renderer

TW-007 implementation decisions, subordinate to [INTENT.md](../INTENT.md) and
[foundation decisions](foundation-decisions.md). The [editor session](editor-shell.md)
connects the [document](map-document.md) to PixiJS WebGL 2 through an imperative
subscription. React owns no tile arrays, textures, or tile elements.

## Culling and resources

`src/renderer/chunks.ts` inverts the shared CSS-pixel viewport transform, intersects
it with fixed map bounds, and enumerates only intersecting **32 × 32** render
chunks. These align with current storage partitions for cheap queries; the visual
chunk lattice remains **64 × 64** and is independent. Negative coordinates use
floor division. Half-open edges exclude chunks that merely touch the viewport;
partial map-edge chunks have transparent pixels outside the document.

`MapDocument.iterateRuns` now probes chunk coordinates directly for narrow queries.
It chooses the smaller of the query's partition lattice and the occupied index;
whole-map sparse export queries can still enumerate the index. Deterministic order,
mutation guards and public query semantics are unchanged. A visible chunk query
never scans every tile position or the whole large map's partition index.

`src/renderer/tileScene.ts` owns one container per visible layer and at most one
sprite/texture per occupied, visible layer chunk. Each texture has one texel per
game cell: 32 × 32 × 4 = **4,096 bytes** of RGBA8, plus an equal CPU pixel buffer.
Nearest filtering preserves sharp solid cells; there are no mipmaps, per-tile
objects, full-map texture, offscreen cache, or application animation ticker. Empty
visible chunks retain only query metadata so ordinary pan within those chunks does
not repeatedly query emptiness. Fully transparent occupied paint is still content.

For a W × H CSS-pixel viewport at Z zoom (24Z pixels per tile), an upper bound on
cached slots is `(ceil(W / (24Z × 32)) + 1) × (ceil(H / (24Z × 32)) + 1)` per shown
layer. Bounds clipping and empty chunks reduce texture counts further. This bounds
resources by the view, not by cumulative panning history. Layer count and distant
zoom still increase that bound. TW-010 now switches to [bounded composite overview images](overview-rendering.md)
below 2 CSS pixels per tile; the detail cache is released at that scale.

Panning within cached chunk coverage repositions sprites without querying tiles or
uploading textures. Camera-relative positions keep large world coordinates out of
GPU float32 transforms. Leaving a chunk, hiding/removing a layer, replacing the
session/document, or destroying the renderer explicitly destroys owned textures
and their sources. Shrinking the viewport drops obsolete chunks immediately.
Pixi retains a small amount of shared batching/default GPU state until renderer
teardown. The resize path changes the backing surface only when size or DPR changes.

## Color and composition

`src/renderer/colors.ts` is the shared raw/registered color lookup. Raw values use
the model's normalized `#rrggbbaa`. Registry records currently expose an `rgba`
property in the same eight-digit format; other metadata is ignored. This is a
renderer integration convention for the existing opaque record seam, not a final
registry schema or import policy. Missing/malformed references render opaque
magenta, making unresolved occupied cells visible without mutating their stable
identity. Registry editing and collision rules remain their feature tickets.

Layer containers follow the document's bottom-to-top order. Empty texels have zero
alpha, revealing lower content. Raw zero-alpha paint remains occupied in the model
but is visually transparent. Other alpha uses standard source-over composition;
CPU buffers are explicitly premultiplied before upload so browser upload behavior
does not change the result. Black, white and canvas-colored paint are ordinary
occupied cells. Reordering containers reuses their textures.

`EditorSession.hiddenLayers` and `setLayerVisible` supply transient view visibility.
The active layer's **Show active layer** checkbox uses that seam. Hiding releases
its renderer cache, leaves underlying model content untouched, and adds no history
entry. Showing queries fresh content, including intervening hidden edits or registry
changes. Removed layer IDs are dropped from the preference; undoing removal shows
the restored layer. TW-013 supplies [layer-management controls and editing-target policy](layers.md);
persisted view preferences remain a later file-format decision. A replacement document requires a new session as already specified
by the editor/history ownership contract.

## Incremental updates and disposal

The existing document bridge carries exact changed spans, composition/bounds flags
and registry identities. TileScene rebuilds only cached chunks intersecting those
spans on that layer. Multiple spans in a transaction rebuild a chunk once. Updates
to existing textures reuse their source and upload a single 4 KiB chunk. Clearing
the last occupied cell destroys its texture. Empty-to-painted chunks allocate on
demand. Offscreen edits do no query/upload/render work and are read on entry.

Each cached chunk tracks the registry IDs it uses. A registry change refreshes only
referencing visible chunks across all shown layers. Hidden/offscreen chunks retain
no stale pixel cache. Undo/redo use the same notification path. Name-only and
annotation changes do not redraw tiles. Bounds changes clear the current chunk
cache to update clipped edges correctly; growth does not change the camera.

`createRenderer.ts` draws the map background followed by ordered tiles, with no
old decorative origin marker or centered placeholder over the map. Canvas help
remains available to assistive technology. `mountRenderer.ts` owns document, viewport,
visibility, ResizeObserver and density subscriptions. Errors during document-driven
rendering enter the same cleanup/retry path as initialization and resize failures.
Disposal releases those subscriptions, scene resources, Pixi resources, WebGL
context and canvas; pending initialization is safely canceled. Numeric `snapshot()`
counters support tests/profiling without exposing GPU objects or a production global.

The pinned Pixi implementation and its [texture documentation](https://pixijs.com/guides/components/textures/)
define BufferImageSource updates, nearest sampling, premultiplied alpha and explicit
texture-source destruction. No dependency or content-security-policy changes were
needed.

## Validation

- `tests/domain/render-chunks.test.ts`: negative/partial/exclusive culling edges,
  bounded target-map query coordinates, empty/opaque/transparent/raw/registered
  chunk pixels and lookup fallback. Existing model oracle/full-fixture tests also
  validate the query optimization.
- `tests/tiles.spec.ts` and `tiles-harness.ts`: actual WebGL pixel readback at DPR 1
  and 2; overlaps, holes, alpha, 32/64 boundaries, negative/map-edge cells; targeted
  updates, cross-chunk undo/redo, shared registry updates, reorder/visibility,
  removal/restore, growth, resizing and document replacement/disposal.
- `tests/tiles-scale.spec.ts`: both complete deterministic populated maps are loaded
  into the real document. Independent recipe pixels are compared in overlapping,
  sparse and empty regions. Three 83-position pan sweeps per fixture record visible
  resource counts, queries, CPU submission time, tracked live WebGL textures/buffers
  and CDP post-GC heap at the same ending viewport. Replacement and final teardown
  verify resource release. JSON reports and detail PNGs are written under
  `test-results/`; they are development artifacts, not shipped globals or fixtures.
- Existing browser tests continue to cover React isolation, Retina sizing, focus,
  unavailable-WebGL retry, Strict Mode and cancellation. Run `npm run build`,
  `npm test`, `npm run format:check`, and `npm run build:desktop`.

Raw counters distinguish owned RGBA buffer bytes from total process/driver memory.
CDP heap samples and browser submission timings are not native WKWebView memory,
presented-frame latency, or passing results for all provisional editor budgets.
TW-008 adds [navigation input and camera math](navigation.md). TW-009 adds
[tile/chunk overlays and scale readouts](grid-and-scale.md); distant overview
caches are described in [overview rendering](overview-rendering.md).
The [recorded renderer baseline](renderer-baseline.json) retains fixture IDs/hashes,
source hashes, all submission-time samples, live resource maxima and memory samples.
Actual native launch observations and the final acceptance audit are recorded in WRK.
