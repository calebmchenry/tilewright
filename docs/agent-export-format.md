# Whole-map agent format, version 1

Decision record for [TW-043](../.wrk/wrk-eeabc6ef.md), subordinate to
[INTENT.md](../INTENT.md#project-files-and-agent-exports). These are implementation
choices resolving the open export decisions. TW-044 implements capture and encoding;
TW-045 adds the native export action and reliable local publication. TW-043 supplies
the public contract, example and size study.

## Container and public contract

An agent export is one uncompressed UTF-8 JSON object, normally named
`<name>.agent-map.json`, with MIME type `application/json`. No BOM, comments,
external resources, executable content or archive members. Identify it by
`format: "tilewright-agent-map"` and integer `version: 1`, never by the filename.
Versioning is independent of the application and editable-project versions.
Consumers must reject unsupported versions rather than guess their meaning.

This is a **separate public schema** from `tilewright-project`: it has no
`document` or `editor` envelope, resolves color values and meanings together,
and exports semantic areas without editor label-placement settings. It is not
accepted by project Open and does not promise project reconstruction. An agent
needs only this specification and the export, never a project file or editor API.

All properties below are required. Objects have only the specified properties;
empty collections use `[]`, and at least one layer is required. The matching independent wire types are in
[`agent-export-format.ts`](../src/domain/agent-export-format.ts); these types
describe shape, not runtime validation.

```ts
type AgentMapV1 = {
  format: "tilewright-agent-map";
  version: 1;
  bounds: Bounds;
  colors: Color[];
  layers: { id: string; name: string; runs: Run[] }[];
  areas: {
    id: string;
    name: string;
    description: string;
    tier: "detail" | "locality" | "region";
    bounds: Bounds;
  }[];
};
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Color =
  | { kind: "raw"; rgba: string; meaning: null }
  | { kind: "registered"; registryId: string; rgba: string; meaning: string };
type Run = [x: number, y: number, length: number, colorIndex: number];
```

JSON and a shared color table keep the file readable without repeating color
objects or long IDs per tile. Sparse horizontal runs compress contiguous paint
without exposing internal partitions or requiring dense arrays. Binary formats,
compression, flattened images and per-cell objects are not the v1 encoding.
Highly varied paint can still require one run per occupied cell; this decision
does not claim a general compression ratio or performance budget pass.

## Coordinates, dimensions and empty cells

One unit is one game tile. The fixed origin `(0, 0)` is the initial map's top-left
grid intersection; x increases right and y increases down. Addresses are signed
integers, never screen pixels or offsets from the current map minimum. Explicit
growth to the left/top retains existing addresses and can introduce negatives.

Bounds cover `[minX, maxX) × [minY, maxY)`. Width is `maxX - minX`, height is
`maxY - minY`; neither dimension is redundantly stored. Both must be in
`1..65,536`, matching the existing canvas. Tile `(x, y)` occupies
`[x, x + 1) × [y, y + 1)`. Endpoints, dimensions, coordinates, run lengths,
indices and arithmetic results must be exact safe integers
(`-9,007,199,254,740,991..9,007,199,254,740,991`). Numeric tokens use integer
spelling, without fractions or exponents; writers normalize negative zero to zero.
Readers must check lexical range before a conversion could round an invalid value.

The bounds always describe the **entire map**, including empty margins, distant
content and newly grown space. There is no selection, crop, viewport, offset or
export-scope parameter. Visual 64 × 64 chunks and internal storage partitions
are irrelevant to interpretation; runs may cross either boundary.

A coordinate omitted from a layer's runs is empty **on that layer**. Empty has
no color, sentinel index, `null` run or explicit storage. Outside the bounds is
outside the map, not an empty cell. Black, white and transparent paint are all
occupied values. A fully empty map retains its bounds, at least one named layer,
all registered meanings and any areas, with empty run arrays.

## Layers and run interpretation

The `layers` array is bottom to top. IDs are stable, names retain the author's
text, and empty layers are retained. Every occupied cell of every layer is
represented, including tiles obscured by other layers and layers hidden in the
editor. Overlap between layers is intentional and never resolves by deletion.

Editor layer visibility is **omitted and ignored**: hidden is an editing/viewing
preference, not a statement that content is absent from the game world. The export
is identical for the same map with different active/hidden layers, selections,
camera positions and zoom. An agent must consider all layers. A consumer drawing
a preview may compose them in array order, bottom to top, using RGBA source-over;
that preview must not replace the independent semantic content. No collision,
height, walkability, material or other game behavior is inferred from stack order.

`[x, y, length, colorIndex]` means that every tile at `(x + i, y)` for integer
`0 <= i < length` uses `colors[colorIndex]`. Length is positive, the zero-based
index exists, and the entire span lies inside the map. Runs never wrap rows.
Within each layer they are sorted by numeric y, then x, and cannot overlap.
Canonical writers coalesce adjacent runs of the same color on the same row,
including across chunk boundaries, but never merge across empty gaps or rows.
Readers may accept adjacent split runs with the same color; their meaning is equal.

To interpret a tile, locate its covering run independently in each layer and
resolve its color-table entry. Do not choose only the topmost occupied tile.
This works directly on the run lists without allocating the whole grid.

## Color values, meanings and unlabeled paint

Every color entry gives its exact, unpremultiplied 8-bit sRGB RGBA as lowercase
`#rrggbbaa`. Raw alpha, including `00`, is preserved. Current registry entries
are opaque (`ff`). Neither alpha nor matching the background makes a cell empty.

- **Registered:** `registryId` is the stable source registry ID, `meaning` is
  the exact registered name, and `rgba` is its current color at capture time.
  Recoloring changes that color without changing the ID or tile association.
  Include **every registered entry**, even if no run references it, so the full
  authored vocabulary is available. An unused entry does not imply any tiles.
- **Raw:** `meaning` is explicitly `null`; include one entry for each distinct
  raw RGBA actually used. This means "occupied paint with no author-assigned
  meaning", not empty or unknown location. Preserve it without warnings that
  block export, guessing labels, dropping tiles or assigning a registry ID.
  Color equality with a registered entry **does not confer its meaning**.
  An agent can describe the exact color and position but must distinguish that
  observation from any inferred game purpose.

Indices are local encoding references, not identities or internal paint tokens.
Raw entries are unique by RGBA; registered entries are unique by registry ID.
The same RGBA may occur once as raw and once as registered. Registered colors
have unique owners under the existing registry contract; duplicate meanings are
allowed. No separate registry lookup, history, recolor log or editor palette is
needed. There are no dangling IDs: each registered entry carries its meaning and
color in full. Invalid source registry records or unresolved tile references
must fail export, never silently turn into raw paint or placeholders.

## Named areas and text

Export all areas with stable IDs, names, full descriptions, author-selected tiers
and nonempty rectangles fully inside map bounds. Preserve empty descriptions,
Unicode and line breaks exactly. Bounds use the same tile coordinates and
half-open endpoints as the map; areas may overlap, contain other areas or cover
empty tiles. Containment does not create a parent-child relation. Areas are
independent of layers and tile operations; their geometry is never recomputed
from painted content or a tile selection.

`detail`, `locality` and `region` communicate the author's chosen scope (for
example, house, village and wider region). They are not layer membership,
gameplay types or a requirement to hide other tiers. Every tier is exported
regardless of zoom or label collision suppression. Center placement, label
thresholds/styles and screen anchors are omitted. A consumer can derive an
optional geometric center from the bounds without a renderer.

