# Map navigation

TW-008 implementation decisions, subordinate to [INTENT.md](../INTENT.md) and
[foundation decisions](foundation-decisions.md). These are conventional editor
defaults, not additional confirmed product requirements. The camera remains
transient session state; navigation never executes a document command, grows
bounds, adds history, or changes the saved revision.

## Controls

| Input over the canvas                            | Behavior                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Mouse wheel / two-finger trackpad scroll         | Pan in both axes; positive deltas move the camera right/down               |
| Shift + vertical scroll                          | Horizontal pan                                                             |
| Cmd/Ctrl + scroll                                | Zoom about the pointer                                                     |
| Trackpad pinch                                   | Pointer-anchored zoom; WebKit cumulative gesture scale or Ctrl-wheel input |
| Middle-button drag                               | Grab and move the map                                                      |
| Space + primary-button drag                      | Temporarily grab the map without switching tools                           |
| Pan button / H, then primary-button drag         | Persistent Pan tool                                                        |
| Inspect button / I                               | Inspect tile coordinates; drag to measure a rectangle                      |
| Fit map button / F                               | Center all fixed document bounds in the canvas                             |
| + / =, - / _                                     | Multiply/divide zoom by 1.25 about canvas center                           |
| 0                                                | 100% about canvas center                                                   |
| Arrow keys / Shift + arrows                      | Move camera 64 / 256 CSS pixels                                            |
| Escape, lost capture, cancellation or focus loss | End the current navigation drag; blur/Escape clear temporary Space state   |

Keyboard navigation applies only while the canvas owns focus. Text fields,
selects, IME composition and panel controls retain their normal input. Cmd/Ctrl+Z,
Shift+Z and S keep the existing shared history/save routing. Space release is
observed even outside the canvas. Pointer capture lets a drag finish outside the
host; cancellation and teardown release it. Navigation listeners are attached
once per canvas and removed on disposal, including Strict Mode replay.

`src/editor/navigation.ts` uses non-passive wheel/gesture listeners to prevent
page scrolling and browser zoom over the canvas. Pixel deltas keep fractional
trackpad motion; line deltas use 16 CSS pixels and page deltas use canvas height.
Wheel zoom multiplies by `exp(-0.002 * deltaY)`, with delta clamped to ±1000 per
event to avoid overflow. It does not attempt unreliable mouse/trackpad detection.
WebKit scale is relative to gesture start; each update solves from that original
view and anchor, and wheel events during the gesture are ignored to avoid double
application. Other browsers' pinch delivery uses Ctrl-wheel. References:
[wheel units](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode),
[wheel cancellation and pinch](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event),
[Apple gesture scale semantics](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html).

## Camera, limits and edges

`src/editor/viewport.ts` owns the pure camera math. World units are tiles; screen
units are **CSS pixels local to the canvas host**. At 100%, a tile occupies 24 CSS
pixels. The view's `(x,y)` is the world point at the fixed `(24,24)` canvas inset:

```text
screen = inset + (world - view) * (24 * zoom)
world  = view + (screen - inset) / (24 * zoom)
```

`worldToScreen` maps grid intersections; `tileToScreen` maps tile centers.
`screenToWorld` is reversible without integer rounding; `screenToTile` uses
mathematical floor, including negatives and exclusive right/bottom boundaries.
Only integer-edge roundoff within eight machine epsilons of the participating
coordinate magnitudes is snapped. This avoids picking a previous cell at an
exact edge after cancellation; it is not a screen-pixel-sized snapping band.
Tests cover the 6,400-tile target and negative growth coordinates; exact sub-tile
camera precision across every safe-integer-sized map is not claimed.

Pointer conversion subtracts the host's current bounding rectangle on every
sample. Panel offsets and resizing therefore use the same transform. DPR never
enters input math: Pixi alone sizes the backing surface. Stationary-pointer
readouts are recomputed after camera/size changes. Resize preserves the existing
camera rather than silently refitting; press F to fit the new window dimensions.
Explicit map growth also preserves the camera and fixed world coordinates.

Zoom spans **1/1024 to 8** (0.09765625%–800%, or 0.0234375–192 CSS px/tile).
The lower bound decreases if needed to admit Fit for a larger map or tiny host.
Fit centers all document bounds with 24 CSS pixels of padding on each side;
padding reduces for hosts smaller than 96 pixels, and magnification caps at 800%.
The selector includes common presets and the current continuous/fitted value.
Toolbar zoom and keyboard zoom anchor at canvas center; wheel zoom anchors at
its pointer. Camera coordinates are never rounded to tiles. A limit-clamped
zoom uses the actual clamped factor, so the anchor stays put even at limits.

Pan permits bounded overscroll: each axis keeps at least the lesser of 48 CSS
pixels, half the viewport, or half the rendered map visible. This lets edge
cells be brought into comfortable working positions while keeping the map
reachable. Zoom solves the anchor exactly without a subsequent pan clamp;
zooming around empty margin can move the map farther away. The next pan applies
its bounds, and Fit always recovers the full map. This precedence is deliberate:
a pan clamp during zoom would unexpectedly move the intended pointer anchor.

## Overview and tools

Below **8 CSS pixels per tile**, the canvas displays “Overview · Zoom in to edit
tiles (8 px per tile minimum).” Tile tool controls expose that reason, and the
shared `EditorSession.editableTileAt` returns null. Out-of-bounds coordinates
also return null instead of being clamped to an edge cell. Inspect and navigation
remain usable; clicking in overview reports the reason without any document edit.
At detail scale, Inspect now supports [rectangle measurement](grid-and-scale.md)
without selecting or changing tile content.
At the threshold the gate permits picking. Drawing tools themselves remain their
later tickets; they must use this gate when implementing pointer edits. Undo,
metadata changes and document commands remain independent of camera scale.

TW-008 exposes full-map navigation through the existing sparse tile renderer.
It does not implement TW-010's overview caches or claim its frame/memory budgets.
At full-map fit, the existing renderer necessarily queries all visible render
chunks. The target-scale tests load actual populated, overlapping layers; future
overview caching should retain the same camera/input contracts.

## Validation

- `tests/domain/viewport.test.ts`: signed world/screen/tile round trips, exact
  edges and near-edge rounding, distant-origin cancellation, 10,000 inverse zoom
  cycles, limits, 100×100-chunk fit, overscroll, transient-state isolation and tool
  gating. Existing domain/model oracle tests remain in the full suite.
- `tests/navigation.spec.ts`: real browser wheel/mouse/keyboard interactions,
  fractional/line/page scroll, repeated zoom, gesture-shaped cumulative scale and
  duplicate wheel suppression, pan tools, Space/middle drag, limits, cancellation,
  blur, focus, disposal, DPR 1/2 and panel/resized-host picking.
- `tests/editor.spec.ts`: existing layout, density notifications, native text undo,
  targeted panel subscriptions, same-canvas lifetime and center-anchored selector.
- `tests/navigation-scale.spec.ts`: complete populated target-map fit/detail loops
  and preservation of bounds/history/content counts. Raw evidence is retained
  in the ticket's local validation directory.

Run build, full tests, formatting, and the packaged desktop build. Actual command
results and native input observations belong in WRK. Synthetic gesture events
verify handling, not physical trackpad delivery; native automation and physical
hardware checks must be identified separately in that evidence.
