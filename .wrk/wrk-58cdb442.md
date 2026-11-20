---
id: wrk-58cdb442
title: 'TW-008: Implement pan, anchored zoom, fit-to-map, and coordinate conversion'
status: done
created_at: 2026-11-18T16:50:30Z
depends_on:
  - wrk-c92d1a4b
priority: normal
labels:
  - v1
  - canvas
  - implementation
fields:
  sequence: 8
  source: INTENT.md
---
## Outcome

Let the author move between precise tile editing and a whole-map overview.

## Source and scope

**Source:** INTENT.md — Map size and navigation; INTENT.md — Remaining implementation decisions.

**Execution order:** 08 of 54. Phase: canvas.

**Prerequisite:** [wrk-c92d1a4b](wrk-c92d1a4b.md) — TW-007: Render visible sparse tiles and ordered layers with PixiJS WebGL.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose conventional mouse/trackpad/keyboard navigation controls, zoom limits, and behavior at map edges; document these decisions.
- Implement reversible world/screen/tile conversion, pointer-anchored zoom, panning, and a fit-to-map action.
- Define tool behavior when individual cells are too small to edit meaningfully.

## Acceptance criteria

- [x] Zoom preserves the intended map point under the pointer and does not accumulate coordinate drift.
- [x] Navigation works at tile-detail scale and with all 100 by 100 chunks in view.
- [x] Retina scaling, resized windows, and panel offsets produce correct tile picking.
- [x] Overview mode communicates editing availability instead of silently placing unintended tiles; navigation does not alter document bounds.

## Validation

- Test conversion round trips, tile-edge rounding, zoom limits, and pan bounds.
- Manually use macOS mouse and trackpad navigation through repeated detail/overview transitions.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-009: Add tile grids, emphasized 64-tile chunk boundaries, and scale readouts](wrk-bba25a4a.md).


## Execution — 2026-11-18

Strategy A, executed in this session using WRK state. Prerequisite TW-007 is done.
Read sprint-execute, AGENTS.md, ticket runner, INTENT, README and the referenced
foundation, editor, renderer, desktop, model/history and performance guidance.
Weather report fetched: gpt-6-astra is its CS/Math choice; Opus 5.5 its frontend
architecture choice. No delegation or model switch under Strategy A.
Existing staged/unstaged prerequisite work is preserved. No commits requested
or required by project workflow. Use the pinned local Node 24.22.3 toolchain.

- [x] Phase 1: reversible CSS/world/tile camera math, limits, pan bounds, fit,
  and numerical regression tests; build/test/format.
- [x] Phase 2: session actions, mouse/trackpad/keyboard controls, resize-aware
  sizing, explicit overview editing availability; interaction tests and validation.
- [ ] Phase 3: repeated detail/6400×6400 overview transitions, Retina/panel/resize
  picking, native macOS checks, decision record, final suite and acceptance audit.

Native physical-input validation will be reported according to what is actually
available; automated wheel/gesture events will not be described as physical hardware.

Phase 1: build, 55 domain tests, 13 browser/WebGL tests, and format checks pass.
Camera regressions cover 10,000 anchored zoom round trips, signed tile boundaries,
cancellation at distant origins, fit in minimum-size hosts, limits and bounded pan.
Logs: `.wrk-runs/wrk-58cdb442/phase1-{build,tests,format}.log`.

Phase 2: build, 56 domain tests, 16 browser/WebGL tests (27.7 s), and format
checks pass. Controls, fractional/line/page wheel input, cumulative WebKit-shaped
gestures, pointer capture/cancellation/blur, focus and teardown are covered.
DPR 1/2 and four window sizes preserve CSS picking and unchanged bounds/history.
Two test assumptions were corrected: CDP's injected wheel delta scales with
emulated DPR (the test now checks the delivered event values), and a single
zoom event is deliberately capped to exp(2), so two are needed to hit 800%.
Logs: `.wrk-runs/wrk-58cdb442/phase2-{build,tests,format}.log`.
Decisions are documented in `docs/navigation.md`; no dependencies changed.


## Implementation complete; manual validation blocked — 2026-11-18

All implementation acceptance criteria have automated evidence below. Phase 3's
required manual mouse/trackpad validation is **not complete**. Status is blocked,
not done. Original ticket prose is preserved above; no separate sprint ledger,
workers, commits, dependency/lockfile changes, or other-ticket updates were made.
Existing prerequisite staged/unstaged changes remain intact.