Layer, registry and area IDs use `^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$` and are
case-sensitive and unique within their separate namespaces. Preserve IDs;
duplicate display names never merge records. Layer names and registered meanings
must be nonblank strings; area names must additionally be trimmed and single-line
(no CR, LF, U+2028 or U+2029). Text is plain text, not HTML or executable instructions.
Do not trim descriptions, normalize Unicode, truncate names or invent semantics.

## Determinism, capture and validity

Canonical output follows these rules, independent of editing/storage history:

1. Preserve layer order. Sort areas by ID with case-sensitive ASCII comparison.
2. Put used raw colors first, sorted by RGBA, then all registered colors sorted
   by registry ID. Remap every run index accordingly.
3. Sort/coalesce each layer's runs as above. Preserve all map bounds and metadata.
4. Sort object keys recursively by ASCII order. Use ECMAScript `JSON.stringify`
   string escaping, integer number spelling, no indentation and one trailing LF.
   Encode UTF-8 without a BOM. Pretty JSON is valid, but is not canonical output.

Consumers may accept reordered object keys, color/area arrays and whitespace,
with references interpreted against the actual array order. Reject duplicate JSON
keys, unknown properties, wrong types/version, unsafe numbers, invalid bounds,
duplicate identities, invalid colors, absent meanings, invalid run references,
unsorted/overlapping runs and out-of-bounds areas/spans. No missing fields have
defaults. Do not salvage an incomplete or malformed file as a complete map.

