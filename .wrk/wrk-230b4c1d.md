---
id: wrk-230b4c1d
title: 'TW-016: Implement the named color registry and stable tile associations'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-e811af32
priority: normal
labels:
  - v1
  - painting
  - implementation
fields:
  sequence: 16
  source: INTENT.md
---
## Outcome

Let authors give colors meaningful names while preserving freeform painting.

## Source and scope

**Source:** INTENT.md — Map use and meaning; INTENT.md — Chosen technology.

**Execution order:** 16 of 54. Phase: painting.

**Prerequisite:** [wrk-e811af32](wrk-e811af32.md) — TW-015: Decide registry identity, existing-color adoption, and collision behavior.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Build registry add/name/edit/remove UI and model commands following the collision/adoption contract.
- Allow selecting a registry entry for painting and display its name alongside its current swatch.
- Implement association/adoption and safe removal behavior consistently across all layers.

## Acceptance criteria

- [x] Named entries have stable IDs, unique canonical colors under the chosen policy, and user-readable names.
- [x] Registry operations apply to hidden and visible layers without losing underlying data.
- [x] Raw colors remain usable; registration/adoption/removal has exactly the documented effect on existing tiles.
- [x] Operations are atomic, undoable, and emit targeted notifications; rejected collisions leave document/history unchanged.

## Validation

- Test every collision/adoption decision case and undo/redo with multiple layers.
- Create grass, mountain, and stone-wall entries and inspect tile associations independently of rendered colors.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-017: Recolor registered entries across layers, history, and overview caches](wrk-8110dbc9.md).


## Implementation and acceptance audit — 2026-11-18

Execution: sprint-execute Strategy A (Orchestrated), in this Codex session with
no delegation. WRK replaced the sprint ledger. Prerequisite wrk-e811af32 was
verified done before implementation. Read AGENTS.md, the requested skill,
INTENT.md, README, ticket-runner, registry decisions, color selection, foundation,
desktop, model, history, editor, layer, renderer, overview and performance guides.
Fetched the skill's weather report (gpt-6-astra listed for CS/Math implementation);
retained the user-selected in-session strategy. Only TW-016 was executed.

Completed phases and implementation locations:

1. Model commands: `src/domain/registry.ts` validates add/edit/adopt/remove over
   CommandHistory. Entries use fresh UUID identities, trimmed nonblank names and
   canonical opaque colors. Immutable previews bind private command batches to
   one controller/document version. Occupied-run planning counts every layer;
   add/adopt and detach/remove commit atomically. Collision, malformed/ambiguous
   ownership, duplicate/unknown IDs, stale/canceled/foreign/reused previews and
   history-capacity failures reject without partial effects.
2. Session and UI: `src/editor/session.ts` adds explicit ID-based paint selection,
   swatch synchronization, successful-add selection and raw fallback on removal
   or undoing creation. `src/RegistryControls.tsx`, `src/App.tsx`, `src/styles.css`
   provide named rows, IDs in tooltips, add/edit hex/RGB/picker dialogs, optional
   adoption (off by default), exact all-layer counts, owner-specific collision
   actions, stale-preview refresh and safe removal confirmation. Cancel/Escape
   and modal shortcut isolation are covered. `src/editor/invalidation.ts` keeps
   name-only changes out of tile rendering while retaining document metadata events.
3. Verification/documentation: `tests/fixtures/registry.ts`,
   `tests/domain/registry.test.ts`, `tests/registry.spec.ts`, and the editor harness
   exercise actual commands and UI. `docs/registry-decisions.md#tw-016-implementation`
   documents the APIs, controls, coverage, and limitations; README, color-selection
   and editor-shell guides now link/explain the implemented behavior.

Acceptance evidence:

- Stable IDs/unique canonical colors/names: R01/R05/R06/R07/R10/R14 tests cover
  equivalent shorthand/full/RGB collisions, combined name/color rejection,
  no-op edits, trimmed and duplicate display names, invalid/nonopaque input,
  malformed/ambiguous metadata, and duplicate/unknown IDs. Undo/redo preserves
  identity; creation after removal or an undo branch receives a new ID.
