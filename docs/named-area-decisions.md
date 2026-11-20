# Named areas and zoom-dependent labels

Decision record for [TW-029](../.wrk/wrk-353fa9ca.md), subordinate to
[INTENT.md](../INTENT.md#named-areas-and-labels). These are implementation choices
for TW-030–TW-032, not additional confirmed product requirements.
TW-030 authoring, TW-031 zoom-dependent labels and TW-032 browsing/focus now ship
as documented below. They extend the
[coordinate](foundation-decisions.md), [camera](navigation.md),
[history](command-history.md), and [selection](selection-decisions.md) contracts.
The [TW-033 project format](project-format.md) specifies the complete editable
schema; TW-043 owns the separate agent export schema.

## Geometry and document data

Use a **nonempty axis-aligned rectangle** in whole-tile world coordinates. Bounds
are `{ minX, minY, maxX, maxY }`, covering `[minX, maxX) × [minY, maxY)`.
Every endpoint, width and height must be a safe integer; width and height must be
positive. The complete rectangle must fit inside the fixed map bounds. Negative
coordinates after left/top growth and rectangles crossing any chunk boundary are
valid. Empty tile content is allowed; areas describe intent independently of paint.

Each area has the following data. No tile layer, registry entry or other area is
required to interpret it.

| Field         | Contract                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Stable unique `AnnotationId`, using the existing 1–128 ASCII ID syntax. Generate a fresh `area-<UUID>` on creation; edits and undo/redo retain it. Names are not identity. |
| `name`        | Required plain-text, trimmed, nonblank, single-line string (reject line breaks). Duplicate names are allowed.                                                              |
| `description` | Required plain-text string; `""` is valid. Preserve Unicode, whitespace and line breaks. An empty UI field creates `""`, not null or an omitted field.                     |
| `tier`        | Exactly `"detail"`, `"locality"` or `"region"`, displayed as Detail, Locality and Region. Chosen by the author, never inferred from size or containment.                   |
| `bounds`      | The contained, nonempty half-open rectangle above. Rectangles are the only v1 geometry, so no shape discriminator is necessary in the domain payload.                      |
| `label`       | Exactly `{ "placement": "center" }` in v1. This persisted setting defines the anchor; screen positions and collision decisions are derived.                                |

The [existing metadata seam](../src/domain/document.ts) stores the ID as the key
and the remaining fields as a JSON object; do not duplicate ID inside that object.
Feature commands and future decoders validate the complete record before changing
anything. Generic `annotation` commands currently validate JSON, not these feature
rules. Existing tests with arbitrary annotation payloads are isolation fixtures,
not a preexisting file schema or a reason to accept malformed named areas.

The label anchor is the rectangle's geometric center:

```text
anchorX = minX + (maxX - minX) / 2
anchorY = minY + (maxY - minY) / 2
```

The center may lie on a grid intersection or at a half-tile coordinate; a 1 × 1
area anchors at its cell center. Compute it from bounds, never from occupied tiles
or a visible intersection. Do not store a second mutable anchor. Rendering uses
the existing floating-point camera precision; exact tile bounds remain authoritative.
Freeform polygons, point areas, manually dragged labels and custom tiers are deferred.

## Explicit editing and independence

The Areas panel provides **New area**, area selection, name, description, tier,
exclusive bounds, **Apply**, **Cancel** and **Delete area**. New areas default to
Detail; the author can select either other tier before applying. Show width ×
height in tiles. Entering bounds numerically works at every zoom, including overview.

**Draw bounds** enters an explicit annotation gesture, separate from the tile
Select tool. At 8 CSS pixels/tile or above, drag from an in-map tile; both endpoint
tiles count, reversed drags normalize, and a click creates a 1 × 1 candidate.
Clip a creation drag's outside endpoint to the map, as for rectangle selection.
An outside start creates nothing. Below 8 CSS pixels/tile, retain numeric editing
and explain that drawing bounds requires zooming in. **Redraw bounds** uses the
same interaction to replace an existing area's draft rectangle. No drag-to-move,
resize handles or annotation arrow-key nudging are required in v1; numeric bounds
and redraw cover explicit geometry edits.

Draft fields and preview outlines are transient. Apply validates all fields and
commits one history step; invalid numeric bounds, missing fields or unknown tiers
show field feedback and preserve document, history and draft. Numeric edits reject
out-of-bounds geometry as a whole, without clipping or growing the map. Cancel or
Escape discards the draft. Pointer cancellation, lost capture or blur discards the
active bounds gesture and restores the preceding draft. Switching area/tool,
undo/redo or replacing the document cancels the draft rather than applying it.
Text fields and IME keep native keyboard editing.

Creation, Apply and explicit Delete area use annotation commands and existing
atomic history/dirty-state rules. Unchanged Apply is a no-op. Delete is one undoable
step, removing only the chosen record; undo restores its exact ID and data.
Selecting, focusing or inspecting an area changes only session state. Selecting
another area or deleting the selected record clears obsolete selection/draft state.

Area selection is distinct from tile selection. Clicking an on-map label selects
its area only in explicit annotation mode; ordinary tile tools keep their pointer
behavior. The panel remains usable for hidden or overlapping labels. Starting an
annotation gesture cancels a pending tile preview using existing cancellation
rules; an idle tile-selection rectangle may remain. Neither selection becomes a
mask or payload for the other.

**Every tile operation** (painting, erasing, fill, move, nudge, cut, copy, paste,
rotation and flip) leaves all annotation fields unchanged, including fully enclosed
and partially overlapping areas. Deleting/hiding/reordering layers also leaves
areas intact. Explicit map growth keeps world bounds and anchors fixed. Undoing
growth follows chronological history, after undoing subsequent area edits in the
new space; no operation may silently trim a live area. A future bounds replacement
or import must reject records outside the resulting map.

## Three visibility ranges

Use the existing camera scale `p = 24 * zoom`, in **CSS pixels per tile**, without
DPR or rounded zoom percentages. The thresholds are application defaults, not
per-area settings or serialized visibility flags.

| Normal visible tier | Exact range  | Zoom percentage (for orientation only)            |
| ------------------- | ------------ | ------------------------------------------------- |
| Detail              | `p >= 8`     | At least 33⅓%                                     |
| Locality            | `1 <= p < 8` | At least 4⅙%, below 33⅓%                          |
| Region              | `0 < p < 1`  | Below 4⅙%, through the supported Fit/minimum zoom |

Exactly one tier is eligible in an ordinary view. At `p = 8` choose Detail; at
`p = 1` choose Locality. Crossing a threshold replaces the eligible set on that
camera update, in either zoom direction, with no fade, hysteresis, lingering old
labels or cross-tier overlap. Pan, resize and DPR changes do not change tier unless
the actual camera zoom changes. If the current tier has no visible areas, show no
normal labels; do not fall back to a cloud of house labels. Area size never changes
its tier. Names and descriptions stay in the document regardless of visibility.

The precise tile-tool threshold is also 8 CSS pixels/tile; Pencil, Eraser and
area metadata editing are available at all scales. The renderer's 2 CSS pixels/tile
overview-cache switch is a separate decision: it does not change Locality labels.

One **selected area** is a deliberate inspection exception: show its outline and
label at any tier, if in view, in a distinct selected style. At most one area gets
this exception; selecting a village does not reveal its houses. It takes collision
priority over normal labels. Draft geometry substitutes for that area's ordinary
overlay rather than drawing a duplicate. Selection never changes the saved tier.

## Placement, overlap and readability

Place labels in a separate Pixi overlay above tiles/grids, with constant screen
text size: 13 CSS px Detail, 15 Locality, 17 Region, medium-weight system sans-serif,
light text on a dark translucent background with a contrasting selected outline.
Descriptions belong in the panel, never in the on-map label. No always-on area
fills or every-area outlines: show the selected/draft rectangle with a thin,
distinct outline and corner marks so tile selections remain distinguishable.

Use this deterministic placement order:

1. Take current-tier candidates plus the single selected area. Cull rectangles
   wholly outside the viewport and anchors outside the canvas. An offscreen anchor
   is not pinned to an edge even if part of its area is visible; the selected
   outline can still be clipped into view. The area panel always exposes its data.
2. Center one single-line label box at the projected world anchor. Its width is
   measured text width plus 6 CSS px padding per side, capped at the lesser of
   240 CSS px and canvas width minus 8. Ellipsize overflowing text by grapheme,
   preserving the full name in the panel. Use a line height of font size plus 4
   and 4 CSS px vertical padding per side. If even an ellipsis plus padding or the
   label height cannot fit, omit the label for that tiny viewport.
3. Translate the screen box just enough to stay within a 4 CSS px canvas inset.
   It may extend beyond the projected map/area rectangle into canvas margin. This
   is a transient placement adjustment; the world anchor and bounds never change.
   Clip outlines at the canvas edge, not by changing their geometry.
4. Process the selected candidate first, then remaining IDs in ascending ASCII
   order. Reject a candidate if its final box intersects an accepted box expanded
   by 4 CSS px on every side; exactly 4 px separation is allowed. Suppress labels
   only, not records. No alternate-anchor search, force layout or priority inferred
   from name, creation order, geometry size or containment is required.

Overlapping and coincident rectangles are legal, as are duplicate names. The
stable-ID rule makes crowded views repeatable; selecting a suppressed area from
the panel reveals it with priority. Recompute from current candidates when the
camera or annotation data changes, without retaining hidden labels as obstacles.
Renderer resources are derived, bounded to visible candidates/accepted labels,
and released on document replacement. Annotation invalidations use affected IDs;
they do not dirty tile or overview imagery. Profiling belongs to TW-031/TW-049.

**No hierarchy is needed for v1.** Containment has no semantic effect and creates
no parent, membership list, cascade, inherited tier or visibility link. A house,
village and region may geometrically nest, overlap partly, or be disjoint. The
three author-selected tiers alone supply the scale change. Hierarchy is deferred
unless a later product decision establishes a need.

## Worked map and boundary examples

This JSON is an **illustrative project annotation fragment**, not the final
project envelope. It specifies all annotation data needed for a shared-map
house/village/region rehearsal. Other map data is deliberately omitted here.

```json
{
  "bounds": { "minX": -64, "minY": -64, "maxX": 6400, "maxY": 6400 },
  "annotations": [
    {
      "id": "area-house",
      "name": "Blacksmith's house",
      "description": "Forge downstairs.\nHome upstairs.",
      "tier": "detail",
      "bounds": { "minX": 60, "minY": 60, "maxX": 68, "maxY": 68 },
      "label": { "placement": "center" }
    },
    {
      "id": "area-village",
      "name": "Willow Village",
      "description": "",
      "tier": "locality",
      "bounds": { "minX": 0, "minY": 0, "maxX": 128, "maxY": 128 },
      "label": { "placement": "center" }
    },
    {
      "id": "area-region",
      "name": "Green Reach",
      "description": "Settled valley and surrounding hills.",
      "tier": "region",
      "bounds": { "minX": -64, "minY": -64, "maxX": 1024, "maxY": 1024 },
      "label": { "placement": "center" }
    }
  ]
}
```

For a 960 × 640 CSS canvas centered on world `(64,64)` at close/locality scales,
then centered on `(480,480)` at region scales, the normal-label evaluation is:

| Zoom / CSS px per tile       | Eligible name      | Area's projected dimensions | Result                                                 |
| ---------------------------- | ------------------ | --------------------------- | ------------------------------------------------------ |
| 100% / 24                    | Blacksmith's house | 192 × 192 px                | House readable; village and region suppressed by tier  |
| 50% / 12                     | Blacksmith's house | 96 × 96 px                  | Same house label; text may extend beyond its rectangle |
| 33⅓% / exactly 8             | Blacksmith's house | 64 × 64 px                  | Detail includes this exact boundary                    |
| `p = 8 - 0.000001`           | Willow Village     | About 1024 × 1024 px        | Locality replaces house; its center remains visible    |
| 12.5% / 3                    | Willow Village     | 384 × 384 px                | Village replaces house clutter                         |
| `p = 2`                      | Willow Village     | 256 × 256 px                | Overview rendering boundary does not change tier       |
| 4⅙% / exactly 1              | Willow Village     | 128 × 128 px                | Locality includes this exact boundary                  |
| `p = 1 - 0.000001`           | Green Reach        | About 1088 × 1088 px        | Region replaces village                                |
| 1% / 0.24                    | Green Reach        | 261.12 × 261.12 px          | Broad region label remains readable                    |
| Fit whole map / `592 / 6464` | Green Reach        | About 99.64 × 99.64 px      | Region remains eligible at the target map scale        |

Fit centers the complete `[-64,6400)` map; the region anchor is on-screen. Repeat
at DPR 1 and 2: the eligible names and CSS dimensions are identical. Immediately
above both thresholds the tier is unchanged from the exact threshold; reversing
zoom follows the same rules. The computed `p`, not the rounded toolbar text, is
authoritative. With a selected house at 1% zoom, only that one house can accompany
Region labels, subject to viewport and collision priority.

Additional acceptance examples:

- **Overlap:** Add `area-house-b` named “Storehouse” with the same Detail bounds
  as `area-house`. At 100%, both centers are `(64,64)`, so `area-house` wins the
  box collision. Selecting `area-house-b` makes Storehouse win. Both records remain
  unchanged. A partly overlapping village needs no parent reference; tier rules
  apply independently. Edge-touching rectangles share no tiles and are valid.
- **Empty description:** Willow Village's `""` displays an empty description
  editor and still has its ordinary label. JSON round trips preserve `""` exactly;
  it does not become the name, a missing record or null.
- **Map edges:** A 1 × 1 Detail area at `[-64,-63) × [-64,-63)` anchors at
  `(-63.5,-63.5)`; one at `[6399,6400)²` anchors at `(6399.5,6399.5)`. Both are
  valid. With a projected anchor at `(3,3)` and a measured 180 × 25 px label box,
  placement becomes `[4,184] × [4,29]` on the 960 × 640 canvas. At `(957,637)`
  it becomes `[776,956] × [611,636]`. The record/anchor is unchanged. With the
  anchor just outside the viewport, omit the label rather than stick it to an edge.
  A long name ellipsizes to at most 240 px; smaller hosts reduce that cap.
- **Invalid geometry:** Zero width, fractional endpoints, unsafe arithmetic or
  `[6399,6401) × [6399,6400)` reject without partial updates. Reverse creation
  from `(67,67)` to `(60,60)` yields the exact house rectangle; dragging its end
  past the map edge clips only the creation candidate. Numeric Apply never clips.
- **Tile independence:** Move the house's tiles three right to `[63,71) × [60,68)`;
  its named area stays `[60,68)²` and its anchor `(64,64)`. Cut, paste, rotate and
  flip those tiles preserve every annotation field. The author must explicitly
  edit the house bounds to relocate its label. Deleting the village leaves the
  house and region records intact, even though their geometry overlaps it.

## Project and agent-export compatibility

The example's `annotations` array can be mapped losslessly to the current metadata
API as `(annotationId(id), recordWithoutId)` and back, ordered by ID. All values
are JSON scalars/objects; fractional screen placement is absent. Project codecs
must retain every listed field, including empty descriptions and center placement,
at every zoom, regardless of collisions or current layer visibility.

An independent agent schema can use an `areas` collection with this record shape:

```json
{
  "id": "area-house",
  "name": "Blacksmith's house",
  "description": "Forge downstairs.\nHome upstairs.",
  "geometry": {
    "type": "rectangle",
    "bounds": { "minX": 60, "minY": 60, "maxX": 68, "maxY": 68 }
  },
  "label": { "tier": "detail", "placement": "center" }
}
```

This is a representability example, not a choice of final file format/version.
For **every** source area, copy ID/name/description, map bounds to
`geometry.bounds`, emit type `rectangle`, and map tier/placement to `label`.
The inverse extracts those same values. An agent can compute the center and knows
that bounds are half-open tile coordinates with positive x right and y down.
Geometry, tier meaning and descriptions do not require any editor state or
hierarchy. The exported collection includes the village with `""` and the region,
even when only Detail is visible. It must cover all named areas on the whole map.

Project and export envelopes remain distinct. Neither annotation representation
needs selected IDs, drafts, camera, collision winners, label textures, history or
recovery state. TW-033 decides any separately persisted editor settings; TW-043
decides the public export envelope and its whole-map tile encoding. Actual codecs,
malformed-input handling and save/reopen/export integration remain those tickets.

## Validation and handoff

TW-029 validation evaluates the tables and JSON projections against the existing
camera and metadata/history APIs. Actual results and commands are recorded in
[its WRK ticket](../.wrk/wrk-353fa9ca.md). This checks decision consistency and
representability; it does not claim implemented label screenshots or file codecs.

TW-030 implements validation, lifecycle/editing commands and controls, with
independence checks for every tile-selection operation. TW-031 implements the
placement/collision algorithm and captures screenshots at `p = 1` and `p = 8`,
immediately below/above each, both zoom directions and DPR 1/2, including selected,
overlap, long-name and edge cases. TW-032 implements area browsing/focus without
document edits. Performance observations remain subject to the working-baseline
priority in AGENTS.md; rendering refinement belongs to TW-049, history/memory to
TW-050. These thresholds are chosen defaults, not measured performance guarantees.

## Authoring implementation (TW-030)

The **Named areas** panel now provides New area, a searchable list with stable IDs,
name, multiline description, Detail/Locality/Region, exclusive numeric bounds,
Apply area, Cancel area edit, Delete area and Deselect area. Selecting a list item
opens a transient editor; after Apply or Cancel, Edit area reopens it. Duplicate
names and overlapping/nested rectangles are allowed, with no hierarchy or cascade.
An empty description remains exactly `""`. Plain text is never interpreted as HTML.

New area starts at the map's top-left cell with 1 × 1 bounds and Detail tier;
it requires a name before Apply. All numeric fields work at every zoom and with
hidden tile layers. Empty, fractional, unsafe, inverted, zero-size and out-of-map
bounds reject atomically. Invalid fields retain the draft, show inline feedback
and produce no document version, history or dirty-state change. Numeric bounds
never clip or grow the map. Names trim outer whitespace and reject line breaks;
description whitespace, Unicode and newlines remain exact.

Draw bounds / Redraw bounds explicitly arms area input. The ordinary tile Select
tool never edits an area. At >= 8 CSS px/tile, primary drag captures both endpoint
cells, normalizes reverse drags and clips an outside endpoint to the fixed map.
An outside start does nothing; a click proposes one tile. Release changes only the
draft, and Apply performs the single document edit. Purple outlines and thicker
corner marks distinguish selected/draft areas from cyan tile selection and gold
Inspect measurement. Draft geometry substitutes for the selected outline; invalid
numeric geometry draws no outline. Outlines have no fill, remain visible at all
zooms and clip actual edges to the viewport without inventing boundary edges.
TW-031 adds normal-tier labels and collision handling as documented below.

Tool/area switches, Undo/Redo, document mutations and session replacement discard
unapplied drafts. Camera/size/readiness changes, pointer cancellation, capture loss,
missing pointer buttons, window/host blur, Space navigation or pinch cancel an
active bounds gesture and retain the preceding draft. Escape from canvas/panel
controls discards the draft; text fields and IME keep native key behavior. Enter
in the form uses ordinary form submission. Starting area authoring cancels pending
tile previews while retaining an idle tile-selection rectangle. Selection changes,
drafts, previews and camera actions do not dirty the map. Undoing a deleted area
restores its exact ID/data without reselecting it.

Implementation locations:

- `src/domain/annotations.ts`: complete record validation, field errors, stable
  `area-<UUID>` creation and explicit annotation-only lifecycle commands through
  `CommandHistory`. The generic JSON metadata seam remains unchanged for existing
  fixtures and future codecs; feature entry points reject malformed targets.
- `src/editor/annotations.ts`: immutable draft/selection stores, field parsing,
  Apply/Cancel/Delete, context cancellation and bounds gesture state. The session
  and single navigation router integrate it without including areas in tile payloads.
- `src/AnnotationPanel.tsx`: accessible controls, field feedback and inspection.
  `src/renderer/areaOutline.ts`, `createRenderer.ts` and `mountRenderer.ts` provide
  clipped Pixi outlines, redraw subscriptions and teardown. Annotation IDs trigger
  overlay refresh without dirtying detail textures or overview images.

Validation is reproducible in `tests/domain/annotations.test.ts`,
`annotation-controller.test.ts`, `annotation-independence.test.ts` and
`tests/annotations.spec.ts`. Lifecycle/validation tests include missing fields,
all tiers, descriptions, stable identities, capacity failure, no-op Apply, dirty
checkpoints, cancellation, overview editing and session replacement. The selection
matrix uses asymmetric populated walls plus furniture with fully enclosed,
partially overlapping and surrounding named areas created through the feature
commands. Every move, nudge, copy, cut, repeated paste, rotation and flip (including
transformed paste) preserves byte-identical records through commit/undo/redo in
both layer scopes. Paint, erase, fill, layer changes and growth are also isolated.
Browser checks cover controls, native text undo, canceled captured gestures,
minimum-window layout, exact DPR 1/2 outline pixels and GPU cleanup.

Actual command/native results are recorded in [TW-030](../.wrk/wrk-0d9194dc.md).
No project/agent codec or performance guarantee is introduced. Draft updates and
annotation-list filtering are synchronous; no large-annotation benchmark is claimed.
Rendering/presentation refinement remains TW-049 and edit/history/memory work
remains TW-050 under AGENTS.md.

## Label rendering implementation (TW-031)

`src/renderer/areaLabels.ts` implements the exact CSS-pixel ranges, true rectangle
centers, viewport/anchor culling, four-pixel inset, grapheme ellipsis and deterministic
selected-first/ASCII-ID collision rule above. It has no DOM or Pixi dependency.
There is no fade, tier fallback or inferred hierarchy. Selection is the only tier
exception. Empty/invalid draft names or geometry suppress the old selected label;
the valid draft/gesture replaces its geometry. Cancel restores the saved label.
Descriptions are never drawn, and visibility never changes document data.

`src/renderer/areaLabelScene.ts` draws Pixi Text over dark rounded backgrounds
above the existing grid, drawing, tile-selection and purple area outlines. It uses
500-weight system sans-serif at 13/15/17 CSS px, with the specified line height and
padding. Selected labels retain their authored tier's text size and add a purple
border. Names are plain text, including angle brackets; no markup styles or remote
fonts are enabled. DPR changes regenerate text resolution without changing CSS
geometry, eligible tiers or world anchors.

The scene retains measurements only for the current visible candidates and Pixi
objects only for accepted labels. Camera changes reposition retained objects;
unchanged text does not rasterize again. Annotation IDs request a collision relayout
because changing one box can reveal or suppress neighbors. Only changed text/style
is updated, and unchanged backgrounds/objects are reused. Description-only edits
change no visual. Tile edits/transforms do not relayout labels or alter their bounds;
annotation edits do not invalidate completed tile/overview images. As in the existing
overview contract, an in-progress image job can restart on any document version.

Culled/deleted labels destroy their Text and Graphics objects. After rendering,
`TexturePool.clear(true)` releases Pixi's **idle** pooled textures, including those
returned by text replacement/destruction; live textures stay owned by their users.
This prevents idle GPU resources accumulating across pans, names or DPR changes.
Session replacement/disposal clears candidate measurements, label objects, styles,
subscriptions and GPU context. Pixi's own bounded 1,000-entry text-metrics LRU and
small shared font/canvas infrastructure remain library caches, not live map labels.

`createRenderer.ts` integrates labels with overlay drawing, invalidation, hit tests
and numeric/resource snapshots. `mountRenderer.ts` supplies the live renderer to
`MapCanvas.tsx`, which passes hit testing into the existing single navigation router.
Clicking a visible label selects its area only with the Area tool active and no
Draw/Redraw gesture armed, including in overview. Space/middle-button navigation
retains priority. Pencil, eraser, selection and other tools receive their ordinary
input through labels; the selected purple area and cyan tile selection can coexist.
The Areas panel remains the route to labels hidden by tier, viewport or overlap.

Validation locations:

- `tests/domain/area-labels.test.ts`: exact thresholds in both directions, Fit,
  no fallback, selection/draft substitution, true centers, edge placement, tiny
  hosts, Unicode truncation, stable collisions and exactly four-pixel separation.
- `tests/area-labels.spec.ts`: screenshots at every tier and immediately below,
  at and above both thresholds at DPR 1/2; real WebGL text pixel readback; selected
  exception/overlap; plain Unicode long names; viewport culling; density changes;
  draft cancellation; targeted updates; actual move/rotation undo/redo; overview
  hit tests and drawing/selection input through labels; teardown.
- `tests/area-labels-scale.spec.ts`, `tests/fixtures/areas.ts`: 1,089 named areas
  (891 houses, 99 villages, 99 regions) on each complete populated reference map.
  Three 120-step navigation passes per map retain CPU submission samples, GPU
  counts and post-GC heap, validate tier/resource/data invariants, then replace
  documents three times and verify teardown. JSON reports include source hashes,
  fixture golden data and environment. Screenshots show detail/locality/region.

Actual results are recorded in [TW-031](../.wrk/wrk-dfb3bfaf.md). Navigation currently
scans the annotation metadata and collision-checks accepted boxes synchronously;
there is no spatial annotation index or native presentation/physical-memory claim.
The measurements are Chromium CPU submission proxies. Refinement remains TW-049,
with history/memory refinement in TW-050 under AGENTS.md. Browsing/focus is
documented below; project/export codecs remain their own tickets.

## Browsing and scale inspection (TW-032)

The searchable Areas list includes all named areas, regardless of the current
zoom, viewport, layer visibility or label collisions. Search is a case-insensitive
name substring; it does not change selection or camera. Rows retain the authored
name, tier and stable ID so duplicate names remain distinguishable. Selecting a
row opens the existing explicit editor and highlights its purple outline/label;
selecting an on-map label in Area mode opens the same record. Selection alone
does not pan or zoom. A search can hide the selected row without hiding its editor.
Renames, deletes and undo/redo refresh from document notifications; deleted IDs
are deselected, and undo restores the row without automatically selecting it.

**Focus area** centers the selected rectangle and fits it with the existing
24 CSS pixel Fit padding (reduced on tiny hosts). Magnification caps at 100% so a
small house remains at familiar tile scale. Large regions fit at overview scale;
the selected-label exception continues to show their name even when their authored
tier differs from the resulting zoom. The operation uses the live canvas size,
works at negative coordinates and map edges, and never clamps the rectangle or
moves its tiles. Repeating Focus yields the same view. Keyboard activation uses
the ordinary panel button and keeps focus in the panel.

While editing, Focus reveals the valid **draft** rectangle shown by the outline,
retains all draft fields and does not Apply them. It cancels an armed bounds draw
and its pointer preview before fitting the retained draft. Invalid geometry or
an unavailable canvas disables Focus with an accessible reason. Deleted or disposed
records cannot be focused. New, uncommitted areas keep the existing Draw/numeric
workflow; Focus is for a selected area.

Exact width × height in tiles is visible both in the editor and after Apply or
Cancel. Inspection shows signed half-open X/Y bounds with exclusive maximums,
the full name, authored tier and full multiline description (or “No description.”).
These are world dimensions, independent of zoom and label visibility; no inferred
hierarchy, automatic tier changes, tile selection, or occupied-cell counts are
introduced. All focus/search/inspection state is transient: document version,
content, history, explicit-save/recovery checkpoints and dirty state are unchanged.
An idle cyan tile-selection rectangle remains independent of the purple area.
The shared Undo/Redo route retains its existing policy of clearing tile selection;
restoring an area never recreates a tile selection.

Implementation locations: `src/AnnotationPanel.tsx` provides the focus control and
persistent readouts; `src/editor/annotations.ts` validates selection/readiness and
preserves drafts; `EditorSession.revealBounds` in `src/editor/session.ts` uses
`focusOnBounds` in `src/editor/viewport.ts` through the existing camera update path.
No renderer or document-storage change is required.

Validation: `tests/domain/area-browsing.test.ts` covers signed/distant/edge bounds,
both-axis fit and 100% cap, tiny hosts, clean checkpoints, tile-selection isolation,
drafts, invalid/unready/stale/disposed actions. `tests/area-browsing.spec.ts` covers
actual search/select/focus on both complete populated reference maps, exact readouts,
hidden tiers, label-to-panel selection, rename/delete/undo and narrow-window layout.
Actual command results and screenshot observations are recorded in
[TW-032](../.wrk/wrk-efb169f5.md). Synchronous annotation filtering and rendering
retain the documented baseline; performance refinement remains TW-049/TW-050.
