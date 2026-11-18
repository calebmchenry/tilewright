---
id: wrk-e811af32
title: 'TW-015: Decide registry identity, existing-color adoption, and collision behavior'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-2357ea93
priority: high
labels:
  - v1
  - painting
  - decision
fields:
  sequence: 15
  source: INTENT.md
---
## Outcome

Resolve how unique named colors and stable tile associations behave before implementing registry editing.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Remaining implementation decisions.

**Execution order:** 15 of 54. Phase: painting.

**Prerequisite:** [wrk-2357ea93](wrk-2357ea93.md) — TW-014: Provide arbitrary color selection and distinguish empty cells from painted colors.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Define registering a color already used by raw tiles, adding/renaming/removing entries, and the identity assigned to future strokes.
- Choose explicit handling for duplicate entry colors and recoloring an entry to a color used by another entry or unregistered tiles.
- Specify exact-color normalization and how cancellation or failure leaves the document unchanged.

## Acceptance criteria

- [x] One entry retains its identity and meaning through color changes; tiles remain attached by identity rather than accidental RGB equality.
- [x] Document examples for raw-color adoption, duplicate registration, same-color recolor, conflicting recolor, and removal of an in-use entry.
- [x] The chosen collision policy preserves unique registered colors without silently conflating distinct meanings.
- [x] Choices are recorded as implementation decisions; export handling for unnamed colors remains owned by the export-schema task.

## Validation

- Work through grass, mountain, and wall examples across at least two layers.
- Translate the decision table into concrete cases for the following registry implementation tickets.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-016: Implement the named color registry and stable tile associations](wrk-230b4c1d.md).

## Decision and acceptance audit — 2026-11-18

Execution: Strategy A (Orchestrated), performed in this Codex session without
worker delegation. WRK replaced the sprint ledger. The requested sprint-execute
skill, AGENTS.md, INTENT.md, README, ticket-runner and relevant foundation,
color-selection, model, history, editor, layer, rendering, overview, desktop and
performance guides were read. Prerequisite wrk-2357ea93 is done. The skill's
weather report was fetched (gpt-6-astra listed for CS/Math implementation work);
the already-selected in-session strategy was retained. TW-016/TW-017 and TW-043
were read for handoff boundaries, not executed or modified.

Completed phases:

1. Contract: `docs/registry-decisions.md` records stable IDs, canonical opaque
   sRGB color equality, trimmed nonblank names, optional explicit raw adoption,
   future raw/registered paint selection, rename/recolor/remove behavior,
   collision rejection, cancellation, failure, history, and notifications.
2. Worked validation and handoff: the same document includes the complete
   eight-cell Terrain/Buildings grass/mountain/stone-wall walkthrough and cases
   R01–R20, with concrete inputs, expected outcomes, and TW-016/TW-017 ownership.
   README and the existing color-selection/model guides link to the contract.
   `package.json` includes the decision document in format/format:check.
3. Verification: audited each criterion, rehearsed feasible transitions using
   existing model/history primitives, ran the full build/test/format checks, and
   checked local links and unrelated-work preservation.

Acceptance criteria evidence:

- Stable meaning/identity: the Identity and exact color / Select, rename, and
  recolor sections define ID references independently of names and RGB. Recolor
  changes the entry record only, across all layers; raw matches stay independent.
  Walkthrough step 4 and R08/R09/R16/R19/R20 distinguish stored IDs from pixels.
- Required examples: steps 1–2 cover raw adoption and duplicate registration;
  step 2 covers equivalent same-color recolor; step 3 covers Mountain conflicting
  with Stone wall; steps 6–7 cover in-use Grass removal and exact undo/redo.
  The fixture includes hidden, overlapping/underlying, and cross-chunk content
  with explicit cell and layer counts.
- Unique colors without conflation: creation/recolor rejects another owner's
  canonical color atomically. No silent merge, swap, relink, or duplicate entry
  is allowed. Explicit adoption affects raw cells only. Removal preserves
  appearance as raw paint; undo restores only previously linked references.
  R01/R05/R06/R07/R12/R14 define edge cases including normalized equivalence.
- Decision/scope boundaries: the record labels these as implementation decisions,
  separates this specification from unimplemented feature commands/UI, and leaves
  unnamed-color export representation/policy explicitly to TW-043
  (wrk-eeabc6ef). No export schema or new product runtime behavior was introduced.

Actual validation on macOS 15.8.1 (24H32), arm64, Node 24.22.3, Rust 1.100.0:

- Manual decision review: worked through all seven sequential steps and reviewed
  R01–R20 against the contract. Initial M/W each have two references on Terrain
  and Buildings. Grass adoption changes exactly two raw cells on two layers;
  conflicting M → W preserves both meanings; recoloring G to the raw target shade
  leaves the third same-colored cell raw. Removal changes two references to raw
  with eight occupied cells preserved. Recreating without adoption produces G2
  with zero uses; later explicit adoption covers three raw cells on two layers.
  Rejection/UI cases are specified expectations for TW-016/TW-017, not a claim
  that the current generic metadata API already enforces them.
- `node .wrk-runs/wrk-e811af32-validation/walkthrough.mjs` — PASS. This local
  rehearsal uses the real MapDocument, CommandHistory, color normalization and
  renderer color resolver, submitting explicit generic commands for the worked
  successful transitions. It verifies complete content snapshots on undo/redo,
  one document event/undo step per edit, same-color no-op preservation, unchanged
  tile references on recolor, equal appearance after detach/remove, fresh G2,
  exact two/three-cell counts, and no dangling references at notification time.
  Late invalid-command and one-byte history-limit failures both restore content,
  history, version and zero notifications. It does not implement or claim to
  test registry collision rejection, registry UI/selection, or new cache behavior.
- `npm run build` — PASS, both TypeScript configurations and Vite production build.
- `npm test` — PASS: 79 domain tests, 39 Chromium/Playwright tests (2.0 minutes),
  zero failed/skipped tests. Existing regressions cover raw normalization,
  identity, atomic history, multilayer rendering, hidden content, overview caches,
  target-scale populated maps, and panel isolation. The unavailable-WebGL test's
  expected error output is followed by a passing retry check.
- `npm run format:check` — PASS after the final documentation edits, including
  the new decision document and Rust formatting.
- Local documentation check — PASS: 43 relative links/anchors resolve and cases
  R01–R20 appear once in order. `git diff --check` — PASS.

Validation logs and the ad hoc model rehearsal are retained locally under the
ignored `.wrk-runs/wrk-e811af32-validation/` directory. The committed walkthrough
and case table are the reproducible specification for the implementation tickets;
no mirror implementation or speculative feature tests were added. No native smoke
or new performance measurement was needed for this documentation-only decision.
The existing Vite >500 kB bundle warning remains; performance refinement remains
TW-049/TW-050 under AGENTS.md without claiming a budget pass.

All four acceptance criteria are satisfied as decision work. No blockers or
changes to the requested scope were found. Only this ticket is being completed.
The initial index was empty; the unrelated `.wrk/wrk-58cdb442.md` edit is preserved
byte-for-byte and excluded from the completion commit. The commit includes this
WRK update, the decision document, its cross-links, and formatting coverage, with
wrk-e811af32 in its message.

Final integrity checks: `wrk validate` — PASS (57 tickets); original ticket
requirements preserved apart from checked acceptance boxes; unrelated WRK file
byte comparison and initially empty Git index comparison — PASS.
