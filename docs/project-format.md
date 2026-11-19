# Editable project format, version 1

Decision record for [TW-033](../.wrk/wrk-eef53dd9.md), subordinate to
[INTENT.md](../INTENT.md#project-files-and-agent-exports). These are implementation
choices, not additional product requirements. This specifies the contract for
TW-034 encoding, TW-035 decoding and subsequent native save/open/recovery work.
The [TW-034 snapshot and encoder](#snapshot-and-encoder-implementation-tw-034)
now implement the writing side; decoding and native file workflows follow.

## Container and version

An editable project is one **uncompressed UTF-8 JSON object**, normally named
`<name>.tilewright`. No BOM, comments, trailing commas, external resources, archive
members or executable content. Detect the format from its envelope, not its
filename. Use `application/json` if a MIME type is needed. Native paths and the
displayed filename live outside it.

JSON is inspectable, available in TypeScript and sufficient for the current
run-based model. A document-wide paint palette avoids repeating long registry IDs
or color objects in every run. Sparse horizontal runs compress solid regions
without tying the file to 32-tile storage partitions or 64-tile visual chunks.
Binary formats, compression and partition manifests add tooling and recovery
complexity; reconsider them with measured evidence and a versioned change.
A varied/checkerboard map may need one run per occupied cell. No performance
budget is established by this choice; TW-049/TW-050 own refinement.

The root has exactly `format`, `version`, `document`, and `editor`:

```ts
// Wire shapes, not executable domain types. All properties are required.
type ProjectV1 = {
  format: "tilewright-project";
  version: 1;
  document: {
    bounds: Bounds;
    palette: Paint[];
    layers: Layer[]; // Bottom to top, including empty and hidden layers.
    registry: RegistryEntry[];
    annotations: NamedArea[];
  };
  editor: {
    activeLayerId: string;
    hiddenLayerIds: string[];
  };
};
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Paint =
  { kind: "raw"; rgba: string } | { kind: "registered"; registryId: string };
type Run = [x: number, y: number, length: number, paintIndex: number];
type Layer = { id: string; name: string; runs: Run[] };
type RegistryEntry = { id: string; name: string; rgba: string };
type NamedArea = {
  id: string;
  name: string;
  description: string;
  tier: "detail" | "locality" | "region";
  bounds: Bounds;
  label: { placement: "center" };
};
```

There are no optional/defaulted fields, implicit migrations or extension bags in
v1. Empty lists are explicit `[]`; at least one layer is required. Each object
allows only the properties shown, including the appropriate paint union arm.
Reject unknown properties rather than dropping data on the next Save. The generic
JSON metadata seams in `MapDocument` are not a legacy file format: arbitrary
test metadata, unresolved IDs and older illustrative `anchor` records are not
valid projects. Encoding must report unrepresentable model data rather than
silently filtering or repairing it.

`version` is an independent positive safe integer schema version, not the app
version, document mutation counter or history revision. V1 readers accept version
`1` only. Reject a missing, noninteger, older or newer version without changing the
live document; explain unsupported versions separately from malformed data. A
future schema change gets a new integer, explicit migration tests and a documented
support range. No best-effort forward loading, downgrade save or overwrite on
failure. There are currently no older released project formats to migrate.

## Coordinates, identity and content

Bounds use the fixed [world coordinate contract](foundation-decisions.md): x right,
y down, initial origin `(0, 0)`, signed whole-tile addresses and half-open maxima.
Width and height are derived from endpoints, never redundantly serialized. All
endpoints, coordinates, lengths, indices and arithmetic results must be exact
JavaScript safe integers. Reject fractional, rounded or overflowing values. Map
width and height must each be in `1..65,536`, matching
[`validateCanvasBounds`](../src/domain/canvas.ts). Partial chunks and negative
coordinates are valid; growth never rebases existing data. Do not store chunk
dimensions or promise exact camera rendering near safe-integer limits.

All numeric JSON tokens must use integer spelling (`-?(0|[1-9][0-9]*)`), without
fractions or exponents. Check their safe range before numeric conversion so a
fractional or oversized literal cannot round into an apparently valid integer.
Readers may accept `-0`; writers emit `0`.

IDs follow [`values.ts`](../src/domain/values.ts):
`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`. They are unique within each of the layer,
registry and annotation namespaces; the same spelling in different namespaces is
legal. Preserve case-sensitive IDs/references exactly. Names are not keys;
duplicate display names are legal. Never regenerate IDs, merge names or infer
identity from paint or array position. New authoring continues to generate fresh
UUID-based IDs after reopening; no allocation counter needs persistence.

Layer and registry names are nonblank strings (`name.trim().length > 0`); preserve
their original text. Authoring already trims newly submitted names. Annotation
names must also be trimmed and single-line (no CR, LF, U+2028 or U+2029), matching
the named-area feature. Reject an untrimmed annotation name rather than changing
it during load. All text is plain text, never HTML. Preserve Unicode and
description whitespace/line breaks exactly; apply no Unicode normalization.

### Ordered independent layers and sparse runs

`document.layers[0]` is bottommost; the last layer is topmost, opposite the panel's
displayed stack. Every layer has its complete occupied content, even if hidden or
fully covered. Empty layers have `runs: []`. Never flatten/composite layers, crop
to a viewport/selection, or omit hidden data.

Each `[x, y, length, paintIndex]` covers `[x, x + length)` on one world row y.
It never wraps to another row. Require a positive length, an existing zero-based
palette index, and the **entire** span inside map bounds. Validate `x + length`
with safe arithmetic before allocating or writing. Runs are sorted by numeric y,
then numeric x within each layer and must not overlap on that layer. Different
layers may overlap freely. Runs may cross visual or internal partition edges.

Every coordinate not covered by a run is **empty on that layer**. Empty is not a
palette entry: no `null`, sentinel index, transparent color or explicit empty run
is allowed. An empty 6,400 × 6,400 map needs only metadata and empty arrays, not
40,960,000 slots per layer. Decode occupied spans only.

### Paint palette and registry

The shared palette contains distinct occupied values. Raw paint is exact
unpremultiplied 8-bit sRGB RGBA, lowercase `#rrggbbaa`; preserve all alpha bytes
allowed by the low-level model, including `00`. UI authoring remains opaque.
Transparent raw paint is occupied: erasing removes it, movement treats it as
content, and round trips preserve its exact bytes. A registered value contains
only `registryId`, which must resolve to one
registry entry; never bake its current color into the association.

Registry entries have stable IDs, names and lowercase opaque `#rrggbbff` colors.
Each color has at most one registry owner, per the
[registry contract](registry-decisions.md). Duplicate IDs/colors, malformed
entries and dangling references reject the whole project. Raw paint may equal a
registry color and still means raw; loading never adopts it. Recoloring changes
only the registry entry, retaining references on every layer. Preserve unused
registry entries so they remain available to paint.

Palette indices are local encoding references, **not** document identities or
internal numeric tokens. Entries must be unique by `(kind, rgba)` or
`(kind, registryId)` and all must be used by at least one run. An empty document
has an empty palette. Never deduplicate raw/registered values by rendered color.
Restore domain values through their respective factories; storage tokens may
differ without changing content.

### Named areas and label settings

Persist every [named-area field](named-area-decisions.md#geometry-and-document-data),
including empty descriptions, author-selected tiers and center placement. Area
bounds must be nonempty, safe-integer and fully contained in the map. There is no
layer membership, parent, tile selection linkage or additional anchor. Overlapping
and nested areas, including those over empty tiles, are independent records.
Derive the center from bounds, including half-tile centers.

`label: { placement: "center" }` is the complete per-area label setting in v1.
Tier thresholds (8 and 1 CSS px/tile), text styles, collisions, ellipsis,
selected-area exception and screen positions are application/derived state,
not per-project options. Neither zoom nor suppression removes a saved record.

## Persisted preferences and session reset

`editor` is a project-only preference snapshot, separate from map meaning. Capture
it alongside committed content. `activeLayerId` must name an existing layer;
`hiddenLayerIds` must contain unique existing IDs. The active layer may be hidden
and all layers may be hidden. Restore exact preferences, keeping the existing
show-before-editing rule. A malformed reference is an error, not a fallback.
New maps use the first layer and no hidden layers.

| State                                                                                             | Persistence and reopen behavior                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bounds, ordered layers/tiles, complete registry and named areas                                   | Required document data; lossless for all valid v1 content.                                                            |
| Active layer and hidden layer IDs                                                                 | Required `editor` fields; restored after document validation.                                                         |
| Area tier and center label placement                                                              | Required area data, independent of current visibility.                                                                |
| Camera position/zoom                                                                              | Session-local; fit the map once the canvas has a real size.                                                           |
| Active tool, raw/registered paint choice, pencil/eraser size, rectangle mode                      | Session-local; current defaults: Inspect, raw `#91baa1ff`, size 1, filled. Registry entries themselves remain saved.  |
| Tile/area selection, included layer IDs, Inspect rectangle, area search/filter                    | Session-local; clear on replacement.                                                                                  |
| Clipboard, move/paste/transform previews, strokes/fill plans, draft forms/areas/dialogs           | Excluded; clear on replacement. Save captures committed content only; it never Applies a draft or finishes a gesture. |
| Focus, pointer, canvas size/DPR, renderer readiness, feedback, panel scroll/window geometry       | Session/app state, reset or recomputed; never document meaning.                                                       |
| Grids, thresholds, label layout, GPU textures, overview caches, indices and internal paint tokens | Application constants or derived resources; regenerate.                                                               |
| Undo/redo stacks and limits, document version, history/checkpoint tokens                          | Intentionally excluded. Open creates fresh history; no pre-save undo survives reopening.                              |
| File path, recent files, explicit-save/recovery status, timestamps, recovery ownership            | Native/session bookkeeping outside the project payload.                                                               |

Changing active/hidden preferences stays outside content history and does not
make the document dirty or discard redo. Explicit Save must still capture/write
current preferences even when content is clean; never skip it solely because
`revision === savedRevision`. Preference-only changes need no unsaved-map prompt,
guaranteed recovery scheduling, or undo entry. They persist on the next actual
explicit save/recovery snapshot; otherwise the previous saved preferences return.
Any future guarantee of saving preference-only changes needs separate tracking,
not fake document revisions.

## Determinism and snapshot boundary

Equal valid content and persisted preferences must encode to identical bytes,
regardless of mutation history, object insertion order, run segmentation or
sparse/dense storage promotion:

1. Keep layer order. Sort registry/annotation arrays by ID with case-sensitive
   ASCII comparison, never locale order. Sort hidden IDs likewise.
2. Include only referenced palette values: raw first sorted by RGBA text, then
   registered sorted by registry ID. Rebuild indices; never use token allocation
   or first-use order.
3. Emit each layer's runs in numeric `(y, x)` order. Coalesce touching spans of
   identical paint on one row, including across partition/chunk boundaries.
   Never merge across rows, layers or empty gaps.
4. Sort every object's keys in ASCII order recursively. Use ECMAScript
   `JSON.stringify` string escaping and integer number spelling, normalize `-0`
   to `0`, no indentation, and one trailing LF, encoded as UTF-8 without a BOM.
   Array orders follow the rules above; text is not trimmed/normalized.

Readers accept different object key order/JSON whitespace, unsorted
registry/annotation/palette/hidden arrays, and adjacent equal split runs. They
still enforce uniqueness, references and sorted nonoverlapping run order.
Re-encoding canonicalizes representation, never map meaning. Reject duplicate
JSON member names at every depth before normal object materialization; ordinary
`JSON.parse` alone cannot detect them. Reject invalid UTF-8, trailing non-JSON
data and extra root values as well.

Capture bounds, all metadata, every occupied run and editor preferences at
**one committed revision**, with a history checkpoint token outside the wire
data. Live iterators invalidate on edits and cannot survive asynchronous yields.
TW-034 must detach a coherent snapshot before async encoding, or retry a
version-checked capture as a whole. Copying metadata first and tiles after a yield
is not a snapshot. Never serialize gesture queues, previews, drafts or live React
state. Edits after capture belong to a later save and remain dirty when the older
snapshot is acknowledged. Snapshot/codec code stays independent of native
paths/dialogs. Measure extraction and encoding costs separately.

## Validation, resource limits and failure policy

Validate the **entire** candidate before replacing the workspace or touching its
saved checkpoint. Build a detached document, install validated metadata/runs,
then create fresh session/history and restore preferences. Failed/canceled reads,
parsing, validation or construction leave current content, history, selection,
preferences, file association and recovery data intact. Never expose partially
loaded layers. Report an error category and useful location such as
`document.layers[1].runs[3]`, displaying text safely as plain text.

V1 desktop codec resource policy is separate from semantic bounds. Use these
initial ceilings on **both writing and reading**, so the writer never knowingly
creates a file its reader refuses for these limits:

| Resource                             | Inclusive ceiling                                    |
| ------------------------------------ | ---------------------------------------------------- |
| Complete UTF-8 file                  | 268,435,456 bytes (256 MiB), including whitespace/LF |
| JSON container nesting               | 8 levels, root object at level 1                     |
| Layers                               | 1,024                                                |
| Registry entries; named areas        | 65,536 each                                          |
| Distinct palette values              | 1,000,000                                            |
| Runs across all layers               | 2,000,000                                            |
| Sum of run lengths across all layers | 100,000,000 occupied layer cells                     |

These are defensive capacity decisions, not measured memory/latency guarantees.
Names/descriptions have no additional truncation or per-field length cap; total
bytes still apply. Reject oversize documents before native write, with a useful
capacity error and dirty state intact. Never flatten, truncate or drop content to
fit. Raising ceilings later does not change v1 interpretation, but needs validation
and a recorded implementation-policy update.

Check bytes before reading/parsing the whole file and enforce the cap while
reading in case the source grows. Reject excessive nesting during lexical parsing
before recursive object construction. Check collection counts and span totals
using safe arithmetic before populating storage: tiny files can declare enormous
lengths. Validate shape, bounds, IDs, colors, order, overlap and references before
domain writes. Never allocate `width * height * layerCount` or a dense declared
palette/chunk space. Check cancellation during bounded parsing/population work.
Allocation OOM is not a recoverable JavaScript guarantee; limits reduce exposure
without proving it impossible. Scheduling/worker details belong to implementation;
performance-only misses remain deferred under [AGENTS.md](../AGENTS.md).

Review cases before implementation:

| Input or interruption                                                                                | Required result                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version 2, zero, omitted version or wrong `format`                                                   | Unsupported/malformed format error; no load or overwrite. Agent exports are not projects.                                                                                                        |
| Cut inside a string/run, missing delimiters, invalid UTF-8, trailing garbage                         | Parse error; never salvage a partial map. A complete valid JSON document with intentionally removed records cannot be detected without an external checksum/backup; v1 claims no such detection. |
| Duplicate JSON keys, unknown fields, duplicate IDs/paint values, registry color collisions           | Reject; never last-value-wins or silent field dropping.                                                                                                                                          |
| Missing registry ID, out-of-range palette index, unknown active/hidden layer                         | Reference error before publication; no RGB lookup, replacement identity or placeholder repair.                                                                                                   |
| Zero/negative length, fractional endpoint/index, overlapping/unsorted runs, span crossing a map edge | Reject atomically. Cross-layer overlap and cross-chunk spans remain valid.                                                                                                                       |
| Invalid tier/placement, area outside map, untrimmed/blank area name                                  | Reject; never clamp geometry, guess tier or drop the area.                                                                                                                                       |
| Width 65,537, unsafe endpoint/sum, tiny file declaring a billion-cell span                           | Reject before allocation. Width 65,536 with no tiles is valid and remains sparse.                                                                                                                |
| Target 6,400 × 6,400 with several empty layers                                                       | Metadata-only storage; no dense allocation for 40,960,000 positions per layer.                                                                                                                   |
| Valid spans exceeding 100,000,000 occupied layer cells or another resource ceiling                   | Capacity error even with small JSON. Count hidden/covered cells too.                                                                                                                             |
| Cancellation, disk read failure, candidate construction exception                                    | Release candidate; leave current workspace and source file untouched.                                                                                                                            |

Low-level model fixtures intentionally missing feature invariants can be rejected.
That is never permission to discard live data: encoding must identify the invalid
record and decoding must reject the file. No repair UI or unversioned metadata
migration is in scope.

## Explicit save, recovery and agent export

The payload contains neither `saved: true` nor revision/timestamp fields.
Successful explicit file load creates fresh history with `initiallySaved: true`;
new maps are dirty. Successful explicit write calls `markSaved` only for the
captured checkpoint after durable acknowledgement. Failure/cancellation never
does. Serialize writes to a destination so acknowledgements reflect durable order.
Native atomic replacement/dialogs remain save implementation work. See
[history checkpoints](command-history.md#revisions-explicit-saves-and-recovery).

Recovery may reuse validated project snapshot bytes, at a **separate local
destination** with its own versioned envelope/sidecar. Ownership/session identity,
originating explicit path, capture time, checkpoint provenance and discovery status
belong there, not in `ProjectV1` or annotations. Its exact schema, cadence and
restore UI belong to recovery tickets. Never reuse serialized history tokens
across sessions; they are controller-bound. Restoring recovery creates fresh
history marked **dirty**. Recovery write acknowledges only `markRecovery`, never
`markSaved`; it must not silently replace an explicit file or masquerade as an
explicit Open acknowledgement. Preferences may ride with a recovery snapshot
without becoming map meaning.

Agent export has a separate purpose/schema owned by TW-043 onward. It must retain
whole-map layers/order/underlying content, raw versus named meaning and named
areas/descriptions, excluding editor preferences, native paths, recovery metadata,
saved checkpoints, undo and previews. Sharing JSON does not make envelopes
interchangeable. Never implement export by renaming/copying a `.tilewright` file
or exporting only visible composited pixels. No agent-import feature is implied.

## Annotated example and inspection round trip

The complete, pretty-printed JSON fixture is
[project-v1.tilewright](examples/project-v1.tilewright). Whitespace/key order make
it readable; canonical encoding compacts/sorts it as specified above. Its map is
6,400 × 6,400 with bounds `[-64,6336) × [-64,6336)`, but only **nine runs and
16 occupied layer cells**. This is an inspection fixture, not a claim of an
implemented codec or native filesystem round trip.

| Encoded part                                                         | Source state and reconstruction by inspection                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layers: terrain, buildings, notes                                    | Restore IDs/names bottom-to-top; notes is empty. At `(63,63)`, building raw black covers registered terrain without replacing it.                                                                                                                                    |
| Palette 0, 1, 2                                                      | Raw transparent black, opaque black, raw `#629653ff`. Index 0 is occupied paint, never empty.                                                                                                                                                                        |
| Palette 3, 4                                                         | Registered grass and stone. Grass currently equals raw palette[2], but their identities remain distinct.                                                                                                                                                             |
| Terrain `[-1,-1,2,3]`                                                | Registered grass at `(-1,-1)` and `(0,-1)`, crossing negative/zero without rebasing.                                                                                                                                                                                 |
| Terrain `[62,63,4,3]`                                                | Grass at x=62..65 on y=63, beneath buildings and across x=64.                                                                                                                                                                                                        |
| Terrain `[62,64,1,2]`, `[64,64,1,0]`, `[6335,6335,1,1]`              | Raw grass, occupied transparent black, and opaque black at the final valid address. Other unspecified terrain cells are empty.                                                                                                                                       |
| Buildings `[63,63,1,1]`, `[64,63,2,4]`, `[63,64,3,4]`, `[66,64,1,2]` | Raw black; two then three stone cells; one raw grass cell. Hidden status preserves all seven occupied cells. `(62,63)` on buildings and every notes cell are empty.                                                                                                  |
| Complete registry                                                    | Grass/stone plus unused water. Recolor grass to `#335c46ff`: only six registered terrain cells change appearance. The two raw grass cells retain `#629653ff`; IDs/runs remain unchanged.                                                                             |
| Three annotations                                                    | Detail house crosses chunk boundaries; locality village has empty description; region includes negative bounds. Restore full strings, bounds, tiers and center placement. Centers are `(64,64)`, `(64,64)`, `(480,480)` for house/village/region, without hierarchy. |
| Editor                                                               | Buildings is active **and hidden**; terrain/notes visible. Restore without revealing buildings. Start Inspect/fitted view with empty clipboard, selection and undo stacks.                                                                                           |

Reverse mapping: create a detached `MapDocument` with stated bounds/layers;
install registry/area records with IDs as metadata keys, without duplicating
`id` in payloads; resolve indices to raw/registered domain values; write the nine
spans; restore editor preferences in a fresh session. Enumerate occupied runs and
sorted metadata into the same wire shapes, rebuilding the palette canonically.
Every persisted field and hole is accounted for. Hiding/showing buildings changes
only composition; moving its tiles leaves area fields fixed. The fixture can seed
TW-034/TW-035 golden codec tests.

The existing populated golden fixtures have 138,222 and 500,802 recipe runs and
6,620,700 and 24,025,200 occupied layer cells respectively
([expected.json](../tests/fixtures/expected.json)). Their counts fit the initial
run/cell ceilings; this is a count review, not an encoded-byte-size, codec memory,
latency or native-I/O measurement. Actual checks and inspection evidence are in
the TW-033 ticket.

## Snapshot and encoder implementation (TW-034)

[`project-format.ts`](../src/domain/project-format.ts) defines readonly v1 wire
types, shared capacity constants and `ProjectEncodingError` with a `category`
(`invalid-data`, `capacity`, or `canceled`) and field `path`.
[`project.ts`](../src/domain/project.ts) provides two operations:

- `captureProjectSnapshot(history, preferences, options?)` synchronously validates
  and detaches one committed revision into a deeply frozen `ProjectSnapshot`.
  `snapshot.project` holds only v1 data; `checkpoint` and `documentVersion` stay
  outside the payload. No live iterator or controller is retained. Immutable
  metadata/paint values can safely be shared; run arrays, indices and preferences
  are detached. Capture validates feature records/references and rejects unknown
  fields instead of dropping them. Model primitives already enforce identities,
  safe run arithmetic and nonoverlap; their iterator coalesces ordered spans.
- `encodeProjectSnapshot(snapshot, { signal?, yieldControl? }?)` returns canonical
  UTF-8 `Uint8Array` bytes with one trailing LF. By default it yields to a timer
  before encoding and between approximately 32 KiB character batches. Long strings
  are escaped in slices preserving surrogate pairs and exact `JSON.stringify`
  output. Final byte assembly yields after every sixteen chunks. It accepts only
  snapshots captured by this module, not arbitrary or spread/copied objects.

`EditorSession.captureProjectSnapshot(options?)` captures its history and just
the active/hidden layer preferences in one synchronous call, including when
content is clean or has redo available. It never reads or commits drawing queues,
tile/area selection, clipboard, placements or drafts. Closed sessions reject it.
The caller must capture before its first await and keep the matching token:

```ts
const snapshot = session.captureProjectSnapshot();
const bytes = await encodeProjectSnapshot(snapshot);
// Future save coordinator: write these bytes atomically to the chosen destination.
// Only on that write's successful acknowledgement:
// session.history.markSaved(snapshot.checkpoint);
```

`MapDocument.assertCommittedRead` rejects capture during transactions/mutation
callbacks; history rejects edits outside its controller. Capture also verifies
version/revision before publication. Later edits, undo/redo, layer removal,
recolor or preference changes cannot affect the snapshot. An older acknowledged
token leaves newer content dirty. Neither API acknowledges saved/recovery state.
Ordering native writes and assigning file paths remain the save coordinator's job.

Collection/run/cell ceilings apply during capture; the complete UTF-8 byte ceiling
(including LF) applies incrementally during encoding. The closed wire shape has
maximum container depth six, below the v1 ceiling of eight. Optional capture
`limits` may lower capacities for constrained destinations/testing but cannot
raise policy ceilings. Encoding cancellation or capacity failure returns no file.

[`project-snapshot.test.ts`](../tests/domain/project-snapshot.test.ts) and
[`project-encoding.test.ts`](../tests/domain/project-encoding.test.ts) cover all
fields, immutable capture, equivalent storage/mutation histories, Unicode/integer
extremes, capacity boundaries, invalid metadata/references, cancellation, preview
exclusion, preference-only saves and edits during asynchronous encoding (including
real timer tasks). The [canonical golden bytes](../tests/fixtures/project-v1.canonical.tilewright)
are an independently sorted/minified copy of the reviewed example, intentionally
compact. No decoder or native write is implied by these tests.

Both complete populated fixtures encode all four layers, five registry records
and 1,089 named areas. A test adapter reads **every run from emitted JSON bytes**
into the existing independent golden occupancy/hash oracle. All metadata and
preferences are compared separately. Frontier encodes to 123,870 canonical runs /
2,340,632 bytes; heartland to 470,490 runs / 8,114,368 bytes. Occupied layer-cell
counts remain 6,620,700 and 24,025,200, including hidden/covered content.

Tests report extraction and encoding durations separately. Initial Node v24.22.3
project-suite samples measured approximately 106/171 ms for frontier and 274/839 ms
for heartland (capture/encoding, one sample each, with concurrent build activity).
These are correctness-run timings, not native save or percentile benchmarks.
Capture and palette construction remain synchronous; encoded chunks coexist
temporarily with the final byte buffer. Native I/O, UI presentation and peak
process memory are unmeasured. These performance limitations remain for TW-050
(TW-049 for presentation), following AGENTS.md's delivery priority.
