---
id: wrk-dfb3bfaf
title: 'TW-031: Render zoom-dependent labels and annotation overlays'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-0d9194dc
priority: normal
labels:
  - v1
  - annotations
  - implementation
fields:
  sequence: 31
  source: INTENT.md
---
## Outcome

Show the appropriate names at tile, village, and region scales without overwhelming the map.

## Source and scope

**Source:** INTENT.md — Named areas and labels; INTENT.md — Chosen technology.

**Execution order:** 31 of 54. Phase: annotations.

**Prerequisite:** [wrk-0d9194dc](wrk-0d9194dc.md) — TW-030: Implement named-area creation, descriptions, tiers, and explicit editing.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Implement label culling, tier visibility thresholds, placement, and readable text styling through PixiJS.
- Update labels for annotation edits and camera changes with bounded resource use.
- Keep selected-area outlines/labels understandable while drawing tools and selections are active.

## Acceptance criteria

- [x] Detail, Locality, and Region labels follow the documented ranges and transition predictably during zoom.
- [x] A far-out view avoids a cluttered collection of house labels while showing relevant larger areas.
- [x] Names and descriptions remain document data even when labels are culled or hidden.
- [x] Tile transforms do not shift labels or area bounds; annotation edits invalidate only affected visuals.

## Validation

- Check screenshots at each tier and immediately above/below visibility thresholds.
- Profile navigation with a representative concentration of named areas and verify label resources are released on document changes.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-032: Add named-area browsing and scale inspection](wrk-efb169f5.md).

## Execution progress — 2026-11-18

Strategy A (Orchestrated), executed in this session with WRK state. Prerequisite
wrk-0d9194dc is done. Read sprint-execute, AGENTS.md, INTENT.md, README, ticket
runner, named-area decisions, and domain/editor/rendering/development guidance.
Weather report fetched (gpt-6-astra for CS/Math, opus-5.5 for frontend architecture);
no delegation. Node 24.22.3 matches the project pin. Build, test, formatting and
release commands are available. Recent commits use descriptive prefixes and WRK IDs.
The index starts empty; unrelated .wrk/wrk-58cdb442.md is snapshotted and excluded.

Phase checklist:
- [x] Pure tier, culling, placement, grapheme truncation and collision rules.
- [x] Pixi text/selected overlays, targeted invalidation and bounded resource lifetime.
- [x] Threshold screenshots, tool/data isolation and concentrated-area navigation profiling.
- [x] Final acceptance audit and full validation.
- Finalization gate: mark done and create the requested scoped Git commit before reporting success.

Performance limitations alone remain deferred to TW-049/TW-050 under AGENTS.md;
functional correctness and annotation data integrity remain required.

Phase 1 passed: npm run build, 238 domain tests, 103 Chromium/WebGL tests
(4.8 minutes), and npm run format:check. Exact CSS thresholds, both zoom
directions, fit, offscreen centers, selected/draft substitution, grapheme truncation,
edge insets, deterministic collision order and exact four-pixel gaps are covered.
The first build caught use of an ES2023 array helper in a test; changed to the
project-compatible ES2022 form, then reran build and domain validation successfully.

## Implementation and focused validation — 2026-11-18

- `src/renderer/areaLabels.ts`: pure CSS-scale tier ranges, true rectangle centers,
  viewport/anchor culling, grapheme ellipsis, inset placement and deterministic
  selected-first/ASCII-ID collision suppression. No document writes.
- `src/renderer/areaLabelScene.ts`: Pixi Text and dark backgrounds at 13/15/17 CSS
  px, selected purple border, retained per-visible-candidate measurements and
  per-accepted-label visuals. Unchanged Text objects/geometry are reused. IDs trigger
  collision relayout; only changed text/style is regenerated. Culled/deleted labels
  are destroyed and idle pooled text textures explicitly released after rendering.
- `src/editor/annotations.ts`: selected/draft/gesture label projection sharing the
  existing outline bounds. Invalid draft geometry/name suppresses the old label.
- `createRenderer.ts`, `mountRenderer.ts`, `MapCanvas.tsx`, `navigation.ts`: overlay
  subscriptions, hit testing, explicit Area-only label selection even in overview,
  renderer/session cleanup. Drawing tools and tile selections pass through labels.
