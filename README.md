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

Tile/chunk grids, scale readouts, and Inspect rectangle measurement are documented
in [grids and scale](docs/grid-and-scale.md).

For domain tests, deterministic populated maps, performance measurement, and
provisional budgets, see [testing and performance](docs/performance.md).

See [the ticket runner guide](docs/ticket-runner.md) for running the queue,
monitoring progress, and restarting interrupted work.
