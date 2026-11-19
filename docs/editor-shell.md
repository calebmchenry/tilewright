# Editor shell and session

TW-006 implementation decisions, subordinate to [INTENT.md](../INTENT.md) and
[foundation decisions](foundation-decisions.md). The shell integrates the existing
[sparse document](map-document.md) and [transactional history](command-history.md).

## Ownership and subscriptions

`src/main.tsx` constructs an `EditorWorkspace` outside React. Its current
`EditorSession` is passed to `App`; New Map replaces it with a fresh session.
The workspace disposes its session after root unmount on pagehide or HMR. Strict
Mode can replay canvas effects without creating duplicate document controllers.
A replacement document must have a new session; never write around its history.
See [map creation and growth](canvas-creation.md) for replacement, modal controls,
dimension guardrails and undoable bounds changes.

`src/editor/session.ts` owns the document and history, plus separate transient
stores for active tool/layer, current color, viewport, pointer, focus, renderer
readiness, rectangle measurement and feedback. React component drafts (layer name, hex input and area
search) stay local to their panel. None of these values are copied into document
content, commands, saved revisions or recovery data in the current implementation.
The [TW-033 project format](project-format.md#persisted-preferences-and-session-reset)
chooses to snapshot active/hidden layers separately. The
[TW-034 snapshot API](project-format.md#snapshot-and-encoder-implementation-tw-034)
implements that boundary; other editor preferences remain session-local.
`execute` and `perform` are the shared
command/action entry points; tools can build domain commands outside React.

`Store` exposes cached `getSnapshot` and idempotent `subscribe` seams for
`useSyncExternalStore`. Values are immutable snapshots. The session subscribes to
model changes once and only refreshes the summaries named by their change kinds:

| Change                  | React subscriptions                         | Canvas invalidation                                                   |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Tile span               | History controls, dirty indicator, feedback | Exact layer/world rectangles                                          |
| Layer name              | Layer panel/readout and history             | None; names do not affect composition                                 |
| Layer membership/order  | Layer panel/readout and history             | Composition; removed active layer falls back to top remaining layer   |
| Bounds                  | Dimension/pointer readouts and history      | Map boundary                                                          |
| Registry record         | Color panel and history                     | Changed color identities across layers; name-only edits do not redraw |
| Annotation record       | Named-area panel and history                | Changed annotation identities                                         |
| Pointer/focus           | Compact readout only                        | None                                                                  |
| Color/tool/active layer | Corresponding controls/readouts             | No persistent document change                                         |
| Zoom                    | Zoom control                                | Resize the shell surface with the same CSS transform                  |

`App` has no document revision/state subscription. It never enumerates tiles or
creates tile React elements. Action controls select just their relevant history
label or renderer readiness, so unavailable tool buttons do not update on a tile
edit. A subscriber failure is isolated from other listeners. Committed observer
failures are reported as committed edits with a view-update error, not retried.

`src/renderer/bindDocument.ts` converts model events through
`src/editor/invalidation.ts` and delivers them imperatively to the canvas.
Transactions, undo and redo use the same path. The bridge preserves exact changed
horizontal spans, separates registry/annotation IDs, and distinguishes layer
names from composition changes. Unsubscription belongs to renderer teardown.

**Rendering:** TW-007 now consumes this seam through the [visible tile renderer](tile-renderer.md).
It renders sparse chunk textures in document layer order and invalidates only affected
visible caches. The former origin marker has been removed. The active layer's
visibility is a transient session store with a **Show active layer** checkbox;
hiding releases its render cache without changing document content or history.
TW-013 completes [layer management](layers.md), including safe removal, last-layer
protection, stack controls, and the visible-layer editing-target policy.

## Controls and focus

The responsive layout contains a tools/color sidebar, flexing canvas workspace,
layer/annotation sidebar, header and two compact status lines. Sidebars scroll
independently at the existing 640 × 480 minimum window size. Height follows the content viewport, including the 452-pixel
content area beneath the native title bar at minimum height. Active controls have
visible state and accessible names/pressed state. Disabled buttons have a native
disabled attribute, a reason in their accessible description and hover title, and
visible explanatory panel text. Undo/redo reasons follow history availability.

Inspect is the current tool and reports world tile coordinates. Layer selection,
layer creation/renaming/reordering/removal, color selection/hex validation, annotation filtering, undo/redo
and the zoom selector work. New maps retain the existing default of one `Layer 1`
in a 256 × 256 map. Named metadata lists use a string `name` if present, otherwise
the stable ID; the shell does not invent registry/annotation schemas.

TW-009 adds [tile/chunk grids and Inspect rectangle measurement](grid-and-scale.md).
The transient rectangle store updates its readout and renderer overlay, without
document/history notifications. Future selection tools can use the same validated
rectangle display seam.

Drawing, selection, named area editing and local saving
are explicitly unavailable until their existing tickets. Save never acknowledges
a checkpoint without native I/O. TW-014 adds [validated hex/RGB color selection](color-selection.md)
with opaque sRGB `#rrggbbff` state, synchronized picker/fields, and explicit raw
paint versus named-match feedback. It is a tool preference, not a conversion of
persisted raw/registered paint. TW-016 adds [named registry controls](registry-decisions.md#tw-016-implementation),
explicit adoption, safe removal, and registered paint selection. Registry records
use validated names and opaque colors at this feature boundary.

`src/editor/focus.ts` classifies the actual event target as canvas, panel, text or
outside. Inputs, textarea, selects, contenteditable descendants and textbox roles
retain native keyboard handling. `routeKey` ignores those targets, composition,
already-handled events and Alt combinations. Canvas/panel Cmd/Ctrl+Z and Shift+Z
share `perform` with toolbar undo/redo. In the shipping workspace, TW-038
`ApplicationActions` owns file/history/clipboard shortcuts and native menus;
`routeKey` retains canvas tools/navigation and the standalone test-shell fallback.
Canvas `I` selects Inspect; TW-008 adds [navigation controls](navigation.md). Clicking/Tabbing into the canvas
sets focus ownership; window blur marks it inactive. The readout distinguishes
text editing, panel controls and canvas keyboard input without stealing focus.

Errors from model commands, color input and renderer startup use the shared
feedback store (`role=alert`). Renderer errors additionally retain technical
details, recovery instructions and Retry canvas. Successful retry clears the
canvas failure feedback. No test fixture or debugging global ships in production.

## Surface size and coordinates

`src/editor/viewport.ts` uses CSS pixels exclusively: 24 CSS pixels per tile at
100%, with a 24-pixel workspace inset and a fixed world origin. TW-008 now supplies
[continuous anchored zoom, pan and fit](navigation.md). Resizing preserves the
camera. Pointer conversion subtracts the current host rectangle and uses signed
half-open tile edges; the renderer alone owns device pixels. The session tracks
canvas CSS size and exposes a shared tool gate for overview/out-of-bounds picking.

Pixi owns device-pixel scaling. ResizeObserver updates CSS width/height; its backing
buffer is CSS size multiplied by current DPR with `autoDensity`. A resolution
media-query listener observes density-only monitor changes and re-arms after each
change. Neither DPR nor window size enters the tile-coordinate transform.
Renderer disposal removes the observer, density listener, viewport/document
subscriptions, GPU resources and canvas, including canceled asynchronous creation.

## Validation

Run `npm run build`, `npm test`, `npm run format:check`, then
`npm run build:desktop`. Native checks are recorded in the WRK ticket; browser
checks complement the WKWebView checks rather than replacing them.

- `tests/domain/editor.test.ts`: targeted snapshot identities/notification counts,
  exact spans including undo/redo, metadata routing, removed active layer fallback,
  transient isolation, text/IME guards, command and observer errors, disposal and
  CSS/world conversion.
- `tests/editor.spec.ts`: visible/disabled state, native text undo versus map undo,
  color errors, 1200 × 800 / 900 × 620 / 640 × 480 at DPR 1 and 2, zoom conversion,
  same-size density-change handling and canvas identity.
- `tests/editor-harness.tsx`: test-only two-layer session, exact canvas invalidation
  capture and React Profiler probes using the real panel components. A two-cell
  edit must produce zero updates in tools, colors, layers, annotations and view
  controls. A layer rename must update only the layer probe.
- `tests/renderer.spec.ts`: existing Strict Mode, resize, cancellation, teardown,
  unavailable-WebGL and retry regressions. The caption has its own accessible
  name, independent of shared action feedback.

CDP changes devicePixelRatio/query matches without emitting a resolution-change
event; the density-only test supplies that event explicitly. It is a simulated
notification test, not evidence of moving the native window between monitors.
The shell is not a target-scale rendering/performance measurement, and historical
fixture/model/history baselines have not been regenerated.

## Document lifecycle integration (TW-037)

`main.tsx` also owns `ProjectFiles`, `DocumentLifecycle`, and the native close-event
subscription, disposing them on pagehide/HMR. `Workspace` routes New, Open and
explicit saves through the coordinator, with one Save/Discard/Cancel modal shared
with native close/Quit. `ApplicationActions` and its native menu binding route New/Open/Save/Save As
through that same coordinator even from text inputs; editor modals isolate
shortcuts. Native Edit and map shortcuts share session actions while text fields
retain AppKit editing. See [File/Edit menus](project-format.md#fileedit-menus-and-shortcuts-tw-038). The
header derives the path from workspace state and dirty status from the current
history checkpoint. See [the lifecycle contract](project-format.md#document-lifecycle-tw-037)
for asynchronous saves, failure preservation, session reset and validation.
