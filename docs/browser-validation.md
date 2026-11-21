# Production browser release acceptance (TW-061)

This record qualifies local production assets, not a live GitHub Pages site or a
hosted Actions run. TW-062 records the selected target and publication. The
[browser guide](browser-guide.md) explains the user workflow; the
[Pages guide](github-pages.md) explains repeatable builds and the deployment gate.

## Repeat the release checks

Use Node 24.22.3 (`.nvmrc`), the npm lockfile, Python 3.9+ for the independent
consumer, and the pinned Playwright browsers:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run format:check:web
npm test
TILEWRIGHT_WEB_BASE=/pages-smoke/ npm run test:web
TILEWRIGHT_WEB_BASE=/ npm run test:web
```

Linux browser installation uses `--with-deps`. For an actual Pages candidate,
repeat `test:web` with that site's exact base instead of the root example. The
workflow requires the full domain/development UI suite and all three production
engine projects at both a repository prefix and the chosen deployment base before
upload/deploy. A focused engine run is diagnostic, not release acceptance.

The production preview serves only `dist-web/` at its explicit mount; missing,
out-of-prefix, source and harness URLs return 404. No Vite dev server, native IPC
mock, editor test probe, remote project service or backend is used by web
acceptance. File imports use the browser input, drop tests dispatch real File /
DataTransfer events, and downloads are read from actual browser-managed files.
Downloaded populated projects are saved to test output and selected again by
path. Drop automation does not claim an operating-system drag gesture.

Playwright 1.64.1 is deliberately pinned. Version 1.65.1 reproduced a spurious
Firefox file-input cancel before selection, matching
[the upstream regression](https://github.com/microsoft/playwright/issues/43994).
The pin keeps application cancellation behavior and real chooser tests intact.
Upgrade only with renewed three-engine results; do not skip Firefox or suppress
its application cancel listener to make tests pass.

## Coverage and oracles

| Production tests               | Required evidence                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/web/production.spec.ts` | Every emitted asset's HTTP bytes/MIME, lazy/worker environment module resolution, subpath reload, WebGL 2 startup, canonical import/download, edit/undo and export; no native startup requests.                                                                                                                  |
| `tests/web/session.spec.ts`    | Create a 128 × 128 map; raw/named terrain; layers; pencil, eraser, eyedropper, fill, line and rectangle modes; three complete area tiers; 8 × 8 chosen-layer move; copy, rotated/flipped paste and live flip; undo/redo; hidden-layer overview recolor; download/reopen, independent export and reload/recovery. |
| `tests/web/integrity.spec.ts`  | Full preservation on malformed/unsupported/duplicate-key input and canceled Open; successful drop; stale asynchronous File read; download-and-stay, explicit New and actual dismissed browser unload warning; both complete populated fixtures.                                                                  |
| `tests/web/recovery.spec.ts`   | Two real tabs and Web Locks protect active work; released work restores completely; quota/transaction/unavailable storage preserve prior bytes and allow editing/download/export/retry; corrupt newest generation rejects restoration while the full older fallback remains recoverable.                         |
| `tests/web/support.ts`         | Per-context script/console/network failure audit, local GET-only asset requests, no native chunks, actual browser/version evidence, shared file/download and independent consumer helpers.                                                                                                                       |

The editing oracle expands downloaded runs into independent per-layer cells.
Movement explicitly checks destination-hole preservation in source/destination
overlap. Rotation plus horizontal flip is checked against a coordinate transpose;
the live vertical flip has a separate cell oracle. Undo/redo compares complete
project documents. Area identity, descriptions and geometry stay independent.
Recolor preserves run identities and the same-colored raw patch. Downloads and
recovery compare complete bytes/fields, including hidden layer preferences.

Each 6,400 × 6,400 populated fixture includes four layers, five registry entries
and 1,089 areas. Both editable round trips are byte-exact. The separate golden
fixture inspector examines every emitted project and agent run. The independent
Python consumer reconstructs resolved-run hashes, layer order, colors/meanings,
bounds and all areas, compared with the source model rather than the exporter.
Visibility and close/overview zoom cannot filter the exported content.

The development suite adds broader controlled-clock/encoder races, cancellation,
capacity, database upgrade blocking/migration/future versions, semantic corruption
with a matching hash, transient gestures, interrupted publication and disposal,
plus drawing/selection/rendering and desktop-adapter regressions. Standard browser
APIs are instrumented only for deterministic failures; IndexedDB and Web Locks
are real in production recovery cases. Native UI tests substitute OS IPC and
are identified separately from actual Rust filesystem tests.

## Recorded environment and outcomes

Host: macOS 15.8.1 (24H32), arm64; Node 24.22.3; npm 11.19.1;
Python 3.13.3; Rust 1.100.0. Local acceptance date: 2026-11-20.

`TILEWRIGHT_WEB_BASE=/pages-smoke/ npm run test:web` passed all 39 tests in
9.0 minutes, without skips, retries or flaky results:

| Playwright 1.64.1 engine | Installed revision | Production subpath |
| ------------------------ | ------------------ | ------------------ |
| Chromium 156.0.8078.4    | 1248               | 13/13 pass         |
| Firefox 157.0            | 1555               | 13/13 pass         |
| WebKit 27.2              | 2370               | 13/13 pass         |

Playwright WebKit is an automation build, not the installed Safari application.
All 33 functional audit attachments contain zero script, console or network
errors and zero unexpected requests. The separate asset-probe tests deliberately
request missing URLs and import dormant chunks to verify their resolution.

`TILEWRIGHT_WEB_BASE=/ npm run test:web` also passed all 39 tests in 9.1 minutes
in the clean HEAD archive containing only this ticket's changes: 13/13 per engine,
no skips/retries/flaky results, and another 33 error-free functional audits.
Both fixture hashes and complete content checks match the subpath run. This
validates the root mount and checks independence from unrelated workspace edits.

| Fixture   | Occupied layer cells | Project bytes | Agent bytes | Areas |
| --------- | -------------------: | ------------: | ----------: | ----: |
| Frontier  |            6,620,700 |     2,340,642 |   2,306,718 | 1,089 |
| Heartland |           24,025,200 |     8,114,378 |   8,080,454 | 1,089 |

Complete file SHA-256 values match across all three engines and are retained in
the WRK record. Subpath workflow observations (Chromium / Firefox / WebKit) were
20.969 / 25.437 / 23.250 seconds for Frontier and 66.061 / 86.397 / 75.921 seconds
for Heartland. These include two imports, complete downloads, overview rendering,
agent export and independent assertions; they are not single-operation latency
measurements. Both decoded golden-fixture inspections and Python source-model
comparisons passed for both fixtures in every engine.

`npm test` passed 524 domain tests and all 198 development UI tests (11.3 minutes
for the UI run), including desktop project/lifecycle/recovery adapter coverage.
The workspace contained unrelated editor changes, which were preserved. A
separate clean HEAD archive with only TW-061 files passed its 523 baseline domain
tests; the production root run above separately checks ticket independence.

Native validation was `cargo test --locked --manifest-path src-tauri/Cargo.toml
-- --test-threads=1` (31/31, including actual filesystem publication/recovery
failure cases), `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --
-D warnings` (pass), and `npm run build:desktop` (pass, packaged 12.42 MiB
`Tilewright.app`). `npm run format:check` includes Rust formatting and passed;
`npm run format:check:web`, actionlint 1.7.12 and `git diff --check` also passed.
No interactive Tauri WKWebView walkthrough or native performance campaign was
performed for this ticket.

The actual Safari 27.0 (20625.1.29.18.28) smoke used the OS file picker against
`http://127.0.0.1:4173/pages-smoke/`. Observed: WebGL canvas ready, canonical
project import, all three layers/colors/areas, hidden active-layer protection,
show layer, area focus at 100%, pencil at tile (64,64), Cmd+Z, whole-map agent
download, Fit at 0.45%, committed layer rename, checkpoint-ready feedback, real
reload warning, and restore as an independent unsaved copy with that rename.
Close and overview rendering and readable labels were visually inspected.

Safari's actual 1,421-byte project download equals the canonical fixture byte for
byte (SHA-256 `2dbe0f45b7675b059544952b1f8589d73b948d82a95bad794c2290c1b6f13455`).
Its 1,261-byte agent file independently reconstructs all 16 occupied layer cells,
three layers and three areas, with the complete source-model summary matching.
The source project was unchanged. This is a real Safari smoke, not the full
fault-injection campaign or a native Tauri WKWebView session.

## Scope and limitations

Desktop Chromium, Firefox and Safari are the release targets. The versions and
host above are the measured compatibility baseline. Other OS/browser versions,
extensions, private-mode quotas and actual hosted Ubuntu Actions execution are
not certified by a macOS local run. Mobile/touch redesign is outside scope.
Downloads remain browser handoffs, and recovery is origin/profile-local with
clearing/eviction risks; see the user guide before relying on either.

Large-map import, encoding, recovery and rendering still have synchronous work
and whole-buffer memory costs. Single workflow durations include correctness
assertions and concurrent test activity; they are not p95 latency, cold/warm
benchmarks, peak memory or presentation-budget passes. The >500 kB bundle warning
remains. Populated overview inspection also shows dense region labels, some
clipped text in Firefox, and download feedback covering part of the lower map;
complete names/content remain intact in both file formats. These presentation
limitations stay with TW-049. TW-049/TW-050 retain performance refinement;
TW-049 through TW-054 remain unchanged and outside the Pages queue.
Functional/data-integrity failures block
acceptance regardless of these performance deferrals.

Reports and actual downloads are in `test-results-web/`, including the JSON run
summary and per-test engine/network/fixture evidence; the HTML report is
`playwright-report-web/`. Successful visual captures show the composed house at
close zoom and the locality label/recolored map at overview. Subsequent runs
replace these directories. The WRK ticket retains exact commands, counts,
fixture hashes, native checks, corrections and qualification boundaries.