TW-044 must capture a coherent committed revision before asynchronous encoding,
including current registry values and every area's full text. It may reuse
validated domain snapshot machinery, but must construct this separate wire
format and never expose the editable-project object as the export. Drafts,
pending gestures and previews are not committed content. Export must not change
the map, undo/redo, dirty/save/recovery checkpoints or the editable-project path.

The initial exporter capacity policy is 256 MiB of UTF-8 output including LF,
1,024 layers, 65,536 registered entries, 65,536 areas, 1,000,000 total colors,
2,000,000 runs and 100,000,000 occupied layer cells. Count unused registered
entries in the color total and hidden/covered tiles in the cell total. These are
defensive implementation limits, independent of interpretation and not measured
latency/memory guarantees. Exceeding a limit or invalid source content must fail
before publishing a final file, without flattening, cropping or truncating data.
Native publication, action/progress UI and user-facing cancellation belong to TW-045;
the TW-044 codec exposes an encoding cancellation signal for that coordinator.

No editor caches, overview images, GPU resources, storage partitions/tokens,
history/revisions, save/recovery metadata, paths, active tools, visibility flags,
selection/clipboard, camera, grid settings or label layout appear in this schema.
Selected-area export and direct game-import compatibility remain deferred; no
game units beyond tile coordinates, assets, 3D heights or importer are promised.

## Human-readable example

[`agent-map-v1.json`](examples/agent-map-v1.json) is a complete 6 × 5 map with
negative minima, two overlapping layers, three raw colors, three registered
meanings, and independent house/village areas. It is pretty-printed for reading.

- Terrain is bottommost. At `(1, 0)` Grass remains under Stone wall in Buildings.
  At `(1, 1)` Grass remains under raw black, whose meaning is `null`.
- `(4, 2)` is raw green with no meaning, even though its RGBA equals Grass.
  `(-1, -1)` is occupied transparent white. `(4, 3)` is empty on both layers;
  `(5, 3)` is outside the map. Water is registered but has no tiles.
- House bounds `[1, 3) × [0, 2)` contain four positions. Village bounds
  `[0, 5) × [0, 3)` contain fifteen; neither changes the underlying paint or
  establishes an explicit hierarchy. The village description contains a newline.
- This is also the required output if the source Buildings layer is hidden.
  Hiding Terrain or all layers cannot remove any of its 18 occupied layer cells.

## Size study and validation

Run `node scripts/agent-export-size.ts` using the pinned Node version. This is a
fixture-only encoding study, not the production exporter or a benchmark of it.
It validates the example's interpreted cells, normalizes the complete existing
frontier/heartland fixture runs to this schema, parses the resulting JSON and
compares every run with the source. It compares source summaries against the
checked-in golden hashes/counts and records canonical byte counts and hashes.

The fixture recipe has no areas. The study explicitly adds two annotations for
the first village and its central 8 × 8 house, with full descriptions and bounds,
counting their bytes. Its four layers include every occupied tile; it creates no editor state. The
retained report is [`agent-export-size.json`](agent-export-size.json).

Measured with Node 24.22.3 on 2026-11-19 (compact canonical UTF-8, including LF):

