# Drawing gestures and previews

TW-018 supplies the shared drawing pipeline, following [INTENT.md](../INTENT.md),
[coordinates](foundation-decisions.md), [navigation](navigation.md), and
[history](command-history.md). These are implementation decisions. Tool algorithms,
sizes and shortcuts are supplied by feature modules. TW-019 installs the pencil;
TW-020 adds the eraser and eyedropper described below. The other unfinished drawing
tools remain unavailable.
Test-only adapters also exercise the real controller and canvas.

## Adjustable pencil (TW-019)

`src/editor/pencil.ts` supplies a square brush with whole-tile sizes **1–32**,
default **1**. Its top-left offset from the pointer tile is
`-floor((size - 1) / 2)` on both axes. Odd sizes center on that tile. Even sizes
put the extra row and column below/right: size 2 at `(63,63)` covers
`[63,65)²`; size 4 covers `[62,66)²`. These are conventional implementation
choices, not additional requirements from INTENT.md.

Each sample connects the previous and current integer tiles with a nearest-cell,
8-connected line (diagonal cells may meet at corners), then stamps every center.
Both endpoints are included. The larger coordinate delta is the major axis;
ascending major-axis ordering and half-ties toward the positive minor coordinate
make the result independent of drag direction. Interpolation uses exact integer
arithmetic. It skips major-axis positions whose stamps cannot touch fixed bounds,
without rounding new endpoints or changing the original line's phase. This avoids
walking a huge off-map gap. Footprints clip all four edges before generating runs;
chunk boundaries never split a gesture. Repeated same-tile samples are skipped,
and the shared sparse staging deduplicates overlap/retracing before the command.

The selected raw value or registry identity and brush size are captured at gesture
start. Release commits one Pencil history step on the active visible layer.
Undo restores overwritten content and emptiness exactly; other layers, metadata
and bounds stay unchanged. Same-paint and outside-only gestures preserve redo and
saved state. Size is a transient session preference, not document content.

Choose **Pencil** or press **B** while the canvas has keyboard focus. The Tools
panel offers a **Pencil size** selector; **[** and **]** decrease/increase size by
one, stopping at 1 and 32. Inputs/selects and IME retain their native keys. New Map
resets size to 1. Changing size cancels an in-progress stroke, preserving redo;
the next stroke captures the new size. Other cancellation/readiness rules below
also apply. Inspect remains the initial tool.

Hover shows a clipped square in the selected raw/registered paint; dragging shows
the accumulated stroke. Both use the existing Pixi overlay and never enter the
document or tile/overview caches. The hover store is separate from the gesture
preview/history and clears on canvas exit, navigation, cancellation and teardown.
Size shortcuts refresh the hover at the stationary pointer after canceling a
stroke. The overlay indicates affected cells above all layers; it is not a final
composite preview when another layer covers the editing target.

Pencil geometry and command coverage live in `tests/domain/pencil.test.ts`:
stationary dabs, sizes 1/2/3/4/31/32, all line octants and reversal ties, rapid
horizontal/diagonal strokes across signed storage/visual boundaries, overlapping
stamps, raw/registered identity, layer preservation, undo/redo, clipped corners,
outside no-ops and very distant endpoints.
`tests/pencil.spec.ts` exercises the shipping adapter, controls and pointer path
at DPR 1/2, hover/stroke screenshots, exact canvas pixels after undo/redo, raw and
registered strokes, layer preservation, even dabs, size-change cancellation,
clipped edges, text shortcuts and the minimum-window layout.

## Eraser and eyedropper (TW-020)

These are implementation decisions within INTENT.md's eraser/sampling scope.

**Eraser** (canvas shortcut **E**) uses exactly the pencil's square footprint,
1–32 tile range, even-size anchor, continuous interpolation and clipping rules.
Pencil and Eraser share one transient size preference (initially 1); the Tools
panel labels its selector for the active brush. **[ / ]** changes either brush's
size. Switching tools or changing size cancels a pending stroke. The red hover
and stroke overlay indicates affected cells, not the final composite appearance.

Release writes `null` on the captured active visible layer in one **Eraser**
history step, never a background-colored tile. Lower layers are untouched and
become visible wherever no higher visible content remains. Undo restores every
original raw value, registry ID and empty cell; redo clears the same cells again.
Erasing empty space or an entirely outside footprint is a no-op, preserving redo
and saved/recovery checkpoints. Navigation, overview, capture and cancellation
rules are identical to Pencil. `src/editor/pencil.ts` shares the square-brush
algorithm between the two tools; `DrawingController` owns staging and history.

