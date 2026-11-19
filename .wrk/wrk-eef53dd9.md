---
id: wrk-eef53dd9
title: 'TW-033: Specify the versioned editable-project schema and persisted settings'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-efb169f5
priority: high
labels:
  - v1
  - projects
  - decision
fields:
  sequence: 33
  source: INTENT.md
---
## Outcome

Define an efficient, complete editable document format before implementing file I/O.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation; INTENT.md — Remaining implementation decisions.

**Execution order:** 33 of 54. Phase: projects.

**Prerequisite:** [wrk-efb169f5](wrk-efb169f5.md) — TW-032: Add named-area browsing and scale inspection.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose serialization technology, file extension, versioning, efficient sparse encoding, validation rules, and compatibility/error policy.
- Specify dimensions/coordinates, all ordered layers and tiles, raw colors, stable registry IDs/names/colors/associations, and annotation geometry/descriptions/tiers/label settings.
- Decide which editor settings persist, which remain session-local, and whether undo history is intentionally excluded.

## Acceptance criteria

- [x] A written schema and small annotated example account for every state needed to reopen and continue editing.
- [x] Layer order and hidden underlying content are explicit; dimensions do not require a dense 40,960,000-cell array per layer.
- [x] The format distinguishes empty, raw-color, and registered cells and preserves identity across recoloring.
- [x] Project and agent-export purposes are separate; recovery metadata and explicit-save state are not conflated with exported map meaning.

## Validation

