---
id: wrk-d831f7e0
title: 'TW-003: Establish domain tests, representative fixtures, and performance budgets'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-ffd4eb5c
priority: normal
labels:
  - v1
  - foundation
  - implementation
fields:
  sequence: 3
  source: INTENT.md
---
## Outcome

Make correctness and target-scale responsiveness measurable before feature development.

## Source and scope

**Source:** INTENT.md — Map size and navigation; INTENT.md — Chosen technology; INTENT.md — First-version success criteria.

**Execution order:** 03 of 54. Phase: foundation.

**Prerequisite:** [wrk-ffd4eb5c](wrk-ffd4eb5c.md) — TW-002: Bootstrap the macOS Tauri, React, TypeScript, Vite, and PixiJS application.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Add a TypeScript test harness for model/commands/codecs and an appropriate macOS UI/manual smoke workflow.
- Define deterministic fixtures near 6,400 by 6,400 tiles with clustered buildings, populated terrain, empty space, and multiple overlapping layers; report actual occupied-cell counts.
- Choose and document provisional budgets for navigation frame time, input-to-paint latency, memory, large edits, file I/O, export, and recovery overhead on a named baseline Mac.

## Acceptance criteria

- [x] Fixtures cover partially filled and substantially populated regions; an empty large canvas is not the only performance input.
- [x] Fixture seed, dimensions, layer count, occupancy, machine, build mode, and measurement method are reproducible.
- [x] Performance budgets are explicit implementation decisions and include detailed editing and a full-map overview.
- [x] Checks run through documented commands without depending on cloud services or developer-only absolute paths.

## Validation

- Generate each fixture twice and confirm equivalent content and occupancy statistics.
- Run a meaningful model smoke test and record a baseline harness execution without claiming the unbuilt editor already meets the budgets.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-004: Implement the sparse, layered TypeScript map document](wrk-4d23646a.md).

## TW-003 execution record — 2026-11-18

Executed in this Codex session with sprint-execute Strategy A. WRK state replaces
sprint/ledger files. Read the full ticket, AGENTS.md, INTENT.md, README.md,
docs/ticket-runner.md, scripts/run-tickets.sh, docs/foundation-decisions.md, and
docs/desktop-development.md. Prerequisites TW-002 and its prerequisite TW-001 were
done. Fetched the skill weather report successfully (it lists gpt-6-astra for
CS/Math and Opus 5.5 for frontend implementation); no delegation or model switch
was needed for the selected strategy. No commits were requested or required.
The repository started without any commits and with existing files untracked.

### Completed phase checklist

- [x] Establish the pure TypeScript domain harness and meaningful coordinate
  smoke tests. Initial phase passed the frontend build, 4 domain tests, 3 WebGL
  tests, and formatting before proceeding.
- [x] Add two target-scale populated fixtures, independent occupancy accounting,
  golden content hashes, small layered cell-oracle checks, and baseline runner.
  Phase passed build, all 10 domain tests, all 3 WebGL tests, and formatting;
  both complete generations of each fixture matched each other and golden data.
- [x] Document provisional budgets, baseline machine and build modes, future
  measurement boundaries, and native smoke workflow. Retain an actual harness
  baseline, perform packaged-app smoke, run final validation, and review all
  acceptance criteria before marking done.

### Implementation and decision locations

- `package.json`, `package-lock.json`: pinned `@types/node` 24.19.2; built-in Node
  test runner; separate `test:domain` / `test:ui`; `npm test` runs both; reproducible
  `perf:baseline` command; formatting includes the new scripts and performance
  document. No additional runtime testing dependency was needed.
- `tsconfig.json`, `tsconfig.domain.json`: strict checking of app, tests, and
  scripts, plus a no-DOM domain configuration with erasable TypeScript syntax.
- `playwright.config.ts`: explicitly discovers `*.spec.ts` browser tests, separate
  from Node's domain `*.test.ts` files.
- `src/domain/coordinates.ts`, `tests/domain/model.test.ts`: executable half-open
  safe-integer bounds and visual-chunk contract; smoke tests cover fixed target
  dimensions, bounds rejection, an 8 by 8 cross-chunk footprint, negative
  coordinates, and dimension overflow. This is not the future storage model.
