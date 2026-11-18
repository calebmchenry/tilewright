# Tilewright foundation decisions

Decision record for [TW-001](../.wrk/wrk-a1d21a8b.md). The product is **Tilewright**;
the repository directory is `tilewright`.

## Authority and confirmed requirements

[INTENT.md](../INTENT.md) remains the source of confirmed requirements. This
document resolves its open coordinate, canvas, and component-boundary decisions.
The defaults and rules under **Implementation choices** below are implementation
choices, not additional confirmed user requirements. Alternatives and rationale
are recorded so later work can evaluate a deliberate revision.

The following requirements are carried forward from the intent:

- One tile represents one game tile, independent of screen pixels and zoom.
- Visual chunks are exactly **64 × 64 tiles**. They communicate scale and never
  restrict painting, selection, movement, or annotations across their boundaries.
- Maps have fixed dimensions until explicit growth. Painting never grows a map.
- The scale target is about 100 × 100 chunks: 6,400 × 6,400 tiles, or 40,960,000
  possible tile positions per layer. This does not require dense allocation.
  Validate populated maps with overlapping layers, detailed editing, and overview
  navigation; an empty canvas is insufficient evidence of performance.
- Layers preserve underlying content. Arbitrary colors are allowed; named color
  associations must survive recoloring across layers. Occupied selection cells
  overwrite destinations on the same layer; empty selection cells leave them
  untouched. Undo must restore overwritten destinations as well as sources.
- Annotations, including named-area bounds and labels, remain independent of
  tile selections. The author-selected tiers are Detail, Locality, and Region.
- Tauri delivers a single-user, local macOS app. The packaged app must launch and
  work offline without a separate web server. A development server is allowed.
  Open, Save, Save As, and Cmd+S use local files. Automatic recovery is separate
  from the explicitly saved project. Whole-map agent export has a separate
  purpose and schema, retaining layer order, underlying content, color meanings,
  and named areas with descriptions.

All deferred scope in INTENT.md stays deferred:

- Windows, Linux, and a standalone browser release.
- Cloud storage, accounts, sharing, and collaboration.
- Direct game integration (including a game importer) or a 3D preview.
- Exporting only a selected area.
- Custom label tiers and automatic movement of annotations with tile selections.
- Freeform selection.

## Implementation choices: coordinates and cells

### World coordinates and rectangle endpoints

The initial map's top-left grid intersection is the fixed world origin `(0, 0)`.
Positive `x` points right; positive `y` points down. Addresses are signed integer
tile coordinates `(x, y)`, with a layer identity specifying which cell is meant.
Tile `(x, y)` occupies the world rectangle `[x, x + 1) × [y, y + 1)`; its center
is `(x + 0.5, y + 0.5)`. World distances are measured in tiles. Screen coordinates
are derived through the viewport transform and are never stored as tile addresses.

All document bounds and tile rectangles use half-open endpoints:

```text
Bounds = { minX, minY, maxX, maxY }
width  = maxX - minX
height = maxY - minY
inside(x, y) = minX <= x < maxX and minY <= y < maxY
```

Map width and height must be positive. Coordinates, endpoints, dimensions, and
growth arithmetic must remain exact JavaScript safe integers; reject invalid or
overflowing input rather than rounding it. This is a numerical correctness rule,
not a performance promise for every representable size. Runtime capacity limits
and performance budgets belong to later implementation and performance tickets.

An internal empty rectangle can have equal endpoints and touches no cells. A
nonempty tile rectangle has width `maxX - minX` and height `maxY - minY`. A drag
between two included tile addresses normalizes to minima and maxima plus one:
dragging from `(67, 67)` to `(60, 60)` produces `[60, 68) × [60, 68)`, an 8 × 8
rectangle containing 64 cells. A single-cell drag at `(63, 63)` produces
`[63, 64) × [63, 64)`. Reversed drags use the same normalization.

Annotation geometry and label anchors use the same fixed world frame and tile
units. This record does not decide their shapes, anchor placement, or whether
anchors can be fractional; TW-029 owns those choices. Any annotation rectangle
that describes tile coverage uses the same half-open convention.