**Eyedropper** (canvas shortcut **D**, retaining **I** for Inspect) samples once
on primary pointer-down. It stays selected until another tool is chosen; moving
or releasing the pointer does not sample additional cells or paint. Choose Pencil
or press B to paint with the selected value. The Tools hint describes the policy.

Sampling uses the **visible layer stack**, not the active layer. At the pointed
integer cell, `src/editor/sampling.ts` searches top to bottom, skips hidden layers
and empty cells, and returns the first occupied stored value. Thus an empty top
layer exposes underlying paint; a hidden top layer cannot supply paint. A hidden
active layer does not prevent sampling visible content. Reordering/visibility
affects the next sample immediately. There is no active-layer-only mode in this
baseline. This default matches the opaque visible tile an author is pointing at.

`EditorSession.sampleColorAt` selects an existing registry ID for registered
content. Its current swatch resolves through the registry; subsequent Pencil
strokes store that ID and follow future recolors. Raw samples select exact raw
bytes, even when they match a registry entry's color. Sampling never adopts,
registers, recolors or edits tiles. It reads the model rather than framebuffer
pixels, so grid lines, preview overlays and display color blending cannot destroy
identity. Black, white and map-background-colored tiles are ordinary raw samples.

If all visible layers are empty (or hidden), or the pointer is outside fixed
bounds, keep the current paint and explain that there is no visible tile.
Sampling requires a ready canvas and the same 8 CSS px/tile detail threshold as
painting. Space/middle navigation takes precedence; right clicks, secondary
pointers, Cmd/Ctrl/Alt starts, panel/text input and IME do not sample. Sampling
changes only transient paint selection/feedback; document version, tile allocation,
registry, history, redo and checkpoints stay unchanged.

The existing authoring palette accepts opaque colors only. Legacy nonopaque raw
values (including alpha zero) still count as occupied, and missing/malformed or
nonopaque registry records remain stored content. Sampling these reports the
existing color/registry validation error and keeps the selection unchanged. It
neither flattens a blended color nor skips the occupied cell to choose an unrelated
lower-layer identity. This preserves the established legacy-data contract without
adding transparency authoring or an import-repair policy.

`tests/domain/eraser-sampling.test.ts` covers signed 32/64 boundaries, partial
corners, mixed raw/registry erasure, lower-layer preservation, exact atomic undo/
redo, no-ops/cancellation, stack/hidden/empty/outside/readiness cases and sampling
followed by painting and recoloring. `tests/eraser-sampling.spec.ts` covers shipping
controls and pointer routing, red previews and exact visible undo/redo at DPR 1/2,
underlying-layer reveal, and registered versus raw painting after sampling.

## Tool contract and data ownership

`src/editor/drawing.ts` owns a session's `DrawingController`. Feature modules
register a `DrawingTool` under its existing action ID before mounting controls.
The session then uses that tool's label and normal readiness/overview/visible-layer
gates. A tool creates one synchronous operation per pointer gesture. Its immutable
context captures the start tile, bounds, active layer ID, and raw/registered paint
identity. Each sample supplies start, previous and current integer tiles, including
out-of-map coordinates. Tools own interpolation/footprint algorithms; coalesced
pointer samples and the final release position are delivered by the canvas router.

A sample returns candidate horizontal spans and either `append` (a stroke) or
`replace` (an endpoint-based shape). Each span contains a cell value; `null` means
erasure. The pipeline validates and copies spans, intersects them with fixed map
bounds **before allocating cells**, and stores only the sparse last write for each
candidate cell. It does not clamp outside samples onto edges, grow the map, split
at chunks, infer registry identity from RGB, or retarget layers mid-gesture.
Tools can begin over empty canvas margin, cross into the map, and clip normally;
an entirely outside footprint is a no-op. Inspect retains its inside-map start gate.

Previews are frozen, compact horizontal runs in `drawing.preview`, outside
MapDocument, history, saved/recovery checkpoints and React state. Shape replacement
removes the old footprint. Release stages the final sparse runs as **one tiles
command** through the existing `DocumentGesture`; history computes net deltas and
original values. A same-color, outside-only, empty-erase or canceled gesture sends
no document event, adds no history and preserves redo/checkpoints. A new unsaved
map remains unsaved; a clean saved checkpoint remains clean for these operations.
Undo restores overwritten and formerly empty cells across every touched chunk.

Any effective document change cancels an active preview, including undo/redo,
registry changes and layer removal. Active tool/layer, visibility, paint selection,
camera, canvas size or readiness changes also cancel it. Session disposal cancels
and unsubscribes. Tool errors and invalid spans clear preview and report through
shared feedback; atomic history errors preserve the document. Post-commit observer
errors are reported as committed edits, never retried.

