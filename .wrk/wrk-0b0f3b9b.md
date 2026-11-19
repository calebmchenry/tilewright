---
id: wrk-0b0f3b9b
title: 'TW-034: Implement deterministic project encoding and snapshot extraction'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-eef53dd9
priority: normal
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 34
  source: INTENT.md
---
## Outcome

Serialize a coherent editable document without losing content or blocking the interface unnecessarily.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Chosen technology.

**Execution order:** 34 of 54. Phase: projects.

**Prerequisite:** [wrk-eef53dd9](wrk-eef53dd9.md) — TW-033: Specify the versioned editable-project schema and persisted settings.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement the chosen project encoder and revision-consistent snapshot boundary in TypeScript.
- Encode sparse ordered layers, registry associations, annotations, dimensions, and chosen editor settings.
- Separate document serialization from native paths/dialogs and avoid exposing transient preview state.

## Acceptance criteria

- [x] Equivalent documents encode deterministically under the chosen schema/ordering conventions.
- [x] Hidden layers, raw colors, empty-vs-occupied distinctions, and full annotation metadata are preserved.
- [x] A snapshot represents one committed document revision even when editing continues during an asynchronous save.
- [x] Preview gestures, transient selection overlays, and nonpersisted UI state are excluded intentionally.

## Validation

- Encode small golden fixtures and a representative large map; verify all expected schema fields.
- Edit during asynchronous snapshot/encoding and confirm the resulting file is a coherent revision.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-035: Implement validated project decoding and safe load failures](wrk-4ccae787.md).

## Execution progress — 2026-11-19

Strategy A (Orchestrated), executed in this session using WRK state. Read the
sprint-execute skill, AGENTS.md, ticket-runner, INTENT, README, project schema and
example, and relevant foundation/model/history/editor/development/performance,
registry/color and annotation guidance and source. Prerequisite wrk-eef53dd9 is
done. Weather report fetched (gpt-6-astra for CS/Math; opus-5.5 for frontend
architecture); Strategy A uses this session, without delegation/model changes.
Node v24.22.3 matches the pin; build, domain/UI tests and format commands are
understood. Commits use descriptive prefixes plus ticket IDs; no additional
commit convention is configured. Initial index is empty. The unrelated
`.wrk/wrk-58cdb442.md` edit is snapshotted and excluded.

Working checklist:
- [x] Phase 1: revision-consistent immutable snapshot, persisted preferences,
      strict metadata validation and resource limits; domain/build/format checks.
- [x] Phase 2: deterministic yielding UTF-8 encoder; small golden and populated
      maps, asynchronous edit coherence, rejection/cancellation and timing checks.
- [x] Phase 3: final build/full tests/format, acceptance audit, evidence and scoped
      commit containing this ticket's implementation and WRK updates.

Implementation choice: synchronous full sparse capture before asynchronous
encoding. Capture never yields or reads preview/UI stores other than active and
hidden layer preferences. Snapshot extraction costs are measured separately;
performance-only overruns remain deferred to TW-050 per AGENTS.md. Native I/O,
Save UI, decoding, recovery and exports remain their existing subsequent tickets.

Phase 1 complete:
- `src/domain/project-format.ts` defines v1 wire types, capacity policy and
  categorized/path-specific errors. `src/domain/project.ts` extracts a deeply
  immutable, validated sparse snapshot plus an external history checkpoint.
- `MapDocument.assertCommittedRead` prevents reads during unpublished mutations;
  `EditorSession.captureProjectSnapshot` captures just active/hidden preferences.
- `tests/fixtures/project.ts` constructs the reviewed schema example for tests;
  `tests/domain/project-snapshot.test.ts` checks all fields, deep immutability,
  subsequent metadata/layer/tile/preference changes, stale-save dirty state,
  preview/draft exclusion, closed sessions and reentrant/bypassed-history rejection.
