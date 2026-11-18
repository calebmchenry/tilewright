---
id: wrk-ffd4eb5c
title: 'TW-002: Bootstrap the macOS Tauri, React, TypeScript, Vite, and PixiJS application'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-a1d21a8b
priority: high
labels:
  - v1
  - foundation
  - implementation
fields:
  sequence: 2
  source: INTENT.md
---
## Outcome

Create a reproducible desktop development and packaged-app baseline.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Chosen technology.

**Execution order:** 02 of 54. Phase: foundation.

**Prerequisite:** [wrk-a1d21a8b](wrk-a1d21a8b.md) — TW-001: Define map coordinates, canvas rules, and implementation boundaries.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Initialize the chosen stack with explicit package versions and lockfiles, a minimal editor window, and a PixiJS WebGL canvas.
- Configure Tauri application identity and narrowly scoped native capabilities for future file integration; keep editor logic in TypeScript.
- Provide install, development, type-check, frontend-build, and desktop-build commands with macOS prerequisites.

## Acceptance criteria

- [x] The window is named Tilewrite and starts from a documented clean checkout workflow.
- [x] Production assets are bundled in the Tauri app; normal startup does not depend on Vite or a separate server process.
- [x] The renderer explicitly uses the intended WebGL path and reports an actionable initialization failure.
- [x] React and PixiJS mount/unmount cleanly, without duplicated canvases, listeners, or render loops.

## Validation

- Run type checking and a frontend production build, then launch the Tauri development app and a local packaged build.
- Close and reopen the window and verify clean renderer teardown.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-003: Establish domain tests, representative fixtures, and performance budgets](wrk-d831f7e0.md).

## TW-002 execution record — 2026-11-18

Completed in this Codex session using sprint-execute Strategy A, with WRK state
instead of a sprint ledger. Read AGENTS.md, README.md, INTENT.md,
docs/foundation-decisions.md, docs/ticket-runner.md, and scripts/run-tickets.sh.
Prerequisite wrk-a1d21a8b was done before implementation. Fetched the skill's
weather report successfully; no worker or separate CLI execution was used.
No commits were requested or required; the repository began without a commit,
with its existing project documents and tickets untracked.

### Completed phase checklist

- [x] Reproducible stack and native shell: exact versions, npm/Cargo lockfiles,
  project toolchain pins, application identity, local-only capabilities, and
  embedded frontend configuration. Frontend build/typecheck and Cargo check/test
  succeeded before the renderer validation gate.
- [x] Pixi renderer and React lifecycle: explicit WebGL 2, actionable failure and
  retry, detached asynchronous initialization, idempotent disposal, Strict Mode,
  resize handling, and focused lifecycle smoke tests. Build, tests, formatting,
  and native Clippy passed.
- [x] macOS development/release launch and reopen checks, clean dependency install,
  final test suite, documented workflow and decisions, and acceptance review.

### Implementation and decision locations

- `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `tsconfig.json`,
  `vite.config.ts`, `index.html`: React 19.3.1, TypeScript 5.9.3, Vite 8.3.8,
  PixiJS 8.23.0, Tauri CLI 2.12.6, and exact tool dependencies. Node is pinned to
  24.22.3. The installed npm bundled with this Node version is 11.19.1.
- `rust-toolchain.toml`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/build.rs`, `src-tauri/src/main.rs`: Rust 1.100.0, Tauri 2.12.7,
  tauri-build 2.7.6. Rust only starts the desktop shell.
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/main.json`,
  `src-tauri/icons/`: Tilewrite window/product, `app.tilewrite.desktop` identity,
  `main` window, local macOS-only capability with no native commands, production
  CSP, embedded `dist` assets, and a reproducible SVG icon source.
- `src/App.tsx`, `src/MapCanvas.tsx`, `src/main.tsx`, `src/styles.css`: minimal
  editor shell, status and failure/retry UI, Strict Mode, pagehide/HMR cleanup.
- `src/renderer/createRenderer.ts`, `src/renderer/mountRenderer.ts`: explicit
  WebGLRenderer with a WebGL 2 context; CSP-safe Pixi implementation; disposable
  preview, observer, GPU context and listeners; no persistent editing state.
- `tests/renderer.spec.ts`, `tests/renderer-harness.tsx`, `tests/renderer.html`,
  `playwright.config.ts`: three real-WebGL browser lifecycle/recovery tests.
- [Desktop development](../docs/desktop-development.md) and [README](../README.md):
  clean checkout prerequisites, install/development/typecheck/build/test commands,
  bundle location, ownership/security decisions, and native smoke procedure.
- `.gitignore`: dependency/build/generated schema/test output exclusions.

### Acceptance evidence

- [x] **Name and reproducible workflow:** native development and release windows
  both reported title `Tilewrite`. The README links the complete macOS setup.
  Exact package versions and both lockfiles are present; `npm ci` succeeded.
- [x] **Bundled production startup:** `frontendDist` is `../dist`; the release app
  loaded `tauri://localhost`, not the development URL. A copy of the `.app` under
  `/tmp` launched and reopened with port 1420 confirmed closed. No runtime server,
  sidecar, CDN assets, or network-native plugin is included. Production CSP
  permits only local assets and native IPC connections.
- [x] **WebGL and actionable failure:** the adapter constructs WebGLRenderer
  directly from WebGL 2. Tests assert exactly one canvas and its actual reported
  WebGL version `2`. Denying WebGL produces an alert with retry/restart/macOS
  recovery instructions and technical details. Restoring WebGL and clicking
  Retry canvas succeeds, then teardown releases resources.
