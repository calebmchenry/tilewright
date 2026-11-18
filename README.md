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

The pure TypeScript map API, storage choices, and change-notification contract are
documented in [the sparse map document](docs/map-document.md).

Atomic commands, undo/redo limits, and explicit-save/recovery checkpoints are
documented in [command history](docs/command-history.md).

The editor session, targeted subscriptions, keyboard routing, and workspace controls
are documented in [the editor shell](docs/editor-shell.md).

Visible sparse WebGL tiles, color lookup, composition, and cache lifetime are
documented in [the tile renderer](docs/tile-renderer.md).

Camera math, mouse/trackpad/keyboard controls and overview editing availability
are documented in [map navigation](docs/navigation.md).

For domain tests, deterministic populated maps, performance measurement, and
provisional budgets, see [testing and performance](docs/performance.md).

See [the ticket runner guide](docs/ticket-runner.md) for running the queue,
monitoring progress, and restarting interrupted work.