| Fixture      | Occupied layer cells | Canonical runs |     Bytes |   MiB |
| ------------ | -------------------: | -------------: | --------: | ----: |
| frontier-v1  |            6,620,700 |        123,870 | 2,064,469 | 1.969 |
| heartland-v1 |           24,025,200 |        470,490 | 7,838,205 | 7.475 |

Both are 6,400 × 6,400 maps with four layers and six colors. The two added areas
contribute 431 bytes per file. All 64,944 overlapping positions per fixture
retain their underlying layer content. Decoded runs reproduce the full golden
fixture hashes (frontier `de4ed786…552617`, heartland `c1e44439…61d33`); complete
hashes and source hashes are in the report. The readable example has 14 Terrain
cells and four Buildings cells and takes 1,133 bytes when canonicalized.

The evidence script imports only public wire types, fixture data and the fixture
inspector; it uses no project codec, editor session, renderer or history. Tile
locations resolve from bounds/runs, meanings from `colors`, ordering/names from
`layers`, and descriptions/geometry from `areas`. Thus all interpretation inputs
are in the export and this specification. Hidden-source capture behavior remains
an implementation validation for TW-044; this study establishes its contract,
not a working application export action.

Encoding time, peak memory, native I/O and agent context limits are not measured
by this size estimate. Performance-only issues remain nonblocking
under the current delivery priority; rendering/presentation refinement belongs
to TW-049, large edit/history/memory refinement to TW-050, and export profiling
to TW-051.

## Snapshot and encoder implementation (TW-044)

[`agent-export.ts`](../src/domain/agent-export.ts) implements this public contract
directly from the sparse domain model. It imports neither the project schema/codec
nor editor/renderer modules. The only shared machinery is domain validation,
committed-read guards, history checkpoints and the model's ordered run iterator.

- `captureAgentExportSnapshot(history, { limits? }?)` synchronously captures one
  committed revision as a deeply frozen `AgentExportSnapshot`. `snapshot.map`
  contains only the public wire shape; `checkpoint` and `documentVersion` remain
  outside it. All runs are detached before an asynchronous boundary, and registry
  colors/names and area text/geometry are resolved at capture time. Reentrant
  capture and edits bypassing history reject; capture verifies the version and
  revision again before publishing the snapshot.
- `encodeAgentExportSnapshot(snapshot, { signal?, yieldControl? }?)` accepts only
  snapshots produced by capture and returns canonical UTF-8 `Uint8Array` bytes.
  It reads no live document or editor state. It yields to timer tasks before
  encoding, between approximately 32 KiB character batches and every sixteen
  chunks during final assembly. Large strings use bounded escaping slices that
  keep surrogate pairs intact. Null raw meanings, unpaired surrogates, negative
  zero and safe-integer coordinates follow ECMAScript JSON spelling exactly.
- `EditorSession.captureAgentExportSnapshot(options?)` is the session entry point.
  It rejects closed sessions and delegates only the history, never active/hidden
  layers, selection, viewport, filenames, overview data, pending gestures or drafts.
  Neither API changes history, redo, dirty/save/recovery checkpoints or project paths.

```ts
const snapshot = session.captureAgentExportSnapshot(); // before the first await
const bytes = await encodeAgentExportSnapshot(snapshot, { signal });
// TW-045 publishes bytes atomically to the chosen export destination.
// Export is not a project save: do not markSaved or markRecovery.
```

Capture traverses every layer's occupied runs without a window or visibility
filter. Model iteration already sorts and coalesces across 32-tile storage and
64-tile visual boundaries. Empty layers/margins remain, underlying tiles are never
composited, and all registry entries (including unused ones) become resolved
colors. Only used raw colors enter the table, separately from equal registered
RGBA. A final color sort remaps indices without changing coverage. Area IDs are
already ASCII-sorted by the model; only the validated center-placement field is
intentionally omitted from the semantic wire shape.

