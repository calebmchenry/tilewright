---
id: wrk-ebb7c04f
title: 'TW-028: Verify selection invariants and large multi-layer operations'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-286859eb
priority: normal
labels:
  - v1
  - selection
  - verification
fields:
  sequence: 28
  source: INTENT.md
---
## Outcome

Close correctness and responsiveness gaps across the complete rearrangement workflow.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Map size and navigation; INTENT.md — First-version success criteria.

**Execution order:** 28 of 54. Phase: selection.

**Prerequisite:** [wrk-286859eb](wrk-286859eb.md) — TW-027: Implement 90-degree rotation and horizontal/vertical flips.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Add integration/property-based cases that compose selection, move, cut/paste, rotation, flip, and undo/redo.
- Exercise populated selections crossing chunk boundaries and spanning multiple overlapping layers.
- Profile snapshot, preview, commit, and history memory for representative large selections; fix observed defects.

## Acceptance criteria

- [x] A sequence followed by undo returns the exact original document, including overwritten content, registry identities, and unrelated layers.
- [x] Destination-hole preservation and same-layer overwrite behavior remain correct after composed transforms.
- [ ] Large gestures meet the documented responsiveness/memory budgets or use explicit responsive progress/cancellation.
  **Original gate deferred:** AGENTS.md and INTENT.md (2026-11-18) explicitly allow
  completion with measured limitations recorded for TW-049/TW-050. The original
  numerical gate is preserved here as unpassed; it is not a remaining requirement
  for this ticket under the current delivery scope. See the acceptance audit below.
- [x] The 8 by 8 house / three-tile move scenario has repeatable evidence for single-layer and chosen-multi-layer variants.

## Validation