- `docs/named-area-decisions.md#label-rendering-implementation-tw-031` and README:
  behavior, resource lifetime, implementation decisions and validation limits.

Focused evidence:
- Production build and formatting passed after integration. Existing >500 kB
  bundle warning remains; no bundle-budget pass is claimed.
- `npx playwright test tests/area-labels.spec.ts tests/annotations.spec.ts`: first
  nine checks passed (18.7 s). The expanded ten-check run passed nine; the new
  density/draft assertion failed only on 320.00000000000006 vs 320. Corrected the
  expectation to compare exact displacement from the original floating-point
  anchor; the focused density/draft rerun passed (1 test, 2.3 s). Final full suite
  will cover all ten together. Earlier test-only API typo commitTransform was
  corrected to the existing commitPlacement before browser execution.
- Threshold evidence checks 24, 8.000001, 8, 7.999999, 3, 2, 1.000001, 1,
  0.999999 and 0.24 CSS px/tile in both directions at DPR 1/2, including actual
  WebGL light-text pixel counts, exact tier sets and constant CSS heights.
- Visually inspected all twelve immediately-above/exact/below threshold screenshots
  at both DPRs. Also inspected selected-house-with-region, long plain-text Unicode
  edge truncation, purple area plus cyan tile-selection overlay, and populated-map
  detail/region screenshots. Text is readable, with no old-tier labels lingering.
- Tests check collision winner/reselection, offscreen anchors, small-host omission,
  descriptions retained when hidden, undo/redo rename, offscreen edit visibility,
  unchanged tile/overview counters for annotation edits, unchanged unrelated label
  IDs/geometry, and unchanged label projections during real nudge/rotation/undo/redo.
  Existing annotation independence tests cover all tile operation variants/scopes.
- Actual input tests select a Region label in overview, paint a tile through a
  selected house label, then create a cyan tile selection through that label while
  retaining the purple selected area. Annotation bytes remain unchanged.

Concentrated-area profile:
- `npx playwright test tests/area-labels-scale.spec.ts`: 2 passed (1.1 minutes).
  Both complete 6,400-square golden documents are populated: frontier-v1 has
  6,620,700 occupied layer cells; heartland-v1 has 24,025,200. Each has 1,089
  valid named areas: 891 houses, 99 villages, 99 regions, with exact multiline
  descriptions. Canvas 960x640 CSS pixels, DPR 2, Chromium WebGL 2.
- Three 120-step pan/zoom passes per map cover all tiers and both boundaries.
  Initial per-pass CPU navigation/render-submission p95: frontier 2.8/2.2/2.2 ms;
  heartland 3.0/2.7/2.6 ms. Maximums: frontier 16.0/2.8/2.6 ms; heartland
  8.8/3.4/3.6 ms. These are browser CPU proxies, not native presented frames.
- At most 32 live labels and 90 visible candidates in either profile. Every sample
  checks live = created - released, measurements = current candidates, correct
  tier and tracked live GPU textures <= tile + overview + labels + 4 shared.
  No house labels appear at Region scale. Annotation JSON remains byte-identical.
- Post-GC browser heap growth from first to third equal-endpoint pass: frontier
  833,784 bytes; heartland 755,700 bytes. Not whole-app physical memory.
- Three document replacements per test each release all prior label objects and
  measurements, leave zero labels in the new empty document and <=4 shared textures.
  Final teardown: zero contexts, textures and buffers.
- Raw samples, source SHA-256s, fixture golden records, environment and screenshots
  retained in `.wrk-runs/wrk-dfb3bfaf-validation/profile-initial/`. Focused PNGs and
  threshold JSON retained in `focused-artifacts/`; corrected density run in
  `density-artifacts/`. Full suite/release build results are pending below.

Limits and decisions: metadata scan/collision layout remains synchronous; no spatial
annotation index, hierarchy, custom tiers or file codec is introduced. Pixi retains
its bounded 1,000-entry metrics cache/shared font machinery; live label/GPU resources
are released. Selected labels use their authored tier's font size. Native frame
presentation and process-group physical memory remain unmeasured and deferred to
TW-049/TW-050 under AGENTS.md. No performance claim blocks feature delivery.

