---
id: wrk-4ccae787
title: 'TW-035: Implement validated project decoding and safe load failures'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-0b0f3b9b
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 35
  source: INTENT.md
---
## Outcome

Reopen project files accurately and reject invalid input without replacing the active document.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation.

**Execution order:** 35 of 54. Phase: projects.

**Prerequisite:** [wrk-0b0f3b9b](wrk-0b0f3b9b.md) — TW-034: Implement deterministic project encoding and snapshot extraction.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement decoding, schema/version checks, reference validation, and reconstruction of stable model identities.
- Validate sizes, coordinates, layer order, registry collisions/references, annotations, and persisted settings.
- Prepare a complete new document before swapping it into the editor; define unsupported-version behavior without inventing nonexistent migrations.

## Acceptance criteria

- [x] Encode/decode round trips preserve all document data, including hidden underlying cells and registry identities after recolor.
- [x] Malformed/truncated files, unsupported versions, invalid bounds, and dangling references produce useful errors.
- [x] A failed load leaves current content, history, saved path, and dirty state intact.
- [x] Large inputs use the sparse representation and avoid unchecked allocation based solely on declared dimensions.

## Validation

- Run round-trip/golden fixture cases and corrupt-file variants for every major schema component.
- Open a full representative document and compare model equality before and after serialization.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-036: Implement native local file dialogs and atomic project reads/writes](wrk-16de7b43.md).

## Execution progress — 2026-11-19

Strategy A (Orchestrated), executed in this session with WRK state instead of a
sprint ledger. Prerequisite wrk-0b0f3b9b is done. Read sprint-execute, AGENTS.md,
ticket-runner, README, INTENT, schema/example and relevant model, history, editor,
registry, annotations, development and performance guidance. Weather report
retrieved: gpt-6-astra for CS/Math and opus-5.5 for frontend architecture; no model
change or delegation under the selected Strategy A. Node v24.22.3 matches the pin.
Build/test/format commands and descriptive commits with ticket IDs are understood.
Initial index is empty; unrelated .wrk/wrk-58cdb442.md is snapshotted and excluded.

Working checklist:
- [x] Phase 1: strict cancellable byte/parser/schema validation and sparse detached
      model reconstruction; golden, round-trip, corrupt-input and capacity tests.
- [x] Phase 2: atomic workspace installation with fresh saved history and restored
      preferences; prove failed/canceled loads preserve all active session state.
- [x] Phase 3: final build/full tests/format, acceptance audit, actual evidence and
      scoped commit including this WRK ticket.

Native dialogs/read/write, Open/Save UI and recovery remain subsequent tickets.
The decoder consumes bytes and the workspace exposes the safe load boundary.

Phase 1 complete:
- src/domain/project-json.ts parses bounded-depth JSON with decoded-key duplicate
  rejection, exact integer spelling/range checks before Number conversion,
  inert object keys and bounded character scheduling checkpoints.
- src/domain/project-decoding.ts owns input bytes before awaiting, rejects BOM /
  invalid UTF-8, validates the entire closed schema, counts all runs/cells before
  storage, and reconstructs metadata and raw/registered paints through the model.
  Population batches are bounded by 256 writes and 16,384 occupied cells.
- src/domain/project-format.ts adds categorized, path-specific decoding errors.
  Unsupported positive versions are diagnosed before applying v1 object rules;
  only version 1 is supported and no migration is invented.
- tests/domain/project-decoding.test.ts: 70 cases including both golden forms,
  recolor/underlying content, every closed object and required field, 58 corrupt
  schema variants, lexical/UTF-8 errors, all capacity boundaries, safe integer
  extremes, sparse 65,536-square maps, cancellation and injected failures.
- npm run build, npm run test:domain (329/329), npm run format:check: PASS.
  Logs: .wrk-runs/wrk-4ccae787/phase1-{build,domain,format}.log.
  Initial TypeScript narrowing and mock-argument errors were fixed before passing.
- Both complete populated maps compare equal via canonical snapshot, ordered model
  metadata and every occupied span through the independent fixture inspector.
  Initial isolated decoder timings: frontier 656.632 ms / 2,340,633 bytes /
  6,620,700 cells; heartland 2374.237 ms / 8,114,369 bytes / 24,025,200 cells.
  Two hidden IDs were persisted. These Node correctness timings use immediate
  scheduling and do not establish native open/presentation or memory budgets.

Phase 2 complete:
- src/editor/workspace.ts adds openProject(bytes, options), preparing a detached
  saved session and exact active/hidden preferences before one publication of
  session/generation/savedPath. Only then is the old session disposed. New Map
  clears savedPath; failed/canceled work never changes it.
- Pending loads reject as superseded after a newer request, workspace replacement
  or closure, content edits/undo, preference changes or changed saved/recovery
  checkpoints. Post-publication observer failures are returned separately from
  successful installation; reentrant replacement is rejected.
- src/editor/session.ts accepts initial saved-history and first-size-fit options.
  A test exposed the missing automatic loaded-map fit; this is now implemented
  once on the first real canvas size, preserving subsequent camera/resize state.
- tests/domain/project-loading.test.ts: 7 passing integration cases. Clean and
  dirty current documents retain content, history/redo, recovery checkpoint,
  saved path, preferences, clipboard, selection and drafts after malformed input,
  capacity errors, cancellation, injected storage/session construction failure or
  scheduling failure. The original redo branch still works afterward.
- Successful loads restore hidden active layers, reset transient state/history,
  and publish once. Concurrency and real-timer cancellation are covered. A complete
  frontier map opens through the workspace with exact model equality, 6,620,700
  cells, all 1,089 areas and zero retained history. Isolated open/equality sample:
  761.749 ms with immediate scheduling; no native I/O/presentation claim.
