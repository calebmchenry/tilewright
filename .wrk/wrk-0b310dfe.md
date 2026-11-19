---
id: wrk-0b310dfe
title: 'TW-024: Implement rectangular selections and explicit multi-layer inclusion'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-7cd74024
priority: normal
labels:
  - v1
  - selection
  - implementation
fields:
  sequence: 24
  source: INTENT.md
---
## Outcome

Let the author choose a tile rectangle and exactly which layers it affects.

## Source and scope

**Source:** INTENT.md — First-version scope; INTENT.md — Map use and meaning; INTENT.md — Drawing and rearranging.

**Execution order:** 24 of 54. Phase: selection.

**Prerequisite:** [wrk-7cd74024](wrk-7cd74024.md) — TW-023: Define selection, clipboard, transform, and out-of-bounds semantics.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement rectangle creation, selection overlay, bounds/dimension readout, deselect, and tool switching behavior.
- Default selection scope to the active layer and expose an explicit set of additional layers.
- Capture tile payloads by layer with empty positions distinguished from occupied cells.

## Acceptance criteria

- [x] An 8 by 8 rectangle is selectable precisely, including across chunk boundaries and at map edges.
- [x] Walls and furniture can be included together while terrain stays excluded; changing the active layer does not silently broaden an existing selection.
- [x] Selection alone does not modify tiles, mark the document dirty, or add a history entry.
- [x] Named areas and labels are never included, even when fully enclosed by the rectangle.

## Validation

- Test reverse drags, one-cell/empty selections, changing layer scope, and boundary clipping.
- Verify overlays, tile counts, and dimensions against known multilayer fixtures.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-025: Implement overlap-safe selection dragging and whole-tile nudging](wrk-9bab6495.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), in this Codex session, using WRK state instead of a
sprint ledger. Prerequisite wrk-7cd74024 is done. Read the requested skill,
AGENTS.md, INTENT.md, README and relevant project guidance. Weather report fetched;
it lists gpt-6-astra for CS/Math coding and opus-5.5 for frontend architecture.
Retaining the requested in-session execution without delegation.

Phase checklist:
- [x] Implement immutable tile-only payload capture, transient selection creation,
  pinned layer membership and lifecycle; validate build/tests/format.
- [x] Wire Select/V, pointer capture/cancellation, explicit layer controls and Pixi
  overlay/readouts; validate known multilayer fixtures and interaction regressions.
- [x] Audit acceptance criteria, run full validation, record evidence, mark done
  and create a scoped commit containing wrk-0b310dfe.

Initial index is empty. The pre-existing unstaged `.wrk/wrk-58cdb442.md` edit is
saved for byte comparison and will remain excluded. Movement, clipboard and
transforms remain TW-025 through TW-028. Until TW-025, dragging inside a completed
selection leaves it unchanged and explains that Deselect starts a new rectangle.

Phase 1 validation: production build PASS; 127 domain and 77 browser tests PASS;
format:check PASS. Corrected a test helper that double-added the tile-center offset.


## Implementation and acceptance evidence — 2026-11-18

Completed both implementation phases and the acceptance audit with Strategy A.
The original ticket requirements are retained above; no other ticket was executed.

Implementation locations:

- `src/domain/selection.ts`: immutable tile-only snapshots with a shared world
  rectangle, exact width/height/geometric count, source version, stable layer IDs,
  local occupied runs and per-layer occupancy. Full extents encode holes;
  `selectionCell` returns null only for inside holes and rejects outside or
  excluded-layer queries. Raw RGBA (including alpha zero) and registry IDs remain
  exact. Unknown/duplicate/empty membership, invalid bounds and unsafe counts reject.
- `src/editor/selection.ts`: transient creation/preview/committed selection stores,
  clipped inclusive/reverse endpoints, visible-active-layer defaults, pinned
  membership, explicit inclusion, cancellation and idle payload/count refresh.
  Hidden/removed included layers clear the whole selection; restoration does not
  reselect. Active layer/name/order/new-layer changes do not broaden membership.
- `src/editor/session.ts` and `src/editor/navigation.ts`: Select/V action and gates,
  primary pointer capture and release endpoint, outside-start rejection,
  Escape/Deselect, context/capture/blur/missing-button cancellation, navigation
  precedence, painting-tool clearing, and undo/redo action clearing.
- `src/SelectionPanel.tsx`, `src/App.tsx`, `src/MapCanvas.tsx`, `src/styles.css`:
  exclusive bounds, dimensions/geometric positions, named/identified layer
  checkboxes and occupancy, disabled hidden/last-layer choices, help and shortcuts.
- `src/renderer/createRenderer.ts` and `mountRenderer.ts`: cyan selection overlay
  independent of Inspect and tile/overview caches, with disposable subscriptions.
- `tests/fixtures/selection.ts`, `tests/domain/selection.test.ts`,
  `tests/selection.spec.ts`, `tests/editor-harness.tsx`: known layered fixture,
  six domain cases and five browser cases with DPR 1/2 screenshot/pixel checks.
- `docs/selection-decisions.md#rectangle-selection-implementation-tw-024` and
  README: shipped behavior, implementation seams and explicit delivery limits.

Acceptance audit:

