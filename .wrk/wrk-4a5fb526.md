---
id: wrk-4a5fb526
title: 'TW-005: Add transactional commands, undo/redo, and saved-revision tracking'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-4d23646a
priority: high
labels:
  - v1
  - foundation
  - implementation
fields:
  sequence: 5
  source: INTENT.md
---
## Outcome

Make user edits reversible and distinguish the current document from the last explicit save.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — Local operation; INTENT.md — First-version success criteria.

**Execution order:** 05 of 54. Phase: foundation.

**Prerequisite:** [wrk-4d23646a](wrk-4d23646a.md) — TW-004: Implement the sparse, layered TypeScript map document.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement document commands with atomic commit, cancellation, inverse data, and bounded history suitable for large sparse edits.
- Support grouped gestures and commands affecting tiles, layers, registry entries, annotations, and bounds.
- Track document revision and explicit-save checkpoints independently of recovery snapshots.

## Acceptance criteria

- [x] One completed user gesture is one undo step; canceled/no-op actions create no history entry.
- [x] Undo and redo restore overwritten data and all affected layers, not just the final visible composite.
- [x] New edits after undo invalidate the redo branch; dirty state follows the saved checkpoint correctly.
- [x] History limits and memory behavior are documented; large transactions avoid whole-document copies when practical.

## Validation

- Test grouped edits, cancellation, branch replacement, saved/dirty transitions, and inverse restoration over overlapping cells.
- Measure memory for a large sparse edit and verify renderer notifications identify changed content.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-006: Build the editor shell and isolate document state from React UI state](wrk-fbc58697.md).


## Execution plan — 2026-11-18

Strategy A, executed in this session; WRK replaces the sprint ledger. TW-004 is
done. Read AGENTS.md, INTENT.md, README.md, ticket runner and its script,
foundation decisions, sparse model, desktop development, and performance guidance.
Weather report fetched (gpt-6-astra for CS/Math, Opus 5.5 for frontend); no delegated
execution. No commits required; the repository has no initial commit and existing
files are untracked. Use the pinned Node 24.22.3 rather than the shell's Node 22.

- [x] Phase 1: atomic domain transactions, staged/cancelable gestures, inverse
  restoration, bounded undo/redo, revisions/save checkpoints, regression tests;
  validate build, full tests, and formatting.
- [x] Phase 2: reproducible large sparse transaction memory/notification
  measurement, documented API/limits/decisions; validate measurement and checks.
- [x] Phase 3: acceptance audit, final full validation, actual evidence and
  implementation locations recorded here before marking done.


Phase 1 validation: `npm run build` passed both strict TypeScript configurations
and Vite (771 modules); `npm test` passed 38 domain tests and 3 real-WebGL UI tests;
`npm run format:check` passed Prettier and cargo fmt. Added transactions, run-based
inverse history, staged gestures, immutable metadata seams, save/recovery revision
tokens, and tests including an 8x8 two-layer move, overlapping-run oracle checks,
net no-ops, rollback, byte/count limits, and disjoint safe-integer bounds replay.
Two initial TypeScript errors were fixed before validation. Registry/annotation
records are opaque JSON payloads; feature schema/UX remains with its later tickets.


## Completed implementation and validation — 2026-11-18

All three phases and all four acceptance criteria are complete. The original
outcome, scope, work, validation and next-step text remain above; checkboxes are
checked and this evidence is appended. No separate sprint ledger was created.

### Implementation and decision locations

- `src/domain/commands.ts`: immutable discriminated commands for tiles, layer
  creation/removal/name/order, bounds, registry records and annotation records;
  finite JSON metadata validation/copying; endpoint-sweep compaction of sequential
  overlapping deltas to earliest-before/final-after; safe canonical patch replay.
- `src/domain/document.ts`: synchronous atomic command batches; unpublished
  primitive journal and reverse rollback; net transaction notifications; sparse
  removed-layer inverse capture; stable registry/annotation record storage and
  immutable deterministic reads. Existing low-level loading APIs remain available.
