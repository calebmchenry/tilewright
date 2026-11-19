---
id: wrk-eeabc6ef
title: 'TW-043: Specify a separate whole-map agent-export schema'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-9b478f1c
priority: high
labels:
  - v1
  - export
  - decision
fields:
  sequence: 43
  source: INTENT.md
---
## Outcome

Define a simple, efficient map representation an agent can interpret without editor-state knowledge.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Project files and agent exports; INTENT.md — Remaining implementation decisions.

**Execution order:** 43 of 54. Phase: export.

**Prerequisite:** [wrk-9b478f1c](wrk-9b478f1c.md) — TW-042: Verify crash recovery and persistence under interruption and failure.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose the export serialization format (JSON is a candidate), schema version, coordinate conventions, and sparse whole-map encoding.
- Specify ordered/named layers and every underlying tile, registered meanings, an explicit policy for unlabeled colors, and named-area descriptions/geometry.
- Document how empty cells, map dimensions, color references, and layer visibility relate to interpretation.

## Acceptance criteria

- [x] The export is a distinct public schema from the editable project even if both use the same serialization technology.
- [x] An agent can determine tile locations, layer order/names, color values/meanings, and area descriptions from the export plus its schema.
- [x] Hidden/underlying content is preserved, and unnamed colors remain interpretable through the chosen explicit policy.
- [x] Export always covers the whole map; selected-area export and direct game-import compatibility remain deferred.

## Validation