- `tests/fixtures/maps.ts`: versioned deterministic streaming runs and a cell
  visitor for later domain import, fixed bounds, ordered layers, seeds, and palette.
- `tests/fixtures/inspect.ts`, `tests/fixtures/expected.json`: actual emitted-cell
  occupancy accounting, row/layer/order/overlap/bounds validation, SHA-256 over
  full metadata and cell-run content, and checked-in golden counts/digests.
- `tests/domain/fixtures.test.ts`: each fixture generated twice; golden comparison;
  coverage bounds and overlap-depth invariants; layered window oracle preserving
  underlying terrain, occupied black paint, absence, and cross-chunk buildings;
  rejection of malformed runs and proof that hashes cover paint and seed changes.
- `scripts/fixture-baseline.ts`, `.gitignore`: portable local harness with two
  passes per fixture, reproducibility checks, actual timings/memory and source
  fingerprints; routine reports go to ignored `artifacts/performance/`.
- [Testing and performance](../docs/performance.md): commands, test extension
  conventions for future model/commands/codecs, fixture definitions/counts,
  TW-M1Pro-16 baseline, explicit provisional budgets for all requested categories,
  detailed and overview scenarios, measurement protocols, and macOS smoke record.
- [Recorded harness baseline](../docs/performance-baseline.json): retained raw
  results from both full passes per fixture, machine/mode/method, input hashes,
  memory snapshots, occupancy statistics, and full content digests.
- [Desktop development](../docs/desktop-development.md), [README](../README.md):
  discoverable commands and links to the new workflow and performance decisions.

### Acceptance and fixture evidence

All four acceptance criteria are satisfied:

1. Both maps are 6,400 by 6,400 with four overlapping layers and 99 distributed
   villages / 891 houses. Partially filled terrain has holes and unoccupied rows;
   villages have fully occupied 128 by 128 terrain. The 640 by 640 bottom-right
   region is empty on all layers. Tests verify substantial versus partial overall
   coverage and actual layered content near the center of a village.
2. Version, uint32 seed, dimensions, layer order, actual occupied counts, palette,
   source hashes, Mac model/RAM/CPU/OS, Node version, build mode, and measurement
   method are recorded in the reproducible harness/report. Generation is streamed;
   no full tile matrix or dense multi-layer canvas allocation is required.
3. Explicitly provisional budgets cover navigation frame time, input-to-paint,
   process-group memory, small/large edits, open/save, whole-map export, and
   recovery overhead. Both detailed editing at 16 CSS pixels per tile and a
   full-map overview at 0.1 CSS pixels per tile are specified, with workloads,
   repetitions, percentile definitions, boundaries, and failure reporting.
4. Commands work from repository-relative paths using pinned installed tools.
   Tests and measurement require no cloud service, credentials, or private paths.
   Dependency/browser installation is the only network-dependent setup. Browser
   tests use local Vite; domain tests and the baseline need no server.

Actual fixture counts (layer cells count overlapping layers separately):

| Metric | frontier-v1 | heartland-v1 |
| --- | --- | --- |
| Seed | 0x1a2b3c4d / 439041101 | 0x5e6f7081 / 1584361601 |
| Terrain | 6,545,856 | 23,950,356 |
| Buildings | 57,024 | 57,024 |
| Furniture | 3,564 | 3,564 |
| Canopy | 14,256 | 14,256 |
| Total occupied layer cells | **6,620,700** | **24,025,200** |
| Unique occupied positions | 6,545,856 (15.9811%) | 23,950,356 (58.4725%) |
| Empty positions | 34,414,144 | 17,009,644 |
| Positions occupied on at least two layers | 64,944 | 64,944 |
| Positions occupied on exactly four layers | 396 | 396 |
| Emitted runs | 138,222 | 500,802 |

Content SHA-256, identical across both generations and the golden file:

- frontier-v1: `de4ed786f9a80c42b6ab3939c08990b40484975b2dc77eeea147591bab552617`
- heartland-v1: `c1e4443944ee8d9576529a88029c3aad854fa33c251e1d91c70adad8f8361d33`

### Actual validation evidence

Machine: **TW-M1Pro-16**, MacBookPro18,3, Apple M1 Pro (8 CPU / 14 GPU cores),
16 GiB RAM, arm64, macOS 15.8.1 (24H32). Used repository Node 24.22.3 / npm 11.19.1
through `nvm use` and Rust/Cargo 1.100.0. Did not change the older global Node default.

