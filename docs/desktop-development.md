# Tilewright desktop development

Implementation record for TW-002. These are bootstrap choices, not additional
product requirements. [INTENT.md](../INTENT.md) and the
[foundation decisions](foundation-decisions.md) define scope and ownership.

## Clean checkout on macOS

1. Install Xcode or its Command Line Tools (`xcode-select --install`). If using
   full Xcode, launch it once to finish setup and accept its license. Check
   `xcode-select -p`. Tauri uses the system WebKit; no separate webview install is
   needed. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
2. Install Node using your preferred version manager. With nvm installed, run
   `nvm install` and `nvm use` in the repository. `.nvmrc` pins Node 24.22.3;
   `.npmrc` rejects unsupported Node versions and saves exact dependency versions.
3. Install [rustup](https://rustup.rs/). `rust-toolchain.toml` pins Rust 1.100.0
   with rustfmt and Clippy. Run `rustup show` in the checkout to install/select
   that toolchain. This is a repository pin, not a global toolchain change.
4. From the repository root:

   ```sh
   npm ci
   cargo fetch --locked --manifest-path src-tauri/Cargo.toml
   npm run dev
   ```

Dependency installation needs a network connection. Check in both
`package-lock.json` and `src-tauri/Cargo.lock`; use `npm ci` and Cargo's `--locked`
flag when reproducing builds. Direct npm and Cargo dependencies use exact
versions. There is no configured repository commit convention or automatic
commit step.

The development command starts Vite on `127.0.0.1:1420` and opens a macOS window
titled **Tilewright**. That port must be available; Vite deliberately fails rather
than silently choosing a different port. Stop the command with Ctrl-C.

## Commands

| Command                                                                     | Purpose                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm ci`                                                                    | Install exactly the locked frontend/tool dependencies              |
| `npm run dev`                                                               | Run the Tauri desktop app with Vite and hot reload                 |
| `npm run dev:frontend`                                                      | Run Vite for frontend debugging and automated tests                |
| `npm run typecheck`                                                         | Strict TypeScript check, including test code                       |
| `npm run build`                                                             | Type-check and build frontend assets into `dist/`                  |
| `npm run build:desktop`                                                     | Build a release macOS `.app`, using the Cargo lockfile             |
| `npx playwright install chromium`                                           | Install the browser used by lifecycle tests, once                  |
| `npm test`                                                                  | Run TypeScript domain tests, then real-WebGL lifecycle smoke tests |
| `npm run test:domain`                                                       | Run model/command/codec tests in Node, without a DOM or server     |
| `npm run test:ui`                                                           | Run only the Chromium WebGL lifecycle/failure tests                |
| `npm run perf:baseline`                                                     | Generate both populated fixtures twice and record harness metrics  |
| `npm run format:check`                                                      | Check app/test formatting and Rust formatting                      |
| `npm run format`                                                            | Format app/test code and Rust code                                 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml`                  | Compile/test the native shell (currently zero Rust unit tests)     |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings` | Lint the native shell                                              |

The [editor shell](editor-shell.md) now integrates the document/history controller,
targeted panels, focus routing, and Retina surface. The [tile renderer](tile-renderer.md) draws visible sparse tiles in layer order.
A fresh document is empty; its canvas shows the map background, boundary and
[tile/chunk grid](grid-and-scale.md).

The frontend-only command and browser tests are development tooling, not a
standalone browser distribution. [Testing and performance](performance.md)
documents the TW-003 fixtures, baseline, and provisional budgets. The bootstrap
preview does not validate target map scale.

## Packaged app

```sh
npm run build:desktop
open src-tauri/target/release/bundle/macos/Tilewright.app
```

`frontendDist` points to `../dist`: Tauri embeds the production HTML, JavaScript,
CSS, and locally bundled dependencies. Only development uses `devUrl`. There are
no CDN assets, remote fonts, runtime servers, or sidecar processes. Stop Vite
before validating the release; the app must still display the canvas. After a
build, launch does not need Node, Rust, the checkout, or a network connection.

This command produces a local build for the current Mac's architecture, with
macOS 12.0 as the configured minimum. The exact minimum OS and cross-architecture
support still need release testing. Distribution signing, notarization, and DMG
delivery belong to the later release ticket; a locally generated `.app` is enough
for this baseline. Do not claim notarized distribution from this command.

## Renderer and native decisions

- React owns the shell and status/retry controls (`src/App.tsx`,
  `src/MapCanvas.tsx`). Map data and future editing algorithms remain outside
  React. Rust currently does nothing beyond starting Tauri.
- `src/renderer/createRenderer.ts` explicitly constructs Pixi's `WebGLRenderer`
  with a WebGL 2 context. WebGPU and Canvas2D are not fallback renderers. WebGL 2
  is the chosen bootstrap path for the macOS system webview. Initialization
  failures show recovery steps, technical details, and a Retry canvas button.
- The Pixi `unsafe-eval` compatibility module installs implementations that
  **avoid** runtime code generation. Despite its name, it lets the production
  CSP omit `unsafe-eval`. The pinned implementation is in
  `node_modules/pixi.js/lib/unsafe-eval/init.mjs` after installation.
- The surface uses disposable containers, background graphics and visible chunk
  textures, without an application ticker. Rendering occurs on view changes and
  relevant document invalidations. Pixi's internal maintenance scheduler is
  released by renderer destruction. Drawing tools remain later tickets.
- `mountRenderer.ts` returns an idempotent disposer immediately. If initialization
  completes after disposal, it destroys the result before attaching a canvas.
  Mounted cleanup disconnects the ResizeObserver and destroys scene/GPU resources
  and Pixi listeners. React Strict Mode remains enabled. `main.tsx` unmounts the
  React root on `pagehide` and Vite module disposal.
- The native identifier is `app.tilewright.desktop`; the window label is `main`.
  `src-tauri/capabilities/main.json` applies only to the local macOS main window
  and grants zero commands. No filesystem/dialog/shell plugin is installed.
  TW-036 should add explicit file-dialog and selected-path permissions or narrow
  atomic file commands there; it must not start with unrestricted home access.
  See [Tauri capabilities](https://v2.tauri.app/security/capabilities/).
- Production CSP restricts scripts/assets to the bundled origin and connections
  to native IPC. The development CSP additionally permits Vite's local HMR and
  React refresh script. Remote capabilities are not configured.
- The last window's close button exits this minimal app. Reopen by launching the
  `.app` again (or rerunning `npm run dev`). A persistent macOS document/window
  lifecycle is deferred to its document workflow ticket.

## Manual desktop smoke check

1. Run `npm run dev`. Verify the title, workspace boundary, panels, and **Canvas ready** status.
   Resize the window; the world origin should stay fixed with exactly one canvas. Verify text
   input shows **Text editing** and clicking the workspace shows **Canvas keyboard**.
2. Close the window and rerun the command. Verify the same successful startup.
3. Run `npm run build:desktop`, stop development processes, and open the `.app`.
   Verify the same shell/status. Close and reopen it. Repeat from a copied `.app`
   outside the checkout to verify that assets are embedded.
4. Run `npm test` for the measurable teardown cases: Strict Mode, pagehide,
   repeated mount/unmount, cancellation before async initialization settles,
   unavailable WebGL, and successful retry. Browser automation complements, but
   does not substitute for, the native WKWebView launch above.

Record actual machine, commands, outcomes, and limitations in the WRK ticket.
Use the [smoke record and measurement protocol](performance.md#macos-smoke-workflow)
to distinguish automated Chromium checks, native WKWebView observations, and
future populated-map measurements. Unimplemented operations are **not measured**.