### Empty cells and canvas edges

An empty cell is the absence of a tile value on a particular layer. No paint
color, including black, white, or a color matching the canvas background, serves
as an empty sentinel. Erasing removes that layer's tile value and can expose a
lower layer. An unregistered color is still occupied content. Color encoding and
registry identity details remain for their respective tickets.

An out-of-bounds coordinate is outside the map, not an editable empty cell. Domain
write operations reject out-of-bounds addresses. Drawing tools intersect their
candidate cells with the fixed bounds before submitting a command; a wholly
outside stroke is a no-op. They neither clamp outside cells onto the nearest edge
nor expand bounds. Flood fill is bounded by the same map rectangle. Selection
move/paste policies at an edge remain for TW-023; they cannot implicitly grow it.

### Visual chunks and storage

The visual chunk lattice is anchored to world `(0, 0)` permanently, with grid
lines at integer multiples of 64 on each axis. For an integer tile address:

```text
chunkX = floor(x / 64)       chunkY = floor(y / 64)
localX = x - 64 * chunkX    localY = y - 64 * chunkY
```

Local coordinates are always integers from 0 through 63. Use mathematical floor,
including for negative addresses; truncation toward zero and a raw negative
remainder give incorrect results. Growth never reanchors the chunk lattice.

| Tile address | Visual chunk | Local address | Meaning |
| --- | --- | --- | --- |
| `(0, 0)` | `(0, 0)` | `(0, 0)` | Initial top-left tile |
| `(63, 63)` | `(0, 0)` | `(63, 63)` | Last tile before both chunk boundaries |
| `(64, 63)` | `(1, 0)` | `(0, 63)` | Cross the vertical line at `x = 64` |
| `(63, 64)` | `(0, 1)` | `(63, 0)` | Cross the horizontal line at `y = 64` |
| `(64, 64)` | `(1, 1)` | `(0, 0)` | Cross both boundaries |
| `(-1, -1)` | `(-1, -1)` | `(63, 63)` | Available after left and top growth |
| `(-64, -64)` | `(-1, -1)` | `(0, 0)` | First tile in that negative chunk |
| `(-65, 0)` | `(-2, 0)` | `(63, 0)` | Requires further left growth |

Use sparse, partitioned layer data as directed by the intent. The internal
partition size and encoding are not a file-format or editing contract: they can
differ from the 64 × 64 visual chunks. Domain operations span any number of
partitions and visual chunks as one logical edit. Do not allocate all tile
positions merely to create or grow a map. Serialization must preserve world
coordinates and bounds even if its eventual wire encoding uses local offsets.

## Implementation choices: creation and explicit growth

New Map defaults to **256 × 256 tiles**, or 4 × 4 visual chunks, with bounds
`[0, 256) × [0, 256)`. Allow custom positive integer widths and heights in tiles;
the origin is still `(0, 0)`. Dimensions need not be multiples of 64. A partial
chunk at a map edge is just the intersection of a full 64 × 64 visual chunk with
the bounds, not a smaller chunk definition. For example, a 101 × 130 map has
bounds `[0, 101) × [0, 130)` and a last valid tile `(100, 129)`.

The explicit Grow Canvas operation supports **left, right, top, and bottom**.
Each chosen edge grows by a positive multiple of 64 tiles. The control starts at
one increment (64 tiles); an unchosen edge has count zero. Several edges can grow
in one command. Counts must be nonnegative integers with at least one nonzero
count; zero on all edges is a no-op. Shrinking is not part of this operation.

For edge counts `L`, `R`, `T`, and `B`:

```text
newMinX = minX - 64 * L     newMaxX = maxX + 64 * R
newMinY = minY - 64 * T     newMaxY = maxY + 64 * B
```

Growth changes only bounds. Newly admitted cells are empty on every layer.
Existing tiles, named-area geometry, and label anchors keep their world
coordinates and identities, including for left and top growth. Those directions
introduce negative coordinates; they do not translate existing data. Coordinates
displayed to the author use this world frame. A temporary array or image offset
may be `(x - minX, y - minY)`, but it is not the stored or displayed tile address.
Keep the viewport's world position stable during growth; fitting the enlarged
map is a separate navigation action.

