# Whole-map agent format, version 1

Decision record for [TW-043](../.wrk/wrk-eeabc6ef.md), subordinate to
[INTENT.md](../INTENT.md#project-files-and-agent-exports). These are implementation
choices resolving the open export decisions. TW-044 implements capture, encoding
and local export; this ticket supplies its public contract, example and size study.

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
Native publication and cancellation belong to TW-044.

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