- README and docs/project-format.md document APIs, failure/version decisions,
  native boundary and memory/performance limits. Native Open/Save/recovery remain
  later tickets; byte input and atomic session installation are implemented here.
- npm run build, npm run test:domain (336/336, 9.476 s), npm run format:check: PASS.
  Logs: .wrk-runs/wrk-4ccae787/phase2-{build,loading,domain,format}.log.
  Corrected test method names before final validation. The existing Vite >500 kB
  bundle warning remains; no performance-only gate is claimed.

## Final acceptance audit and validation evidence

All acceptance criteria are met:
1. Golden and encode/decode round trips preserve complete bounds, ordered layer
   IDs/names and every occupied run, empty holes/empty layers, transparent raw
   paint, full registry/annotation metadata and persisted preferences. Recolor
   tests retain registry IDs on hidden/underlying layers while equal-color raw
   tiles stay raw. Both complete 6,400-square fixtures compare model equality.
2. Malformed/truncated UTF-8/JSON, duplicate keys, unsafe/fractional/exponent
   literals, unsupported versions, unknown/missing fields, invalid sizes/bounds,
   order/overlap, registry collisions/references, annotations and preferences
   reject with useful categorized/path-specific errors. No migration or repair.
3. Workspace integration proves failed/canceled decoding and construction leave
   the exact current session and saved path intact, including clean/dirty state,
   history/redo, recovery checkpoint, preferences, selection, clipboard and drafts.
   Successful publication is atomic; pending stale work cannot overwrite edits.
4. Byte/depth/collection/run/cell ceilings precede population. Sparse empty maximum
   dimensions allocate no tile partitions; actual occupied spans alone populate
   bounded write batches. A separate maximum-span audit loaded 65,536 cells in
   four 16,384-cell batches with 2,048 occupied partitions, zero typed-array bytes,
   exact final-cell content and the adjacent empty row untouched.

Implementation/decision locations:
- src/domain/project-json.ts: lexical safety and bounded parsing checkpoints.
- src/domain/project-decoding.ts: byte handling, full schema/reference/capacity
  validation, cancellable detached reconstruction and domain identity factories.
- src/domain/project-format.ts: decoder error categories/paths, shared policy.
- src/editor/workspace.ts and src/editor/session.ts: atomic load/path publication,
  saved fresh history, restored preferences, concurrent-work guards and first fit.
- tests/domain/project-decoding.test.ts and project-loading.test.ts: 77 new
  regression/integration tests. Existing golden fixtures are unchanged.
- docs/project-format.md and README.md: API contract, decisions and limitations.

Final actual checks (Apple M1 Pro, arm64, 16 GiB RAM, macOS 15.8.1, Node v24.22.3):
- npm test: PASS, 336/336 domain tests (9.727 seconds) and 115/115 Chromium browser
  tests (6.4 minutes), zero failures/skips. Includes existing real-WebGL/scale and
  forced-renderer-failure recovery checks; the latter logs its expected error.
  Log: .wrk-runs/wrk-4ccae787/final-test.log.
- npm run build:desktop: PASS, both TypeScript configurations, Vite production
  build, locked release Rust build and Tilewright.app bundle (10.63 MiB).
  Log: .wrk-runs/wrk-4ccae787/final-desktop.log. Separate phase-2 npm run build
  also passes. The existing Vite >500 kB bundle warning remains.
- npm run format:check: PASS, Prettier including schema fixture and rustfmt.
  Log: .wrk-runs/wrk-4ccae787/final-format.log.
- git diff --check: PASS. README/project-format local links/anchors: 58/58 PASS.
  wrk validate: PASS, 57 tickets. Original ticket requirements preserved, with
  completed acceptance boxes and this appended evidence.
- Independent parser audit: 2,000 fixed-seed (0x35ccae78) valid integer-only JSON
  grammar cases match JSON.parse after normalization, including nested containers,
  escaped control characters and arbitrary UTF-16/Unicode text. Log:
  .wrk-runs/wrk-4ccae787/parser-audit.log. Maximum-span audit log:
  .wrk-runs/wrk-4ccae787/long-span-audit.log.
- Final full-suite Node decoder samples with concurrent package-build activity:
  frontier 1152.559 ms, 2,340,633 bytes, 6,620,700 occupied cells;
  heartland 2459.582 ms, 8,114,369 bytes, 24,025,200 occupied cells.
  Frontier workspace open/equality sample: 1067.638 ms. Metadata and all spans
  compare equal before/after; stable fixture hashes remain
  de4ed786f9a80c42b6ab3939c08990b40484975b2dc77eeea147591bab552617 (frontier) and
  c1e4443944ee8d9576529a88029c3aad854fa33c251e1d91c70adad8f8361d33 (heartland).

Limits and scope: input copy, text/parsed graph and candidate model coexist;
individual string/collection work remains synchronous. No latency, peak physical
memory, native read/Open/first-frame or offline launch claim. These performance
limits stay deferred to TW-050/TW-049 under AGENTS.md. Native dialogs/read/write,
Open/Save UI, unsaved-change prompting and recovery remain subsequent tickets.
No architectural deviation or additional ticket was introduced.

The unrelated .wrk/wrk-58cdb442.md edit is byte-identical to its starting snapshot
and excluded from the scoped commit. No unrelated staged work existed initially;
only this ticket's listed implementation, documentation, tests and WRK update are
included. Work stops after this ticket and its required Git commit.