- `npm run build`: PASS after fixing two initial TypeScript issues (literal limit
  inference and test command's `ids` property). Existing >500 kB bundle warning.
- `npm run test:domain`: PASS, 245 tests, zero failures, 5.193 seconds.
- `npm run format:check`: PASS (Prettier and rustfmt); added code was formatted.

Phase 2 complete:
- `encodeProjectSnapshot` in `src/domain/project.ts` emits sorted-key canonical
  UTF-8 JSON with one LF, rebuilding paint indices without storage tokens. It
  yields to timer tasks between bounded character batches, preserves ECMAScript
  escaping across surrogate-pair boundaries, enforces exact UTF-8 byte limits,
  supports cancellation, and performs no native I/O/checkpoint acknowledgement.
- `tests/domain/project-encoding.test.ts`, `tests/fixtures/project.ts` and the
  independently canonicalized `tests/fixtures/project-v1.canonical.tilewright`
  verify golden bytes, reverse insertion/segmentation/token order, sparse versus
  dense storage history, unused-paint removal, identity ordering, all-hidden
  preferences, Unicode/whitespace, safe integer extremes and an empty 65,536-square
  map with zero partitions/typed-array bytes.
- Checks include unknown/missing nested metadata, invalid area fields, registry
  collisions/dangling IDs, bounds/preference errors, every collection/run/cell
  capacity at its inclusive fixture boundary and one below it, exact UTF-8 bytes
  including LF, cancellation before/partway through work, scheduler failure and
  forged snapshot rejection. No live content/history/checkpoint is changed.
- Async tests apply tiles, growth, layer removal/rename, registry recoloring,
  annotation deletion, undo/redo and preference changes while encoding yields.
  Captured bytes remain identical to the original snapshot. Acknowledging its
  checkpoint leaves newer content dirty. A real timer edits during default
  scheduling too. Drawing, selection/move/transform/paste, clipboard, area drafts,
  camera/tool/focus state are excluded without applying/canceling them.
- Both complete 6,400 x 6,400 fixtures preserve four layers, five registry records,
  1,089 areas (all fields compared), six typed paints and hidden/active preferences.
  Every run read from emitted JSON is checked by the independent golden oracle:
  frontier 6,620,700 occupied layer cells, hash
  de4ed786f9a80c42b6ab3939c08990b40484975b2dc77eeea147591bab552617;
  heartland 24,025,200, hash
  c1e4443944ee8d9576529a88029c3aad854fa33c251e1d91c70adad8f8361d33.
- Canonical sizes: frontier 123,870 runs / 2,340,632 bytes; heartland 470,490 runs /
  8,114,368 bytes. Initial project-suite samples (Node v24.22.3 with concurrent
  build activity): extraction 106.3805 / 274.2254 ms; encoding 171.4625 / 839.3987 ms
  for frontier / heartland. These are single correctness-run samples, not native
  save, percentile, presentation or peak-memory measurements. Synchronous capture
  and transient snapshot/chunks/final-buffer memory remain TW-050 limitations;
  presentation remains TW-049. No performance gate is claimed.
- Phase-2 build PASS after correcting TypeScript contextual inference in test
  command arrays. `npm run test:domain`: PASS, 259 tests (6.173 seconds).
  `npm run format:check`: PASS. Strengthened cancellation/nested-metadata/capacity
  checks then passed the focused 18-test project suite (3.401 seconds), and build.
- API, decisions, evidence and limitations are documented in
  `docs/project-format.md#snapshot-and-encoder-implementation-tw-034`, linked from
  README, `docs/editor-shell.md` and `docs/map-document.md`.

Phase 3 in progress: final `npm test` (domain + all 115 Chromium UI tests), build,
format, diff/link checks and acceptance audit. The initial full build/format
checks pass; do not mark done or report success until validation and commit finish.

## Final validation and acceptance audit — 2026-11-19

All three phases and all four acceptance criteria are complete:
1. Determinism: exact golden bytes, independently constructed equivalent documents,
   reverse first-use/storage token order, run segmentation, sparse/dense history,
   undo, ASCII key/identity order, integer normalization and Unicode escaping pass.
2. Lossless content: complete mixed fixture plus every run of both populated maps
   matches expected fields/independent hashes. Hidden and covered layers, empty
   layers, omitted cells versus alpha-zero occupied paint, raw/registered identity,
   unused registry entries and full annotation metadata are retained.
3. Coherent revision: frozen snapshots retain one committed revision through
   asynchronous edits, recolor, metadata/layer/bounds changes, undo and redo. Real
   timer edits proceed during default encoding. Older saved checkpoints leave
   newer content dirty; failed/canceled encoding never acknowledges either checkpoint.
4. Intentional exclusions: active/hidden layers are the only captured UI stores.
   Drawing and selection/move/paste/transform previews, clipboard, area drafts,
   measurement/camera/tool/focus state and history are excluded; capture leaves
   previews/drafts uncommitted and intact. No native path/dialog dependency.

Actual final checks (Apple M1 Pro, arm64, 16 GiB RAM, macOS 15.8.1, Node v24.22.3):
- `npm run build`: PASS (both TypeScript configurations and Vite; preexisting
  >500 kB bundle warning remains). Log: `.wrk-runs/wrk-0b0f3b9b/final-build.log`.
- `npm test`: PASS, 259/259 domain tests (6.331 seconds) and 115/115 Chromium
  browser tests (6.4 minutes), zero failures/skips. Log:
  `.wrk-runs/wrk-0b0f3b9b/final-test.log`. Includes existing real-WebGL/scale and
  forced-renderer-failure recovery coverage; the latter logs its expected errors.
- `npm run format:check`: PASS (Prettier including schema example, and rustfmt).
  Log: `.wrk-runs/wrk-0b0f3b9b/final-format.log`.
- `git diff --check`: PASS. Local documentation paths/anchors: 80/80 pass.
  `wrk validate`: PASS, 57 tickets. Original ticket requirements are preserved
  with acceptance boxes checked and this implementation/evidence record appended.
- Final concurrent full-suite timing samples: frontier capture 152.364 ms,
  encoding 558.453 ms; heartland capture 293.222 ms, encoding 622.588 ms.
  Counts/hashes/encoded sizes match the phase-2 record. No latency/memory gate
  claim; native I/O, packaged save/reopen, peak physical memory and presentation
  remain unmeasured. Synchronous extraction and transient buffers remain the
  documented TW-050 limitation; TW-049 owns presentation refinement.
- No decoding, native Save/Open UI, recovery or export implementation was added;
  those stay in their existing subsequent tickets. No architectural deviation.
- The unrelated `.wrk/wrk-58cdb442.md` edit remains byte-identical to the starting
  snapshot. No unrelated staged work existed initially; the scoped commit excludes
  that file and preserves any other work. The required Git commit carrying this
  final record includes `wrk-0b0f3b9b` in its message. Do not start another ticket.
