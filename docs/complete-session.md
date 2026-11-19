# Complete drawing, rearrangement and annotation session

TW-048 verifies success criteria 1–6 in [INTENT.md](../INTENT.md). It adds
repeatable integration evidence for the working baseline; it does not change
product behavior or introduce another performance gate.

## Repeat the automated session

With the pinned toolchains from [desktop development](desktop-development.md):

```sh
node --test tests/domain/complete-session.test.ts
npx playwright test tests/complete-session.spec.ts
npm run build
npm test
npm run format:check
```

`tests/fixtures/complete-session.ts` starts an empty 128 × 128 document with
Terrain, Walls and Furniture layers. It authors content through the actual
drawing, fill, registry and annotation controllers. The house occupies
`[60,68) × [60,68)`, crossing both 64-tile chunk lines. Its asymmetric roof,
filled interior, erased door, furniture, and occupied destination distinguish
movement, overwrite, empty-cell transparency, rotation and flips.

The session uses raw and named paint, a sized pencil, eraser, eyedropper, fill,
line, and both rectangle styles. Explicit growth produces `[-64,6400)` on each
axis (101 × 101 chunks). A second meadow at `[6016,6080)²` and grass on Furniture
exercise offscreen and hidden content. A raw patch with the original grass RGB
must stay unchanged when the registered Grass entry changes. Four complete
annotations name two houses, Willow Village and Green Reach.

Coverage is divided by the evidence each layer can supply:

| Coverage                                     | Evidence                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/domain/complete-session.test.ts`      | Both movement scopes; independent cell oracle including all unrelated and distant cells; every authoring revision undone/redone; composed copy, paste, cut, both rotations and both flips; explicit annotation edits; hidden/offscreen recolor identity |
| `tests/complete-session.spec.ts` UI cases    | Real mouse/keyboard drawing, 8 × 8 selection and three-tile drag, chosen layer controls, transformed paste, explicit description edit and registry dialog; full document comparison after every undo/redo                                               |
| Same spec, renderer cases                    | Actual WebGL label IDs and close/locality/region screenshots at DPR 1/2; near/distant overview images warmed before recoloring; exact pixel readback at 12, 1 and 0.5 CSS px/tile, with Furniture hidden/shown, after recolor/undo/redo                 |
| Existing selection/annotation/recolor suites | Full selection-operation independence matrix, independent transform oracles, DPR 1/2 gestures, exact tier thresholds, complete populated target-scale fixtures                                                                                          |

Full-document comparisons include bounds, ordered layer identities/names,
every occupied run (including covered/hidden/offscreen content), registry records
and all annotation fields. Monotonic version counters and transient tool/camera/
selection state are intentionally excluded. Visibility is an independent project
preference, not an undoable document edit. Same-colored raw tiles remain raw.
Pixel samples avoid label backgrounds/text so they test the underlying map.

## Repeat the desktop walkthrough

Generate a regular project file at a new destination (the script refuses to
overwrite an existing file):

```sh
node scripts/complete-session-fixture.ts /tmp/tilewright-session.tilewright
npm run build:desktop
```

1. In the packaged app, create a 128 × 128 map, grow selected edges, and undo/redo
   growth. Open the generated fixture, discarding only the disposable test map.
2. Select Blacksmith's house in Named areas, Focus area, cancel its draft and
   deselect it. Inspect the 8 × 8 house, original terrain and occupied destination.
3. On Walls, select `[60,68)²`, move three tiles right, undo and redo. Repeat with
   Furniture visible and included; leave Terrain excluded. Copy/paste the house
   at `[80,88) × [60,68)`, rotate and flip it. The house label and bounds stay at
   their authored position until explicitly edited through Named areas.
4. Exercise sized pencil, eraser, eyedropper, fill, line and both rectangle modes;
   undo to restore the original document. Edit an area description explicitly and
   verify undo/redo. Wait for any native document action to finish before the next
   history action; the busy feedback asks the author to retry immediate repeats.
5. Deselect areas before checking ordinary tiers. Detail shows the house labels;
   12.5% shows Willow Village; Fit shows Green Reach. The selected-area exception
   is deliberate and should not be mistaken for a tier failure.
6. Edit Grass from `#335C46` to `#557755`. Check named identity, unchanged raw
   patch, visibility toggles and distant overview, then undo/redo the recolor.

## Recorded desktop result, 2026-11-19

The release app was built on macOS 15.8.1 arm64 with Node 24.22.3 and Rust 1.100.0.
The validation-only Tauri overlay used the name **Tilewright TW048**, identifier
`app.tilewright.tw048`, and 1440 × 1000 requested window size. This isolates test
recovery from the normal app; frontend code and native implementation are unchanged.
The local build log and overlay are in `.wrk-runs/wrk-74cf177c-validation/`.

Observed in WKWebView/AppKit: fixed-size creation and explicit left/top growth;
native Open of the fixture; house focus and all three zoom tiers; named eyedropper,
3 × 3 pencil, eraser, one-cell line and both rectangle modes, and a 36-cell fill.
Six drawing undos returned to Saved. Single-tile selection moved three whole
tiles, three undos returned to Saved, and native copy/paste accepted rotation and
flip before placement. Explicit description Apply displayed the new text with
unchanged 8 × 8 bounds. Registry recolor, undo and a subsequent available Redo
updated the swatch and map while retaining Grass identity. The validation app was
closed and its disposable unsaved edits discarded; the source fixture was preserved.

Native held-drag injection canceled the selection gesture, matching the limitation
already recorded in TW-047. No native 8 × 8 drag success is claimed. The exact
8 × 8 moves, overwritten-content restoration and composed operations are proven
by repeatable controller and Chromium pointer tests, including the existing
DPR 1/2 selection suites. Native single-click/keyboard evidence supplements them.

Retained screenshots (original, unedited captures):

| View             | Native release app                                                  | Automated Chromium                                                                              |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Close/detail     | [Native close](evidence/tw048/native-close.png)                     | [Authored detail](evidence/tw048/chromium-close.png)                                            |
| Locality         | [Native locality after recolor](evidence/tw048/native-locality.png) | [Locality](evidence/tw048/chromium-locality.png)                                                |
| Region           | [Native Fit](evidence/tw048/native-region.png)                      | [Region](evidence/tw048/chromium-region.png)                                                    |
| Composed session | —                                                                   | [Moved/copied houses after full redo and recolor](evidence/tw048/chromium-composed-session.png) |

The storehouse area in the initial fixture is a destination annotation; the
composed UI session fills it with the transformed copy. The small authored
fixture covers integration at distant coordinates, not representative population
or performance. The full suite also exercises the established populated maps.
Rendering/presentation budgets remain TW-049 and large edit/history/memory
refinement remains TW-050 under [AGENTS.md](../AGENTS.md). Exact validation counts
and acceptance review are recorded in [the WRK ticket](../.wrk/wrk-74cf177c.md).