Successful commands and observations on 2026-11-18:

1. Final `npm ci`: **44 packages installed, 45 audited, 0 vulnerabilities**, exit 0.
2. Final `npm run build`: both strict TypeScript configurations passed; Vite
   transformed **771 modules**, exit 0. Production main asset remained
   `index-DVsIN_X8.js` (618.62 kB / 184.13 kB gzip). Test data and the baseline
   harness are not imported into the production renderer.
3. Final `npm test`: **10 domain tests passed**, 0 failures/skips, **1197.73 ms**;
   **3 real-WebGL UI tests passed in 5.1 s**. The unavailable-WebGL test deliberately
   logs initialization failure, then successfully recovers. No missing-feature
   tests were falsely reported as passing.
4. Final `npm run format:check`: all matched app/test/script/config/document files
   passed Prettier; `cargo fmt --check` passed, exit 0.
5. `npm run perf:baseline -- --output docs/performance-baseline.json`: exit 0;
   each fixture's two full generations had equivalent content and occupancy and
   matched the reviewed golden summary. Recorded full scan times (generation,
   validation, occupancy, and hashing): frontier **254.16 / 235.98 ms**; heartland
   **302.52 / 296.36 ms**. Process cumulative max RSS was **99.36 / 101.11 MiB**
   after frontier passes and **101.31 / 101.62 MiB** after heartland passes. These
   are whole Node-process high-water marks, not per-fixture or editor-model memory.
   The report contains exact timings and before/after/post-GC memory snapshots.
6. `npm run build:desktop`: exit 0; optimized native build finished in **10.81 s**,
   produced `src-tauri/target/release/bundle/macos/Tilewrite.app` (**10.57 MiB**).
7. Packaged native smoke: copied the app into a fresh system temporary directory
   outside the checkout; verified `127.0.0.1:1420` was closed. Native UI inspection
   showed title **Tilewrite**, `tauri://localhost`, one **Map workspace preview**,
   and **Canvas ready**. Enlarged the window and visually inspected the centered
   tile probe. Closed with Cmd+W, relaunched the copied app, and observed the same
   successful native startup. Closed the test app and verified its process had
   exited. A UI query immediately after window close reported `procNotFound`
   because the app had exited; reopening succeeded. No networking interface was
   disabled, so physical offline launch was not claimed.
8. Final `cargo test --locked --manifest-path src-tauri/Cargo.toml`: exit 0;
   **0 Rust tests**, as expected for the unchanged minimal native shell.
9. Python audit: all report source fingerprints matched current files; local links
   in README and both workflow documents resolved; all **17** new/modified
   implementation files had final newlines, no trailing whitespace, and no
   developer-specific `/Users/` paths. This explicitly checked untracked files,
   which `git diff --check` alone cannot cover. The copied smoke app had exited.
10. `git diff --check`: exit 0. `wrk validate`: exit 0, **Valid project: 56 tickets**.

### Decisions, limits, and handoff

- The native Node runner avoids another test runtime dependency. The small real
  coordinate module supplies a meaningful domain smoke before TW-004; the layered
  Maps in fixture tests are explicitly an independent cell oracle. Full sparse
  document storage, commands/history, and codecs remain their existing tickets.
- Run-based fixture interchange keeps fixture generation practical without
  preselecting storage or project/export schemas. TW-004 can consume runs or the
  provided cell visitor, then report actual model initialization and memory.
- No editor navigation, input latency, memory, edit, I/O, export, or recovery budget
  has been measured or passed. Two fixture scans are a reproducibility/harness
  baseline, not statistically sufficient editor performance samples. The guide
  specifies future release measurements separately from Node and Chromium checks.
- Known existing Vite large-chunk and npm optional fsevents-script advisories
  remain; neither failed installation, builds, tests, or native smoke. No new
  warning suppression was introduced. Native development relaunch and physical
  offline testing remain documented procedures; this ticket exercised the release
  app and automated local frontend checks.
- No other ticket, INTENT.md, production UI/renderer, or Rust source was modified.
  No commits or new sprint ledger/document were created. No blockers or unfinished
  acceptance criteria remain. The original body is preserved, with its four
  acceptance checkboxes checked and this evidence appended.
