# Native rendering performance gate

TW-011 / wrk-02942808 tests the sparse document, command/history path, and Pixi
projection in release arm64 Tauri with embedded production Vite assets,
WKWebView and WebGL 2. See [the budgets and fixture definitions](performance.md).
The performance gate is **not yet passed**. On 2026-11-18 the user accepted this
working baseline to continue feature development and deferred performance
refinement to [TW-049](../.wrk/wrk-6e0d23e5.md) and
[TW-050](../.wrk/wrk-e61b329b.md). TW-011 is complete under that revised scope.
This report preserves the original measurements and their limitations.

## Reproduce

```sh
npm run build:performance
npm run perf:native -- --mode quick --output artifacts/performance/native-quick
npm run perf:native -- --mode full --output artifacts/performance/native-full
npm run perf:native -- --mode memory --output artifacts/performance/native-memory
node scripts/native-performance-report.ts artifacts/performance/report.json artifacts/performance/native-full artifacts/performance/native-memory
```

Run one mode at a time with the benchmark window visible on AC power, Low Power
Mode off, DevTools closed, Vite stopped, and no concurrent builds/tests/profiling
unless explicitly measuring their overhead. Keep the display at the protocol's
60 Hz and record any deviation. The dedicated benchmark window stays above other windows to avoid WKWebView
occlusion suspending rAF; the ordinary app window policy is unchanged.
The canvas asserts DPR 2 and is 1024 × 640 CSS
pixels. `--keep-open` leaves the final overview available for visual inspection.
The runner exits nonzero for failed structural/pixel checks, early exit, or timeout;
it does **not** assert that JavaScript proxies establish presentation budgets.

`quick` is a diagnostic trial: one 3-second run per fixture/scenario, 1-second
warmup and two command repetitions. `full` loads a fresh complete document for
each of three detail and three overview runs per fixture, warms for 5 seconds,
and records 60 seconds. Both use the documented square/zoom and fit/zoom/pan
routes. The overview starts at exactly 0.1 CSS pixels/tile; its 6,400-tile height
fills the canvas without the shell's normal Fit padding. Every native load checks
all occupied layer cells and all four layers against the deterministic fixture.

Each command scenario moves the 8 × 8 house three tiles across storage/visual
boundaries on buildings and furniture, then tests 512² and 1024² terrain fills.
Undo resets content before every repetition. Overwritten source/destination and
underlying terrain are compared after small-move undo. All edits, undo, and redo
use `EditorSession` and real history, invalidation and rendering subscriptions.
Overview small moves must rebuild exactly one region; detail queries must remain
bounded to affected 32² chunks. These checks fail rather than silently omit work.

`memory` performs 20 command repetitions, initial/ending 10-second idle windows,
and overview creation/edits, with macOS `footprint --sample 0.1`. The runner records
the new native app and its newly launched WebKit GPU, WebContent and Networking
processes; verify that inventory before interpreting a run. The JSON sampler
records actual sample start/end times, totals and shared accounting. Sampling
itself adds load, so it runs separately from navigation. This is a native
physical-footprint measurement, not a JS heap estimate; WKWebView does not expose
a portable JS heap counter here. Save/export/recovery are not implemented or timed.

## Evidence boundaries

The runner retains environment, input source SHA-256s, release executable hash,
PID inventory, all raw event samples, stderr and optional physical-memory samples.
Nearest-rank summaries retain p50/p95/p99/max and sample counts. The missed-interval
estimate sums `max(0, round(interval / (1000/60)) - 1)`; it is a rAF proxy, not a
measurement of dropped display frames. Clock values in this WKWebView are
quantized to whole milliseconds, so a literal 16.7 ms comparison of that proxy
also includes timer quantization and scheduling jitter.

Navigation IDs link synthetic camera delivery, synchronous render submission,
and the following rAF. Discrete timings include model transaction, inverse capture,
cache invalidation, and the following rAF after pending overview work finishes.
Neither boundary proves that pixels have reached the physical display. No physical
mouse/trackpad, pencil tool, selection controller or production React panel cost
is claimed: this isolated architecture spike directly uses the production model,
EditorSession and renderer. Input tools and their end-to-end validation remain
necessary for the full editor.

The separate `vite.performance.config.ts` entry bundles test fixtures only into
`artifacts/performance/dist`; `tauri.performance.conf.json` embeds that output in
**Tilewright Performance.app** under a separate app identifier. The Rust
`performance` feature exposes only a mode query and stdout event reporting.
The ordinary `npm run build:desktop` neither includes fixture imports nor compiles
the reporting commands. No local server or network service is used at runtime.

## Changes under evaluation

- `src/domain/storage.ts` and `document.ts`: bounded token-span scans, resolving
  immutable paint once per run, preserving sparse queries and exact signed edges.
- `src/renderer/overview.ts`: opaque packed fills, exact span-based box averaging,
  and cooperative 6 ms slices with a 1,024-work-unit fallback. CPU/GPU cache byte
  limits, visibility, version guards, alpha semantics and eviction stay intact.
