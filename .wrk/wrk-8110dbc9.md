---
id: wrk-8110dbc9
title: 'TW-017: Recolor registered entries across layers, history, and overview caches'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-230b4c1d
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 17
  source: INTENT.md
---
## Outcome

Change a registered shade once and update every associated tile without repainting.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — First-version success criteria.

**Execution order:** 17 of 54. Phase: painting.

**Prerequisite:** [wrk-230b4c1d](wrk-230b4c1d.md) — TW-016: Implement the named color registry and stable tile associations.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement entry color changes using stable associations, including currently offscreen and hidden content.
- Update active color UI, visible rendering, overview cache invalidation, and undo/redo behavior.
- Avoid scanning all possible tile positions when propagating a registry change.

## Acceptance criteria

- [x] Changing grass recolors all grass tiles across the map while retaining the same entry identity and meaning.
- [x] Other registered entries and unrelated raw colors are unaffected according to the recorded collision/adoption policy.
- [x] Undo/redo restores both entry appearance and all affected rendered views, including cached overviews.
- [x] Pan away/back, toggle a hidden layer, and zoom out after recoloring all show the new color without stale tiles.

## Validation

- Run a cross-layer/offscreen recolor fixture including a conflicting-color attempt and history operations.
- Measure recolor and cache refresh latency on the target-scale populated fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-018: Build the drawing gesture pipeline and tool previews](wrk-13e3ba6a.md).


## Implementation and acceptance audit — 2026-11-18

Executed sprint-execute Strategy A (Orchestrated) in this session, without
workers or a separate CLI. WRK replaced the sprint ledger; prerequisite
wrk-230b4c1d was verified done before work. Read the requested skill, AGENTS.md,
INTENT.md, README, ticket-runner and the relevant foundation, desktop, registry,
color, layer, document/history, editor, renderer/overview, navigation and
performance guides. Fetched the skill weather report (gpt-6-astra listed for
CS/Math implementation); retained the explicitly selected in-session strategy.
Only TW-017 was executed.

Completed phases and implementation locations:

1. Command/history/cache audit and domain validation: the prerequisite already
   implemented metadata-only recoloring in `src/domain/registry.ts`, history in
   `src/domain/history.ts`/`document.ts`, selected-ID swatch synchronization in
   `src/editor/session.ts`, and changed-ID routing in `src/editor/invalidation.ts`
   and `src/renderer/bindDocument.ts`. Reused this working implementation rather
   than duplicating it. `tests/domain/recolor.test.ts` proves no tile reads,
   enumeration or writes occur during recolor/undo/redo. Added feature-command
   tests in `tests/domain/overview.test.ts` for retained offscreen resolutions and
   cancellation of mixed-version work.
2. UI and real rendering integration: `src/RegistryControls.tsx` now explains
   that Edit recolors linked tiles on every layer, including hidden/offscreen
   tiles, while raw colors retain their bytes. `tests/fixtures/recolor.ts`,
   `tests/tiles-harness.ts` and `tests/recolor.spec.ts` cover the actual session,
   TileScene and OverviewCache paths. `tests/registry.spec.ts` exercises Edit,
   named/raw active swatches and history through real controls.
3. Populated-map measurement and final audit: `tests/recolor-scale.spec.ts`
   benchmarks both complete deterministic fixtures and verifies pixels against
   the independent fixture recipe. `docs/recolor-baseline.json` retains actual
   samples, fixture definitions/hashes/counts, complete stored-value fingerprints,
   machine/browser metadata and source hashes. Decisions and coverage are in
   `docs/registry-decisions.md#tw-017-recolor-integration`, linked from README
   and `docs/overview-rendering.md`.

Acceptance evidence:

- Same identity and meaning: the dedicated 6,400-square fixture contains 1,728
  occupied layer cells, including 576 Grass references on Terrain/Buildings at
  x=0, 1024 and 6272. Recolor changes only Grass's rgba record. Every stored run,
  bounds, layer, annotation and allocation count remains identical; name and ID
  stay Grass/the same ID. The complete populated fixtures retain all stored tile
  values and per-layer occupancy, including 5,950,896 frontier and 20,760,096
  heartland Grass references.
- Collision/adoption policy: conflicting Stone wall/Mountain shades reject
  without partial name changes, history/version changes, notifications, render
  work or lost redo/checkpoints. Equivalent-color edits are no-ops. Raw swatches
  matching both old and new Grass shades remain independent, as do Mountain and
  Stone wall. Recolor does not adopt raw tiles. Raw active paint remains fixed;
  explicit registered selection follows recolor/undo/redo.
- History and caches: one metadata event/undo step per effective recolor, carrying
  only the changed registry ID and no tile spans. Detail refresh touches exactly
  the two referencing visible terrain chunks in the dedicated fixture. Retained
  overview entries at multiple resolutions are invalidated while offscreen and
  rebuilt on return; no offscreen rebuild runs in detail. A forced interrupted
  rebuild is discarded on redo, and every resulting pixel uses the latest shade.
