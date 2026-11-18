# Sparse map document

Implementation decisions for TW-004, subordinate to [INTENT.md](../INTENT.md) and
the [foundation decisions](foundation-decisions.md). These are domain primitives;
TW-005 adds [atomic commands/history](command-history.md). Registry management,
annotation feature schemas, codecs, and renderer integration remain their own tickets.

## Public model

[MapDocument](../src/domain/document.ts) owns half-open safe-integer world bounds,
stable layer identities, bottom-to-top layer order, and independent tile content.
It has no imports from React, PixiJS, DOM, Tauri, or Node. The default document is
256 × 256 with `layer-1` named `Layer 1`; construction also accepts explicit bounds
and ordered layers, including negative coordinates and partial visual chunks.

```ts
import { MapDocument } from "../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../src/domain/values.ts";

const terrain = layerId("terrain");
const map = new MapDocument({
  bounds: { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
  layers: [{ id: terrain, name: "Terrain" }],
});
map.setCell(terrain, 63, 64, rawColor("#000000ff"));
map.writeBatch([
  {
    layerId: terrain,
    x: 60,
    y: 65,
    length: 8,
    value: registeredColor(registryId("grass")),
  },
]);
```

[values.ts](../src/domain/values.ts) reserves separate branded string namespaces
for `LayerId`, `RegistryId`, and `AnnotationId`. The caller supplies persistent IDs
through validated factories (1–128 ASCII letters/digits/dot/colon/underscore/hyphen,
starting with a letter or digit). Display names are independent; duplicate names
are allowed, duplicate layer IDs are rejected. IDs do not depend on layer order
or storage partitions. Future creation/import commands own ID generation and
registry/annotation uniqueness; these factories do not generate random IDs.

A `Cell` is exactly one of:

- `null`: empty on this layer, without touching any lower layer.
- `{ kind: "raw", rgba: "#rrggbbaa" }`: arbitrary paint, including black, white,
  or zero alpha. Input requires eight hexadecimal digits and normalizes case.
- `{ kind: "registered", registryId }`: an association, independent of the
  entry's current color. It is never implicitly converted to raw paint or looked
  up by color equality. Registry resolution/recoloring and missing-reference import
  policy await registry/codecs tickets; this model can hold unresolved identities.

Layer visibility/compositing is not baked into stored content. `addLayer`,
`renameLayer`, and `reorderLayers` preserve all existing IDs and cells. The current
model requires at least one layer; transactional removal is available through
TW-005 commands, while layer-management UX belongs to later work. `setBounds` preserves world coordinates and rejects changes that
would discard content. Expansion allocates no tile storage. Future growth commands
enforce the chosen 64-tile increments; the primitive also permits restoring old
bounds after undoing subsequent edits.

## Bounded edits and notifications

`getCell`, `setCell`, and `clearCell` reject unknown layers, noninteger/unsafe
coordinates, and out-of-bounds cells. Outside is never silently treated as empty,
clamped, or auto-grown. An empty read/clear allocates no partition or paint.

`writeBatch` takes a finite iterable of positive-length horizontal `TileWrite`
spans. It copies and validates the **whole input before any mutation**, including
exclusive ends, layers, and paint. Bad late input or a throwing input iterator
leaves content, allocation, and version unchanged. There is no implicit clipping.
Spans and batches may cross any visual/storage boundaries and multiple layers.
Overlapping spans apply in input order. Allocation exhaustion is not a recoverable
transaction boundary; as elsewhere in JavaScript, process OOM cannot be rolled back.

Every effective mutation returns a `MutationResult` and publishes one immutable
`DocumentChange` synchronously **after** all its changes. A no-op has `change: null`,
does not increment `version`, and sends no notification. The monotonic counter
detects changes; it is separate from the TW-005 undo revision or saved checkpoint.

