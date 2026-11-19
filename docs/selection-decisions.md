# Rectangular selection, clipboard, and transforms

Decision record for [TW-023](../.wrk/wrk-7cd74024.md), subordinate to
[INTENT.md](../INTENT.md#drawing-and-rearranging). These are implementation
decisions for TW-024 through TW-028, not a claim that selection tools already
ship. They extend the [coordinate](foundation-decisions.md),
[layer](layers.md), [registry](registry-decisions.md),
[input](navigation.md), and [atomic history](command-history.md) contracts.

The intent requires rectangular selections, active-layer defaults with explicit
multi-layer inclusion, whole-tile movement, cut/copy/paste, quarter-turns and
flips. Occupied source cells overwrite same-layer destinations; holes preserve
destination content. Named areas and labels are always independent. No freeform
selection, annotation coupling, automatic canvas growth, or new file format is
introduced here.

## Rectangle and layer membership

**Select** uses canvas shortcut **V**. A primary drag from included tile `(ax, ay)`
to included tile `(bx, by)` produces the half-open rectangle
`[min(ax,bx), max(ax,bx)+1) × [min(ay,by), max(ay,by)+1)`, intersected with map
bounds. Reverse drags are identical; a click is a one-cell rectangle. A start
must be inside the map. Capture allows the endpoint to leave the map/canvas;
only rectangle creation clips. An outside start does nothing. There is no
auto-pan, freeform outline, additive/disjoint rectangle, or resize handle in v1.

A primary drag outside an existing rectangle replaces it; a drag inside it
moves it, including when the grabbed cell is a hole. Deselect first to start a
new rectangle inside the old one. Show its exclusive bounds, width × height,
geometric tile count, included layer names/IDs, and occupied count per layer.
The geometric count is width × height, not multiplied by layer count. All-hole
rectangles are valid selections, distinct from no selection or a zero-area
rectangle. They can be repositioned but make no tile changes.

Each new rectangle starts with exactly the active **visible** layer. Hidden
active layers block creation with the existing “show layer” explanation. An
explicit inclusion control can add/remove visible layer IDs on the rectangle;
require at least one included ID. Do not include all layers by default. All
included layers share one world rectangle and local origin; never crop each
layer to its own occupied bounds. Include covered/offscreen tiles on those
visible layers, not merely the final composited pixels.

Membership is pinned by stable ID, independent of active layer, name and stack
index. Changing active layer does not retarget or broaden an existing selection;
show the pinned membership. Adding a new layer does not include it. Rename or
reorder retains membership and all relative offsets. Explicit inclusion changes
cancel any pending edit and read the newly chosen layers at the same rectangle.
Hidden/missing layers cannot be added. Hiding or removing any included layer
cancels the pending edit and clears the entire selection with an explanation;
never silently commit the remaining subset. Showing/restoring that layer does
not resurrect the selection. This refines the existing visible-ID filter into
an all-or-nothing operation policy.

Selection geometry/membership is transient session state outside MapDocument.
Creating, changing, or clearing it does not change content, dirty state, version,
undo/redo, or save/recovery checkpoints. It is not a drawing mask. Switching to
Pan or Inspect retains the rectangle; switching to a painting tool clears it.
Selecting another rectangle replaces the first. No annotation ID, bounds,
description, label tier, or anchor is captured, even for fully enclosed areas.

## Snapshots and movement

At the start of each edit, capture the rectangle, included IDs, document session
identity/version and immutable per-layer payload. A payload contains width,
height and local tile offsets `(u, v) = (x-minX, y-minY)`, preserving exact
`null`, raw RGBA, or registered ID values. Sparse occupied runs plus the full
rectangle encode holes; a dense array is not required. Raw alpha-zero paint is
occupied, never a hole. Do not flatten layers, resolve IDs to RGB, or adopt raw
values by color match.

Dragging uses `currentPointerTile - pointerDownTile` in both axes; it retains
the grabbed offset within the selection and snaps to integer tiles using the
existing floor-based world picker. Every preview is derived from the **same
start snapshot**, not from earlier preview results. Show destination bounds
and the actual composited result, including cells cleared at the source. Release
commits once at that offset; zero offset is a no-op. Returning to the start
before release leaves the document untouched. No live tiles change during drag.

With Select active and a selection present, canvas arrow keys move by one tile;
Shift+arrow moves by ten. Each keydown, including an OS repeat, is a separate
atomic nudge/undo step using a fresh snapshot. Without an active Select selection,
arrows retain camera navigation. During a paste or transform preview, arrows
adjust only its destination anchor, by the same steps, until commit. Modifier
Cmd/Ctrl/Alt combinations do not nudge. Navigation via Space/middle drag retains
priority over editing. All tile edits require a ready canvas at the existing
8 CSS pixels/tile minimum; overview keeps navigation and undo/redo available.

### Exact overlap and hole precedence

For each included layer independently, let `B(p)` be the pre-operation cell,
`S` the source rectangle, `D` its translated destination, and `P(q)` the captured
source payload. Let `q = p - delta` for `p` in `D`. The resulting cell is:

```text
after(p) = P(q)   if p is in D and P(q) is occupied
           B(p)   if p is in D and P(q) is a hole
           null   if p is in S but not D
           B(p)   otherwise
```

**Destination-hole preservation wins over source clearing in the overlap.** A
source tile underneath a translated hole remains at that position, as well as
being copied to its occupied destination. This deliberate consequence implements
the intent's “leave destination content untouched,” including prior content in
the overlap. Clear the source outside `D`, then write occupied payload cells into
`D`; never clear all of `S` and thereby erase a destination under a hole. Source
holes outside `D` were already empty. The same rule applies in every direction.

All reads use `B`/`P` before any write. Do not scan/mutate the live map in movement
order. Source and destination changes across **all** included layers are one
history command, capturing exact pre-edit values in their union. Undo restores
cleared sources, overwritten destinations, raw bytes and registered IDs; redo
replays the recorded result, not a fresh selection read. Unrelated layers,
registry metadata, bounds, layer order and annotations remain unchanged.

After a commit, the rectangle follows `D` and retains its IDs. It selects the
current map there: a subsequent independent operation snapshots that content,
including destinations retained under holes. It is not a persistent object or
floating cutout. Consequently several committed one-tile nudges can differ from
one three-tile drag when holes/collisions are involved. A single drag's intermediate
previews never accumulate these effects. Undo is the exact inverse; moving back
is not a substitute for Undo. The worked overlap example makes this visible.

## Clipboard and placement

Use one **in-memory clipboard per document session**, shared by its selection
actions and cleared on New/Open/session disposal. Same path, same names, or
identical IDs in another session do not grant compatibility. Cross-document
paste is unsupported in v1 and reports a reason without changes; no OS clipboard
format, cross-window import, layer creation, or registry import is implied.
Save/Save As within the same live session does not invalidate the clipboard.

Copy captures the rectangle, local payloads, included layer IDs, and session
identity. It replaces the previous clipboard only after a successful capture.
Copy changes no document/history state. Clipboard cells remain a snapshot if
source tiles later change; registered cells still reference their live entry ID,
so recoloring that entry changes both future paste appearance and existing copies.
Raw bytes remain raw. Clipboard storage contains no annotation records.

Paste maps each captured layer ID to **that exact layer** in the original session,
even for a single-layer clipboard and even when another layer is active. Never
map by name, current index or active layer, merge layers, or drop a failed layer.
Every captured layer must still exist and be visible, including an all-hole
layer. Every referenced registry ID must still resolve to a valid entry under
the registry contract. Missing/hidden layers or removed/malformed entries reject
the whole paste with an actionable explanation. Keep the clipboard so showing
the layer or undoing removal can make it usable again. Restored original IDs are
valid; a new same-name/same-color entry is not a replacement. Do not detach stale
clipboard references to raw colors automatically.

**Cut** first prepares the same clipboard snapshot, then clears occupied cells
inside the chosen rectangle on included layers in one reversible **Cut** command.
Publish the new clipboard only after the command succeeds. Failed capture or
history-capacity rejection preserves the previous clipboard and document. An
all-hole cut can replace the clipboard but adds no history. Keep the rectangle
and membership after cut. Cut is immediate, not deferred until paste: if no paste
ever follows, or paste is canceled/rejected, sources remain cut. Undo Cut restores
them; clipboard data is independent of undo/redo and is not consumed by paste.

**Paste** starts a transient preview with its top-left grid intersection at the
current valid in-map pointer tile. If the pointer is unavailable/outside, use the
current selection's top-left; if none, use the copied rectangle's original
top-left. Never silently center, clamp, or cascade placements. Pointer movement
over the canvas sets the proposed top-left to its tile; arrows nudge it. A primary
click at a valid candidate or Enter commits one **Paste** command and selects the
destination rectangle with the clipboard's IDs. Source tiles are not cleared by
paste. Occupied payload cells overwrite same-layer destinations; holes preserve
the pre-paste cells, including within a former cut region.

After commit, another Cmd/Ctrl+V starts a new preview from the unchanged clipboard,
using the same anchor rule. There is no automatic offset and no “paste consumed”
state; identical repeated placement can be a document no-op. Cmd/Ctrl+V during
an existing preview resets that preview from the clipboard without committing
the old one. Escape cancels only the preview and restores the prior selection.
Copy/Cut are disabled during any pending placement/edit until commit or cancel.
Canvas Cmd/Ctrl+C/X/V use these actions; text fields/contenteditable/IME retain
native clipboard behavior. Panel buttons route through the same actions without
installing global text-shortcut overrides.

## Quarter-turns and flips

Provide explicit **Rotate clockwise**, **Rotate counterclockwise**, **Flip
horizontal** and **Flip vertical** actions. They start/update a transient
transform preview; Enter or an explicit Apply commits and Escape cancels. A
paste preview can be transformed by the same actions without altering the stored
clipboard. Arrows can reposition the proposed result before Apply. Do not infer
a transform from a drag modifier or invent free-angle rotation.

The anchor/pivot policy keeps the rectangle's **top-left grid intersection**
fixed. Rotate in local coordinates and rebase the turned rectangle to that
anchor, rather than rotating around a world center and rounding half tiles.
For local `(u,v)` in width `w`, height `h`, with screen/world y increasing down:

| Operation                           | Destination offset | New dimensions |
| ----------------------------------- | ------------------ | -------------- |
| Clockwise 90°                       | `(h-1-v, u)`       | `h × w`        |
| Counterclockwise 90°                | `(v, w-1-u)`       | `h × w`        |
| Horizontal flip (left/right mirror) | `(w-1-u, v)`       | `w × h`        |
| Vertical flip (top/bottom mirror)   | `(u, h-1-v)`       | `w × h`        |

All layers use the **same** source rectangle, mapping and destination anchor,
including empty rows/columns. Map every hole and occupied cell; registry IDs and
raw bytes do not change. Successive preview transforms compose on the captured
payload with updated dimensions; four quarter-turns, a clockwise/counterclockwise
pair, or two identical flips recover that exact payload/anchor. Do not recapture
destination background between preview transforms.

Applying a transform to a live selection uses the movement formula above, with
`q` supplied by the inverse transform instead of translation. Clear `S` outside
`D`, write transformed occupied values, and preserve `B(p)` under transformed
holes, including in `S ∩ D`. For a paste preview, perform only the destination
compositing; do not clear the original copied rectangle. This is the same
transparent-hole rule for every operation, not a rectangular opaque stamp.

After a live transform commits, use the resulting dimensions and pinned IDs for
the selection. Each subsequent committed edit captures the current map, as with
movement. Four **payload** turns are an identity; four separate committed turns
over occupied backgrounds are not promised to restore overwritten content or
remove cells retained under holes. That requires Undo. Preview-return-to-original
is a no-op when the anchor is also unchanged. Non-square turns never crop rows
or columns to fit the old rectangle.

## Fixed boundaries, cancellation, and history

For move, nudge, paste or transform, the **entire destination rectangle**, including
its holes and all included layers, must fit current half-open map bounds. Touching
the exclusive edge is valid (`D.maxX <= bounds.maxX`, likewise y); any spill,
unsafe coordinate/dimension arithmetic, or missing dependency rejects the whole
operation. There is no clipping, wrapping, partial layer commit, automatic growth,
or silent clamp. Show invalid destination bounds and why placement is unavailable.
The author may cancel, explicitly Grow Canvas, and retry.

An invalid move release discards its preview and retains the original selection.
A rejected nudge leaves it in place. Invalid Paste/Apply keeps the candidate
preview for repositioning or Escape; it makes no document/history changes.
Copy/cut require a valid in-map source rectangle. Bounds can change only through
the independent explicit command; a version change invalidates pending work.

| Event                                                                                              | Result                                                                             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Escape during creation/move                                                                        | Cancel candidate; restore the previous committed selection                         |
| Escape during paste/transform                                                                      | Discard staged payload/placement; restore the previous selection; retain clipboard |
| Escape with no pending operation / Deselect                                                        | Clear selection only; do not undo a completed edit or cut                          |
| Lost capture, pointer cancel, window blur                                                          | Cancel pending work; retain the prior valid selection and clipboard                |
| Tool, active layer, inclusion, visibility, camera/size or canvas readiness change during a preview | Cancel pending work before the change; apply the selection lifetime rules above    |
| Document mutation during a preview                                                                 | Discard stale plan; never rebase or commit against a different version             |
| Included layer hidden/removed                                                                      | Clear selection and cancel; clipboard remains but paste validation rejects         |
| Undo/redo                                                                                          | Cancel preview and clear selection; replay document history; keep clipboard        |
| New/Open/session disposal                                                                          | Drop selection, preview and session clipboard                                      |

After other document mutations, retain an idle rectangle only if its bounds and
included IDs remain valid; later operations capture fresh cells. Ordinary canvas
focus moving to a selection control does not cancel the preview; window blur
does. Text and panel navigation keys retain their normal behavior. Escape/Enter
also work on the dedicated preview Cancel/Apply controls, not in unrelated text.

Validate the entire operation and history capacity before publication. A failed,
canceled or net no-op operation preserves content, version, undo/redo and saved/
recovery checkpoints; only transient feedback/selection/preview may change as
specified. No document event escapes. An effective multi-layer edit adds one
transaction/undo step, regardless of storage or visual chunk boundaries. A
history-limit failure is not a reason to split the edit or make it irreversible.
Undo captures earliest before/final after values for all changed cells, including
overlaps. Post-commit observer errors describe a committed edit with a view error,
not a retryable rejection. Use the existing TypeScript document/history seams;
React and Pixi hold no authoritative tile edits. Large-edit/history/memory and
rendering/presentation refinements remain TW-050/TW-049 under AGENTS.md.

## Worked examples and implementation handoff

These examples specify expected behavior for future feature tests. They are not
evidence that the selection UI exists. `.` denotes a hole, `ref(W)` a registry
identity, and letters denote distinct occupied values unless stated otherwise.

### 8 × 8 house moved three tiles

Use bounds `[0,128)²`, with Terrain (`T`), Walls (`W`) and Furniture (`F`) in that
order. T has grass throughout. W has `ref(stone)` in all 64 cells of
`S = [60,68) × [60,68)` and raw `X` in `[68,71) × [60,68)` (24 cells). F has raw
`C` at `(60,61)`, raw `D` at `(61,61)`, raw `Q` at `(64,61)`, and raw `E` at
`(70,66)`; other F cells are empty. An illustrative named house has bounds S,
anchor `(64,64)` and a description. This fixture does not decide annotation UI.

Reverse drag `(67,67)` to `(60,60)` selects exactly 8 × 8 = 64 positions crossing
both 64-tile chunk lines. Active W is the default. Explicitly include F; leave T
excluded. A drag from `(62,62)` to `(65,62)` has delta `(3,0)` and
`D = [63,71) × [60,68)`.

- W: `[60,63) × [60,68)` becomes empty (24 cells). All 64 cells in D are
  `ref(stone)`, overwriting the 24 X cells. T is identical at every coordinate.
- F: C moves to `(63,61)` and D overwrites Q at `(64,61)`; Q moves to `(67,61)`.
  E at `(70,66)` remains because its incoming source `(67,66)` is a hole.
  `(60,61)` and `(61,61)` become empty; F has exactly four occupied cells after.
- Annotation bounds S, anchor `(64,64)`, name/description/tier stay unchanged.
  The selection now has D and IDs W/F; active-layer changes cannot add T.
- One Undo restores all 88 W cells, C/D/Q/E at their original F positions, and
  unchanged terrain/annotation metadata. Redo reproduces the exact moved state.
  A zero-offset drag, or Escape before release, leaves the complete initial state.

### Overlapping move with holes

On one layer at a fixed y, use `S = [0,4)` and move right by one to `D = [1,5)`:

| x                     | 0   | 1   | 2   | 3   | 4   | 5   |
| --------------------- | --- | --- | --- | --- | --- | --- |
| Before                | A   | .   | B   | C   | X   | Y   |
| Incoming payload in D | —   | A   | .   | B   | C   | —   |
| After                 | .   | A   | B   | B   | C   | Y   |
| Undo                  | A   | .   | B   | C   | X   | Y   |

At x=2 the incoming hole preserves **pre-move B**, although x=2 is also a source
cell. At x=3 captured B overwrites C; at x=4 captured C overwrites X. Reading
live values after writing x=3 would incorrectly duplicate B at x=4. Only x=0
lies in `S \ D` and is cleared. Other layers and annotations are unchanged.
Paste of the same payload at x=1 has the same destinations but keeps A at x=0.
Cut of S instead clears x=0,2,3 immediately; canceling its subsequent paste does
not restore them. Undo Cut does.

### Non-square quarter-turn and boundary rejection

At anchor `(10,20)`, select width 3, height 2, with this payload on one layer:

```text
Before (3 × 2)   Clockwise (2 × 3)   Counterclockwise (2 × 3)
A . B           C A                B E
C D E           D .                . D
                E B                A C
```

Clockwise maps A `(0,0)` to `(1,0)`, the hole `(1,0)` to `(1,1)`, and E `(2,1)`
to `(0,2)`. The result is `[10,12) × [20,23)` at the unchanged top-left anchor.
For a live transform, old B at `(12,20)` and E at `(12,21)` are cleared outside D.
Old D at `(11,21)` is under the transformed hole, so it remains. If the old map
also had X at `(10,22)` and Y at `(11,22)`, E/B overwrite them. The actual rows
in D after commit are therefore `C A / D D / E B`, distinct from the payload
diagram because of hole compositing. Undo restores A/B/C/D/E/X/Y and the hole
exactly. A second included layer uses the identical coordinate map, never its
own cropped center. Horizontal payload flip is `B . A / E D C`; vertical is
`C D E / A . B`. Four preview turns or two preview flips recover the original.

If map bounds end at y=22, the original source fits but this rotation does not:
the candidate maxY=23 rejects entirely. Nothing is cleared, even if the protruding
row is all holes. Bounds ending at y=23 permit it. Moving `[120,128)²` right by
one on `[0,128)²` likewise rejects, while moving it left by one fits. Creation
dragging from `(126,126)` to `(130,130)` clips to `[126,128)²`; that exception
never applies to movement/paste/transform. Negative coordinates after explicit
left/top growth use the same rules.

### Concrete follow-on cases

| Case | Owner          | Required check                                                                                                                                                                         |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01  | TW-024         | Reverse 8 × 8 drag, one-cell click, all-hole rectangle, outside start and clipped creation at each edge; exact dimensions/counts                                                       |
| S02  | TW-024         | Explicit W/F IDs exclude T; active switch, rename and reorder do not retarget; hidden/missing IDs cannot join; hiding/removing an included layer clears selection                      |
| S03  | TW-024         | Selection-only operations preserve content/version/history/checkpoints; enclosed and intersecting annotations never enter payloads                                                     |
| S04  | TW-025         | House example: exact complete W/F/T before/after maps, delta three, one transaction and exact undo/redo                                                                                |
| S05  | TW-025         | Hole example in four directions, source/destination overlap and no overlap, including source tiles beneath destination holes; compare against the piecewise rule                       |
| S06  | TW-025         | Same-snapshot drag previews, return to origin, independent key-repeat history, all-hole movement, Escape/capture/blur/context/version cancellation                                     |
| S07  | TW-025/026/027 | Full-rectangle boundary rejection at four edges/corners and negative bounds; exact touching allowed; overflow and history-limit rejection preserve state                               |
| S08  | TW-026         | Copy is immutable; cut then no paste, Escape or failed paste stays cut until Undo; failed Cut preserves previous clipboard; empty Cut/Paste adds no history                            |
| S09  | TW-026         | Repeated paste, same-anchor no-op, pointer/fallback anchors, pending-paste reset, hole compositing and complete overwritten-destination undo                                           |
| S10  | TW-026         | Active-layer/name/order changes never remap; hidden/removed layer rejects all layers; same-ID undo restoration permits retry; replacement session clears/rejects clipboard             |
| S11  | TW-026         | Copy layered raw/registered house, paste and recolor: ID copies update together, raw matches stay raw; deleted registry ID rejects until restored; native text shortcuts remain native |
| S12  | TW-027         | Asymmetric 3 × 2 example, one row/column, sparse layers with different extents; common anchor, formulas, dimension swaps, unchanged raw/registered identities                          |
| S13  | TW-027         | Four preview turns/two flips recover exact payload, including holes; actual live compositing, overwritten rows, cancel and undo follow the worked example                              |
| S14  | TW-028         | Compose move/cut/paste/rotate/flip with intervening scope changes; reverse the entire history and compare all cells, layer IDs/order, registry, bounds and annotations                 |
| S15  | TW-028         | Populated cross-chunk multi-layer operations, stale plans, no-op redo preservation and capacity rejection; record snapshot/preview/commit/history cost with TW-049/TW-050 limitations  |

These cases are a handoff, not additional work performed in this decision ticket.
Runtime correctness tests and interaction checks belong to those implementation
tickets. No new selection performance or native interaction result is claimed.