Feature validation rejects malformed/unknown registry and area properties,
ambiguous registry ownership, invalid geometry/tiers and unresolved paint IDs.
Domain primitives already enforce layer names/IDs, tile values, bounds arithmetic
and ordered nonoverlapping runs. `AgentExportError` carries `category`
(`invalid-data`, `capacity`, `canceled`) and `path`. Collection/run/cell limits
apply during capture; byte limits apply incrementally to encoded UTF-8 including
the trailing LF. Per-capture limits can only lower the independent
`AGENT_EXPORT_LIMITS` ceilings. A failure returns no partial byte array.

[`agent-export.test.ts`](../tests/domain/agent-export.test.ts) and
[`agent-export-snapshot.test.ts`](../tests/domain/agent-export-snapshot.test.ts)
verify the reviewed example's exact canonical SHA-256, raw/registered equality,
recolor/undo/redo, all tiers, empty layers, sparse gaps, boundary coalescing,
safe-integer extremes, Unicode, capacity boundaries, invalid source rejection,
cancellation and edits during asynchronous encoding (including a real timer edit).
They compare identical bytes across viewport/active/hidden-layer combinations,
selection/move/transform/paste previews, area drafts, unsaved/saved paths and
empty/pending/warm/stale/destroyed overview caches.

Both complete 6,400 × 6,400 fixtures are loaded into real `MapDocument` storage,
with all 1,089 house/village/region annotations. Parsed export bytes are translated
independently into the fixture inspector's lattice; complete content hashes,
occupancy, overlap counts, layer order/names, resolved meanings and every area field
must match. The 17 focused tests passed with Node 24.22.3 on 2026-11-19:

| Fixture      | Occupied layer cells | Canonical runs | UTF-8 bytes | Capture ms | Encode ms |
| ------------ | -------------------: | -------------: | ----------: | ---------: | --------: |
| frontier-v1  |            6,620,700 |        123,870 |   2,306,718 |     161.40 |    286.10 |
| heartland-v1 |           24,025,200 |        470,490 |   8,080,454 |     364.19 |    927.30 |

These are single Node samples under concurrent browser-test load, not native I/O
or performance gate results. The files are larger than TW-043's estimate because
they contain 1,089 areas instead of two. Golden content hashes remain frontier
`de4ed786f9a80c42b6ab3939c08990b40484975b2dc77eeea147591bab552617` and heartland
`c1e4443944ee8d9576529a88029c3aad854fa33c251e1d91c70adad8f8361d33`.

Capture is synchronous and proportional to occupied storage/runs; its observed
long tasks remain a limitation. Snapshot runs, encoded chunks and final bytes
coexist transiently; peak memory and native responsiveness are not measured here.
The current delivery policy defers performance-only refinement to TW-049/TW-050
and export profiling to TW-051. TW-045 still owns native dialogs, progress,
destination handling and atomic writes; this codec performs no file I/O.

## Native export workflow (TW-045)

**Export for Agent…** appears in the toolbar and native File menu, with
Cmd+Shift+E. The native save panel suggests `<project-name>.agent-map.json`
(or `Untitled.agent-map.json`) and filters JSON. The confirmed name must end in
`.json`; the panel handles extension and existing-file replacement confirmation.
No extension is silently changed after confirmation. Export works with the
packaged app's embedded assets and local IPC, without a server or network service.

[`editor/agent-export.ts`](../src/editor/agent-export.ts) captures the entire
committed map, including unsaved edits, before opening the picker. Later edits
remain in the editor and belong to the next export. Drafts and previews remain
excluded by the existing snapshot contract. This coordinator owns separate
feedback and never changes the project path, save/recovery checkpoints, undo/redo
or recovery lineage. The shared document-action gate prevents overlapping
New/Open/Save/restore/close operations; normal editing and recovery scheduling
continue during export. Menu, button and shortcut dispatch use that same gate.

The footer reports capture, destination selection, encoding with actual KiB
encoded, temporary writing, and final publication. Its indeterminate progress bar
does not invent a total before encoding finishes. Cancel is available during
encoding and temporary writing; the native panel has its own Cancel. A cancel
while native I/O is pending waits for it to settle, then deletes the unpublished
temporary file. The short final atomic publication phase is noncancelable.
Success is reported only after native publication; directory-sync failure is a
success with an explicit durability warning. Errors and cancellation have distinct
plain-text feedback, and allow retry without changing project state.