Tile changes contain ordered horizontal spans with layer, world coordinates,
length, and immutable `before`/`after` values. Adjacent identical changes coalesce
across partition boundaries. A renderer can invalidate those world rectangles;
history can replay `after` forward or `before` in reverse order. Overlaps retain
their sequential inverse data. A batch that changes then restores a cell still
contains changes; gesture cancellation and net-no-op compaction are the command
layer's responsibility. Layer changes contain old/new ordered metadata snapshots;
bounds changes contain old/new bounds. No document-wide tile copy is made.
TW-005 `applyCommands` adds a single net transaction event around multiple
primitives, including registry/annotation records; see [its contract](command-history.md#atomicity-inverse-data-and-notifications).

`subscribe` returns an idempotent unsubscribe function. The listener list is
snapshotted for each dispatch. A failing listener does not stop other listeners
or make the edit appear uncommitted: errors are returned in `observerErrors` and
callers should report them. Reads inside a listener see the completed batch.
Reentrant writes, including writes from input generators or listeners, are rejected.
Inputs, returned metadata/cells, and change records cannot mutate internal state.

## Storage and queries

[storage.ts](../src/domain/storage.ts) partitions each layer into **32 × 32**
world-anchored cells using mathematical floor, including for negative coordinates.
This is an implementation choice, deliberately distinct from the 64 × 64 visual
grid. It imposes no editing boundary and is not a file-format promise.

Only occupied partitions exist. Each starts with a Map of local offsets to
numeric paint tokens; at 128 occupied cells it promotes to a 1,024-entry
`Uint32Array` (4 KiB). At 64 remaining cells it demotes to a sparse Map; the two
thresholds prevent repeated conversions around one occupancy level. Empty
partitions are removed. Zero is an internal empty token, not a raw color.
The document interns immutable paint values with reference counts and releases
unreferenced entries. A cyclic 32-bit token allocator skips live tokens on wrap
and resets when empty; it retains no list of deleted colors or free IDs. Internal
token numbers are never exposed or persisted.

An empty 6,400 × 6,400 document therefore allocates only bounds/layer metadata.
Storage scales with occupied content, allocated partitions, and distinct paint
values, rather than full canvas area times layer count. Dense blocks trade bounded
empty slots for lower per-cell overhead; isolated cells keep sparse entries.
`storageStats()` reports exact occupied counts, partition counts, palette count,
and typed-array bytes. It does **not** estimate JS Map/object overhead.

`iterateRuns(optionalLayerId, optionalBounds)` yields occupied runs in layer order,
then world y, then world x, independent of insertion order and storage promotion.
Identical adjacent paint merges across partitions. `iterateCells` expands those
runs into individual occupied cells. Both support contained half-open query
rectangles, including zero-area empty queries. Out-of-bounds/invalid queries throw.
Enumeration probes the smaller of the query partition lattice and the allocated
partition index, sorts matching partitions, then scans only intersecting rows.
TW-011 scans contiguous internal token spans and resolves paint once per run,
choosing the sparse/dense representation once per bounded row instead of per cell.
Tokens remain internal; ordering, immutable results and mutation guards are unchanged.
Small windows therefore avoid scanning the whole-map index; full-map sparse
queries avoid walking empty coordinates. This TW-007 refinement is documented
with the [tile renderer](tile-renderer.md).

Iterators fail on any effective intervening mutation, including before the first
`next()` or during expansion of a run. They are consistent synchronous read seams,
not retained asynchronous save snapshots. Future codecs/history must capture their
own revision/snapshot policy rather than holding a live iterator across edits.

## Validation and measurement

`npm run build` checks domain code with both TypeScript configurations; the domain
configuration excludes DOM libraries. `npm test` runs Node domain tests plus the
existing real-WebGL preview tests. Domain regression tests cover no allocation on
empty maps, adaptive storage/reclamation, empty/set/clear, layer isolation and
stable IDs, malformed and late batch failures, immutable changes, inverse replay,
observer errors, deterministic/windowed iteration, negative/partial boundaries,
64-tile and 32-tile crossings, and both safe-integer extremes. Seeded mixed edits
also compare against an independent per-cell Map oracle.

[Fixture adapter](../tests/fixtures/document.ts) loads **every occupied cell** of
both representative fixtures through actual bounded document writes, in batches
of 512 recipe runs. Named paints become stable registry references; unregistered
black stays raw. The adapter reads every layer back from the model, restores the
fixture's run segmentation/order, then the independent fixture inspector checks
the complete golden hash and occupancy. It reads paint from storage rather than
regenerating expected values. Tests also check underlying terrain/furniture and
the guaranteed empty region.

```sh
npm run perf:model
npm run perf:model -- --output docs/model-baseline.json
```

[model-baseline.json](model-baseline.json) records two fresh Node processes per
input (empty, frontier, heartland), source hashes, seed/content hash, machine/mode,
exact allocation counts, and raw timing/memory snapshots. Initialization includes
construction, generation, validated import, and temporary change records. It
excludes subsequent full model readback/hash validation, reported separately.
No subscribers or undo history are retained. GC runs before/after initialization,
outside the timer. Retained `heapUsed + arrayBuffers` delta approximates model
memory plus runtime/JIT overhead; `external` already includes array buffers and
must not be added again. RSS/high-water RSS describe the whole child process.
Snapshots do not establish transient peak JS heap. Two runs are baseline evidence,
not percentile gates. The [editor budgets](performance.md) still need measurements
with renderer, history, and native integration in the packaged application.
