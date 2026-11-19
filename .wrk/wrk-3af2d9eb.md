---
id: wrk-3af2d9eb
title: 'TW-022: Implement bounded, responsive flood fill'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-d37ece28
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 22
  source: INTENT.md
---
## Outcome

Fill connected regions without freezing the editor or crossing unintended layer boundaries.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Map size and navigation.

**Execution order:** 22 of 54. Phase: painting.

**Prerequisite:** [wrk-d37ece28](wrk-d37ece28.md) — TW-021: Implement straight lines and filled/outlined rectangles.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose and document connectivity and equality rules for empty, raw-color, and registered cells.
- Implement fill on the active layer across storage boundaries with an efficient worklist/batching strategy.
- Provide responsive progress/cancellation for large fills and atomic commit/history semantics.

## Acceptance criteria

- [x] Enclosed regions, edge-connected regions, empty backgrounds, and registered colors fill according to the stated equality rule.
- [x] Fill never escapes fixed bounds, changes other layers, or implicitly merges registry meanings.
- [x] Large operations keep UI/navigation feedback responsive and can be canceled without partial document changes.
- [x] No-op fill adds no history; successful fill is one undo step restoring all prior content.

## Validation

- Test enclosed/open regions, boundary crossing, identical replacement, cancellation, and undo/redo.
- Measure a large contiguous fill and cancellation on the populated target-scale fixture.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-023: Define selection, clipboard, transform, and out-of-bounds semantics](wrk-7cd74024.md).

## Execution progress — 2026-11-18

Strategy A selected by the user; executing in this session, using WRK instead of
a sprint ledger. Prerequisite wrk-d37ece28 is done. Read sprint-execute, AGENTS.md,
INTENT.md, README and referenced development, model, history, drawing, navigation,
layer/color/registry and performance guidance. Weather report fetched (gpt-6-astra
leads CS/Math); no delegation or model switch.

Phase checklist:
- [x] Bounded four-neighbor fill, identity equality, isolated staging and domain tests.
- [x] Shipping Fill control, progress/cancellation and canvas integration tests.
- [x] Full validation, populated target-scale measurements, acceptance audit and commit.

Initial unrelated work: unstaged `.wrk/wrk-58cdb442.md`; index empty. Preserve it.

Phase 1 passed: production build, formatting, 120 domain tests and all 71 browser
regressions (3.6 minutes). An initial test-only TypeScript union narrowing error
was fixed before passing builds. Core fill adds 7 domain cases, including all
4,608 seeds/layouts of binary 3x3 maps checked against an independent BFS.

Phase 2 implementation and focused validation passed: build, 8 fill domain tests,
4 shipping Fill UI cases, 5 editor-shell cases, and 2 populated scale cases.
The first pixel assertions compared different focus states; capturing the baseline
with Fill already selected fixed those tests. Initial scale screenshots exposed
count-driven panel movement; a stable numeric slot keeps Cancel in place, and
both reruns passed. Full suite/package validation follows before completion.

## Final implementation and acceptance audit — 2026-11-18

All three phases and all four acceptance criteria are complete. Strategy A stayed
in this session. No separate sprint ledger, subagent, CLI delegation or next-ticket
work was used. The original requirements and validation instructions are retained
above. Implementation decisions follow INTENT.md and the current AGENTS.md scope.

Implementation and decisions:

- `src/domain/fill.ts`: four-neighbor flood fill on one captured layer, with exact
  stored-cell equality (null, canonical raw RGBA including alpha, or registry ID).
  Raw and registered paint of the same displayed shade remain separate regions;
  different registry IDs never merge. Replacement retains the selected raw value
  or registry identity. Fixed half-open bounds stop traversal, including negative
  coordinates; neither storage partitions nor visual chunks stop connectivity.
- Discovery uses a nonrecursive scanline worklist, at most 513 cells per segment,
  sparse 32x32 visited bitsets, and scheduling checkpoints for skipped seeds.
  It never builds a per-cell object queue or a dense whole-map visited matrix.
