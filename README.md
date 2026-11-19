# Tilewright

Project requirements are in [INTENT.md](INTENT.md). Tickets are managed with `wrk`.

For a clean macOS checkout, prerequisites, development commands, tests, and local
packaged builds, see [desktop development](docs/desktop-development.md).

```sh
nvm install
nvm use
npm ci
npm run dev
```

Implementation choices for coordinates, canvas growth, and component ownership
are in [the foundation decisions](docs/foundation-decisions.md).

New Map dimensions, validation, and undoable growth controls are documented in
[map creation and growth](docs/canvas-creation.md).

Layer controls, safe removal, visibility, and editing-target policy are documented
in [layer management](docs/layers.md).

Arbitrary hex/RGB colors, named-color matches, and the distinct empty-cell state
are documented in [color selection](docs/color-selection.md).

Stable named-color identity, explicit raw-tile adoption, collision rejection, and
safe removal, controls, and command APIs are documented in
[registry decisions and implementation](docs/registry-decisions.md).
Cross-layer recoloring, hidden/offscreen cache refresh, and populated-map
measurements are covered by [recolor integration](docs/registry-decisions.md#tw-017-recolor-integration).

The pure TypeScript map API, storage choices, and change-notification contract are
documented in [the sparse map document](docs/map-document.md).

Atomic commands, undo/redo limits, and explicit-save/recovery checkpoints are
documented in [command history](docs/command-history.md).

The editor session, targeted subscriptions, keyboard routing, and workspace controls
are documented in [the editor shell](docs/editor-shell.md).

Visible sparse WebGL tiles, color lookup, composition, and cache lifetime are
documented in [the tile renderer](docs/tile-renderer.md).

Distant composite images, incremental rebuilds and bounded cache lifetime are
documented in [overview rendering](docs/overview-rendering.md).

Camera math, mouse/trackpad/keyboard controls and overview editing availability
are documented in [map navigation](docs/navigation.md).

Shared pointer capture, transient previews, clipping and gesture history are documented
in [drawing gestures](docs/drawing-gestures.md). The [adjustable pencil](docs/drawing-gestures.md#adjustable-pencil-tw-019)
paints square footprints with raw or registered colors.
The [eraser and eyedropper](docs/drawing-gestures.md#eraser-and-eyedropper-tw-020)
clear active-layer content and sample visible tiles while preserving named-color identity.
[Lines and rectangles](docs/drawing-gestures.md#lines-and-rectangles-tw-021)
preview and commit precise one-tile lines and filled or outlined footprints.
[Four-way flood fill](docs/drawing-gestures.md#flood-fill-tw-022) fills active-layer
regions with progress, cancellation and one undo step.

The contract for rectangular selections, overlap-safe movement, clipboard layer
mapping, transforms and fixed-boundary rejection is in
[selection decisions](docs/selection-decisions.md). [Rectangle selections](docs/selection-decisions.md#rectangle-selection-implementation-tw-024)
support exact bounds, occupied counts and explicit layer inclusion. [Selection
movement](docs/selection-decisions.md#selection-movement-implementation-tw-025)
adds snapped composite drag previews and whole-tile arrow nudges with atomic undo.
[Clipboard placement](docs/selection-decisions.md#clipboard-implementation-tw-026)
adds session-local cut/copy/paste, composited previews and repeated placement.
[Quarter-turns and flips](docs/selection-decisions.md#transform-implementation-tw-027)
add composable live/paste previews with arrow positioning and Apply/Cancel.
[Composed workflow verification](docs/selection-decisions.md#composed-workflow-verification-tw-028)
covers fixed-seed full undo/redo, both house-move scopes and large-selection profiling.

[Named areas](docs/named-area-decisions.md#authoring-implementation-tw-030) support
independent descriptions, three author-selected tiers, numeric or drawn rectangle
bounds, selected/draft overlays, and explicit Apply/Cancel/Delete with undo/redo.
[Zoom-dependent labels](docs/named-area-decisions.md#label-rendering-implementation-tw-031)
show one tier at a time, with deterministic overlap suppression, readable Pixi text,
and a selected-area exception. Labels stay fixed during tile transformations.
[Area browsing and focus](docs/named-area-decisions.md#browsing-and-scale-inspection-tw-032)
reveal distant areas from the searchable panel and show exact tile dimensions and
bounds at every zoom, independently of tile selection.

Tile/chunk grids, scale readouts, and Inspect rectangle measurement are documented
in [grids and scale](docs/grid-and-scale.md).

The [versioned editable-project format](docs/project-format.md) specifies sparse
ordered layers, stable paint identity, complete named areas, persisted preferences,
validation and compatibility policy, with an annotated example. The
[snapshot and encoder](docs/project-format.md#snapshot-and-encoder-implementation-tw-034)
capture one committed revision and emit deterministic UTF-8 bytes, including
hidden content and persisted layer preferences. The
[decoder and safe load boundary](docs/project-format.md#decoder-and-safe-load-implementation-tw-035)
validate complete projects before replacing the workspace, preserving the active
session on failure. [Native project files](docs/project-format.md#native-file-workflow-tw-036)
connect Open, Save and Save As to macOS dialogs and atomic local writes, with
Cmd+O, Cmd+S and Cmd+Shift+S. [Document lifecycle](docs/project-format.md#document-lifecycle-tw-037)
protects New/Open/window close/Quit with Save, Discard and Cancel, including edits
during saves and fresh session/cache installation. [File/Edit menus](docs/project-format.md#fileedit-menus-and-shortcuts-tw-038)
share those actions, with focus-aware native text editing and Cmd+N/O/S/Z/X/C/V.
The [recovery policy](docs/recovery-policy.md) defines separate local snapshots,
cadence, identity, bounded retention, save/discard ordering and restoration as an
unsaved copy. [Recovery writing](docs/recovery-policy.md#writer-implementation-tw-040) now preserves
committed revisions with atomic local generations, bounded retention and separate
feedback. [Startup recovery review](docs/recovery-policy.md#discovery-and-restoration-implementation-tw-041)
offers validated checkpoints, safe restoration as unsaved copies and selected
recovery discard while preserving explicit project files.

The [whole-map agent format](docs/agent-export-format.md) defines a separate public
JSON schema with resolved color meanings, complete ordered layers, raw-color
policy and independent named areas. The
[agent snapshot and encoder](docs/agent-export-format.md#snapshot-and-encoder-implementation-tw-044)
now capture every committed layer and area and emit deterministic UTF-8 bytes,
independently of viewport, selection and visibility. Native export actions and
reliable file writes follow in TW-045.

For domain tests, deterministic populated maps, performance measurement, and
provisional budgets, see [testing and performance](docs/performance.md).

See [the ticket runner guide](docs/ticket-runner.md) for running the queue,
monitoring progress, and restarting interrupted work.