Growth is an undoable command. It records before/after bounds and does not
rewrite tiles or annotations. In chronological undo, any subsequent edits in
new space are undone before the growth, so restoring the previous bounds does
not discard live content. No automatic trimming occurs on save or export.

## Implementation choices: component ownership

These are logical boundaries for the later application bootstrap, not a demand
to create empty modules or finalize the file layout in this ticket.

| Component | Owns | Boundary |
| --- | --- | --- |
| TypeScript document/domain | Authoritative bounds, sparse layered tile content, layer order, color associations, named areas, invariants, and snapshot/serialization logic | Independent of React, PixiJS, DOM, and native I/O; exposes queries and validated edit primitives rather than GPU objects or UI state |
| TypeScript tools and command/history layer | Converts gestures into edits; validates and applies complete transactions; captures inverse edits, undo/redo, document revisions, and saved-revision tracking | All persistent edits, including growth and annotation changes, go through commands; one gesture can span partitions without becoming unrelated history entries; failed validation must leave document/history unchanged |
| PixiJS WebGL renderer and viewport adapter | Screen/world conversion, camera, visible tile rendering, tile/chunk grids, previews, selection overlays, labels, and cached overview images | Reads document queries and committed change notifications; caches are disposable derived data; forwards input to tools and does not own authoritative tiles or history |
| React UI | Toolbars, layer/registry/annotation panels, dialogs, settings controls, active tool/layer/color, and other transient interface state | Dispatches commands and subscribes to summaries/revisions; does not hold the full map in component state or create a React element per tile; transient selection/gesture state lives in editor controllers outside the persisted document |
| Rust/Tauri native integration | macOS window/menu integration, native file dialogs, local filesystem access, atomic writes, and recovery-file discovery/storage | Returns bytes, paths, or results through a narrow native bridge; TypeScript owns document semantics and project/export encoding; Rust does not duplicate editing algorithms or serve the app from a runtime web server |
| Vite | Development tooling and bundling frontend assets for Tauri | A development server is tooling only; the packaged app includes assets needed for offline use |

A drawing gesture flows from canvas input through world-coordinate conversion
and a tool into one command. A successful command updates the document, records
undo data and a revision, and publishes changes. The renderer invalidates affected
visible/overview caches; React updates the relevant controls. Redo and undo use
the same notification route. A registered color change must invalidate all of
its affected tiles across layers, not just currently visible content.

For Save, TypeScript captures and encodes a consistent document revision; Rust
writes it locally. Only success marks that captured revision saved, so edits
made during the write remain unsaved. Recovery uses a separate local destination
and does not mark the project saved. Agent export uses its own TypeScript schema
and includes the whole document's layers and annotations, not a screenshot or
the renderer's visible subset. Exact schemas, persisted UI settings, recovery
cadence, and restore policy remain open for their existing tickets.

## Alternatives and rationale

| Decision | Alternative considered | Reason for this choice |
| --- | --- | --- |
| Origin at initial top-left; `y` increases down | Center origin or `y` increasing up | Familiar grid/pixel-editor addressing and straightforward canvas input conversion |
| Signed coordinates remain stable during growth | Rebase all content to keep the current top-left at `(0, 0)` | Avoids rewriting tiles, annotations, references, and history for left/top growth |
| Half-open rectangles | Inclusive maximum endpoints | Width/height are differences; adjacent rectangles share an edge without sharing a tile |
| Absence means empty | Reserve a background color as empty | Preserves arbitrary painted colors, underlying layers, and empty-cell move semantics |
| Default 256 × 256; custom whole-tile dimensions | Start at 6,400 × 6,400 or require chunk-aligned dimensions | Provides a manageable initial map while leaving scale and edge placement under author control |
| All four edges; 64-tile growth increments | Right/bottom only, single-tile growth increments, or automatic growth | Supports adding space around existing work, keeps controls simple at chunk scale, and preserves explicit fixed bounds |
| Fixed visual lattice; independent storage partitions | Treat a visual chunk as an indivisible edit or file unit | Keeps chunk boundaries informative while allowing ordinary edits and future storage tuning |
| TypeScript document/history outside UI and renderer | Store the map in React state, Pixi objects, or a second Rust model | Gives editing, undo, persistence, and rendering one authoritative model with testable invariants |