[`native/agent-export.ts`](../src/native/agent-export.ts) uses four narrowly
permitted Rust commands in [`agent_export.rs`](../src-tauri/src/agent_export.rs).
The picker issues a separate, single-use export handle. Preparation accepts binary
IPC (1 byte–256 MiB), validates the destination, creates an exclusive private
`.tilewright-agent-*.tmp` sibling, writes complete bytes and syncs them. Commit
rechecks the destination and atomically renames the sibling, then syncs the parent.
Cancel drops the handle and its unpublished sibling. Native I/O uses blocking
workers and a serialized export mutex; no filesystem, shell or general dialog
permission is granted to the webview. A new grant drops abandoned unpublished
export state rather than accumulating handles or temporary files.

Paths are resolved at selection, including symlinks, and checked again before
writing and publication. JSON destinations that resolve to a different extension
are rejected. The active project path is protected by canonical path and device /
inode equality, including symlink and hard-link aliases even when an opened
project has a `.json` name. Substituted final symlinks/nonregular files, read-only
files, missing parents and unwritable locations fail without truncating the
existing destination. Existing Unix modes survive replacement; new files are
private. The same local atomic-rename limits as project Save apply: no claim of
power-loss durability for every filesystem, no preservation of arbitrary ACLs or
extended attributes, and no detection of another application's concurrent edits.
Abrupt process termination can leave a clearly temporary sibling; it is never a
completed export or recovery checkpoint.

Validation lives in `tests/domain/agent-export-files.test.ts`, the export cases in
`tests/project-files.spec.ts`, and the native `agent_export.rs` tests. These cover
unsaved content, state isolation, original bytes, active-path aliases, overwrite,
write/sync/rename failures, read-only destinations, cancellation and late edits,
menu/shortcut gating, continued recovery, and target-scale encoding progress.
Actual packaged-app results and command evidence are recorded in TW-045's ticket.

Capture and final byte assembly still have synchronous portions, and snapshot,
codec chunks, IPC bytes and native staging coexist in memory. Encoding yields to
timer tasks; native I/O never runs on the UI thread. Target-scale correctness and
cancellation tests do not establish latency percentiles or peak-memory budgets.
Per AGENTS.md, those performance-only refinements remain TW-049/TW-050, with
end-to-end export profiling in TW-051.

## Browser export workflow (TW-058)

**Export for Agent** in the browser header, or Cmd/Ctrl+Shift+E where the browser
delivers it, requests a local JSON download. The suggested name is
`<project-name>.agent-map.json`, or `Untitled.agent-map.json` for a new map. Names
use the project-download sanitization policy, retain Unicode, and replace a
`.tilewright` or `.json` extension. The browser controls the actual destination
and may change the filename. This action requires no backend, native IPC or
network transfer of project content.

The shared [`AgentExports`](../src/editor/agent-export.ts) coordinator captures
one committed snapshot before any asynchronous work. The unchanged domain
encoder emits exactly the desktop format, including all hidden, covered and
offscreen layers, empty layers, registered meanings, raw colors and every named
area. Selection, camera and zoom cannot narrow it. Edits during encoding remain
in the editor and appear in the next export; drafts and previews remain excluded.

Encoding shows indeterminate progress and actual KiB produced. **Cancel export**
or Escape outside text fields stops encoding before download handoff; disposal or
document replacement also prevents handoff. Cancellation requests no download
and leaves no Blob URL. Capture and final byte assembly still have synchronous
portions, so cancellation is serviced at the encoder's existing yield points.

Once the complete bytes are handed to the browser, the editor's Cancel control
is disabled. Feedback says **Agent map download requested**, explicitly states
that disk persistence is unconfirmed, and directs the user to manage or cancel
the download in the browser. These messages remain visible until dismissed.
The page cannot observe a later blocked/canceled download or guarantee a disk
write. Observable handoff errors are reported separately and permit retry.

[`browser-download.ts`](../src/platform/browser-download.ts) is the same
`application/json` Blob/anchor helper used by editable-project downloads. It
removes the anchor immediately, revokes the object URL after the existing
one-second handoff delay (immediately on observable failure), and completes that
cleanup even if the editor is disposed. Repeated exports retain no handles or
download URLs after cleanup.