The baseline stores a Map entry per candidate cell and sorts/coalesces the preview
on each sample. It never allocates the full map, but very large footprints can
consume significant temporary memory/time. TW-050 owns large edit/history/memory
refinement; TW-049 owns preview rendering/presentation refinement. No new latency
or memory budget is claimed.

## Input lifetime

`src/editor/navigation.ts` remains the single canvas input router. Navigation has
priority over editing. Only primary pointer input starting directly on the host
or its WebGL canvas can draw; panel controls, nested text fields, secondary
pointers, right clicks and Cmd/Ctrl/Alt drawing starts are excluded. Keyboard
routing retains native text editing and IME behavior. Drawing requires a ready
canvas, a visible active layer and **at least 8 CSS pixels per tile**. Below that
threshold the existing overview message applies, while navigation and history
remain available. Input uses CSS pixels and the current host rectangle, never DPR.

| Event                                                                      | Drawing result                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Primary down                                                               | Capture pointer and preview the first sample; a click can affect one tool footprint         |
| Move                                                                       | Deliver coalesced samples in order, then the event's position; tools connect sparse samples |
| Pointer leaves canvas                                                      | Keep capture and preview; outside-map cells are clipped, with no auto-pan                   |
| Primary release, including outside canvas                                  | Sample release position and commit once; normal capture release cannot undo the commit      |
| Pointer cancel / unexpected lost capture                                   | Discard all staged paint and release capture                                                |
| Escape / host or window blur                                               | Discard staged paint; Escape also clears Inspect measurement                                |
| Move with primary button no longer down                                    | Cancel rather than guess where a missing release occurred                                   |
| Camera, size, tool, layer, visibility, color, readiness or document change | Cancel; a subsequent gesture uses the new context                                           |
| Space during drawing / WebKit pinch start                                  | Cancel drawing; navigation never produces a tile command                                    |
| Wheel during drawing                                                       | Ignore it to keep the sampled camera stable                                                 |
| Capture failure / invalid tool output / teardown                           | Cancel and release; errors use shared feedback                                              |

Middle drag, Space-drag and the Pan tool retain their navigation semantics. There
is one active pointer gesture per canvas. A secondary pointer cannot cancel or
finish a primary drawing gesture. Strict Mode teardown removes every input and
preview listener, and session replacement discards pending work.

## Preview rendering and invalidation

`src/renderer/createRenderer.ts` draws candidate runs in a separate Pixi Graphics
overlay above content/grid. Paint is tinted at 55% opacity with a white outline;
erasure uses a faint red fill and red outline. This shows the **affected footprint**,
even when a higher layer covers the active layer, rather than promising the final
composited appearance. It resolves registered colors by identity. Geometry is
clipped to the visible host; candidate writes are already clipped to map bounds.
Cancellation clears it. The preview owns no tile textures or overview pixels.

`mountRenderer.ts` subscribes directly to gesture and hover preview changes and cleans up on failure,
retry and disposal. Preview refresh reads no tile runs and invalidates no tile
cache. Commit/undo/redo go through the normal document bridge: exact net changed
spans on the target layer rebuild only intersecting visible detail chunks once;
intersecting retained overview regions are marked dirty and rebuilt when visible.
No drawing-specific full-map invalidation or React tile state is introduced.

## Validation

- `tests/domain/drawing.test.ts`: saved/recovery/history isolation, append/replace,
  overlap coalescing, clipped signed/partial edges, same-color/outside-only no-ops,
  redo preservation, active-layer gating, errors, context cancellation, registered
  paint and erasure, four visual chunks, underlying cells, metadata and exact undo.
- `tests/fixtures/drawing.ts`: two-layer signed/partial-boundary fixture and simple
  **test-only** tool adapters. These are not the shipping pencil/shape algorithms.
- `tests/drawing.spec.ts`: real pointer capture and outside release, pointer-cancel,
  actual capture loss, Escape, focus/context changes, coalesced and rapid movement,
  release-only endpoint, clicks, navigation/panel/text/secondary-pointer isolation,
  overview gating, replacement previews, missing button/capture failure and teardown.
  DPR 1/2 screenshots and WebGL readbacks verify transient overlay pixels, no tile
  queries/uploads during preview, exactly two affected detail chunks at a boundary,
  exactly one retained overview-region rebuild, erasure and exact undo pixels.

Run build, full tests, formatting and the packaged desktop build. The WRK ticket
records actual results and limitations. Chromium input automation and synthetic
coalesced/cancel events do not claim physical pen/trackpad delivery. Native packaged
smoke checks validate lifecycle, navigation and terrain/building pencil strokes
with undo. Other tool interaction checks follow in their implementation tickets.
