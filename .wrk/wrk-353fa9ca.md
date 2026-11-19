---
id: wrk-353fa9ca
title: 'TW-029: Decide named-area geometry, label placement, and zoom thresholds'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-ebb7c04f
priority: normal
labels:
  - v1
  - annotations
  - decision
fields:
  sequence: 29
  source: INTENT.md
---
## Outcome

Specify a minimal annotation model that supports useful labels at three map scales.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Remaining implementation decisions.

**Execution order:** 29 of 54. Phase: annotations.

**Prerequisite:** [wrk-ebb7c04f](wrk-ebb7c04f.md) — TW-028: Verify selection invariants and large multi-layer operations.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose area geometry, coordinate/boundary rules, label anchoring/placement, and editing interactions.
- Define Detail, Locality, and Region visibility ranges and behavior at threshold transitions.
- Choose a conventional overlap/readability policy and explicitly decide whether any hierarchy is needed for v1.

## Acceptance criteria

- [x] Only the three author-selected tiers are required; custom tiers are deferred.
- [x] At close view houses can be labeled; farther out locality/region labels replace detail clutter.
- [x] Document examples for overlapping areas, empty descriptions, zoom boundaries, and labels near map edges.
- [x] Named areas remain independent of tile-selection operations; nesting is not treated as an established user requirement.

## Validation