- Navigation/visibility: DPR 1/2 WebGL readbacks after recolor, undo and redo check
  all three distant fixture groups, detail and two overview scales, and both
  hidden/shown Buildings states. Covered Grass reappears correctly when Buildings
  is hidden. Previously cached regions and a never-visited far region both match
  current colors. All map contents and history remain intact through view changes.

Actual validation (TW-M1Pro-16, MacBookPro18,3, Apple M1 Pro, 16 GiB,
macOS 15.8.1 / 24H32, arm64, Node 24.22.3, Rust 1.100.0):

- Phase 1: `npm run build`, `npm test` (92 domain + 46 browser tests), and
  `npm run format:check` — PASS before UI integration.
- Focused UI integration: `npx playwright test tests/recolor.spec.ts tests/registry.spec.ts`
  — PASS, 10 tests including DPR 1/2 pixel readbacks.
- Focused populated measurement: `npx playwright test tests/recolor-scale.spec.ts`
  — PASS, both fixtures (49.5 seconds); repeated in the final full suite.
- Final `npm run build` — PASS, both TypeScript configurations and Vite.
- Final `npm test` — PASS, 92 domain tests and 51 Chromium/Playwright tests
  (3.1 minutes for browser tests); zero failures, cancellations or skips.
  The unavailable-WebGL test emits its expected error before successful retry.
- Final `npm run format:check` — PASS, Prettier and Rust formatting.
  Additional `npx prettier --check docs/recolor-baseline.json` — PASS.
- `npm run build:desktop` — PASS, release arm64 Tauri .app (10.60 MiB), locked
  Cargo build. Copied outside the repository and launched with no Vite listener.
  Native WKWebView at tauri://localhost showed Canvas ready. Created Grass,
  inspected the new Edit explanation, recolored #335c46 to #557755, and observed
  the same ID/name with synchronized swatch/hex/RGB. Undo/redo restored both
  shades. Native window zoom resized the window from 2400x1600 to 3024x1888
  device pixels with the canvas ready. After Cmd+W, the next app observation
  showed a fresh default map and Canvas ready. Networking was not disabled.
- Inspected the actual Edit-dialog screenshot and populated heartland overview.
  Local documentation audit — PASS, 41 relative links/anchors. Both retained
  benchmark reports match current source SHA-256 fingerprints and preserve
  complete stored-value fingerprints. `git diff --check` — PASS. `wrk validate` — PASS (57 tickets).

Final populated recolor measurements (Chromium WebGL2/Vite development,
1024x640 CSS canvas, DPR 2; median of three samples per operation/mode/fixture):

| Fixture | Occupied layer cells | Detail recolor incl. render | Fit synchronous recolor | Fit recolor ready | Fit undo ready | Fit redo ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frontier-v1 | 6,620,700 | 1.0 ms | 0.5 ms | 1,375.2 ms | 1,367.4 ms | 1,387.0 ms |
| heartland-v1 | 24,025,200 | 1.2 ms | 0.4 ms | 2,716.7 ms | 2,740.7 ms | 2,769.3 ms |

Each fixture runs three recolor/undo/redo cycles in detail and three at Fit.
All 36 operations pass independent sampled-pixel checks. Every renderer query
is bounded (at most 256 columns and 32 rows); Fit command propagation makes
zero synchronous tile queries. The model-only test forbids all tile query/write
seams. Full stored-run hashes and occupancy are checked outside timing.

Limitations and decisions: the prerequisite supplied the necessary command and
renderer logic; no algorithm rewrite or scope change was needed. Conservative
all-overview invalidation and progressive refresh remain the accepted baseline.
Old images can remain while the existing Refreshing map/aria-busy indicator is
active; each image swaps atomically and settled views contain no stale colors.
The measured 1.4–2.8 second Fit refresh is a rendering limitation for TW-049,
not a feature blocker under AGENTS.md. Native presented-frame latency and physical
memory are not measured here and no performance budget pass is claimed.
TW-050 retains large edit/history/memory refinement. The pre-existing Vite
>500 kB bundle warning also remains TW-049. No validation failure required a fix.

Logs, native observations, focused-run evidence and screenshots are under ignored
`.wrk-runs/wrk-8110dbc9-validation/` and `test-results/`; the actual final benchmark
reports are retained in the tracked `docs/recolor-baseline.json`.

All four acceptance criteria are met. The original ticket requirements are
preserved above with acceptance boxes checked. The initially unstaged
`.wrk/wrk-58cdb442.md` is byte-for-byte unchanged and excluded from this ticket's
commit; the initial index was empty. The completion commit includes only TW-017
implementation, regression coverage, documentation, measured evidence and this
WRK update, with wrk-8110dbc9 in its message.
