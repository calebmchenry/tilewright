# Tilewright testing and performance

Implementation decisions for TW-003, subordinate to [INTENT.md](../INTENT.md) and
the [foundation decisions](foundation-decisions.md). The numerical budgets below
are **provisional implementation decisions**, not newly confirmed requirements or
achieved results. They can be revised with recorded evidence. The application
now has an [editor shell](editor-shell.md) and [visible sparse tile renderer](tile-renderer.md). TW-004 adds the independent
[sparse map model](map-document.md); TW-005 adds [commands/history](command-history.md).
TW-008 adds [map navigation](navigation.md). Codecs, file integration,
export, and recovery remain to be built and integrated.

## Run the checks

Use the pinned Node and Rust toolchains and install dependencies as described in
[desktop development](desktop-development.md). From the repository root:

```sh
nvm use
npm ci
npx playwright install chromium
npm run build
npm test
npm run format:check
npm run perf:baseline
npm run perf:model
npm run perf:history
```

Installation may use the network; after installation these checks use local files
and a loopback-only test server. They need no cloud service, account, environment
secret, or developer-specific absolute path. `npm run test:domain` and
`npm run perf:baseline` / `npm run perf:model` do not start a server or browser. The browser install is
needed only once per pinned Playwright version. `npm test` fails if either suite
fails; it does not silently skip unavailable browsers.

- `npm run test:domain`: Node's built-in test runner, native TypeScript stripping,
  `node:assert/strict`, and `node:test`. Add flat files named
  `tests/domain/<subject>.test.ts` for models, commands, and codecs. Use explicit
  `.ts` import extensions and erasable TypeScript syntax. No extra runtime test
  framework or DOM shim is needed. Type stripping is not type checking: the build
  separately runs both TypeScript configurations. `tsconfig.domain.json` excludes
  DOM libraries and includes domain code, fixture helpers, and harness scripts.
- `src/domain/coordinates.ts` provides the small, executable coordinate contract
  used by model smoke tests. It does not implement storage, edits, or history.
  Tests exercise fixed bounds, invalid addresses, an 8 × 8 footprint crossing four
  chunks, and the negative-coordinate lattice after growth. Layered fixture tests
  expand a 20 × 20 window into independent Maps to verify black paint, empty cells,
  underlying content, and overlapping layers. Those Maps are a test oracle, not
  an implementation or performance measurement of the future document.
- `npm run test:ui`: the `tests/*.spec.ts` Playwright tests run in
  Chromium against local Vite. They cover Strict Mode, resize, disposal, repeated
  mount/cancel cycles, unavailable WebGL, and retry. Expected error logging in the
  unavailable-WebGL case is intentional. Playwright explicitly excludes domain
  `.test.ts` files. Native WKWebView validation uses the manual workflow below.
- `npm run perf:baseline`: generates each fixture twice in one Node process and
  compares the entire measured content summary and SHA-256 against each other and
  the checked-in golden data. Any mismatch exits nonzero. Default output is
  `artifacts/performance/fixture-baseline.json` (ignored by Git). To retain a run:
  `npm run perf:baseline -- --output docs/performance-baseline.json`. Do not
  overwrite historical evidence unless intentionally recording a new baseline.