- `src/domain/document.ts` and `src/domain/storage.ts`: cancelable preparation on
  isolated copy-on-write storage. Palette accounting and partition indexes are
  copied; only touched tile partitions are cloned. Bounded writes yield to timer
  tasks after approximately 8 ms, checking cancellation and source version on
  resumption. The final yield provides a cancellation opportunity before commit.
  Live storage, version, notifications and history remain unchanged throughout
  preparation. Stale, foreign, forged and consumed plans reject.
- `src/domain/history.ts`: `executePrepared` reuses normal history limits and
  accounting, accepting the immutable net patch before storage-root publication.
  Success emits one transaction and one Fill undo step; undo restores every prior
  value, including emptiness. Capacity rejection publishes nothing. No-op fill
  preserves redo and saved/recovery checkpoints. Observer errors are reported as
  view failures after a successful commit, not a reason to retry the edit.
- `src/editor/fill.ts`, `session.ts`, `navigation.ts`, `src/App.tsx`,
  `src/MapCanvas.tsx`, `src/styles.css`: shipping Fill button and G shortcut;
  single primary click starts fill with captured paint and layer. Ready/detail/
  visible-active-layer gates apply. Nonmodal progress and a stable Cancel button
  remain usable during pan, zoom, resize and temporary navigation. Escape cancels
  from the canvas or Cancel button. Editing context changes, document mutations,
  canvas unavailability, unmount and session disposal discard pending work.
  A second fill cannot overlap the current job. No transient paint is published.
- `docs/drawing-gestures.md#flood-fill-tw-022` documents geometry, identity,
  interaction, staging and performance limits; `docs/command-history.md` records
  the prepared-edit contract. README links the feature. `docs/fill-baseline.json`
  retains actual measurements, environment, complete per-layer hashes, original
  fixture occupancy, raw progress/timer samples and exact implementation hashes.

Acceptance evidence:

1. `tests/domain/fill.test.ts` contains eight cases. An independent per-cell BFS
   checks enclosed/open/edge/empty/raw/registered regions and signed partition
   crossing. Every seed in all 512 binary 3x3 layouts (4,608 combinations) checks
   exact connectivity, including corner contact and disconnected islands. Raw
   alpha, equal-looking raw/registered cells and distinct registered identities
   remain distinct. Long 1,301-cell rows join across work batches exactly.
2. Exact whole-document run snapshots verify single-layer changes, preserved
   underlying content, fixed bounds and undo/redo. Tests cover stale work after
   edits/undo, malformed late writes, foreign/forged/reused plans, byte-budget
   rejection, palette reuse, overlapping prepared writes and observer errors.
   Complete populated scale hashes preserve all upper layers, metadata and bounds;
   cancellation and undo restore all layer content, not only the visible viewport.
3. Cancellation is tested during work and at the final yield, with exact live
   content/storage/version/history/checkpoint/event comparisons. Session tests
   exercise tool/paint/layer/visibility/readiness changes, duplicate starts,
   overview/text/IME gates, navigation and disposal. `tests/fill.spec.ts` uses
   real canvas clicks, G, Escape, Cancel, outside seeds, hidden layers, overview
   and the 640x452 layout. Cancel remains visible and clickable at that size.
   Target-map tests pan while progress is visible and before the document version
   changes; native WKWebView also accepted Right while fill was running.
4. No-op raw/registered/empty fills preserve history and redo. Each effective fill
   has one transaction, one version increment and one undo step. UI tests compare
   exact canvas screenshot bytes before/after undo and redo at DPR 1 and 2 and
   verify registered-to-raw and raw-to-registered replacement without changing
   lower-layer content. Native Fill completed 65,536 cells and exposed Undo Fill;
   Cmd+Z exposed Redo Fill, and Cmd+Shift+Z restored Undo Fill.

Actual validation (MacBookPro18,3 / Apple M1 Pro / 16 GiB / arm64,
macOS 15.8.1 build 24H32, Node 24.22.3, Rust 1.100.0):

- Phase 1: production build and formatting passed; 120 domain tests and 71 browser
  regressions passed. Initial test-only TypeScript narrowing error was corrected.
- Phase 2: 8 fill domain cases, 4 shipping Fill browser cases, 5 editor-shell
  cases and 2 populated scale cases passed. Initial pixel-test focus mismatch and
  count-driven progress-panel movement were resolved as recorded above.
