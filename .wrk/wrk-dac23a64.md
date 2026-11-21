---
id: wrk-dac23a64
title: 'TW-055: Separate browser and desktop platform services'
status: done
created_at: 2026-11-21T00:07:03Z
depends_on:
  - wrk-7eade235
priority: normal
labels:
  - github-pages
  - implementation
fields:
  sequence: 55
---
## Outcome

Provide one shared editor with explicit browser and Tauri platform services so
the web build boots without native IPC and the desktop workflow keeps working.

## Source and scope

Read src/main.tsx, src/native/*, src/editor/project-files.ts,
src/editor/agent-export.ts, src/editor/document-lifecycle.ts,
src/editor/recovery.ts, src/editor/recovery-discovery.ts, src/FileControls.tsx,
INTENT.md and docs/project-format.md. Native adapters currently report unavailable
outside Tauri, and main.tsx always constructs them.

## Work and acceptance criteria

- [x] Select platform services/capabilities in one composition boundary. Keep map,
  history, rendering and codec logic shared; do not fork the editor or port Rust.
- [x] Generalize path/handle assumptions so a browser display filename does not
  claim filesystem access or a durable save receipt.
- [x] Define distinct native-save, browser-download-request and local-recovery
  checkpoint semantics. Document how later tickets protect New/Open/close.
- [x] Browser startup, rendering and editing require no Tauri IPC; native close,
  menu and recovery bindings are gated. Keep unavailable features clearly
  unavailable until their implementation exists.
- [x] Desktop adapters retain their file associations, atomic-write acknowledgement
  and recovery contracts.
- [x] Update relevant product/development docs to recognize the additional browser
  delivery target and capture the platform contract for subsequent tickets.

## Validation

Run typechecking/build and relevant domain/UI regressions. Smoke the shipping
browser entry without Tauri mocks, and verify the native-adapter path with the
existing file/lifecycle tests. Record what was and was not checked natively.

## Delivery constraints

User decision, 2026-11-20: ship a browser version on GitHub Pages using the
working editor baseline. Keep this ticket labeled `github-pages`. Preserve the
existing desktop application and shared `.tilewright` format. Project content
stays local to the browser; no application backend, accounts, or cloud file
storage is required. Follow AGENTS.md and docs/ticket-runner.md.

The existing TW-049 through TW-054 backlog remains deferred and unchanged.
Do not add dependencies on those tickets. Performance budget overruns or missing
measurements alone do not block this work; record limitations and retain the
TW-049/TW-050 performance deferrals. Functional correctness and data integrity
are required. Record actual implementation locations and validation evidence
through `wrk update --body-file` before marking done.


## Implementation and validation record — 2026-11-20

Execution: sprint-execute Strategy A in this Codex session, using this WRK body
as the sprint document. Dependency wrk-7eade235 was done before starting. No
separate sprint ledger, worker agents, new tickets or deferred-backlog changes.

### Completed phases and implementation locations

1. Platform composition: src/platform/select.ts selects once; browser.ts provides
   explicitly unavailable file/export adapters; tauri.ts lazily loads the native
   services. services.ts declares availability and optional recovery/native
   bindings. application.ts constructs the same editor/controllers on either
   target. main.tsx owns the shared mount and idempotent teardown. Browser startup
   creates no recovery coordinator/discovery job or native menu/close binding.
   src/editor/application-bindings.ts owns shared DOM keyboard/focus/modal routing;
   src/native/application-menu.ts now owns only native menu IPC. App.tsx receives
   the platform choice rather than detecting Tauri independently.
2. Identity/checkpoints: src/editor/persistence.ts separates native-file paths,
   browser-file display names and native picker grants, and defines distinct
   native-save, browser-download-request and local-recovery evidence.
   workspace.ts installs immutable source metadata with validated content and
   keeps savedPath native-only. Browser-source loads remain dirty with no saved
   receipt. project-files.ts retains native handle association, atomic-write
   acknowledgement and exact captured-revision semantics, and tags lastSave as
   native-save. agent-export.ts and recovery.ts use source display names without
   creating native authority; recovery-discovery.ts documents native-only source
   rereads. FileControls.tsx accepts only native-save timestamps; App.tsx and
   styles.css show the browser preview's unavailable persistence capabilities.
3. Contract/docs/regressions: docs/platform-services.md describes services,
   evidence semantics, current limitations and TW-056/057/058/059 responsibilities
   for imports/downloads, deliberate New/Open continuation, beforeunload/BFCache,
   exports and IndexedDB recovery. Updated INTENT.md, README.md, and foundation,
   desktop-development, project-format, command-history and recovery-policy docs
   recognize both targets. No project schema, map/history/rendering implementation
   or Rust persistence code was forked/ported/changed by this ticket.

### Actual validation evidence

Host: macOS 15.8.1 arm64; Node 24.22.3; npm 11.19.1; Playwright 1.65.1;
Chromium 159.0.8154.6.

- npm run build: passed strict app/test/domain TypeScript checks and Vite output.
- npm test, final stable run: all 506 domain tests and all 163 Chromium UI tests
  passed. This includes the new platform-services.test.ts and browser-platform
  smoke, shared codec/full-content tests, and existing project file, lifecycle,
  menu, recovery and agent-export adapter regressions.
- Production browser smoke: built dist served by Vite preview on 127.0.0.1:4173;
  ran tests/browser-platform.spec.ts with a temporary Playwright config pointing
  to preview. One test passed without any Tauri globals, IPC mocks or editor test
  harness. Real WebGL drawing changed canvas pixels; undo restored them. Disabled
  Save gave feedback without a Saved timestamp; New/Cancel retained the editor.
  No native modules/IPC requests or page errors were observed. The screenshot
  was visually inspected, including the visible browser availability notice.
- npm run build:desktop: passed; produced the local release Tilewright.app with
  the shared production assets and lazy native service chunk (12.41 MiB).
- cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1:
  all 31 native tests passed, including actual atomic file/recovery writes,
  failure/interruption preservation and native close-request state.
- npm run format:check and npx prettier --check docs/platform-services.md passed.
  wrk validate passed (72 tickets). git diff --check and staged diff checks passed.

### Validation fixes, scope and limitations

The first full run had three stale overview assertions in navigation-scale.spec.ts
and usability.spec.ts: they still expected tools to be disabled, contrary to the
pre-existing working baseline. Updated only those regression expectations to
validate overview editing availability; no tool behavior was changed here.
The other first-run failure was a clipboard screenshot detached during concurrent
hot reload; both DPR paths passed in the final run with stable source files.
The first parallel Rust run had one recovery-store reopen lock-contention failure
(30/31 passed); the complete serial rerun passed all 31. No Rust production change
was needed for this ticket.

Native UI tests substitute OS IPC. This run built but did not interactively
launch the packaged WKWebView app or exercise real native dialogs/menus/close.
The production smoke used local root-path assets, not a GitHub Pages deployment
or repository subpath. Firefox, WebKit, Safari and live deployment qualification
remain later Pages tickets. Browser imports/downloads, agent export, recovery,
navigation warnings and BFCache restoration remain explicitly unavailable or
follow-up work as documented; a download checkpoint type is not a download
implementation. Browser filenames and recovery never claim durable native saves.
Vite still reports the existing >500 kB main chunk; presentation/memory/performance
refinement remains TW-049/TW-050, with no new dependencies on the deferred backlog.

Only this ticket's implementation, regression/doc updates and WRK record are
included in its commit. Pre-existing tracked/untracked work was preserved;
overlapping edits in INTENT.md, App.tsx and styles.css were staged by ticket-only
patches, leaving the earlier user changes unstaged.