### Remaining blocker and exact resume step

The Validation section requires: “Manually use macOS mouse and trackpad navigation
through repeated detail/overview transitions.” This unattended session can operate
native UI through synthesized clicks, drags, scrolls and keys, but has no physical
mouse/trackpad or supported native pinch-injection control. Actual physical
trackpad two-axis scroll, pinch delivery, momentum and modifier-scroll behavior
were not observed. Synthetic browser gesture events are **not** a hardware pass.
A CUA horizontal-scroll attempt did not visibly move the map, so it is not counted
as a successful native horizontal trackpad check; browser deltaX tests do pass.

To unblock: manually launch the built macOS app and perform repeated F/0 detail
and overview transitions using a physical mouse and trackpad, including horizontal
and vertical two-finger scroll, pinch about different map points, Cmd-scroll,
Space-drag, middle drag, window resize and map edges. Verify no browser-page zoom,
anchor jumps, stuck drag state or unintended document edits, and that the overview
warning stays visible while the canvas has keyboard focus. Record actual results
through `wrk update ... --body-file ...`; fix any failures. Only then mark done.
This is the sole outstanding required validation; no feature work is deferred.

### Implementation and decision locations

- `src/editor/viewport.ts`: reversible CSS/world conversions, tile-center mapping,
  signed half-open tile picking with floating-point edge tolerance, pointer-anchor
  zoom, fit, limits and bounded overscroll. No DPR in input coordinates and no
  tile rounding of camera positions.
- `src/editor/navigation.ts`: host-local conversion, fractional/line/page scroll,
  Cmd/Ctrl-wheel zoom, cumulative WebKit gestures with duplicate-wheel suppression,
  primary Pan/Space/middle drag and pointer capture, blur/cancel/lost-capture
  cleanup, temporary Space routing and listener/subscription disposal.
- `src/editor/session.ts`: transient canvas size and camera actions, Pan/Inspect/Fit
  enablement, canvas-only F/0/+/-/arrow/H/I shortcuts, overview action reasons and
  shared `editableTileAt` gate for sub-8-pixel cells and out-of-bounds coordinates.
  Persistent document commands and history remain independent of navigation.
- `src/renderer/mountRenderer.ts`: ResizeObserver/initial measurement supplies
  current CSS host dimensions to the session; existing DPR/resolution lifecycle
  remains owned by the renderer.
- `src/MapCanvas.tsx`, `src/App.tsx`, `src/styles.css`: navigation binding, help,
  pressed Pan/Inspect controls, Fit map, continuous-current plus preset zoom,
  visible overview warning, grab cursors and overscroll suppression. Warning and
  caption stack above a keyboard-focused canvas (a native smoke-discovered fix).
- `tests/domain/viewport.test.ts`, `tests/navigation.spec.ts`,
  `tests/navigation-scale.spec.ts`: numerical, input, lifecycle, target-scale and
  document-isolation regressions. `tests/editor.spec.ts` now verifies selector zoom
  about canvas center. `tests/editor-harness.tsx` loads full fixtures only in tests.
  `tests/fixtures/populated.ts` extracts the existing browser fixture adapter from
  `tests/tiles-harness.ts` so both renderer and navigation tests share complete data.
- `docs/navigation.md`: control table, limits, bounds policy, 8-pixel editing gate,
  numerical conventions, native/WebKit event references, validation and scope.
  README and editor/renderer/performance guides link the new behavior;
  package format scripts include the decision record. No production fixture/probe.

Chosen defaults: 24 CSS pixels/tile at 100%; zoom 1/1024–8, with a smaller minimum
only when needed for Fit; centered Fit with 24-pixel padding; minimum meaningful
editing size 8 CSS pixels/tile; pan retains min(48 px, half viewport, half rendered
map) on each axis. Pan clamping does not override zoom anchoring. Zoom around empty
margin can move the map farther away; pan bounds or Fit recover it. Resize/growth
preserve the camera. No grid/scale-overlay or TW-010 overview-cache work was added.

### Acceptance audit

1. **Anchored, drift-free zoom:** 10,000 overview/detail inverse zoom pairs preserve
   the anchor/camera within 1e-9 tile; no camera rounding. Browser tests perform
   20 wheel zoom pairs at both DPRs, cumulative gesture scale 1→1.25→2→1 and
   duplicate-wheel suppression. Zoom limits and signed edge picking pass.
