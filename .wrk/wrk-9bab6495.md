---
id: wrk-9bab6495
title: 'TW-025: Implement overlap-safe selection dragging and whole-tile nudging'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-0b310dfe
priority: high
labels:
  - v1
  - selection
  - implementation
fields:
  sequence: 25
  source: INTENT.md
---
## Outcome

Move selected tiles precisely and restore all affected content with undo.

## Source and scope

**Source:** INTENT.md — Drawing and rearranging; INTENT.md — First-version success criteria.

**Execution order:** 25 of 54. Phase: selection.

**Prerequisite:** [wrk-0b310dfe](wrk-0b310dfe.md) — TW-024: Implement rectangular selections and explicit multi-layer inclusion.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement snapped drag previews and arrow-key nudges using immutable source snapshots and per-layer atomic changes.
- Clear moved source cells, apply occupied destinations, and preserve holes according to the selection contract.
- Handle overlap, cancellation, boundaries, and multi-layer commits through history.

## Acceptance criteria

- [x] An 8 by 8 house moves exactly three tiles by drag or nudges, with walls/furniture together and terrain untouched.
- [x] Occupied cells overwrite destination cells on the same layer; holes preserve prior destination content, including during overlap.
- [x] Undo/redo restores source and overwritten destination cells across every included layer.
- [x] Dragging/snapping never automatically grows the canvas; annotations remain at their exact original bounds and label positions.

## Validation