- Final `npm test`: PASS, **121 domain + 77 Chromium/Playwright tests**, zero
  failures, skips or cancellations; browser suite 3.9 minutes.
- Final audit strengthened the scale assertion to require all 1,024 complete
  painted rows, then `npx playwright test tests/fill-scale.spec.ts` passed both
  cases again (8.2 seconds). Final `npm run typecheck`: PASS.
- `npm run format:check`: PASS (Prettier and Rust formatting); new retained JSON
  evidence was also formatted explicitly. `git diff --check`: PASS.
- `npm run build:desktop`: PASS, locked release arm64 Tauri package, 10.61 MiB.
  Its production TypeScript/Vite build passed. The existing >500 kB bundle warning
  remains a TW-049 refinement item.
- Native smoke: copied the ordinary embedded-assets app with `ditto` into a fresh
  temporary directory outside the checkout and opened that exact copy. Observed
  tauri://localhost, Canvas ready, enabled Fill, a completed 256-square fill and
  Undo/Redo Fill controls. Created a 6,400-square map through New map controls;
  started Fill, pressed Right, observed progress at 707,278 cells with changed
  tile readout, clicked Cancel, and saw the original empty map and disabled Undo.
  A second fill was canceled with Escape; window zoom kept Canvas ready and Undo
  disabled. Cmd+W quit (CUA reported App quit). After the full suite ended, `lsof`
  showed no listener on 1420; reopening the same copy again showed Canvas ready
  and enabled Fill at tauri://localhost. Networking was not disabled.
- `wrk validate`: PASS, 57 tickets. Unrelated `.wrk/wrk-58cdb442.md` is byte-for-byte
  unchanged from the initial snapshot (SHA-256
  `372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd`). The index
  was initially empty and stayed empty until scoped staging for this commit.

Populated target-scale measurements:

Both cases load the complete four-layer 6,400x6,400 fixtures: frontier-v1 has
6,620,700 occupied layer cells; heartland-v1 has 24,025,200. The benchmark then
creates a contiguous 1,024x1,024 raw terrain region at [256,1280) squared, retaining
all upper layers and all content elsewhere. Fill replaces exactly **1,048,576**
cells. Complete stored-run hashes are computed outside timed intervals. A canceled
run preserves content, allocation counters, history, checkpoints and notification
count exactly; committed fill is one undo step, and full hashes match after undo
and redo. These are actual populated documents, not just fixture recipes.

Final dedicated run (milliseconds, rounded to one decimal):

| Fixture | Fill completion | Cancel click to completion | rAF callbacks during fill | Max timer gap | Undo | Redo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frontier-v1 | 703.7 | 26.0 | 42 | 49.0 | 42.4 | 37.4 |
| heartland-v1 | 689.8 | 27.7 | 41 | 49.0 | 41.7 | 38.5 |

The earlier focused run and full-suite run are also retained in
`docs/fill-baseline.json`; no slow samples were dropped. Fill duration includes
preparation, history publication and synchronous notification work. rAF counts and
timer gaps are browser responsiveness proxies, not presented-frame measurements.
This is three functional benchmark runs per fixture, not the future 20-repetition
performance gate. Background apps, power and refresh were not controlled.

Limits and follow-up under AGENTS.md:

Snapshot index/palette copying, final patch compaction and history accounting,
undo/redo and renderer notification still have synchronous portions. Very large
fragmented regions or palettes can require more time/transient memory; history
capacity rejection remains atomic. No native populated-fill latency, whole-app
physical-memory budget, or native presented-frame budget is claimed. Large edit/
history/memory refinement remains TW-050 (`wrk-e61b329b`); rendering/presentation
and bundle refinement remain TW-049 (`wrk-6e0d23e5`). Those performance limitations
do not block this functionally validated baseline. No unrelated feature work was
added and neither follow-up ticket was modified.

Detailed logs, initial snapshots, WRK body inputs, copied-app path and selected
screenshots are in ignored `.wrk-runs/wrk-3af2d9eb-validation/`; native observations
are in this session's CUA transcript. The completion commit includes only this
ticket's implementation, tests, documentation/evidence and WRK record, with
wrk-3af2d9eb in its message. Unrelated staged and unstaged work is excluded.