- Write a small human-readable example containing raw colors, two overlapping layers, and house/village annotations.
- Estimate encoding size for the representative large fixture and review that no editor cache/history state is required to interpret it.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-044: Implement whole-map agent export with complete semantic content](wrk-5e43190b.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session with WRK state instead
of a sprint ledger. Prerequisite wrk-9b478f1c is done. Read sprint-execute,
AGENTS.md, INTENT.md, README, ticket runner and relevant foundation, desktop,
project-format, sparse-model, registry, named-area and performance guidance.
Fetched the skill weather report (gpt-6-astra coding recommendation); no delegation.

- [x] Phase 1: define the separate public contract and readable example.
- [x] Phase 2: measure complete representative fixtures and verify interpretation.
- [x] Phase 3: complete regression validation, acceptance review and evidence.

## Implementation and decisions

- `docs/agent-export-format.md`: complete version-1 public specification. UTF-8
  JSON, `tilewright-agent-map` envelope, fixed signed tile coordinates, half-open
  bounds, sparse horizontal runs and bottom-to-top named layers. Every layer's
  occupied content is retained; visibility is an omitted viewing preference.
  Whole-map bounds and empty margins remain intact; no selection/viewport crop.
- `src/domain/agent-export-format.ts`: independent public wire types for bounds,
  resolved colors, ordered layers/runs and semantic areas. No project-schema,
  editor, renderer, history or runtime dependencies; not an encoder/validator.
- The shared color table carries exact RGBA and explicit `meaning: null` for raw
  paint, or stable registry ID, current RGBA and registered name for named paint.
  All registered entries are included, even unused ones. Equal raw/registered
  RGBA never shares meaning implicitly. Alpha-zero paint remains occupied.
- Independent areas retain stable IDs, complete names/descriptions, author-selected
  tiers and exact rectangle bounds. Zoom suppression, center label placement and
  renderer layout are omitted. No parent-child or tile-selection relationship is
  inferred. The document also specifies canonical ordering, validation, capture
  coherence and capacity policy without promising measured performance.
- `docs/examples/agent-map-v1.json`: readable 6 by 5 example with negative minima,
  overlapping Terrain/Buildings, house/village descriptions, raw black, raw green
  matching Grass, transparent occupied paint and an unused Water registry entry.
- `scripts/agent-export-size.ts`: fixture-only study, separate from production
  implementation. Canonicalizes complete fixture runs, parses emitted JSON and
  reconstructs the fixture interchange to check every layer against the existing
  golden content hashes/counts. It also independently enumerates every example
  cell and verifies colors, order, names, bounds, tiers and multiline descriptions.
- `docs/agent-export-size.json`: retained byte counts, canonical output hashes,
  fixture hashes, source hashes, Node version and exact occupancy/run counts.
  README links the contract; package.json format commands include the new docs.

## Actual validation evidence

Used pinned Node 24.22.3. Logs are retained locally in the ignored directory
`.wrk-runs/wrk-eeabc6ef-validation/`; the size report is committed with this ticket.

- `node scripts/agent-export-size.ts --output docs/agent-export-size.json`: passed.
  A second run to the default artifacts path reproduced the complete report,
  including exact byte counts, canonical hashes and source hashes. All retained
  source hashes were checked against the final files.
- **frontier-v1:** 6,400 by 6,400, four layers, 6,620,700 occupied layer cells,
  123,870 canonical runs, **2,064,469 bytes (1.969 MiB)**. Decoded complete fixture
  hash `de4ed786f9a80c42b6ab3939c08990b40484975b2dc77eeea147591bab552617`
  matches the existing golden fixture.
- **heartland-v1:** 6,400 by 6,400, four layers, 24,025,200 occupied layer cells,
  470,490 canonical runs, **7,838,205 bytes (7.475 MiB)**. Decoded complete fixture
  hash `c1e4443944ee8d9576529a88029c3aad854fa33c251e1d91c70adad8f8361d33`
  matches the existing golden fixture.
- Each large fixture retains all **64,944 overlapping positions**, six colors
  and two explicitly added house/village annotations contributing 431 bytes.
  Underlying layers are included in both occupancy and whole-content comparison.
- The small example has **14 Terrain + 4 Buildings cells**, three raw colors and
  three registered meanings; its compact canonical representation is **1,133 bytes**.
  Exact decoded-cell comparisons distinguish empty space, transparent paint,
  raw/registered equal RGBA, and covered terrain.
- `npm run build`: both TypeScript configurations and production Vite build passed.
- Final `npm test`: **398 domain tests and 142 Playwright tests passed**;
  zero failures/skips/cancellations, browser duration **7.1 minutes**.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: **26 passed**.
- `npm run format:check`: Prettier and rustfmt passed. The final prose clarification
  also passed a targeted Prettier check.
- All local schema links resolve. `wrk validate` and `git diff --check` passed.
- The preexisting unrelated `.wrk/wrk-58cdb442.md` edit remained byte-identical
  (SHA-256 `372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd`)
  and is excluded from this ticket's commit. The initial Git index was empty.

## Acceptance review and limits

All four criteria are met for this schema decision ticket:

1. The envelope and wire shapes are distinct from the editable project schema.
2. Locations, ordering/names, exact values/meanings and all area text/geometry
   resolve directly from this export plus its self-contained specification.
3. The contract requires every hidden/covered layer; the size study verifies all
   underlying fixture content. Unlabeled paint is explicitly preserved as raw
   RGBA with null meaning, never mistaken for empty or adopted by color equality.
4. Only complete-map export is specified. Selected-area export and direct game
   import remain explicitly deferred.

No editor cache/history state is used by the evidence script or needed by a
consumer: it imports only wire types, fixture data and the fixture inspector.
Visibility is intentionally excluded because it is an editor viewing preference;
all registered meanings are retained, including unused ones. These resolve open
implementation decisions and are not additions to confirmed product requirements.

The production exporter, hidden-source capture behavior and native export action
remain TW-044 work. This ticket does not claim those features are implemented or
that a packaged export smoke test ran. Size estimates do not establish encoding
latency, peak memory, native I/O or agent-context suitability. Existing Vite
bundle-size warnings remain; performance refinement follows TW-049/TW-050 and
persistence/export profiling TW-051 under the accepted delivery priority. No
separate sprint document, extra tickets or unrelated changes were introduced.