Agent export never changes the project filename/source, project download request
or timestamp, native save checkpoint, unsaved status, undo/redo, recovery revision
or lineage. The shared document-action gate prevents overlapping file operations,
while editing and independent recovery scheduling continue. Native picker,
temporary-write, atomic commit, cleanup and durability-warning behavior remain
unchanged.

Validation in `tests/browser-agent-export.spec.ts` uses the shipping entry with
real chooser imports and browser download events. Downloaded bytes pass through
the standalone Python consumer and source-derived semantic oracle, including the
golden raw/registered-color map and both full populated fixtures below. Tests also
exercise selection/zoom independence, edits during real encoder yields, button
and Escape cancellation, blocked handoffs, repeated resource cleanup, application
disposal and visible compact-window feedback. `tests/domain/browser-agent-export.test.ts`
covers project/download/history/recovery isolation, replacement/disposal races,
final-progress cancellation, filename policy and retries. Browser/platform and
native export regressions remain required. Actual run counts and qualification
limits are recorded in TW-058's WRK ticket.

Target-scale correctness does not establish peak memory or latency budgets.
Snapshot, encoded chunks, final bytes and Blob storage may coexist. The existing
TW-049/TW-050 performance deferrals remain unchanged; no dependency is added to
the deferred release backlog.

## Independent consumer verification (TW-046)

[`consume-agent-map.py`](../scripts/consume-agent-map.py) is a standalone Python
3.9+ standard-library reader written against the public contract above. Copy it
and an export to any directory; no installation, project decoder, TypeScript
module, editor state, rendering cache or server is needed. Python is validation
tooling, not a dependency of the packaged editor.

```sh
python3 scripts/consume-agent-map.py docs/examples/agent-consumer-v1.json
python3 scripts/consume-agent-map.py docs/examples/agent-consumer-v1.json --at 1 0
python3 scripts/consume-agent-map.py docs/examples/agent-consumer-v1.json --cells
```

The first command validates and reports full bounds, colors, areas and ordered
layer summaries. `--at X Y` adds every layer's color at the address and all
containing area IDs; a layer's `color: null` means empty, whereas a raw color
object with `meaning: null` means occupied unlabeled paint. An outside-map query
fails. `--cells` emits one JSON line per occupied cell, retaining `layerId`,
zero-based `layerOrder`, world `x`/`y` and the complete resolved `color`. It is
lazy but can produce millions of lines; use summaries or coordinate queries for
large maps. Pass `-` instead of a path to read export bytes from standard input.

The reader validates the entire input before emitting anything. Errors exit 1
with a diagnostic on stderr and no partial output. It rejects duplicate keys
(including escaped aliases), invalid UTF-8/BOM, fractional/exponent/unsafe numeric
tokens, incorrect fields/types/version, duplicate identities or color owners,
unresolved references, invalid bounds, unordered/overlapping runs and invalid
areas. Python's exact integer arithmetic checks lexical range without rounding;
booleans are not integers. The reader applies the published exporter capacity
ceilings as its own input policy. Noncanonical key/color/area order, whitespace,
and adjacent split runs remain valid. Names and descriptions are plain text;
they are never evaluated or treated as instructions.

The returned dictionary retains sparse horizontal runs. Validation and summaries
take O(bytes + runs + metadata) work/storage, never width × height × layers.
Coordinate lookup uses binary search in each layer's ordered runs plus an area
scan. `iter_cells` expands only as requested. This reader loads JSON in memory;
it is not a streaming JSON parser or a peak-memory guarantee at the capacity cap.

### Reading the golden map as an agent