- Assert exact before/after/inverse cell maps for overlapping moves in all directions, holes, empty selections, and multiple layers.
- Run the intent house-movement example interactively and verify cancellation and out-of-bounds policy.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-026: Implement cut, copy, paste, and repeated selection placement](wrk-54aa1866.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in this session; WRK is the sprint record. Read the
requested skill, AGENTS.md, INTENT.md, README, ticket runner, selection contract,
foundation, desktop, map/history, drawing, editor and navigation guidance.
Prerequisite wrk-0b310dfe is done. Weather report fetched (gpt-6-astra for CS/Math,
opus-5.5 for frontend architecture); retaining requested in-session execution.

Phase checklist:
- [x] Implement immutable overlap-safe move planning and exact inverse tests.
- [x] Integrate snapped composite previews, atomic drag/nudge history and UI;
  verify cancellation, boundary rejection and interaction.
- [x] Audit acceptance, run full validation and record evidence.
- Finalization: mark done and create the scoped commit with wrk-9bab6495.

Index initially empty. Pre-existing `.wrk/wrk-58cdb442.md` is snapshotted in the
ignored validation directory and will remain unchanged and excluded.

Phase 1 validation: `npm run build`, `npm test`, `npm run format:check` PASS:
142 domain tests and 82 browser tests (3.9 minutes).
Phase 2 progress checkpoint: 148 domain tests pass. Focused browser tests exposed a
resize/release race before ResizeObserver delivery; selection pointer sampling
and release now synchronize actual host size before proceeding.

## Implementation and acceptance evidence — 2026-11-18

Implementation locations:

- `src/domain/selection.ts`: immutable, document/version-bound snapshot planning;
  checked integer translation and full-rectangle rejection; clear occupied source
  spans outside D, then write captured occupied destinations. Holes preserve B
  even in overlap; exact raw alpha/registry identity and excluded layers survive.
- `src/editor/selection.ts`: pointer-down capture, same-snapshot snapped previews,
  fresh per-key nudge snapshots, atomic history publication, destination selection
  refresh, no-op/cancel/invalid behavior and committed-observer-error reporting.
- `src/editor/navigation.ts`, `session.ts`: captured pointer/release routing,
  actual-size synchronization to close the ResizeObserver/release race, one/ten
  tile arrow steps, repeat history, text/IME/modifier guards and Space/middle pan
  precedence. Existing context/version/visibility/disposal cancellation applies.
- `src/renderer/chunks.ts`, `tileScene.ts`, `createRenderer.ts`: transient writes
  through normal layer raster/compositing, affected visible-chunk refresh and
  cancellation cleanup, exact interior colors and red invalid bounds. Guard stale
  removed-layer/outdated-bounds caches during cancellation before bridge cleanup.
- `src/SelectionPanel.tsx`, `MapCanvas.tsx`: destination/delta/rejection feedback
  and movement/nudge help. README, `docs/selection-decisions.md` (TW-025 section)
  and `docs/navigation.md` describe shipped semantics and decisions.
- `tests/domain/selection-move.test.ts`, `selection-controller.test.ts`,
  `tests/selection-move.spec.ts`, movement fixture in `tests/fixtures/selection.ts`
  and editor harness: exact independent cell oracles/inverses, interaction and
  real WebGL checks. Updated TW-024's staged inside-drag expectation.

Acceptance audit:

1. 8x8 house: [60,68) squared, grab (62,62), release (65,62) yields [63,71) x
   [60,68), one transaction/undo. W/F are explicitly included; T stays excluded
   even after switching active layer to Terrain. All 64 resulting W cells retain
   the stone registry ID, replacing 24 destination wall cells; furniture C/D/Q
   moves and E beneath an incoming hole remains (four occupied F cells). Complete
   map oracles and undo/redo compare every included and excluded cell. Three
   independent Right keydowns also move the rectangle exactly three tiles; each
   captures fresh content and adds one undo entry as the contract specifies.
2. Hole/overlap correctness: complete before/after/inverse maps for +/-X, +/-Y,
   four diagonals and nonoverlapping moves; multiple layers, different extents,
   raw alpha-zero and partial-alpha values, empty selections, origin returns.
   Sparse plan writes never read values already overwritten by earlier writes.
   Domain raster buffers match actual committed rasterization on all layers.
3. Atomic inverse/history: one drag versus independent key/repeat steps, complete
   undo/redo source/destination restoration, no-op redo/checkpoint preservation,
   stale/cross-document snapshot and history-capacity rejection. All-layer
   visibility/removal/context cancellation prevents stale/subset publication.
4. Fixed bounds/annotations: signed and partial edges in every direction/corner,
   exact edge touching allowed, unsafe arithmetic/spill rejects, all-hole edge
   rectangle rejects too. Invalid preview is red with actionable feedback and
   leaves original tiles/selection on release. Full annotation records (bounds,
   anchor, name, description, tier), registry/layer metadata and terrain remain
   identical. No canvas-growth command is issued by move/snapping.

Actual validation on macOS 15.8.1 (24H32), arm64, Node 24.22.3, Rust 1.100.0:

- Phase 1 build/full tests/format: PASS, 142 domain + 82 Chromium cases (3.9m).
- Integration domain suite: PASS, 148 tests. Focused selection UI suite: PASS,
  9 cases (16.2s), including DPR 1/2, release-only drag endpoints, key repeat and
  Shift ten, native text/modifier routing, Space/middle pan, boundary/empty moves.
- Focused tests initially exposed a resize/release race; fixed by synchronizing
  host size before sample/commit and reran successfully. Review also identified
  stale removed-layer preview caches; added a guard and a renderer-ready UI test.
- Integration full suite before the last regression case: PASS, 148 domain +
  86 Chromium cases (4.4m). Final full validation follows below.
- `npm run build:desktop`: PASS after final renderer guard; locked release arm64
  Tauri app, 10.61 MiB. No native source/dependency or permission changes.
- Actual framebuffer samples during three-tile house preview at DPR 1 and 2:
  cleared source terrain [51,92,70,255], registered destination wall
  [177,139,77,255], C [170,187,204,255], D [221,238,255,255], transparent Q reveals
  wall [177,139,77,255], hole-preserved E [255,0,0,255]. Inspected saved preview
  screenshots and the invalid red outline at the map edge. No live document
  version/history/content invalidation changes during these previews.
- Automated interactive Chromium runs the full intent house movement, exact
  undo/redo, cancellation (Escape/capture/cancel/blur/buttons/Space/context/resize)
  and out-of-bounds policy. The ordinary Google Chrome fixture was also inspected
  through CUA, but the browser connector was unavailable and native input later
  returned noWindowsAvailable; no successful Chrome-native drag is claimed.
- Isolated copied packaged WKWebView app launched at tauri://localhost, Canvas
  ready. Native clicks/keys verified empty and painted one-cell selections moved
  exactly three tiles, no history for empty movement, rejection at x=-1 with
  bounds unchanged, three Cmd+Z and three Cmd+Shift+Z restoring painted movement.
  Cmd+W exits. Copy-only bundle identity/name/signature isolated user instances;
  no tracing/instrumentation was added. Native injected rectangle drag canceled,
  consistent with TW-024's buttons=0 automation limitation; this run did not
  instrument events and claims no physical native drag or network-disabled test.
  Native smoke used the copy before the final stale-layer renderer guard; the
  guard is covered by Chromium and the production package was rebuilt afterwards.
  Details: `native-smoke.txt` in the validation directory.

Evidence/logs/screenshots: ignored `.wrk-runs/wrk-9bab6495-validation/`.
Synchronous selected-run capture/planning/history and transient preview rebuilding
may pause for large/highly varied selections. No native presented-frame latency or
whole-app memory budget is claimed. Refinement remains TW-049/TW-050 per AGENTS.md;
the existing Vite >500 kB bundle warning is retained. No extra feature scope or
separate sprint ledger was introduced. Clipboard/transforms remain later tickets.

Final validation (after the stale-layer guard and regression test):

- `npm run build`: PASS, both strict TypeScript configurations and Vite.
- `npm test`: PASS, all 148 domain and 87 Chromium/WebGL tests, zero failures,
  skips or cancellations; browser suite 4.1 minutes. Expected unavailable-WebGL
  diagnostics belong to the passing recovery/retry test.
- Removed-layer cancellation test separately: PASS (1 case, 2.1 seconds), then
  PASS again in the final full suite; canvas stays ready and Undo restores data.
- `npm run format:check`: PASS, Prettier and Rust formatting.
- Final locked `npm run build:desktop`: PASS, 10.61 MiB release app.
- `git diff --check`: PASS. `wrk validate`: PASS (57 tickets). Unrelated
  `.wrk/wrk-58cdb442.md` compares byte-identically with its initial snapshot.

All acceptance criteria are met. Only this ticket's implementation, documentation,
tests and WRK record are included in finalization. The index began empty; the
pre-existing unrelated ticket edit is excluded. Marking done is followed by one
scoped Git commit containing wrk-9bab6495; no push or next-ticket execution.