- `src/domain/history.ts`: staged/cancelable gestures, one commit per undo step,
  fresh branch revisions, undo/redo, entry/byte budgets, atomic oversized-entry
  rejection, observer-error isolation, stale gesture and external mutation guards,
  explicit-save and independent recovery checkpoints using per-controller tokens.
- `tests/domain/history.test.ts`: 14 added regression tests covering all acceptance
  behaviors, including independent per-cell oracle checks for 80 transactions of
  30 overlapping writes and an 8x8 multilayer house move by three tiles.
- `scripts/history-baseline.ts`: reproducible fresh-process memory/timing harness
  with fully populated background validation, notification/inverse checking,
  complete edited-layer readback, unchanged-background hashes and history eviction.
- `package.json`: `npm run perf:history`, and formatting of the new API document.
  No dependency or lockfile changes.
- [Command history API and decisions](../docs/command-history.md): ownership,
  transactions, cancellation, patch/notification contracts, save/recovery handling,
  budget accounting, complexity, measurement method and integration boundaries.
- [Actual history baseline](../docs/history-baseline.json): all four raw samples,
  machine metadata, memory snapshots, storage counts, notification coverage,
  exact history accounting, and 14 current source fingerprints.
- `README.md`, [sparse model](../docs/map-document.md), and
  [testing/performance](../docs/performance.md): discoverability and updated seams.

### Acceptance evidence

1. **One gesture / no-op / cancellation:** commands can be appended across input
   events without changing persistent content. Commit produces one revision,
   history entry and document event. Cancel releases the staged inputs; canceled,
   empty, and net-no-op gestures produce no entries/events and preserve redo.
   Paint-then-erase, rename-back, metadata removal and identical layer replacement
   are tested. Invalid late commands, throwing/reentrant generators and oversize
   history entries restore content/version without publishing intermediate state.
2. **Complete inverse restoration:** tests compare full before/after documents
   through undo and redo for overlapping cells on separate layers, overwritten
   destinations, removed/replaced layers, layer order/names, registry entries,
   annotations and bounds. The 8x8 house move crosses visual/storage boundaries,
   restores overwritten destinations, and leaves terrain/annotations fixed.
   Chronological rollback and canonical patch replay also support disjoint
   safe-integer bounds whose union would overflow.
3. **Branches and saved state:** a new edit after undo discards redo and receives
   a never-reused revision. Tests cover initially new/loaded documents, save
   acknowledgement after intervening edits, undo/redo across the saved checkpoint,
   history pruning, an abandoned saved branch, and forged/foreign checkpoint
   rejection. Recovery acknowledgement never marks the explicit project saved.
4. **Bounded history / sparse memory:** defaults are 100 entries and 64 MiB of
   deterministic accounted history across undo+redo. Oldest complete entries are
   evicted; individually oversized transactions are rejected atomically, never
   silently committed without undo. Changed runs and affected metadata are retained,
   not whole-map tile copies. Actual memory stays about 17.8 MiB for the same
   large sparse edit with empty or 24-million-cell background (measurements below).

Renderer notification checks cover exact net layer/world spans, overwritten
before/after values, bounds and layer structural snapshots, registry IDs requiring
all-associated-layer invalidation, and annotation IDs. Undo/redo use the same event
route. Every large-edit event contains exactly 79,600 four-cell net runs for
318,400 cells on the two affected layers; commit, undo and redo each notify once.
Registry changes preserve cell associations and notify without rewriting tiles.
Observer failures are returned after a committed change and do not prevent other
listeners from seeing coherent document/history state.

### Actual final validation

Machine: **TW-M1Pro-16**, MacBookPro18,3 / Apple M1 Pro, 8 CPU cores, 16 GiB RAM,
arm64 macOS **15.8.1 (24H32)**, pinned Node **24.22.3** selected via `nvm use`.
No global Node setting was changed.

- `npm run build`: exit 0; both strict TypeScript configurations passed, including
  the no-DOM domain configuration; Vite built **771 modules**. The unchanged UI
  main asset remains `index-DVsIN_X8.js`, 618.62 kB / 184.13 kB gzip.
