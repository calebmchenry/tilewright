---
id: wrk-d0e8e734
title: 'TW-046: Verify agent-export completeness with an independent consumer fixture'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-ae1f5f2b
priority: normal
labels:
  - v1
  - export
  - verification
fields:
  sequence: 46
  source: INTENT.md
---
## Outcome

Demonstrate that the export communicates map meaning without relying on editor internals.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Project files and agent exports; INTENT.md — First-version success criteria.

**Execution order:** 46 of 54. Phase: export.

**Prerequisite:** [wrk-ae1f5f2b](wrk-ae1f5f2b.md) — TW-045: Add native agent-export action, progress, and reliable output writes.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Create a small standalone consumer/validator or test decoder using only the published export schema.
- Build a golden map with terrain, walls, furniture, hidden underlying tiles, raw colors, recolored registry entries, and named areas.
- Document a concise example of how an agent reads coordinates, layers, meanings, and descriptions.

## Acceptance criteria

- [x] The independent consumer reconstructs every exported occupied cell and its layer identity/order.
- [x] Assertions prove that hidden content, unlabeled colors, registry meanings, and area descriptions are neither omitted nor conflated.
- [x] The consumer requires no project-file decoder, rendering cache, React state, or application server.
- [x] Schema errors are detectable, examples match actual output, and the large-map representation remains sparse/efficient.

## Validation