[`agent-consumer-v1.json`](examples/agent-consumer-v1.json) is the actual production
export of the independently authored
[`consumerGoldenSession`](../tests/fixtures/agent-consumer.ts), pretty-printed.
The source recolors Grass from `#629653ff` to `#335c46ff`, renames it Meadow,
and hides Walls and Furniture before capture. The four layers retain **28
occupied layer cells in 13 runs**: Terrain 20, Walls 4, Furniture 4, and an empty
top layer also named Furniture. Layer IDs distinguish those equal display names.
Compact production output is 1,520 bytes; SHA-256 is
`95ad511e2a18b0c467fbe50f4541eb95d686f394b26533b1f76a28edf5e49d7b`.

An agent can read the file in this order:

1. `bounds` gives `[-2, 6) × [-1, 5)`, an 8 × 6 map. Addresses are world tiles,
   x right/y down, with exclusive maxima; do not offset them by the negative minima.
2. `layers` is bottom to top. For `(1, 0)`, Terrain's `[-1, 0, 6, 4]`, Walls'
   `[0, 0, 3, 5]` and Furniture's `[1, 0, 1, 6]` all cover that position.
   Resolve indices 4, 5 and 6 in `colors`: Meadow, Stone wall and Oak table.
   Retain all three values, including the underlying and editor-hidden content.
3. `colors[4]` retains `registryId: "grass"` with its current Meadow meaning and
   `#335c46ff` color, also referenced on Furniture at `(3, 2)`. In contrast,
   Terrain at `(5, 3)` uses raw `colors[1]`, the same RGBA with `meaning: null`.
   `(4, 3)` remains raw old green, `(-2, -1)` is occupied transparent white,
   and `(5, 4)` is occupied raw black. Never infer meanings from color equality.
   `colors[7]` is Water, an unused authored meaning with no implied cells.
4. `areas` locates `house`, `village` and `region` by ID, not array position or
   layer membership. House bounds `[0, 3) × [0, 2)` cover six positions; its exact
   description is `Oak worktables stand over grass and stone.\nKeep every underlying tile. 🔨`.
   Village's independent description explains the raw swatches and unused Water;
   Region's description is the empty string. All three tiers remain available.
5. `(5, 0)` is empty on every layer; `(6, 0)` is outside. The empty top Furniture
   layer remains present and does not erase lower layers. Areas can cover these
   empty positions without creating tiles or an implicit parent-child relation.

Thus coordinates come from bounds/runs, layer identity/order from `layers`,
authored meaning and current appearance from `colors`, and names, descriptions,
tiers and geometry from `areas`. None requires guessing editor state or game
behavior such as walkability, height or collision.

### Reproducible completeness checks

Run `node --test tests/domain/agent-consumer.test.ts` with the pinned Node and
Python 3.9+ on PATH; these checks also run in `npm test`. They compare every golden
cell against the source document's cell iterator, all metadata against its source
records, and the checked-in example against fresh production bytes. They test the
original TW-043 example too, and run a copied reader/export in a temporary
directory with Python isolated mode. A negative schema matrix requires nonzero
exit and zero partial output, including for malformed content late in the file.

Both complete populated source documents are exported and independently decoded:

| Fixture      | Occupied layer cells | Canonical runs | Export bytes | Areas |
| ------------ | -------------------: | -------------: | -----------: | ----: |
| frontier-v1  |            6,620,700 |        123,870 |    2,306,718 | 1,089 |
| heartland-v1 |           24,025,200 |        470,490 |    8,080,454 | 1,089 |

The tests compare bounds, every color/meaning, ordered layer IDs/names/counts and
all area records directly to the source document. A SHA-256 per layer compares
every resolved run with the source model's independently read runs, covering all
occupied addresses and hidden overlaps without constructing dense grids. Its
diagnostic encoding is one ASCII JSON tuple plus LF per run:
`[x,y,length,kind,registryIdOrNull,rgba,meaning]`, using Python `ensure_ascii=True`
and compact separators. These are segmentation-sensitive run digests, not a new
wire-format field or a canonical cell hash for arbitrary split runs.

Maximum 65,536 × 65,536 empty/single-cell maps also decode with fewer than 400
export bytes, including safe-coordinate extremes. Large fixture correctness and
sparse representation are verified; native latency percentiles, peak memory and
agent context limits are not measured here. Performance-only refinements remain
TW-049/TW-050 and end-to-end export profiling TW-051.