- `tests/domain/overview.test.ts`: independent per-cell oracle for clipped bin
  averages and transparent/opaque overlaps, alongside the existing full fixture,
  safe-integer, mutation, cache-lifetime and browser pixel regression suites.

## Recorded native baseline — 2026-11-18

Current decision: **accept the baseline and defer the performance gate** under
the user's 2026-11-18 delivery priority. The original audit held TW-011 blocked;
that queue decision is superseded, while its measurement findings remain valid.
The sparse model and bounded caches have a working native baseline. The span
optimizations substantially improve overview construction, but bulk commands
still block the main thread beyond the provisional limit, and presented-frame
and input-to-display timing remain unverified. Numerical budgets are retained as
future targets; their enforcement is deferred to TW-049/TW-050.

Machine: TW-M1Pro-16, MacBookPro18,3, Apple M1 Pro (8 CPU / 14 GPU cores), 16 GiB,
arm64 macOS 15.8.1 (24H32), built-in 3024 × 1964 display, Node 24.22.3 and Rust
1.100.0. AC power, Low Power Mode off; DevTools and Vite stopped. Display refresh
was **not fixed at 60 Hz**, a protocol deviation requiring a controlled rerun.
Other desktop applications remained open; the final navigation run had no
concurrent build, browser test, memory sampler or Instruments capture. Networking
was not disabled; this is not the offline smoke test.

Build: `npm run build:performance`, release arm64 Tauri, production embedded assets,
WKWebView/WebGL 2, 1024 × 640 CSS canvas at DPR 2. Final measured executable SHA-256:
`24f4a6aafb31f15b883768440b4cddddf0b762bd7ecdcee2274921b3a530f189`.
The [machine-readable report](native-performance-baseline.json) retains input hashes
for each historical build, machine/build metadata, golden fixture hashes/counts,
all percentile summaries and process inventories. The adjacent
[compressed raw samples](native-performance-samples.json.gz) retain every event,
input/frame ID, memory sample, inventory and native stderr. Recreate summaries with
the report command above. The recorded `final-native` run began at 22:06:55 UTC.

| Fixture      | Seed         | Occupied layer cells | Layers | Dimensions  |
| ------------ | ------------ | -------------------: | -----: | ----------- |
| frontier-v1  | `0x1a2b3c4d` |            6,620,700 |      4 | 6400 × 6400 |
| heartland-v1 | `0x5e6f7081` |           24,025,200 |      4 | 6400 × 6400 |

All following navigation numbers are **rAF proxies in milliseconds**, not
presented-frame measurements. Each row is one fresh-document, 5-second warmup,
60-second trial. Missed intervals use the documented 60 Hz estimate.

| Fixture   | Route    | Trial | Samples | p50 | p95 | p99 | Max | Missed estimate |
| --------- | -------- | ----: | ------: | --: | --: | --: | --: | --------------: |
| frontier  | detail   |     1 |    3599 |  17 |  18 |  19 |  24 |               0 |
| frontier  | detail   |     2 |    3600 |  17 |  18 |  19 |  25 |               2 |
| frontier  | detail   |     3 |    3600 |  17 |  18 |  19 |  26 |               2 |
| frontier  | overview |     1 |    3600 |  17 |  18 |  19 |  30 |               3 |
| frontier  | overview |     2 |    3601 |  17 |  18 |  19 |  36 |               2 |
| frontier  | overview |     3 |    3600 |  17 |  19 |  19 |  32 |               3 |
| heartland | detail   |     1 |    3600 |  17 |  18 |  19 |  29 |               4 |
| heartland | detail   |     2 |    3599 |  17 |  19 |  20 |  38 |              10 |
| heartland | detail   |     3 |    3600 |  17 |  18 |  19 |  46 |               7 |
| heartland | overview |     1 |    3600 |  17 |  18 |  19 |  31 |               4 |
| heartland | overview |     2 |    3600 |  17 |  18 |  19 |  31 |               6 |
| heartland | overview |     3 |    3600 |  17 |  18 |  20 |  35 |               8 |

Synchronous navigation submission p95 was 2 ms in detail and 3 ms in overview
for every trial. Warm overview navigation performed zero document queries.
Cold overview ready proxies were **880 / 1098 / 999 ms** for frontier and
**1860 / 1962 / 1910 ms** for heartland. All six finish cache work within 2 seconds,
although heartland has little headroom and physical presentation is unverified.
Initial diagnostic trials before optimization took 3685 / 6195 ms respectively;
these were quick, partly concurrent with other work, so no precise speedup ratio
is claimed. Historical samples remain in the archive.

Discrete values below are nearest-rank p95 milliseconds, 20 repetitions per
action, reported as **edit / undo / redo**. Submission includes synchronous model,
inverse capture and invalidation; next-rAF includes readiness but not display.