- Run deterministic generated operation sequences with fixed seeds and cell-by-cell equality assertions.
- Record large-selection measurements and perform a desktop interaction smoke test.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-029: Decide named-area geometry, label placement, and zoom thresholds](wrk-353fa9ca.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in-session, using WRK instead of a sprint ledger.
Prerequisite wrk-286859eb is done. Read sprint-execute, AGENTS.md, INTENT.md,
README, ticket runner, foundation/desktop/model/history/selection/performance
contracts and the existing implementation/tests. Weather report fetched:
gpt-6-astra for CS/Math, opus-5.5 for frontend architecture; no delegation.
Node 24.22.3 is available. Existing commit style uses scoped feat/test descriptions.
Index initially empty; unrelated `.wrk/wrk-58cdb442.md` is snapshotted under
`.wrk-runs/wrk-ebb7c04f-validation/` and excluded from this ticket.

Phase checklist:
- [x] Add fixed-seed composed selection workflows with independent cell oracles.
- [x] Add repeatable single/multi-layer house integration and large-operation profiling.
- [x] Run full validation and native desktop interaction smoke; audit acceptance.
- [x] Record implementation, decisions and actual validation results.
- Finalization: mark done under the current delivery scope and create the required scoped commit before reporting completion.

Acceptance interpretation: AGENTS.md and INTENT.md's current delivery priority
supersede the original performance gate. Measure and report synchronous pauses
and memory limitations for TW-049/TW-050; do not claim a budget pass or block this
verification ticket solely on performance. Functional correctness remains required.

## Implementation and evidence — 2026-11-18

- `tests/domain/selection-workflow.test.ts`: 12 fixed-seed workflows (seeds 1,
  42, 0x1a2b3c4d, 0x5e6f7081, 0xdeadbeef, 0xffffffff; origins -72 and 52), each
  with 36 generated steps, changing included layers, moves, all four transforms,
  copy/cut, transformed paste and original-clipboard repeated placement. Independent
  dense transpose/reverse/compositing oracles compare every cell on four overlapping
  layers after every commit and each interleaved/full undo/redo. Original metadata
  (bounds, layer IDs/order/names, registry and named areas) remains exact. Holes,
  raw alpha-zero and raw paint matching a named color retain their distinct values.
  Stale captures reject; four-turn no-ops preserve redo/version/save/recovery state.
  An additional 512x384 two-layer composed transform exceeds a real 4 KiB history
  cap and restores all runs, metadata, version/checkpoints and the prior redo branch,
  with zero publication events. Focused run: 13 passed, zero skipped/failed.
- `tests/selection-workflow.spec.ts`: four shipping-control Chromium/WebGL tests,
  both DPR 1/2 and active-Walls/chosen-Walls+Furniture. Reverse 8x8 house selection
  at [60,68)^2 crosses both chunk axes, then one drag moves by exactly (3,0).
  Every map cell matches an independent move oracle, including 24 overwritten walls
  and same-layer furniture-hole preservation. Change membership, Cut, composed
  clockwise/horizontal/vertical Paste, Copy/repeated counterclockwise Paste, then
  live Flip+arrow positioning. Each of five history states compares exactly through
  full undo/redo; terrain/registry/layer metadata/annotations remain unchanged.
  Focused run: 4 passed (14.8s). Inspected single/chosen-layer preview screenshots
  and restored original screenshot: furniture stays behind for Walls-only, moves
  together for chosen scope, and overwritten gray walls return after Undo.
- `scripts/selection-baseline.ts`, `package.json` (`perf:selection`) and
  `docs/selection-baseline.json`: repeatable profile on complete golden-verified
  frontier-v1 (6,620,700 occupied cells) and heartland-v1 (24,025,200), bounds 6400x6400,
  plus two overlapping populated edit layers with holes/registered/raw/alpha-zero.
  Two fresh processes per background and size (eight trials). Selection sizes
  512x384 and 1024x768 contain 294,912 and 1,179,648 occupied layer cells.
  CW+horizontal transform and offset (3,5) compose in one atomic operation.
  Independent per-cell formulas plus full-layer counts exclude stray writes;
  entire-background and undo/redo document hashes match; CPU preview pixels and
  occupied counts match committed rasters across all six visible layers. Repeated
  passes agree on hashes, occupancies and history accounting. Preserved occupied
  destination holes: 73,728 / 294,912; distinct overwritten cells: 147,456 / 589,824.
  Twenty reset house move/undo/redo cycles run separately for each inclusion scope.
- `docs/selection-decisions.md` TW-028 section, `docs/performance.md`, README:
  reproducible checks, measurement boundaries/results, native scope and deferred
  budgets. No product behavior, runtime dependency or persistence schema change.
  No functional defect was found. Fixed test-only recursive Playwright typing
  and a benchmark block-scope edit before final validation.

Measured CPU timing ranges (ms, all four trials per size):

| Selection | Snapshot | Transform | Plan | Preview raster | Commit | Undo | Redo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 512x384, two layers | 4.03–4.12 | 39.24–46.45 | 3.45–3.61 | 10.88–11.90 | 55.02–60.30 | 41.97–45.39 | 34.22–38.75 |
| 1024x768, two layers | 12.75–12.97 | 177.93–200.97 | 8.16–9.05 | 32.39–35.45 | 177.63–180.20 | 131.95–137.69 | 137.10–143.63 |

Accounted history: 9.24 / 35.77 MiB; eviction releases approximately 1.89 / 7.30–7.53
MiB of post-GC heap+buffers. Larger selection snapshot delta 2.43 MiB; plan delta 5.99
MiB. Whole-process high-water RSS 290–506 MiB includes loading/verification. Node
heap deltas are affected by GC/JIT and are not physical memory or transient peaks.
Raw per-stage memory/time, machine identity and source SHA-256s are in the report.
House commit/undo/redo CPU p95 (20 samples): Walls 0.097/0.110/0.094 ms;
Walls+Furniture 0.132/0.077/0.063 ms. No native performance pass is implied.

Native release smoke: `npm run build:desktop` PASS (locked arm64 bundle 10.61 MiB).
An isolated copy with distinct bundle identity launched tauri://localhost,
Canvas ready, 1200x800 logical window at DPR 2. Painted (2,2), selected 1x1, native
Cmd+X/Cmd+V then three Right keys placed the preview at (5,2). Rotate clockwise,
Flip horizontal, Flip vertical and Apply paste succeeded, then a native Right
nudged to (6,2). Three Cmd+Z restored the original visible (2,2) with Undo Pencil /
Redo Cut; three Cmd+Shift+Z restored (6,2) with Undo Nudge selection / Redo disabled.
Cmd+W exited only the validation copy. Native automated drag did not produce a
larger rectangle; native evidence is explicitly one-cell, while browser/domain
checks cover 8x8 and large multilayer cases. Vite was active for independent tests,
but release assets were embedded; networking/power/refresh settings unchanged.
See ignored `.wrk-runs/wrk-ebb7c04f-validation/native-smoke.txt` for the record.

Acceptance audit:
1. PASS: every generated state and complete inverse/replay restores exact cells,
   overwritten content, raw-vs-registered identities and unrelated layers/metadata.
2. PASS: independent oracles verify hole preservation and occupied overwrites after
   composed live/paste transforms, including populated cross-chunk large selections.
3. ORIGINAL PERFORMANCE GATE DEFERRED by AGENTS.md/INTENT.md 2026-11-18 decision.
   Large transform/commit still synchronous, with measured >50 ms tasks; no explicit
   progress/cancellation added. Native presentation, whole-app physical memory,
   large-edit 20-cycle growth and percentile gates are not measured/passed here.
   Record for TW-049 rendering/presentation and TW-050 selection/history/memory;
   this is accepted verification evidence under the working-baseline scope.
4. PASS: reproducible single/chosen-layer 8x8 three-tile browser cases at both DPRs,
   per-cell oracles, exact full Undo/ Redo and 20 reset domain cycles per scope.

Phase 1 validation: build, 197 domain tests, 95 Chromium tests (4.6m), format PASS.
Phase 2 build/profile/focused tests PASS. Final full-suite audit PASS: 198 domain tests and 99 Chromium/WebGL tests (4.6 minutes).
Machine: MacBookPro18,3 / Apple M1 Pro / 16 GiB, macOS 15.8.1 (24H32), Node 24.22.3.
Logs and local smoke app are ignored under `.wrk-runs/wrk-ebb7c04f-validation/`;
browser screenshots are under `test-results/`. Baseline JSON is tracked.

## Final validation and completion — 2026-11-18

- `npm run build`: PASS, both strict TypeScript configurations and production Vite.
- `npm test`: PASS, 198 domain tests and 99 Chromium/WebGL tests, zero failures,
  skips or cancellations; includes all 13 new domain and four new browser tests.
- `npm run format:check`: PASS, Prettier and Rust formatting.
- `npm run build:desktop`: PASS, locked arm64 release; no production-source changes
  followed that build. Native release interaction smoke PASS within the recorded
  one-cell scope; full house and large multilayer correctness is automated evidence.
- `npm run perf:selection -- --output docs/selection-baseline.json`: PASS, all eight
  large trials and 40 house reset cycles. Every recorded source SHA-256 matches
  current inputs. Large-operation budget overruns and missing native measurements
  are explicitly deferred per current AGENTS.md/INTENT.md, not claimed as passed.
- `git diff --check`: PASS. `wrk validate`: PASS (57 tickets).
- Unrelated `.wrk/wrk-58cdb442.md` remains byte-identical to the initial snapshot.
  Index was empty. Commit scope is this ticket, README, the two existing selection/
  performance docs, new baseline JSON/harness, package script and two new test files.

All required work under the current working-baseline scope is complete. The original
performance gate remains visibly unpassed and deferred, as authorized; there is no
functional blocker. Marking done is followed by the requested scoped Git commit;
completion is reported only after the commit exists. No push or next-ticket work.