- All-layer data preservation: the eight-cell Terrain/Buildings walkthrough
  creates Mountain and Stone wall through feature commands and adds Grass.
  Exactly two matching green cells on two layers become Grass; distinct nearby
  green, both gray meanings, annotations, bounds, layer order and occupancy stay
  intact. Hidden and covered cells are queried independently of rendered pixels.
  Removal detaches exactly the two linked cells; undo leaves a third raw match
  raw. Recreating then adopting explicitly links three cells on two layers.
- Raw painting/policy: R02/R03/R04/R12/R16/R17/R18 cover adoption off/on, repeated
  zero-match adoption, alpha-zero/translucent legacy paint, black/white/empty,
  named-vs-raw future paint values on two layers, and fallback without reselection.
  Basic edit/recolor tests preserve old/new-shade raw cells and registered IDs.
- Atomic undo/notifications: every effective domain lifecycle operation round-trips
  complete content snapshots, records one undo step and one complete event, and
  validates no dangling references at notification time. Exact tile spans/IDs and
  metadata-only rename routing are asserted. Rejected collisions/no-ops preserve
  version, content, history/redo and saved/recovery checkpoints; stale session
  submission also preserves paint selection. Oversized add/adopt and detach/remove
  roll back together with redo/checkpoints retained. Committed observer failures
  report a view error without retrying or losing the selected value.

Actual validation (macOS 15.8.1 / 24H32, arm64, Node 24.22.3, Rust 1.100.0):

- Phase 1: `npm run build`, 87 domain tests, 39 browser tests, and
  `npm run format:check` — PASS before UI integration.
- Final `npm run build` — PASS: both TypeScript configurations and Vite.
- Final `npm test` — PASS: 90 domain tests and 46 Chromium/Playwright tests
  (2.1 minutes for browser tests); zero failures, cancellations or skips. The
  unavailable-WebGL case emits its expected error before the successful retry.
- `npx playwright test tests/registry.spec.ts` — PASS: all 7 feature tests,
  including actual dialogs and WebGL readbacks at DPR 1/2. A two-layer 3,136-cell
  Grass adoption retains hidden/covered content; removal and undo/redo preserve
  exact detail/overview pixels with distinct Mountain/Stone wall swatches.
- Final `npm run format:check` — PASS: Prettier and Rust formatting.
- `npm run build:desktop` — PASS: release arm64 Tauri .app (10.60 MiB), locked Cargo
  build. Copied outside the checkout and launched with no listener on port 1420.
  Native WKWebView at tauri://localhost showed Canvas ready; tested Grass creation,
  duplicate rejection, Escape cancellation, combined name/color edit with the same
  ID, unused removal, raw fallback, and undo restoration without reselection.
  Resize from 1200×800 to 800×600 retained the layout/canvas. Cmd+W followed by
  reopening showed a fresh default map and Canvas ready. Networking was not disabled;
  this is packaged functional smoke evidence, not a native performance measurement.
- Inspected registry rows/removal confirmation and the scrollable 640×452 RGB
  dialog screenshots; controls fit horizontally and action buttons remain reachable.
- `git diff --check` — PASS. Local documentation audit — PASS: 44 relative links
  and anchors resolve. `wrk validate` — PASS: 57 tickets.

Initial validation failures were fixed: TypeScript metadata narrowing, a pixel
oracle that incorrectly assumed run segmentation survives coalescing, a stale-plan
UI test that rewrote the same value, and an overly strict select-label locator.
The corrected tests exercise actual changed state and per-cell appearance. Final
results above supersede intermediate failures; logs are retained rather than hidden.

Logs, source fingerprints/native observations and screenshot artifacts are under
ignored `.wrk-runs/wrk-230b4c1d-validation/` and `test-results/`. No new performance
budget is claimed. Planning/draft scans and commit remain synchronous and can use
substantial transient memory; TW-050 owns large-edit/history/memory refinement.
The existing Vite >500 kB bundle warning and rendering/presentation refinement
remain TW-049. TW-017 retains the dedicated offscreen/populated recolor/cache/latency
work; this ticket implements the edit/collision behavior required by its UI.
Drawing gestures and export/file schemas remain their existing later tickets.

All four acceptance criteria are met; no blocker or scope change was required.
The original ticket requirements are preserved with acceptance boxes checked.
The initially unstaged `.wrk/wrk-58cdb442.md` edit is preserved byte-for-byte and
excluded from the commit. The initial Git index was empty. The completion commit
contains only this ticket's implementation, tests, documentation and WRK update,
with wrk-230b4c1d in its message.