- Evaluate a house, village, and region on the same map at several zoom levels.
- Confirm the chosen model can be represented in both editable project and agent-export schemas.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-030: Implement named-area creation, descriptions, tiers, and explicit editing](wrk-0d9194dc.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in-session, using WRK instead of a sprint ledger.
Read sprint-execute, AGENTS.md, INTENT.md, README, ticket runner, foundation,
desktop, navigation, model, history, selection and performance guidance; reviewed
the downstream annotation/project/export tickets and existing metadata/camera APIs.
Prerequisite wrk-ebb7c04f is done. Weather report fetched (gpt-6-astra for CS/Math,
opus-5.5 for frontend architecture); execution stays in this session as requested.
Node 24.22.3 matches the repository pin. Build/test/format commands are available;
recent commits use feat/test descriptions with the WRK ID. Initial index is empty.
Unrelated .wrk/wrk-58cdb442.md is snapshotted and excluded from this ticket.

Phase checklist:
- [x] Specify geometry, anchoring, editing, tier ranges, overlap and hierarchy policy.
- [x] Evaluate concrete house/village/region, edge and schema-representation examples.
- [x] Run relevant validation, audit acceptance, and record actual evidence.
- Finalization: mark done only after acceptance passes, then create the requested
  scoped Git commit before reporting success.

Scope: this is a decision record. TW-030/TW-031 own controls and rendering;
TW-033/TW-043 own the separate complete project/export schemas. This ticket validates a representable annotation contract without claiming those features ship.

## Decision locations and acceptance audit — 2026-11-18

- `docs/named-area-decisions.md`: complete contract for nonempty contained,
  half-open integer rectangles; stable IDs; required name/description/tier;
  persisted center-placement mode with a derived world anchor; explicit draft,
  numeric/redraw, Apply/Cancel/Delete interactions; history and tile independence.
  It specifies exact CSS-scale thresholds, deterministic collisions, screen-edge
  adjustment, selected-area exception, no hierarchy and concrete JSON examples.
- `README.md`: links the planned annotation contract without claiming it ships.
- `package.json`: includes the new decision record in both formatting commands.
  No runtime code, dependencies, file codecs or following-ticket controls changed.

All four acceptance criteria are satisfied as decisions:
1. Exactly Detail, Locality and Region are author-selected; custom tiers deferred.
2. Detail uses p >= 8 CSS px/tile; Locality 1 <= p < 8; Region 0 < p < 1,
   where p = 24 * zoom. Close house labels are replaced by village/region labels.
   Thresholds have no gaps, overlap or direction-dependent hysteresis. One selected
   area may remain visible for inspection, with collision priority, never a whole
   collection of hidden-tier houses.
3. Worked examples cover coincident/partial overlaps and stable-ID/selected
   priority, empty descriptions, both exact zoom thresholds and their immediate
   neighbors, negative/far map edges, viewport clamping and offscreen anchors.
4. All tile operations preserve all annotation data, even if fully enclosed;
   explicit annotation commands own changes. Containment implies no parent,
   cascade, membership or inherited visibility. Hierarchy is deferred.

## Actual validation evidence — 2026-11-18

Decision rehearsal: `node .wrk-runs/wrk-353fa9ca-validation/rehearsal.mjs` PASS.
The retained local script extracts both JSON blocks directly from the decision
record and imports the existing MapDocument, CommandHistory, coordinate/identity
validators and viewport math. It is a numeric/representation rehearsal, not an
annotation feature implementation or a test of nonexistent codecs/rendering.

- All three records are valid contained rectangles on bounds [-64,6400)^2;
  derived anchors are house (64,64), village (64,64), region (480,480).
- The complete records round-trip through actual annotation metadata commands,
  undo/redo and JSON serialization. A tile paint/undo preserves all metadata.
  The separate `areas` projection and inverse preserve every ID, name,
  description, bounds, tier and center setting; its house output equals the
  documented export example. Village's empty string and the house's multiline
  description remain exact. These are illustrative schema fragments; complete
  versioned project/export envelopes remain TW-033/TW-043.
- Eleven centered camera cases evaluated p = 24, 12, 8.000001, 8, 7.999999, 3,
  2, 1.000001, 1, 0.999999 and 0.24, plus actual fitToMap for a 960x640 CSS canvas.
  Exact thresholds choose Detail at 8 and Locality at 1; reversing the sample
  order gives identical tier results. DPR 1/2 CSS/backing-coordinate arithmetic
  agrees; this is math evidence, not rendered-DPR screenshots.
- Whole-map Fit computes zoom 0.003816006600660066 (0.381600660066%),
  p = 0.09158415841584158: Region. Its 1088x1088 region spans
  99.64356435643565 CSS px with center (233.82178217821786,73.82178217821783),
  inside the canvas. Close house sizes are 192, 96 and 64 px at p = 24, 12 and 8;
  village is 384 px at p = 3; region is 261.12 px at p = 0.24.
- Negative/far-edge 1x1 rectangles yield (-63.5,-63.5) and (6399.5,6399.5).
  Measured 180x25 label boxes clamp at projected (3,3) to [4,184]x[4,29],
  and (957,637) to [776,956]x[611,636], exactly as documented. Coincident boxes
  collide, selected/ASCII priority is deterministic, and exactly 4 px separation
  is accepted. Zero/fractional/unsafe bounds and an outside-map example fail
  the chosen numeric/containment rules. Document records remain unchanged.

Final repository validation (macOS 15.8.1 / 24H32, arm64, Node 24.22.3):
- `npm run build`: PASS, both strict TypeScript configurations and Vite. Existing
  >500 kB chunk-size warning remains; no runtime bundle change was introduced.
- `npm test`: PASS, 198 domain tests and 99 Chromium/WebGL tests (4.6 minutes), zero failures.
  Existing composed selection tests exercise move/cut/paste/rotate/flip and exact
  undo/redo while preserving arbitrary annotation metadata.
- `npm run format:check`: PASS, including the new decision record and Rust format.
- Local Markdown link check: PASS for the new record and README.
- `git diff --check`: PASS. `wrk validate`: PASS, 57 tickets.

Logs and the rehearsal script/output are retained in ignored
`.wrk-runs/wrk-353fa9ca-validation/`. No new native interaction, label screenshot,
complete file round-trip or performance result is claimed for this decision-only
ticket. Those validations remain with the existing implementation tickets;
performance refinement remains TW-049/TW-050 per AGENTS.md. No blocker or scope
change was needed. Unrelated `.wrk/wrk-58cdb442.md` remains byte-identical to the
initial snapshot and is excluded; the initial index was empty.

All decisions and validation are complete. Mark done, then create the requested
commit containing only this ticket, the decision record, README and formatting
script additions. Report completion only after that commit exists; do not start
another ticket.
