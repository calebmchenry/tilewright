# Drawing gestures and previews

TW-018 supplies the shared drawing pipeline, following [INTENT.md](../INTENT.md),
[coordinates](foundation-decisions.md), [navigation](navigation.md), and
[history](command-history.md). These are implementation decisions. Tool algorithms,
sizes and shortcuts remain TW-019 onward; no unfinished drawing tool is enabled in
the shipped toolbar. Test-only adapters exercise the real controller and canvas.

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

`mountRenderer.ts` subscribes directly to preview changes and cleans up on failure,
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
smoke checks validate lifecycle and navigation; shipping tool interaction checks
follow as TW-019 onward installs its algorithms.