| Fixture   | Workload            | Submission p95  | Next-rAF p95    |
| --------- | ------------------- | --------------- | --------------- |
| frontier  | 8 × 8 move          | 5 / 4 / 4       | 19 / 21 / 18    |
| heartland | 8 × 8 move          | 4 / 4 / 4       | 19 / 18 / 18    |
| frontier  | 512² fill           | 46 / 46 / 44    | 49 / 49 / 47    |
| heartland | 512² fill           | 27 / 28 / 29    | 30 / 33 / 32    |
| frontier  | 1024² fill          | 86 / 85 / 86    | 89 / 88 / 92    |
| heartland | 1024² fill          | 111 / 115 / 117 | 120 / 119 / 122 |
| frontier  | overview small move | —               | 35 / 34 / 34    |
| heartland | overview small move | —               | 34 / 34 / 34    |

The 1024² tasks exceed the **50 ms longest main-thread task** limit, with maxima
92 ms on frontier and 118 ms on heartland; frontier's 512² edit also had a 78 ms
maximum. Heartland cannot acknowledge synchronously within 100 ms on these large
commands. Small detail edits made six bounded queries, each at most 32² tiles.
Every measured overview move/undo/redo rebuilt exactly one region with query area
at most 64² tiles. The independent local restoration and native pixel checks passed
on both complete fixtures. Native visual inspection showed the populated village,
overlapping building/furniture, grid and chunk boundaries, and the complete
heartland overview with distributed terrain/water/villages and the deliberately
empty bottom-right region. The timings do not substitute for those checks.

### Physical memory

The separate `native-memory` run sampled native app PID 53254, GPU 53255,
WebContent 53256 and Networking 53257. `footprint` recorded **1055 samples** with
group/shared accounting, no errors/warnings; median cadence 100 ms, p95 112 ms,
maximum gap 211 ms. The highest sampled group footprint was **714.38 MiB**.
This is a sampled peak; shorter transients may be missed. No JS heap counter was
available. These values include native/WebKit allocations as well as the model.

Each fixture did 20 edit/undo/redo/reset trials for **each** of the three command
sizes (60 trials total), then overview creation and 20 small-move trials. The
following steady values take the maximum sample in the last second of a
10-second idle window before and after all three command sizes. Fixtures ran
sequentially in one process, so later measurements include retained allocator
capacity from earlier work; no forced GC was used.

| Fixture   | Before cycles | After cycles | Retained growth |
| --------- | ------------: | -----------: | --------------: |
| frontier  |    207.63 MiB |   362.74 MiB |      155.11 MiB |
| heartland |    532.79 MiB |   633.06 MiB |      100.27 MiB |

Sampled steady/peak totals are within 2/4 GiB. Growth does **not establish the
100 MiB / 20-cycle gate**: this combined 60-trial workload exceeds 100 MiB and does
not isolate each 20-trial workload after idle. Investigate history/allocator
retention and repeat isolated scenarios before claiming that budget. File I/O,
export and recovery memory remain outside this spike.

### Presentation blocker and acceptance decision

Xcode 26.3's `xctrace` Animation Hitches captures did not provide valid per-app
presentation evidence on this machine. The 20-second `optimized-navigation.trace`
export had 30 frame-lifetime rows with impossible multi-year durations, zero Core
Animation commit rows, and nine display surface rows with no CPU-to-display
latency. A separate 30-second visible-window capture returned zero frame-lifetime
rows. [Compressed XML exports](native-presentation-samples.json.gz) preserve these
observations; original trace bundles remain locally in `.wrk-runs/wrk-02942808/`.
The cause has not been established. Neither whole-display swap counts nor a
following rAF identifies the first presented frame containing a particular input.

To investigate the capture failure, run the following while a separate native
benchmark run is active (profiled timing must remain separate from baseline timing):

```sh
xcrun xctrace record --template 'Animation Hitches' --all-processes --time-limit 30s --output artifacts/performance/presentation.trace
xcrun xctrace export --input artifacts/performance/presentation.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="hitches-lifetime-interval"]' --output artifacts/performance/lifetimes.xml
xcrun xctrace export --input artifacts/performance/presentation.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="hitches-ca-commit-interval"]' --output artifacts/performance/commits.xml
xcrun xctrace export --input artifacts/performance/presentation.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="displayed-surfaces-interval"]' --output artifacts/performance/surfaces.xml
```

The first long run (`interrupted-native`) was stopped after macOS occlusion
suspended the WebView, producing a 192,947 ms gap. Its samples are preserved and
explicitly invalid for the active-window gate. The final always-visible run
completed all twelve navigation repetitions and every command/correctness check.
Keeping only the benchmark window always-on-top was a harness correction, not a
change to the ordinary app's window behavior.

Deferred work: TW-049 will obtain valid native presentation/input-ID correlation
(working Instruments setup or calibrated external capture) at fixed 60 Hz.
TW-050 will revise bulk commands to yield/acknowledge within budget and remeasure,
and isolate the 20-cycle memory-growth cases. The full editor's physical input/tool
integration also still needs validation. The evidence supports bounded small edits
and faster overview construction, **not** acceptance of all architecture budgets.

Validation of this implementation: production build/typecheck, 65 domain tests,
27 browser tests, formatting, benchmark release build, ordinary desktop release
build, Rust test command (zero Rust unit tests) and clippy with warnings denied
all passed. The extra domain oracle checks exact span downsampling rather than
asserting timing. Browser tests remain Chromium checks, distinct from the native
stress run above.