- `npm test`: exit 0; **38 domain tests passed**, zero failed/skipped, **2776.013 ms**;
  **3 real-WebGL UI tests passed in 5.0 s**. Both complete representative models
  still match their existing golden content. Expected unavailable-WebGL logging
  is followed by a passing retry test.
- `npm run format:check`: exit 0; configured Prettier and `cargo fmt --check` passed.
- `npm run perf:history -- --output docs/history-baseline.json`: exit 0; all four
  fresh-process samples passed complete notification/inverse/readback/background
  checks. The populated background matched golden data before measurement and
  its full model content hash and per-layer storage counts remained unchanged.
- Python audit: **14/14 source hashes** match current files; **11 changed
  implementation/document/report files** have final newlines, no trailing
  whitespace or developer-specific paths; local documentation links resolve;
  domain code imports no React/Pixi/DOM/native/Node dependency. This audit explicitly
  includes untracked files, which `git diff --check` alone cannot inspect.
- `git diff --check`: exit 0. `wrk validate`: exit 0, **Valid project: 56 tickets**.
  Existing Vite large-bundle and Playwright color-environment advisories remain
  non-failing. No warnings were suppressed.

### Actual large sparse edit measurements

Each process loads a 6,400x6,400 document with four background layers, then seeds
two edit layers with 160,000 cells. One transaction changes **318,400 cells** in
40,000 input runs throughout the map, including the overwritten cells and spans
crossing 32/64-tile boundaries. The last span is clipped by fixture construction.
The populated background contains **24,025,200 occupied layer cells**.

| Background / sample | Commit ms | Undo ms | Redo ms | Retained heap + buffers delta MiB | MiB released by history eviction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty / 1 | 139.524 | 117.549 | 117.687 | 17.8835 | 6.1318 |
| Empty / 2 | 151.597 | 115.679 | 119.533 | 17.8843 | 6.0975 |
| Heartland / 1 | 130.221 | 122.503 | 117.073 | 17.8315 | 6.0853 |
| Heartland / 2 | 142.671 | 121.056 | 119.639 | 17.8331 | 6.0859 |

All four large entries account for **29,329,292 bytes**. With the measured
`maxEntries=1` setting, a subsequent tiny edit evicts that entry and leaves only
**648 accounted bytes** while the edited tile content remains. Process high-water
RSS was **333.25 / 333.14 MiB** for empty and **467.97 / 457.92 MiB** for heartland;
these are whole-process measurements, including background/model/runtime/validation.

Timing includes command generation/copying, storage, inverse capture, compaction,
history accounting and the validating notification listener. Post-GC
`heapUsed + arrayBuffers` deltas include changed storage/history and runtime/JIT;
external memory already includes ArrayBuffers and is not added again. GC and full
content readbacks/hashes are outside timers. Eviction releases history references;
actual physical memory and transient heap peak are not established by these
snapshots. Two samples are baseline evidence, not percentile gates. No rendered
frame, desktop app memory, native save/recovery or packaged-app performance claim
is made for this domain-only ticket.

### Decisions and handoff

No acceptance requirement is deferred. Implementation choices left open by the
intent are documented: staged previews/atomic synchronous commits; net run-based
patches; 100-entry/64-MiB accounting defaults; oversized transaction rejection;
new documents initially dirty; controller-specific save tokens; recovery tracked
separately; opaque immutable JSON metadata payloads. Feature tickets own registry
collision/reference rules and annotation geometry/tier schemas. Existing opaque
record commands provide their transactional history seam without choosing those
later feature policies.

The retained-history budget does not cap staging, temporary journals, compaction,
accounting serialization or subscriber-retained events. Process OOM is not
recoverable. Long-running tool computation, actual renderer/cache integration,
file snapshot encoding and serialized native write coordination remain their
existing tickets. The checkpoint token itself is not a content snapshot.

No other ticket, INTENT.md, UI/renderer, Rust source, fixture recipe, golden fixture,
or historical TW-003/TW-004 baseline was changed. No commits were created. No
blockers or unfinished criteria remain; the outer runner may select the successor.