2. **Detail and all 100×100 chunks:** both complete 6,400×6,400 maps with four
   overlapping layers perform three fit→anchored zoom→fractional pan→fit→100%→arrow
   pan cycles. Frontier contains 6,620,700 occupied layer cells; heartland contains
   24,025,200. Every Fit contains all bounds, produces the same camera, disallows
   editing, and returns the center to tile (3200,3200) at 100%. No page errors.
3. **Retina, resize and offsets:** Chromium DPR 1/2 input tests and existing
   1200×800, 900×620, 640×480 and 640×452 layout checks pass. Same-size DPR-change
   notification still resizes the buffer. Native Retina screenshots at 1200×800,
   900×620 and 640×480 confirm fit/notice/layout; an interior point after minimum
   resize picks tile (128,128). A native center click just above the exact y=128
   edge correctly reported y=127, illustrating half-open picking rather than a
   forced center-tile assumption.
4. **Explicit overview/no bounds edits:** visible status and accessible disabled
   reasons explain overview; clicking reports that reason; shared tool picking
   returns null below 8 pixels or outside bounds. Browser snapshots keep exact
   document version, bounds, storage counts, history and saved state through all
   navigation. Native Undo/Redo remain disabled and dimensions stay 256×256.

### Actual final validation evidence

Machine: MacBookPro18,3 / Apple M1 Pro, arm64, 16 GiB RAM,
macOS 15.8.1 (24H32), local Node 24.22.3 and Rust 1.100.0.

After the native stacking correction, final commands all passed:

- `npm run build`: both strict TypeScript configurations and Vite; 798 modules.
- `npm test`: **56/56 domain tests** and **18/18 browser/WebGL tests**, no skips
  or failures; browser suite **41.0 s**. Full existing model/fixture, history,
  resource, pixel-composition, density and disposal regressions remain green.
- `npm run format:check`: Prettier (including navigation guide) and Rust fmt pass.
- `npm run build:desktop`: release compile **11.76 s**; bundled
  `src-tauri/target/release/bundle/macos/Tilewrite.app`, **10.58 MiB**.
- `git diff --check` and `wrk validate` pass (56 tickets).
- New source/doc files have final newlines and no developer-specific absolute
  paths. Production JavaScript contains no editorProbe/tileProbe/rendererProbe or
  representative fixture identifiers. No dependency/lockfile or Rust changes.

Final logs: `.wrk-runs/wrk-58cdb442/final-build.log`, `final-tests.log`,
`final-format.log`, `final-desktop-build.log`. The same directory retains
`source-hashes.json` (implementation/test/lockfile/bundle SHA-256),
`frontier-navigation.json`, `heartland-navigation.json`, and overview/detail PNGs.
These are local ignored validation artifacts; this ticket retains the summary.

At DPR 2 and a 752×634 CSS canvas, both fixtures fit to zoom
0.0038151041666666667 (0.3815104167%), with map screen bounds (83,24)–(669,610).
Automation wall times per cycle: frontier **1173/876/869 ms**, heartland
**2779/2543/2505 ms**. These include multiple actions and screenshots and are
**not presented-frame latency, native performance or TW-010 budget passes**.

### Native UI observations and limitations

With no listener on development port 1420, launched the packaged app at
`tauri://localhost`, quit/relaunched the final build, and saw one ready canvas.
CUA native input verified Fit (9.08% at 1200×800), 100%, arrow/Shift-arrow pan,
vertical scroll, H/I selection and drag displacement (96×48 physical screenshot
pixels, i.e. 48×24 CSS pixels at Retina). Repeated F/0 transitions return to the
same overview. Resize to 900×620 changes Fit to 6.27%; minimum 640×480 remains
usable; return to 1200×800 restores 9.08%. Dimension text and disabled history
controls are unchanged. Final app remains open at the restored overview size.
The native smoke used the fresh empty default document; populated-map checks are
Chromium. Networking was not disabled, and no new offline-network claim is made.

Initial native inspection found that `:focus-visible` raised the canvas above
an unlayered overview notice. Both notice and status caption now explicitly stack
above it. Final native screenshots confirm the warning remains visible with
Canvas keyboard focus, including after resizing. The full suite and native
package were rebuilt after that correction.

Earlier test corrections were test-only: normalize signed zero in expected tile
addresses, account for CDP wheel injection's DPR scaling while asserting actual
CSS event deltas, and use two bounded wheel events to reach maximum zoom. No
production DPR multiplier was introduced. No test or failed requirement was
silently skipped. Physical trackpad validation remains the blocker stated above.
