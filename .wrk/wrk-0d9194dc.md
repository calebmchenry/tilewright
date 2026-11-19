---
id: wrk-0d9194dc
title: 'TW-030: Implement named-area creation, descriptions, tiers, and explicit editing'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-353fa9ca
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 30
  source: INTENT.md
---
## Outcome

Let authors attach meaning and descriptions to areas independently of tile content.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Chosen technology.

**Execution order:** 30 of 54. Phase: annotations.

**Prerequisite:** [wrk-353fa9ca](wrk-353fa9ca.md) — TW-029: Decide named-area geometry, label placement, and zoom thresholds.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement stable annotation IDs, selected geometry, name, description, tier, and label-placement data.
- Build annotation create/select/rename/describe/change-tier/edit-bounds/delete controls and area overlays.
- Route explicit annotation edits through command history without coupling them to tile tools.

## Acceptance criteria

- [x] House, village, and region areas can be created and edited with independent descriptions and tiers.
- [x] Annotation creation/edit/removal is undoable and marks the document dirty appropriately.
- [x] Tile moves, cuts, pastes, rotations, and flips leave all annotation data unchanged even when enclosing an area.
- [x] Invalid geometry or missing required fields receives clear feedback and no partial document update.

## Validation

- Test annotation lifecycle, explicit geometry edits, history, and tier validation.
- Run all tile selection operations around fully enclosed and partially overlapping named areas and assert unchanged annotation records.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-031: Render zoom-dependent labels and annotation overlays](wrk-dfb3bfaf.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in this session, using WRK state instead of a ledger.
Prerequisite wrk-353fa9ca is done. Read sprint-execute, AGENTS.md, INTENT.md,
README, ticket runner, named-area decisions and the relevant domain/history,
editor, selection, rendering and development guidance. Weather report fetched
(gpt-6-astra for CS/Math, opus-5.5 for frontend architecture); no delegation.
Node 24.22.3 matches the repository pin. Build, test and formatting commands
are available. Recent commits use descriptive prefixes and the WRK ID.
Initial index is empty; unrelated .wrk/wrk-58cdb442.md is snapshotted and excluded.

Phase checklist:
- [x] Validated named-area records and atomic lifecycle commands.
- [x] Explicit authoring controls, transient bounds gestures and selected/draft overlays.
- [x] Lifecycle/history, invalid-input and enclosed/overlapping tile-operation validation.
- [x] Acceptance audit and final validation evidence.
- Finalization gate: mark done and create the requested scoped commit before reporting success.

Zoom-dependent labels/collisions remain TW-031; this ticket renders selected/draft
bounds and implements metadata editing at all zoom levels. Native file codecs
remain their existing tickets. Performance limitations do not block this feature
under AGENTS.md; functional correctness and data integrity remain required.

Phase 1 passed: build, 201 domain tests, 99 browser tests (4.7 minutes),
format check and macOS desktop build. Phase 2 passed: build, 35 annotation
domain/controller/independence cases, 12 focused browser checks (16.8 seconds),
and format check. Browser checks include exact outline pixels at DPR 1/2,
GPU teardown, minimum-size layout and text/IME/gesture cancellation.
Initial test failures exposed exact-label lookup issues for Tier and populated
Description fields (fixed with explicit accessible names), an overly specific
assumption about the browser's native text undo stack, and a symmetric tile
fixture producing correct no-op transforms (fixture made asymmetric). All are
fixed; final full-suite and release-build validation is running.

## Implementation locations and acceptance audit — 2026-11-18

- `src/domain/annotations.ts`: validated required name/description/tier/bounds/center
  placement, immutable records, stable UUID IDs and explicit create/edit/remove
  commands through the existing atomic history. Generic metadata stays compatible
  with existing fixtures; the new feature boundary validates complete records.
- `src/editor/annotations.ts`: transient selected ID, draft, field errors, explicit
  Apply/Cancel/Delete and captured bounds gestures. `session.ts`, `navigation.ts`
  and `selection.ts` integrate cancellation and keep idle tile selection separate.
- `src/AnnotationPanel.tsx`, `App.tsx`, `MapCanvas.tsx`, `styles.css`: accessible
  create/select/rename/describe/tier/bounds controls, dimensions and feedback.
- `src/renderer/areaOutline.ts`, `createRenderer.ts`, `mountRenderer.ts`: clipped
  purple selected/draft outlines and corner marks, isolated annotation redraw,
  subscriptions and cleanup. There are no all-area fills or tile-cache invalidations.
- `docs/named-area-decisions.md#authoring-implementation-tw-030` and README:
  implemented behavior, API locations, validation coverage and deferred scope.

All four acceptance criteria are met in the implementation and focused checks:
1. House, village and region records can independently create/edit names,
   descriptions (including empty strings, Unicode and exact newlines), tiers and
   numeric/drawn bounds. Duplicate names and geometric overlap do not infer hierarchy.
2. Effective create/edit/delete is one undo step, retaining stable identity and
   exact before/after data. Saved checkpoints become clean on the matching undo;
   invalid/canceled/no-op edits do not change history/version/dirty state.
3. The tile-only operation matrix checks fully enclosed, partially overlapping and
   surrounding feature-created areas, in both active-Walls and Walls/Furniture
   scopes. Move, nudge, copy, cut, repeated paste, both rotations, both flips and
   each transformed-paste variant retain byte-identical records during each commit,
   every undo and every redo. Paint/erase/fill, layer changes and growth also retain
   annotations. Tests verify the tile edits actually happen and reverse exactly.
4. Complete field validation rejects missing name/description/tier/bounds/label,
   blank or multiline names, custom tiers, unsupported placement, empty/fractional/
   unsafe/reversed/outside rectangles, duplicate IDs and missing targets before
   publication. UI field feedback preserves invalid drafts. Real history-capacity
   rejection rolls back with no records, version, events or history changes.

Actual focused evidence:
- `node --test tests/domain/annotation*.test.ts`: 35 passed, zero failures.
  Files: annotations.test.ts (3), annotation-controller.test.ts (5),
  annotation-independence.test.ts (27). The latter includes 26 operation/scope cases
  plus paint/erase/fill/layer/growth integration.
- `npx playwright test tests/annotations.spec.ts tests/editor.spec.ts tests/navigation.spec.ts`:
  12 passed (16.8 seconds). Four new area tests include exact purple edge pixel
  values [221,166,255,255] and unchanged interior pixels at DPR 1/2, gesture
  cancellation/capture/blur/resize/tool switching, overview numeric editing,
  native text undo, no-op Apply, lifecycle/history and 640x452 layout. Existing
  targeted-render and navigation checks still pass. GPU teardown reports zero
  contexts, textures and buffers. Screenshots were visually inspected.
- Build and formatting passed for the UI implementation. Final full regression
  suite is being run separately before completion.

Native macOS smoke (15.8.1 / 24H32, arm64):
- `npm run build:desktop`: PASS; locked release bundle built successfully.
- Launched a separate temporary copy named Tilewright TW-030, with a unique test
  bundle ID and ad-hoc signature to leave existing Tilewright windows untouched.
  Observed bundled `tauri://localhost`, Canvas ready and the area controls.
- Through native accessibility controls created Native house at [0,8)x[0,8),
  Detail, with the exact two-line description “Forge downstairs.\nHome upstairs.”
  The UI displayed stable ID area-92faafad-477a-4309-8f1e-5802363308ad.
- Changed maximum X to zero: clear bounds feedback, original Create undo label
  unchanged. Corrected maximum X to 12, changed tier to Locality and applied.
  Undo restored Detail and [0,8); Redo restored Locality and [0,12). Delete removed
  only the area; Undo restored the same ID, bounds, tier and multiline description.
- Inspected the native selected outline and panel in a screenshot. This is a
  packaged WKWebView authoring/lifecycle smoke, not a native drag, large-map,
  performance, project-save or codec measurement. Browser tests cover captured
  drawing gestures at both DPRs. No new label-rendering/performance claim is made.

Scope/decisions: New area defaults to the map-origin 1x1 rectangle and requires a
name; numerical editing remains available at any zoom and with hidden layers.
All external document changes conservatively cancel unfinished drafts. Neither
choice adds a new confirmed product requirement. Labels/collision behavior remain
TW-031, browsing/focus TW-032, and file/export codecs their existing tickets.
Synchronous list/draft work has no large-annotation benchmark; rendering refinements
remain TW-049 and history/memory TW-050 under AGENTS.md. No blocker was needed.

## Final validation and delivery — 2026-11-18

- `npm run build`: PASS, both strict TypeScript configurations and Vite production
  build. Existing >500 kB bundle warning remains; no new budget pass is claimed.
- `npm test`: PASS, 233 domain tests and 103 Chromium/WebGL tests, zero failures.
  Final browser duration: 5.2 minutes.
- `npm run format:check`: PASS, Prettier and Rust formatting.
- `npm run build:desktop`: PASS, release macOS app; native lifecycle smoke above.
- Local Markdown link check: PASS for README and named-area record.
- `git diff --check`: PASS. `wrk validate`: PASS, 57 tickets.
- `.wrk/wrk-58cdb442.md` matches its initial snapshot exactly and is excluded from
  staging/commit. Initial index was empty. No unrelated file was modified.

Logs, original unrelated-file snapshot, native app-copy path, focused and final
validation outputs, and the three inspected Chromium screenshots are retained in
ignored `.wrk-runs/wrk-0d9194dc-validation/`. The native screenshot was inspected
in the CUA tool output; no saved native screenshot file is claimed.

All implementation and required validation are complete. No blocker remains.
Mark done and create the requested Git commit containing only this ticket's
implementation, tests, documentation and WRK update, with wrk-0d9194dc in the
message. Report success only after that commit exists; do not start another ticket.