- [x] **Clean lifecycle:** tests exercise React Strict Mode, resize, pagehide,
  five mount/unmount cycles, five immediate cancellations while init is pending,
  duplicate disposal, and failure/retry. Each disposal reaches zero attached
  canvases, zero live renderer-owned GPU contexts, zero tracked Pixi/global/canvas
  listeners, zero active ResizeObservers, and zero pending animation callbacks.
  Native development and release windows were closed and reopened successfully;
  closing the final window exited the application process.

### Actual validation evidence

Machine: Apple Silicon / arm64, macOS 15.8.1 (24H32), Xcode selected at
`/Applications/Xcode-26.3.app/Contents/Developer`. Node 24.22.3 / npm 11.19.1;
Rust/Cargo 1.100.0. The old machine defaults were Node 22.11.0 and Rust 1.64.0;
installed the pinned versions without changing global defaults.

Successful commands and observed results on 2026-11-18:

1. `npm ci`: installed 42 packages, audited 43, **0 vulnerabilities**, exit 0.
   Reproducible final install was followed by the entire frontend check sequence.
2. `npm run typecheck`: exit 0, no TypeScript errors.
3. `npm run build`: exit 0, **771 modules transformed**. Final main asset
   `index-DVsIN_X8.js` was 618.62 kB (184.13 kB gzip), matching the release build's
   asset hash. HTML, CSS, and all JS chunks were emitted in `dist/`.
4. `npm test`: **3 passed (5.1s)** in the final run, with Chromium
   159.0.8154.6 (Playwright 1.65.1). The logged WebGL initialization error is
   deliberately induced by the unavailable-WebGL test; its recovery passes.
5. `npm run format:check`: exit 0; all matched files use Prettier style and
   `cargo fmt --check` passes.
6. `cargo check --locked --manifest-path src-tauri/Cargo.toml`: exit 0.
7. `cargo test --locked --manifest-path src-tauri/Cargo.toml`: exit 0;
   **0 Rust tests**, as expected for the minimal shell. Repeated in the final gate.
8. `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`:
   exit 0, repeated in the final gate.
9. `npm run dev`: Tauri compiled and ran `target/debug/tilewrite`; Vite listened
   on `127.0.0.1:1420`. Native UI inspection showed a single preview and
   **Canvas ready**, and the screenshot showed the centered 12 by 8 tile probe.
   The UI tool cannot select an unbundled executable, so native inspection used
   an unchanged copy of that debug executable in a temporary `.app` wrapper at
   `/tmp/tilewrite-wrk-ffd4eb5c-dev/Tilewrite Dev.app`, backed by the same Vite
   process. Closed with Cmd+W (tool reported App quit), reopened, and observed
   the same title, development URL, preview, and status. Then closed it and
   stopped the development command.
10. `npm run build:desktop`: exit 0; optimized build finished in 50.11s and
    generated `src-tauri/target/release/bundle/macos/Tilewrite.app` (**10.57 MiB**).
    Copied it with `ditto` to `/tmp/tilewrite-wrk-ffd4eb5c-release/Tilewrite.app`.
    A socket check printed `PASS: Vite port 1420 is closed`. Opened the copied
    app through the native UI tool: title **Tilewrite**, URL **tauri://localhost**,
    one Map workspace preview, and **Canvas ready**. Closed and reopened it,
    enlarged the native window, and visually verified a centered tile preview
    and ready status. Closed the app after validation; no test app process
    remained. This is actual WKWebView validation, not only a browser preview.
11. Inline Python audit: local README/desktop guide links resolve; direct npm
    versions are exact; identity, embedded-assets configuration, local-only
    capabilities and production CSP match the design. All untracked text files
    have final newlines and no trailing whitespace. `git diff --check` passes.
12. `wrk validate`: exit 0, `Valid project: 56 tickets`.

Final SHA-256 evidence:

- `package-lock.json`:
  `b1f23014de73e3534b8b535b930da77c2575910f0c38a0bd7a633c4479b7ce7e`
- `src-tauri/Cargo.lock`:
  `94ce3e932b8139f165b43a6b0638e7c045f7035ac644e16b532ba1aa76a675dc`
- Packaged `Contents/MacOS/tilewrite`:
  `40d6788305c73a60448843509ca7238951c754329326cea2671e7229407156a4`

### Resolved issues and limits

- Fixed initial TypeScript context narrowing and test wrapper `this` annotations.
  Initial teardown test failures were traced to Pixi's single shared shader
  capability probe and Playwright's own injected listeners. Tests now measure
  renderer-owned contexts and avoid the locator evaluation that injected driver
  listeners. No renderer-owned context/listener/observer/frame leak remains in
  the repeated lifecycle test.
- The build emits Vite's advisory for a JS chunk above 500 kB. This bootstrap is
  bundled locally; performance budgets and populated map validation remain with
  their existing tickets. npm also reports the optional fsevents install-script
  policy advisory; the documented commands and tests work without approving it.
- No physical network interface was disabled. The release was verified without
  a development server, outside the checkout, with a local-only production CSP.
  Minimum-macOS, Intel/universal, distribution signing/notarization, and final
  offline release acceptance remain future release work.
- WebGL 2, the application identifier, preview scene, and zero-permission initial
  capability are documented implementation choices. File integration belongs to
  TW-036. Domain fixtures/performance budgets remain TW-003. No other ticket or
  INTENT.md was changed, and no application editing functionality was added.

All four acceptance criteria are met. Original ticket prose is preserved, with
acceptance checkboxes checked and this execution record appended. No blockers.