- `npm run perf:model`: loads the empty target-size map and both complete populated
  fixtures into the real sparse document in two fresh processes each. It measures
  initialization and retained memory, then reads all layers back and checks golden
  hashes/counts. Default output is `artifacts/performance/model-baseline.json`;
  retained evidence is [model-baseline.json](model-baseline.json). See the
  [model measurement contract](map-document.md#validation-and-measurement).

Command tests now verify atomic failure and undo restoration of both
source and overwritten destinations, including overlapping layers, saved/recovery
checkpoints, net no-ops, and history limits. For future codec tests, round-trip bounds,
layer order and underlying values, registry associations, and annotations, and
reject malformed input. Wire the actual implementation into these tests as those
tickets land; passing coordinate/fixture tests does not validate missing features.

`npm run perf:history` measures a 318,400-cell sparse transaction across two layers
on empty and fully populated heartland backgrounds in two fresh processes each.
It validates every notification span, overwritten content restoration, background
hashes, and history eviction. Raw evidence is in [history-baseline.json](history-baseline.json);
see [the measurement and limits](command-history.md#validation-and-measurement).
These domain timings/memory samples do not establish the editor budgets below.
Earlier baseline files are historical TW-003/TW-004 evidence, not source hashes of
the current command implementation.

## Deterministic populated fixtures

Source: [maps.ts](../tests/fixtures/maps.ts). Both fixtures have bounds
`[0, 6400) × [0, 6400)`, 100 × 100 visual chunks, 40,960,000 positions per layer,
and four ordered layers: **terrain, buildings, furniture, canopy**. All are visible
in future benchmark scenarios. They have 163,840,000 possible layer-cell addresses.
The generator streams occupied horizontal runs in `(y, layer, x)` order. It uses
specified uint32 `Math.imul` mixing, never `Math.random`, a clock, or filesystem
ordering. Version, seed, density parameter, palette, and ordered layers are hashed.

| Fixture      | Seed (hex / decimal)      | Terrain selection parameter | Terrain cells | Building cells | Furniture cells | Canopy cells | All occupied layer cells |
| ------------ | ------------------------- | --------------------------- | ------------- | -------------- | --------------- | ------------ | ------------------------ |
| frontier-v1  | `0x1a2b3c4d` / 439041101  | 18%                         | 6,545,856     | 57,024         | 3,564           | 14,256       | **6,620,700**            |
| heartland-v1 | `0x5e6f7081` / 1584361601 | 82%                         | 23,950,356    | 57,024         | 3,564           | 14,256       | **24,025,200**           |

The selection parameter is **not** the occupied percentage. Selected terrain
chunks contain 32–64 occupied columns and omit every sixteenth row, except in
villages. Seeded grass/water patches provide partial terrain and holes. Every
640 × 640 region contains a 128 × 128 fully populated village at offset `(256,256)`,
except the deliberately empty bottom-right region `[5760,6400)²`. Thus there are
99 villages and 891 houses per fixture. Each village has nine 8 × 8 building
footprints, nine 2 × 2 furniture footprints, and a 12 × 12 canopy. The center house
straddles four chunks. These give both substantially filled local regions and
partially filled surroundings, distributed across the whole map.

| Actual occupancy metric                             | frontier-v1          | heartland-v1          |
| --------------------------------------------------- | -------------------- | --------------------- |
| Unique occupied map positions (union across layers) | 6,545,856 (15.9811%) | 23,950,356 (58.4725%) |
| Empty positions on every layer                      | 34,414,144           | 17,009,644            |
| Positions with at least two layers                  | 64,944               | 64,944                |
| Positions with exactly two / three / four layers    | 55,440 / 9,108 / 396 | 55,440 / 9,108 / 396  |
| Emitted horizontal runs                             | 138,222              | 500,802               |

These counts are measured from emitted runs by
[inspect.ts](../tests/fixtures/inspect.ts), not estimated from density parameters.
It rejects unordered, duplicate/overlapping same-layer, invalid-paint, fractional,
and out-of-bounds runs. A 6,400-byte row counter measures the union and overlap
depth; it does not materialize the full matrix. SHA-256 covers the JSON metadata
plus a newline, then every run as five little-endian uint32 values
`[layer, y, x, length, paint]`. All colors are occupied, including the unregistered
black furniture color; absence alone means empty.

Reviewed counts, metadata, and digests live in
[expected.json](../tests/fixtures/expected.json). Two complete generations per
fixture must equal this golden data. Changes to fixture content require reviewing
the generated counts, updating the golden file deliberately, and versioning fixture
IDs when comparisons would otherwise become misleading. No test or normal harness
command silently regenerates the golden file.

`generateFixture(spec)` and `visitFixtureCells(spec, callback, optionalBounds)`
are the import seams for TW-004 and later tests. The callback receives layer name,
world x/y, and a fixture palette index. Adapt these explicitly to the eventual
domain color/registry model; the run representation is test interchange, **not**
the project or agent-export schema. Use runs for bulk ingestion or visit all cells
to exercise per-cell insertion. Report which route is measured. Do not time only
the compressed recipe and call it document loading. Do not import these fixtures
into the production bundle or add a production fixture loader in this ticket.

## Named baseline and build modes

**Baseline Mac: TW-M1Pro-16** — MacBook Pro `MacBookPro18,3`, Apple M1 Pro,
8 CPU cores (6 performance + 2 efficiency), 14 GPU cores, 16 GiB unified memory,
internal SSD, macOS 15.8.1 (24H32), arm64. The built-in screen is 3024 × 1964 physical
pixels. Node is 24.22.3; Rust is pinned to 1.100.0. No serial number or device UUID is
needed in a report. Other machines may run checks; label them separately and do not
use their numbers to claim this baseline passed.

The **current harness** runs unbundled TypeScript under Node with `--expose-gc`.
It times generation + validation + actual occupancy scanning + hashing, using
`performance.now()`. There are two sequential passes per fixture, frontier first.
GC runs before and after each pass, outside the timed interval. Memory snapshots
are `process.memoryUsage()` before, after, and after GC. `maxRSS` is a process-wide
cumulative high-water mark, including Node and earlier fixture passes; it is not a
per-fixture memory peak. Snapshots cannot establish peak JS heap usage. Metadata
includes OS/model/CPU/RAM/architecture/Node, command mode, timestamp, and SHA-256
fingerprints of harness inputs. Timings may vary; deterministic content must not.

The **future editor measurements** use `npm run build:desktop`, a release arm64
Tauri `.app`, embedded production assets, WKWebView and WebGL 2. Stop Vite, close
DevTools, use AC power, disable Low Power Mode, let the machine cool, and fix display
refresh at 60 Hz. Set the map canvas to 1024 × 640 CSS pixels at DPR 2 and record its
actual dimensions. Record any unavoidable deviation, OS update, active profiler,
or competing workload. No debugger, software renderer, or development build may
silently stand in for the release baseline.

## Provisional budgets and future measurement protocol

Apply these budgets to **both fixtures**, preserving all four layers and underlying
content. There are no timing assertions in unit tests. These are future release
gates, currently **not measured**, and should be attached to the implementing
tickets when their instrumentation is available. One successful run is not a gate.

Use a fresh document per scenario. Warm up for 5 seconds, then record 60 seconds of
navigation three times. Report p50/p95/p99 and maximum per run with nearest-rank
percentiles, sample counts, and dropped-frame counts; every run must meet the
budget. For discrete operations, use 20 repetitions from the same reset fixture,
report all samples and nearest-rank p95 (19th sorted sample). Include failures and
timeouts. Do not discard slow samples. Cold starts are separate from warm runs.

| Scenario / metric                                                     | Provisional budget                                                                                                                                                    | Measurement boundary and workload                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detailed navigation                                                   | Frame interval p95 ≤ 16.7 ms, p99 ≤ 33.4 ms; no frame > 100 ms                                                                                                        | Start at world `(320,320)`, 16 CSS px/tile (64 × 40 tiles visible). Pan camera in a square through `(280,280)`, `(360,280)`, `(360,360)`, `(280,360)`, each leg 2 s, then zoom 16→32→16 px/tile over 4 s; repeat. Measure presented-frame intervals, including CPU/GPU work.                                                                                                                 |
| Full-map overview navigation                                          | Same frame budgets; initial overview usable ≤ 2 s                                                                                                                     | Fit all bounds at 0.1 CSS px/tile in the same viewport. Repeat fit→2× zoom about map center→pan right 640 tiles→pan back→fit, 2 s per step. Capture initial cache generation separately from the warm navigation loop. This is overview navigation, not individual-tile editing.                                                                                                             |
| Input-to-paint (detail pencil / selection preview; overview pan/zoom) | p95 ≤ 50 ms, p99 ≤ 100 ms                                                                                                                                             | At least 200 inputs per run. Timestamp original input delivery to the first presented frame containing its effect; preserve input IDs through command and rendering. A `requestAnimationFrame` callback or command completion alone is not presentation. Use an Instruments rendering trace or calibrated external capture to verify presentation; label any JS-only measurement as a proxy. |
| Memory                                                                | Steady app + attributed WebContent/GPU physical footprint ≤ 2 GiB; transient peak ≤ 4 GiB; growth after 20 edit/undo cycles ≤ 100 MiB                                 | Measure the entire desktop process group/attributed WebKit footprint with Instruments at 100 ms cadence; avoid double-counting shared memory. Include loaded document, caches, history, and native buffers. Record JS heap separately. Sample steady state after 10 s idle; observe peak through import, overview creation, edits, save/export, and recovery.                                |
| Small edit                                                            | 8 × 8 house move by 3 tiles, two layers, and each undo/redo p95 ≤ 50 ms                                                                                               | Move building + furniture at `[316,324)²`, leave terrain/annotations fixed; measure input→committed model→presented result and validate overwritten destination restoration. Use 20 resets and include cross-chunk paths.                                                                                                                                                                    |
| Large edit                                                            | 512 × 512 filled rectangle (262,144 cells, one layer) and undo/redo each p95 ≤ 500 ms; 1,024 × 1,024 fill p95 ≤ 2 s                                                   | Reset, fill terrain at `[256,768)²` / `[256,1280)²` with a contrasting color. Include transaction/inverse capture and cache invalidation, then first correct frame. UI acknowledgement ≤ 100 ms; longest main-thread task ≤ 50 ms.                                                                                                                                                           |
| Project open                                                          | p95 ≤ 5 s warm; each of 3 separately labeled cold trials ≤ 8 s                                                                                                        | Local SSD, whole fixture file: user confirms path→read/decode/validate/build model→first correct editable frame. Record file bytes and schema version; do not include dialog thinking time. Cold trials follow a reboot; otherwise label OS-cache state unknown, not cold.                                                                                                                   |
| Explicit save                                                         | p95 ≤ 5 s                                                                                                                                                             | Save to a new local temp destination each trial: request→consistent revision capture→encode→native atomic durable write acknowledgement→saved state. Record bytes, and reopen/compare all layers after each trial. Measure existing-file replacement separately.                                                                                                                             |
| Whole-map agent export                                                | p95 ≤ 8 s                                                                                                                                                             | Request→encode every layer and metadata→native completed write. Validate semantic content and occupied counts, record bytes/schema. No visible-subset shortcut.                                                                                                                                                                                                                              |
| Recovery overhead                                                     | Incremental capture/write p95 ≤ 250 ms per checkpoint; foreground frame p95 increase ≤ 2 ms; main-thread task ≤ 50 ms; extra peak memory ≤ 256 MiB; restore p95 ≤ 5 s | Benchmark at a provisional 5 s dirty checkpoint interval with 1,000 deterministic pencil edits per interval. Compare identical 60 s navigation traces with recovery on/off. Measure initial full snapshot separately (≤ 5 s). Recovery destination is separate; kill after confirmed checkpoint, relaunch, and verify unsaved edits while the explicit project stays unchanged.              |

The 5-second recovery interval is a benchmark workload, not a final recovery UX
decision. The memory limits leave room on a 16 GiB Mac for macOS and other work;
the frame/latency limits target smooth 60 Hz feedback, while large operations get
explicit bounded completion times. Streaming, sparse storage, and overview caches
are hypotheses to test against this workload, not proof that it already passes.

## macOS smoke workflow

1. Run `npm test` and retain counts/errors. Run `npm run dev`; verify Tilewright's
   title, editor panels, one map canvas, and **Canvas ready**. Resize, close with Cmd+W, and
   relaunch. A duplicate canvas, stale callback, or failure without a useful
   message fails the smoke check.
2. Run `npm run build:desktop`. Stop development/test servers, copy the `.app` with
   `ditto` into a directory created by `mktemp -d`, and launch the copy with `open`.
   These system commands take repository-relative source paths; no private path
   is needed. Verify startup, resize, close, and reopen in native WKWebView.
3. With networking disabled manually, repeat the packaged launch. Record whether
   networking was actually disabled; a stopped Vite server alone is not that test.
   Restore the machine's original networking state afterward.
4. When the editor exists, adapt/import each fixture through its domain API and
   repeat detailed editing, overview, save/reopen, export, and recovery scenarios
   above. Retain exact fixture ID/hash and counts. Until that integration exists,
   record these operations as **not measured**, never as passed on the preview.

Use this record in the relevant WRK ticket (or attach a local report):

```text
Date; source revision or source hashes; package-lock hash:
Machine label/model, CPU/GPU, RAM, macOS/build, power/refresh:
Build command/mode, app location, canvas CSS size/DPR:
Fixture version/seed/hash, dimensions, layers, actual occupancy:
Commands, suite counts, native observations, close/reopen result:
Server stopped? Network actually disabled? Profiler/background load:
Scenario, repetitions, raw samples, timing/memory method, artifact path:
Budget pass/fail OR not measured; limitations and follow-up ticket:
```

## Recorded harness baseline

[performance-baseline.json](performance-baseline.json) contains the actual
TW-M1Pro-16 run recorded for this ticket, with both complete passes per fixture,
all counts/digests, memory snapshots, and reproducibility metadata. It is a
**harness baseline only**, not an editor benchmark. No navigation frame time,
input latency, model memory, edit, file I/O, export, or recovery budget was
measured or passed by TW-003. TW-004 separately records model-only initialization
and memory in [model-baseline.json](model-baseline.json); this does not establish
an editor memory/performance budget. The shell tests measure state isolation, sizing, focus, behavior and cleanup.
TW-007 additionally measures detailed populated-map rendering, culling, live GPU
resource counts and browser heap during repeated pan sweeps; see the
[tile renderer validation](tile-renderer.md#validation). Overview, native memory,
file I/O and complete editor performance budgets remain unmeasured.