1. Exact 8x8: all four drag directions normalize to [60,68) squared across both
   visual 64-tile and storage 32-tile boundaries. Tests also select exact 8x8
   rectangles at negative top/left and partial bottom/right edges; far captured
   endpoints clip at each edge. One-cell clicks, all-hole selections, outside
   starts, release-only endpoints and real outside-host capture are covered.
   Browser panel shows 8 × 8 / 64 positions and X/Y [60,68). All four actual
   framebuffer boundary samples equal cyan [135,223,255,255] at DPR 1 and 2;
   outside samples remain terrain [51,92,70,255]. Deselect restores complete
   original canvas pixels when compared with identical focus-visible styling.
2. Explicit multilayer scope: fixture has 64 registered wall cells, 3 selected
   furniture cells (one transparent), 1 furniture cell outside and underlying
   terrain. Defaults include Walls only; adding Furniture keeps Terrain excluded.
   Every local cell on both included layers matches the document oracle,
   including covered walls and holes. Active-layer changes, rename, reorder and
   layer creation preserve IDs. Last-layer removal and hidden/missing additions
   reject; hiding/removing one included layer clears the whole selection.
3. Transient isolation: tests compare all document runs, metadata, bounds, version,
   complete history state, saved/recovery checkpoints and redo before/after
   creation, preview, scope changes, cancellation and deselection. No document
   event or renderer content invalidation occurs. Replacement cancellation
   restores the previous committed geometry/scope. Painting clears it; Pan,
   Inspect and read-only Eyedropper retain it; New Map/disposal drop it.
4. Annotation exclusion: the fully enclosed house record includes name,
   description, bounds, label tier and anchor. Complete metadata remains identical
   and no annotation fields/records exist in SelectionPayload. Only layer tile
   runs enter capture, including offscreen/covered content on chosen layers.

Documented implementation choices: counts are captured on release rather than
rescanning tiles on each pointer move; geometry preview is immediate. Eyedropper
retains idle selection because it is read-only. Selection geometry is separate
from Inspect measurement and is never a painting mask. In this staged delivery,
inside drags leave selection intact with a Deselect explanation, and arrows still
pan. Movement/nudging, clipboard and transforms remain TW-025 through TW-028.

Actual validation on macOS 15.8.1 (24H32), arm64, Node 24.22.3, Rust 1.100.0:

- Phase 1 `npm run build`, `npm test` and `npm run format:check`: PASS, 127 domain
  tests and 77 existing Chromium tests (3.8 minutes). Fixed a test helper that
  added the tile-center half offset twice before rerunning successfully.
- Focused `npx playwright test tests/selection.spec.ts`: PASS, 5 cases (8.8 seconds).
  Initial final-screenshot comparisons differed only in canvas focus styling;
  restored the same keyboard-focus state and then compared complete image bytes.
  Inspected the actual original/selected/deselected screenshots.
- Final `npm run build`: PASS, both strict TypeScript configurations and Vite.
- Final `npm test`: PASS, all 127 domain and 82 Chromium/WebGL tests, zero failures,
  skips or cancellations; browser suite 4.1 minutes. The expected unavailable-WebGL
  log belongs to the passing recovery/retry regression.
- Final `npm run format:check`: PASS, Prettier and Rust format.
- `npm run build:desktop`: PASS, locked release arm64 Tauri app (10.61 MiB).
  Temporary diagnostic code was restored byte-identically and the ordinary app
  rebuilt afterwards. No tracing code is included in the implementation/commit.
- Native WKWebView smoke: isolated copied app starts at tauri://localhost, Canvas
  ready; Select/V creates a one-cell empty selection, then a one-cell occupied
  selection after existing Fill. Add layer leaves previous membership pinned;
  explicit empty-layer inclusion shows 0 occupied; Undo label remains Add layer.
  Hiding an included layer clears selection with feedback; showing it does not
  resurrect selection. Window zoom works; Cmd+W exits; copied app reopens without
  a Vite listener on 1420. Copy-only bundle identity/name and ad-hoc signature
  isolated this test from already-running user apps; code/assets were unchanged.
- Native drag automation limitation investigated: CUA-injected pointerdown reports
  buttons=0; the traced pointermove reaches the existing missing-button cancellation
  path. This affects existing Rectangle too. Kept the guard intact. No physical
  native drag completion is claimed; exact drag/capture behavior is verified in
  domain/Chromium tests. Networking was not disabled. Trace and observations are
  retained in `native-smoke.txt` in the ignored evidence directory.
- `git diff --check`: PASS. `wrk validate`: PASS, 57 tickets. Unrelated ticket
  compares byte-identically to its initial snapshot (SHA-256
  372b6408112d8e55ac3ead033976a0a21711cbb0fce06eb1d140a569966bc4dd).

Evidence/logs/screenshots are retained in ignored
`.wrk-runs/wrk-0b310dfe-validation/`. No selection latency, whole-app memory or
native presented-frame budget is claimed. Synchronous selected-run capture and
refresh may pause for large/highly varied selections; refinement remains TW-050.
The existing Vite >500 kB bundle warning and presentation refinement remain
TW-049. These do not block feature acceptance under AGENTS.md.

All four acceptance criteria are met. Finalization marks this ticket done and
creates one scoped commit with wrk-0b310dfe in its message. The index began empty;
only this ticket's implementation, documentation, tests and WRK record belong in
that commit. The pre-existing `.wrk/wrk-58cdb442.md` edit remains excluded.