## Validation walkthrough

These are concrete acceptance examples for the decisions, not a claim that the
application has already been implemented or performance-tested.

1. **Create and check edges.** Create the default map with bounds
   `[0, 256) × [0, 256)`. `(0, 0)` and `(255, 255)` are valid; `(-1, 0)`, `(0, -1)`,
   `(256, 0)`, and `(0, 256)` are outside. A pencil candidate covering
   `[254, 258) × [63, 64)` writes only `(254, 63)` and `(255, 63)`. The bounds stay
   unchanged. An outside-only stroke writes nothing. On the custom 101 × 130
   map, `(100, 129)` is valid and `(101, 129)` and `(100, 130)` are outside.
2. **Cross chunks.** Paint a house on a building layer in `[60, 68) × [60, 68)`.
   Its 64 tiles span visual chunks `(0, 0)`, `(1, 0)`, `(0, 1)`, and `(1, 1)`,
   with 16 tiles in each. It is one edit. Terrain below it remains independent.
   A three-tile right move places the house at `[63, 71) × [60, 68)`. Empty source
   cells leave destinations untouched, and undo restores overwritten content.
   An illustrative named area with bounds `[60, 68) × [60, 68)` and anchor
   `(64, 64)` stays put during that move. The rectangle and anchor are fixture
   examples, not a decision about the named-area geometry or label-placement UI.
3. **Grow each edge.** For each independent row below, start from the original
   default map with the unmoved house, an occupied tile `A = (63, 63)` and edge
   tile `E = (255, 255)`. Keep the same illustrative annotation and its anchor.
   Apply one 64-tile increment on the indicated edge.

| Growth from original map | Resulting x bounds | Resulting y bounds | Dimensions | Newly valid sample | Still outside sample |
| --- | --- | --- | --- | --- | --- |
| Left | `[-64, 256)` | `[0, 256)` | 320 × 256 | `(-64, 63)` | `(-65, 63)` |
| Right | `[0, 320)` | `[0, 256)` | 320 × 256 | `(319, 63)` | `(320, 63)` |
| Top | `[0, 256)` | `[-64, 256)` | 256 × 320 | `(63, -64)` | `(63, -65)` |
| Bottom | `[0, 256)` | `[0, 320)` | 256 × 320 | `(63, 319)` | `(63, 320)` |

In **every row**, `A` ends at `(63, 63)`, `E` at `(255, 255)`, all house tiles
retain their addresses, the annotation bounds remain `[60, 68) × [60, 68)`, and
the label anchor stays `(64, 64)`. Their content, layer identities, names, and
descriptions do not change. Newly valid sample cells are empty on all layers.

4. **Combine and repeat growth.** Applying left, right, top, and bottom increments
   successively, or together in one command, results in `[-64, 320) × [-64, 320)`,
   a 384 × 384 map. All original content and annotation coordinates above are
   unchanged. Only their offsets from the new top-left differ: `A` is at offset
   `(127, 127)` and the anchor at offset `(128, 128)`. Another left increment
   produces `[-128, 320) × [-64, 320)` and admits `(-65, 0)` in visual chunk
   `(-2, 0)`. Grid lines remain at multiples of 64. On a custom 101 × 130 map,
   right growth yields 165 × 130 with right bound 165; it does not round to 192.
5. **Check scope and ownership.** Compare this record with INTENT.md's Project
   goal, Map size and navigation, Chosen technology, Local operation, Deferred
   scope, and Remaining implementation decisions. The record resolves coordinate
   and growth choices and clarifies existing technology boundaries. It does not
   add game import, cloud, 3D, browser delivery, a final serialization format,
   annotation geometry, registry collision policy, or performance guarantees.