- Compare consumer reconstruction to the source document and include negative schema cases.
- Review the example export as an agent-facing artifact and verify each success-criterion datum is locatable.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-047: Finish editor shortcut, focus, feedback, and usability integration](wrk-d8dced1c.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed phase by phase in this Codex session without
delegation. WRK state replaces the sprint ledger. Prerequisite wrk-ae1f5f2b is
done. Read the sprint-execute skill, AGENTS.md, ticket runner, INTENT.md, README,
desktop, foundation, map-document, agent-export-format and performance guidance.
Fetched the skill weather report (gpt-6-astra coding recommendation); retained
the requested in-session strategy.

- [x] Phase 1: standalone sparse schema validator/consumer and isolation checks.
- [x] Phase 2: independently authored golden source, actual export comparison,
  negative schema cases, populated-map completeness and agent-facing walkthrough.
- [x] Phase 3: final regression, acceptance review and actual validation evidence.

## Implementation and decisions

- `scripts/consume-agent-map.py`: a single Python 3.9+ standard-library reader
  based only on the published v1 schema. It imports no Tilewright code/types,
  project decoder, React, rendering data or server APIs. Python is verification
  tooling, not a packaged-app dependency. The CLI accepts a file or stdin and
  provides complete metadata/layer summaries, all-layer coordinate inspection,
  or lazy occupied-cell JSON lines. The importable read_map, at, summary and
  iter_cells functions also operate without the editor.
- Validation finishes before any output. Duplicate keys (including escaped
  aliases), malformed UTF-8/BOM/JSON, noninteger numeric spellings, unsafe lexical
  integer values, wrong/missing/unknown fields, unsupported formats/versions,
  duplicate IDs/color owners, invalid colors/meanings, references, bounds,
  unsorted/overlapping runs and malformed areas fail with a nonzero exit and no
  partial reconstruction. Raw/registered equality stays distinct. Noncanonical
  key/color/area order and adjacent split runs are accepted. The reader adopts
  the published exporter capacity ceilings as its input policy.
- Runs remain sparse. Summaries hash every resolved run and count every occupied
  layer cell; coordinate lookup uses binary search per layer. Individual cells
  are expanded only by an explicitly requested iterator/--cells operation.
  JSON parsing retains the input in memory; this is not a streaming parser or
  a peak-memory guarantee at the 256 MiB input ceiling.
- `tests/fixtures/agent-consumer.ts`: independently authors an 8 x 6 map with
  negative minima, Terrain, Walls, Furniture and an empty same-named layer;
  real registry recolor/rename and two hidden populated layers; raw old/current
  green, transparent white and black; unused Water vocabulary; and exact
  house/village/region records, Unicode, multiline and empty descriptions.
  The fixture is not constructed by decoding the example export.
- `docs/examples/agent-consumer-v1.json`: reviewed pretty-print of the real
  production export. Tests pin its actual semantic output and canonical byte
  count/hash. The existing TW-043 example remains intact and is also validated.
- `tests/domain/agent-consumer.test.ts`: a separate Python process reconstructs
  every golden cell and all layer/metadata records. The expected data comes
  directly from source document cell/run iterators, registry records and areas,
  never from the export snapshot. Complete frontier/heartland exports compare
  all resolved-run hashes, counts, bounds, colors/meanings, layer identities/order
  and every area to the source. The resolved-run digest uses documented ASCII
  JSON tuples plus LF and is explicitly segmentation-sensitive, not a new schema.
- `docs/agent-export-format.md#independent-consumer-verification-tw-046` documents
  CLI/API behavior, schema checks, limits, sparse representation, evidence and a
  concise agent walkthrough locating all required semantic data. README links it;
  desktop-development documents Python for tests. package.json formatting commands
  include both checked-in agent examples. No shipping editor/export behavior,
  schema version, native authority or dependency lockfile changed.

## Actual validation evidence

Environment: macOS 15.8.1 (24H32), arm64, pinned Node v24.22.3, Python 3.13.3,
repository Rust toolchain. Local ignored logs, source hashes and artifact-review
outputs are in `.wrk-runs/wrk-d0e8e734-validation/`.

- Phase 1: `npm run build`, **425/425 domain tests**, and `npm run format:check`
  passed. A copied reader and export run with Python isolated mode in a temporary
  directory containing no repository files or dependencies.
- Phase 2: **71/71 focused consumer tests** passed, including 63 structural
  negative cases and 16 malformed JSON/encoding/numeric cases. All rejected
  inputs return nonzero with zero partial output, including errors late in the
  file. Noncanonical valid exports, maximum-size sparse/empty maps, safe-integer
  coordinate extremes and exact Unicode/unpaired-surrogate text also pass.
- Final frozen-source `npm test`: **493/493 domain tests and 145/145 Chromium
  WebGL tests passed**, no skips. Chromium completed in 7.2 minutes, including
  unsaved agent export, progress/cancel, shortcut, failure/retry and large-map
  regressions. Source hashes were checked unchanged after the final run.
- Final `npm run build` and `npm run format:check`: passed. The existing Vite
  >500 kB bundle advisory remains nonblocking. Test-only TypeScript narrowing
  errors found during phase 2 were fixed before its passing build and final
  validation; no product assertions were weakened or skipped.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: **31/31 passed**.
- `/usr/bin/python3 -I scripts/consume-agent-map.py
  docs/examples/agent-consumer-v1.json --at 1 0`: passed with Python **3.9.6**, also
  verifying the documented minimum Python family on this Mac. CLI help passed.
- `git diff --check` and `wrk validate`: passed (57 valid tickets).

### Golden reconstruction and agent-facing artifact review

The actual canonical export has **28 occupied cells in 13 runs**, four ordered
layers and three named areas, **1,520 bytes**, SHA-256
`95ad511e2a18b0c467fbe50f4541eb95d686f394b26533b1f76a28edf5e49d7b`.
Consumer JSON lines equal every source cell, including layer ID/order and full
resolved paint. Layer counts are Terrain 20, Walls 4, Furniture 4, empty 0.
Unhiding both populated layers produces byte-identical output.

Reviewed the export itself with CLI coordinate queries, retaining
`agent-artifact-review.json`. At (1,0), order 0/1/2 resolves Meadow/Stone wall/Oak
table; the empty top layer remains present. At (5,3), raw green has exactly the
registered Meadow RGBA but null meaning; (4,3) retains raw old green. Transparent
white (-2,-1) and black (5,4) are occupied. (5,0) is empty; (6,0) rejects as outside.
The grass registry ID survives its real recolor/rename across Terrain/Furniture,
and unused Water remains vocabulary without fabricated cells. All area IDs,
geometry, tiers and full descriptions match source records; the house newline
and hammer emoji and the region's empty description remain exact. Coordinates,
layer order, color meanings and named-area descriptions are all locatable in
bounds/runs, layers, colors and areas without editor knowledge.

### Complete populated-map reconstruction

| Actual production export | Occupied layer cells | Canonical runs | Bytes | Areas |
| --- | ---: | ---: | ---: | ---: |
| frontier-v1 | 6,620,700 | 123,870 | 2,306,718 | 1,089 |
| heartland-v1 | 24,025,200 | 470,490 | 8,080,454 | 1,089 |

Both are 6,400 x 6,400 with four ordered layers. Every resolved-run digest and
all metadata match independently read source records; layer counts also match
the existing golden fixture counts. Sparse run counts are more than 50 times
smaller than occupied cell counts, without scanning or allocating the
163,840,000 possible layer-cell addresses. Maximum 65,536 x 65,536 empty and
single-cell maps decode from fewer than 400 export bytes. Detailed per-layer
digests are retained in `tw046-consumer.log` and `npm-test.log`.

## Acceptance review and limitations

All four acceptance criteria are met by actual producer-to-independent-consumer
comparisons, negative schema cases, isolated execution and artifact review above.
No scope deviation or new ticket was needed. The standalone reader is a reference
consumer/validator, not a game importer. Sparse correctness and byte sizes are
verified; native latency percentiles, agent context limits and peak memory are
not claimed. Performance-only refinement remains TW-049/TW-050, with end-to-end
export profiling in TW-051. Native packaged-app export behavior was unchanged
and was not manually repeated in this verification-only ticket.

Commit scope includes this ticket's implementation and WRK record only.
The pre-existing `.wrk/wrk-58cdb442.md` modification is excluded and preserved.
