# Cached overview rendering

TW-010 implementation decisions, subordinate to [INTENT.md](../INTENT.md), the
[coordinate contract](foundation-decisions.md), and [tile rendering](tile-renderer.md).
These are implementation defaults, not additional product requirements.

## Scale and composition

At **2 CSS pixels per tile or above**, the existing visible, per-layer 32-tile
textures render detail. Below that threshold, `TileScene` releases those textures
and uses `OverviewScene` composite region images. This rendering threshold is
independent of the **8 CSS pixels per tile** editing gate. Camera coordinates,
layer order, grid overlays, map bounds, and the tile model stay unchanged.

`overviewRegions` starts with world-zero-anchored **256-tile regions**. It doubles
region width until the conservative visible lattice has at most **256 entries**.
Each image starts with a power-of-two sampling step chosen from physical pixels
(CSS scale × DPR), then coarsens until its side is at most 256 texels and all
visible images together need at most **16 MiB** of RGBA payload. On the measured
6,400-square map at 1024 × 640 CSS pixels, DPR 2, Fit uses 512-tile regions and
4 tiles per texel: **169 slots**, each at most 128 × 128 texels. Empty regions
have ready metadata without a texture. No per-tile display objects or per-layer
full-map textures are created.

`rasterizeOverview` reads bounded runs from the actual document. TW-011 uses
packed fills for opaque spans and integrates identical composite spans directly
into downsampling bins; partially transparent paint retains per-cell source-over.
The independent per-cell oracle checks clipped bins and mixed alpha. It combines
visible layers bottom to top at each source tile using premultiplied source-over,
then box-averages those composite pixels. Averaging layers independently would
incorrectly reveal lower colors through disjoint upper-layer holes. Missing
registry references use the same magenta fallback as detail. Transparent paint
remains model content. Pixel rounding can differ from GPU detail composition by
one channel unit. Downsampling deliberately blends fine features at distance.

Regions share the detail camera transform and signed world lattice. Partial map
edges average only in-bounds source cells and use fractional texture frames to
crop to exact bounds. Images have nearest filtering and no mipmaps. Grid and
measurement graphics remain separate, above content, and cannot be baked into a
cache or exported as tiles.

## Scheduling and invalidation

`OverviewCache` schedules a single requestAnimationFrame while work is pending.
Each slice allows **6 ms**, checked after each bounded **256 × 16 tile block**,
and at most 1,024 work units. A block completes all document iterators before
returning; no live iterator crosses an event-loop yield. This is a cooperative
budget, not a hard real-time guarantee: one block, texture upload, rendering,
GC, or a busy browser may exceed it. There is no idle rendering ticker.

Navigation immediately updates camera transforms and replaces the visible work
set. Work that leaves the view is abandoned; retained ready images are reused.
Cold regions and newly selected resolution levels appear progressively over the
map background. “Refreshing map…” and canvas `aria-busy` identify this interval.
Existing images remain until their own replacement is complete during a content
refresh, and each image swaps atomically. Once refresh ends, every intersecting
region is ready, including empty regions. Detail switching builds its bounded
visible chunks synchronously. No fallback to full-map detail rendering occurs.

| Change                               | Cache behavior                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Tile edit, undo, redo                | Dirty every intersecting retained region, including offscreen and other resolution levels; rebuild visible entries only |
| Layer order/membership or visibility | Dirty all composite entries; use current ordered visible layers on rebuild                                              |
| Registry notification                | Conservatively dirty all entries, including previously offscreen references; no unbounded per-image registry index      |
| Bounds change                        | Release all images and rebuild with new clipped edges                                                                   |
| Rename/annotation only               | No completed tile-image invalidation; an unfinished job can conservatively restart on the changed document version      |
| New document/session                 | Destroy the old renderer, callbacks and all images; the new renderer owns a separate cache                              |

Jobs capture the monotonic document version. Each resume checks that version;
invalidations and visibility changes also abandon current work immediately. An
unfinished result cannot publish after a newer version, a bounds change, a view
cancellation, or disposal. Registry/order/visibility invalidation applies across
all cached levels, preventing stale content from reappearing after pan/zoom back.
Errors from scheduled work reach the same renderer cleanup/retry path as startup.

## Memory and lifetime

- LRU eviction bounds retained overview RGBA buffers to **32 MiB CPU** and an
  equal **32 MiB owned GPU texture payload**. Visible images use at most half
  that budget, leaving room for recently visited regions/resolutions.
- At most **512 entries** survive, including empty entries. Only visible entries
  are pinned. Oldest nonvisible entries are evicted for either byte/entry limit.
- An unused entry expires **30 seconds after its last visible use**, via a
  cancelable timer; no interaction is required to release idle entries. Timers
  can run late when the browser suspends a background window. Entering detail
  makes every overview image eligible for expiration.
- One running job uses at most **2 MiB** of Float64 accumulation, **16 KiB** of
  block pixels, **256 KiB** output, and a block-local color lookup. Replacing an
  image may transiently hold one extra 256 KiB CPU buffer/texture payload before
  pruning. Buffers used by Pixi and the cache share ownership, not retained copies.
- These numbers cover owned pixel payloads. JS metadata, document/history,
  Pixi shared batching buffers, driver allocations and the canvas backing surface
  are additional. They are not a whole-app physical-memory ceiling.
- Eviction destroys sprites, textures and sources. Destroy cancels work/expiry,
  abandons the generator, and releases every cache resource. All caches are
  disposable derived data and are never document or project-file state.

## Validation

`tests/domain/overview.test.ts` exercises geometry/byte limits at target and much
larger dimensions, exact alpha-before-downsample behavior, negative/partial edges,
visible/offscreen invalidation, version/disposal cancellation, LRU limits and TTL.
`tests/overview.spec.ts` reads actual WebGL pixels at DPR 1/2 across detail and
several overview scales, region seams, signed/partial edges, edit/undo/redo,
recolor, order, visibility and replacement while work is pending.

`tests/overview-scale.spec.ts` loads both complete deterministic populated
6,400 × 6,400 maps with all four layers. It checks sampled overview pixels against
an independent fixture recipe, verifies no detail textures at Fit, measures cold
rebuild latency, three 120-frame cached navigation passes, 20 edit/undo/redo
cycles, resolution changes, exact cache payload and tracked live GPU resources.
CDP post-GC heap samples distinguish loaded document, overview, repeated edits,
and replacement. PNG and raw JSON artifacts are generated under `test-results/`.
The retained [overview baseline](overview-baseline.json) records actual samples,
source hashes and environment; WRK records the acceptance audit and validation.

Frame intervals from rAF and CPU render-submission durations are **browser
proxies**, not native presented-frame latency. Exact RGBA accounting and CDP heap
are not a WKWebView process-group physical footprint. The native release gate,
longer repeated navigation protocol and provisional budgets are deferred to
TW-049/TW-050 under the user's 2026-11-18 delivery decision; this
measurement does not claim they passed. Run build, full tests, format check and
the packaged desktop build before completing this ticket.

TW-011 native measurement tooling and gate status are recorded in
[native performance](native-performance.md). The 6 ms slice replaces 4 ms to use
more of a 60 Hz frame for cold generation; the bounded block still controls
cooperative overshoot. The 1,024-unit fallback avoids an artificial 64-block
ceiling when the work finishes before the clock budget. Neither is a presentation
latency guarantee.