## Final acceptance audit and delivery evidence — 2026-11-18

All four acceptance criteria are met:
1. Detail/Locality/Region use the documented exact ranges, with immediate switching
   in both directions at p=8 and p=1. DPR and the separate p=2 overview switch do
   not change tier. Threshold screenshots and actual text pixels verify this.
2. Far-out populated views show relevant Region labels with deterministic collision
   suppression and zero ordinary house labels. Only one selected area can override
   its tier, with priority and purple styling; it never reveals other houses.
3. Names/descriptions remain byte-identical document records during culling, zoom,
   collision suppression, hidden-layer changes and tool use. Empty/Unicode/multiline
   descriptions remain panel data; no label cache enters document/history state.
4. Actual tile moves/rotations and undo/redo retain label bounds, centers, text and
   object identity. The full existing annotation-operation matrix also passes.
   Annotation edits update affected text/placement and collision dependents only;
   unrelated text is reused and completed tile/overview images stay unchanged.

Final commands:
- `npm run build`: PASS (both TypeScript configs and Vite production assets).
- `npm run format:check`: PASS (Prettier and Rust formatting).
- `npm test`: PASS, 238 domain tests and 111 Chromium/WebGL tests; zero failures.
  Browser duration 6.1 minutes. Includes all expanded density/draft checks and
  both complete populated-map label profiles.
- `npm run build:desktop`: PASS, locked optimized macOS app bundle, 10.63 MiB;
  Rust release compilation 10.72 s. Existing large-JS-bundle warning is unchanged
  in status and deferred; no performance-budget pass is claimed.
- Final profile per-pass CPU submission p95: frontier 2.7/2.3/2.1 ms; heartland
  3.1/2.6/2.6 ms. Maxima: frontier 8.5/2.9/2.9 ms; heartland 7.4/3.1/4.0 ms.
  Max live labels/candidates remain 32/90; post-GC first-to-third pass growth is
  816,840 / 752,344 bytes. Resource/tier/data/replacement assertions all pass.
  Final raw profiles and screenshots are retained in `final-artifacts/` under
  `.wrk-runs/wrk-dfb3bfaf-validation/`, alongside the exact command logs.
- Local Markdown target check: PASS for README and named-area decisions.
- `git diff --check`: PASS; `wrk validate`: PASS, 57 tickets.
- `.wrk/wrk-58cdb442.md` is byte-identical to its initial snapshot and excluded
  from this ticket's staging/commit. The initial index was empty.

Native release smoke, macOS 15.8.1 (24H32), arm64:
- Copied the fresh release bundle outside the checkout into a unique temporary
  Tilewright TW-031.app, changed only the copy's bundle identity/name and ad-hoc
  signed it. Existing Tilewright windows were untouched. Copy path is retained
  in `native-app-path.txt`. Port 1420 had no listening development server.
- Native accessibility observed bundled tauri://localhost and Canvas ready.
  Created Native house (Detail), Native village (Locality) and Native region
  (Region), each with [0,8)x[0,8) bounds. House description is exactly
  “Forge downstairs.\nHome upstairs.”
- With no selection, visually observed only Native house at 100%, only Native
  village at 12.5%, and only Native region at 3.2768% (toolbar 3.28%, p=0.786432).
  Selecting the house from the panel at Region scale showed its purple-bordered
  label with collision priority, preserving its Detail tier, original bounds and
  two-line description. All four native screenshots were visually inspected in
  the CUA output; no saved native screenshot file is claimed.
- This is a native rendering/authoring smoke, not a native performance, exact
  threshold, save/reopen, physical-trackpad or network-disabled test. Browser
  evidence covers exact boundaries, input routes, pixel densities and cleanup.

No blocker remains. Scope is only TW-031. Browsing/focus remains TW-032; native
presentation and large-scale refinement remain TW-049/TW-050 as authorized.
All implementation and required validation are complete. Mark done and create the
requested commit containing this ticket's code, tests, docs and WRK updates with
wrk-dfb3bfaf in the message. Report success only after the commit exists.