- Map a mixed multilayer/annotation fixture into the schema and back by inspection.
- Review unsupported versions, truncation, invalid references, and very large declared sizes before implementation.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-034: Implement deterministic project encoding and snapshot extraction](wrk-0b0f3b9b.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in this Codex session using WRK state. This ticket is
schema/decision work only; production encoding, decoding and native I/O remain
TW-034 onward. Prerequisite wrk-efb169f5 is done. Read sprint-execute, AGENTS.md,
INTENT.md, README, ticket-runner, and relevant foundation, model, history, registry,
annotation, layer, editor, selection, grid, development and testing guidance, plus
current domain/session types. Weather report fetched: gpt-6-astra leads CS/Math;
opus-5.5 leads frontend architecture. Strategy A requires no delegation/model change.
Node v24.22.3 matches .nvmrc. Build, tests and formatting commands are understood;
recent commits use descriptive prefixes and ticket IDs. Initial index is empty.
The preexisting .wrk/wrk-58cdb442.md edit is snapshotted and excluded.

Working checklist:
- [x] Phase 1: specify the versioned sparse project schema, persistence choices,
      deterministic ordering, compatibility and resource/error policy.
- [x] Phase 2: map a small mixed layered/annotation fixture both ways, inspect
      failure/large-size cases and record evidence against current model rules.
- [x] Phase 3: final build/full tests/format and acceptance audit, WRK evidence.
      The required scoped commit is the Git commit carrying this final record.

Phase 1 complete:
- `docs/project-format.md` specifies UTF-8 JSON `.tilewright` v1, palette/run
  encoding, identity/metadata rules, deterministic output, active/hidden-layer
  preferences, session reset, snapshot boundary, compatibility/resource policy,
  and project/save/recovery/export separation.
- `docs/examples/project-v1.tilewright` is the complete mixed fixture; README,
  editor/layer/area docs link the decision. Formatting scripts cover both files.
- `npm run build`: PASS (existing >500 kB bundle warning, no performance claim).
- `npm run test:domain`: PASS, 241 tests, zero failures (5.426 seconds).
- `npm run format:check`: PASS, including the schema, JSON example and rustfmt.
- Numeric wire tokens require integer spelling and safe range checks before
  conversion, avoiding rounded malicious literals. Capacity ceilings are
  defensive implementation choices, not measured performance guarantees.

Phase 2 complete:
- Inspected all fields against MapDocument, canvas/identity/registry/annotation
  validators, session stores, and history checkpoint rules. The 2,121-byte
  example represents 6,400 x 6,400 with 3 ordered layers, 9 runs / 16 occupied
  layer cells, 5 typed paints, 3 registry entries and all 3 annotation tiers.
- One-off `node .wrk-runs/wrk-eef53dd9-validation/inspect-example.mjs`: PASS.
  Constructed a detached document using current domain APIs, compared all 16
  cells against a separate explicit oracle, read all wire fields back and
  deep-compared the complete fixture. Preferences were checked by inspection
  against live layer IDs; this is not an implemented project decoder/load path.
- Verified raw transparent black is occupied while omitted cells are empty;
  signed/zero and 64-tile crossings, final map address, covered terrain, hidden
  buildings, empty notes, unused water registry, IDs and metadata are preserved.
  Exact Unicode, multiline/trailing whitespace and empty descriptions survive.
- Actual RegistryCommands recolor changes only the registry record: 6 associated
  cells resolve the new grass color; 2 matching raw grass cells stay unchanged;
  all runs/areas remain identical. Undo restores the registry and clean checkpoint.
- A 65,536-square empty model has zero partitions, palette entries and typed-array
  bytes. Existing canvas validation rejects 65,537 width and unsafe dimension
  arithmetic; truncating the example causes JSON parse failure.
- Reviewed unsupported versions, duplicate/unknown members, references, overlap,
  huge declared lengths/collections and cancellation in the document's failure
  table. These are pre-implementation policy reviews, not codec rejection tests.
- Golden fixture run/cell counts fit the proposed limits: frontier 138,222 /
  6,620,700; heartland 500,802 / 24,025,200. No encoded-size/performance claim.
- No production codec, snapshot coordinator, I/O, recovery or export was added;
  those remain the subsequent tickets. Final build/full tests/format now running.

Final review (continued after local midnight, 2026-11-19):
- All 76 local Markdown file/anchor links in changed documentation pass.
- `git diff --check`: PASS; `wrk validate`: PASS, 57 tickets.
- Final build and format check: PASS. Review fixed accidental Markdown list
  rendering around the version literal and clarified transparent-paint erasure;
  formatting was rerun after those prose edits.
- Unrelated TW-008 bytes remain equal to the initial snapshot (SHA-256
  372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd).
- Final `npm test` has passed all 241 domain checks and continues through the
  115-browser-test suite. No failure observed at this review point.
- No application or native source changed. Native release/physical-performance
  checks are not claimed for this documentation decision ticket.

## Final acceptance audit and validation — 2026-11-19

All acceptance criteria are met:
1. Written schema and annotated example: `docs/project-format.md` specifies every
   current persistent domain field, named-area label setting, selected editor
   preference and intentional session reset. `docs/examples/project-v1.tilewright`
   provides the complete small example. Current domain reconstruction/readback
   is exact, as recorded above.
2. Ordered sparse layers: bottom-to-top arrays include hidden, covered and empty
   layers. World row runs plus palette references encode occupancy only. The
   target-size example is 2,121 bytes with 16 cells; even a 65,536-square empty
   domain map allocates no partitions. No dense canvas representation is required.
3. Empty/raw/registered identity: omitted spans are empty; raw RGBA (including
   zero alpha) and stable registry IDs have distinct palette union arms. The
   independent oracle and actual feature recolor/undo exercise identity retention.
4. Separate purposes: project preferences, content, explicit save acknowledgements,
   recovery destination/metadata and future agent exports have explicit boundaries.
   Undo/history tokens and native paths are excluded from map meaning. Safe failure
   and resource policies cover unsupported versions, truncation, invalid references
   and very large declarations before codec implementation.

Implementation / decision locations:
- `docs/project-format.md`: complete wire shapes, extension/version, all invariants,
  deterministic encoding/snapshot requirements, persisted/session-local choices,
  limits, compatibility, failure table, project/recovery/export boundaries and
  field-by-field round-trip walkthrough.
- `docs/examples/project-v1.tilewright`: mixed sparse multilayer/annotation fixture.
- README, `docs/editor-shell.md`, `docs/layers.md`, `docs/named-area-decisions.md`:
  discoverability and reconciliation of previously open persistence decisions.
- `package.json`: format/format:check include schema documentation and explicitly
  parse the .tilewright example as JSON. No dependencies or application code changed.

Final validation:
- `npm run build`: PASS (strict TypeScript and Vite); existing >500 kB warning.
- `npm test`: PASS, all 241 domain tests and all 115 Chromium/WebGL tests (6.4 min
  browser suite), zero failures. These exercise the existing working baseline.
- `npm run format:check`: PASS after the final prose corrections, including new
  documentation/example and existing rustfmt check.
- Example/domain inspection script: PASS as detailed in Phase 2; no production
  codec or asynchronous snapshot/native I/O claim.
- Local Markdown links/anchors: PASS, 76 targets. `git diff --check`: PASS.
- `wrk validate`: PASS, 57 tickets.

Evidence retained in ignored `.wrk-runs/wrk-eef53dd9-validation/`: phase1 logs,
`final-build.log`, `final-tests.log`, `final-format.log`, `inspect-example.mjs`,
`example-inspection.log`, `links-and-isolation.log`, and copied browser artifacts
in `final-browser-artifacts/`. WRK retains the substantive results independently
of these local artifacts.

No unresolved functional failure or blocker remains. Capacity ceilings are design
choices and count-reviewed against golden fixtures, not measured codec capacity.
Native release/physical-performance checks were not rerun for documentation-only
scope. Performance refinement remains TW-049/TW-050 under AGENTS.md. Production
encoding/decoding/I/O/recovery/export remain their existing subsequent tickets.
The preexisting TW-008 edit is byte-identical and excluded; the initial index was
empty. Mark done and create the requested scoped commit containing this WRK record
before reporting completion; do not start another ticket.
