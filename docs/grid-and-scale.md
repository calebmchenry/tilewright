# Grids and scale

TW-009 decisions, subordinate to [INTENT.md](../INTENT.md) and the
[coordinate contract](foundation-decisions.md). A visual chunk is always
64 × 64 tiles, anchored to world zero. It has no editing or storage boundary.

## Grid rendering

`src/renderer/grid.ts` computes only viewport-intersecting screen-space bands.
`createRenderer.ts` draws them in a separate Pixi Graphics object above the
ordered tile containers. All positions use the same CSS camera transform as
tiles. The grid reads bounds/camera only; it never queries or writes tile data.
The 32-tile texture partitions are independent of the visual lattice.

- Ordinary tile lines use pale gray, one CSS pixel, at up to 22% opacity. They
  fade between 12 and 6 CSS pixels per tile and disappear at 6 or below. At the
  8-pixel editing threshold they remain visible without filling most of a cell.
- Chunk lines use cyan, two CSS pixels, at 65% opacity. Below 24 CSS pixels per
  chunk, draw every 2, 4, 8, … chunks to keep spacing at least 24 pixels. This
  samples the fixed lattice rather than reanchoring it. The footer states the
  actual spacing; omitted lines do not redefine a chunk.
- The outer map boundary is drawn independently, including non-multiples of 64
  and negative bounds. Grid bands are clipped to the map and viewport. A partial
  edge chunk remains part of its original full chunk.
- Line widths are rounded to physical pixels, with centers within half a device
  pixel of the true transformed edge. Filled bands avoid blurred strokes at
  fractional cameras/zooms; DPR affects rasterization only, never tile picking.

These are visual defaults, not additional product requirements. The overlay
has no event target, ticker, tile texture, or persisted state. Renderer teardown
destroys its Graphics resources with the stage. Overview tile caching remains
TW-010; bounded grid generation does not establish whole-editor performance.

## Readouts and rectangle measurement

The toolbar shows exact map dimensions in tiles and equivalent dimensions in
chunks (width/64 × height/64); fractional values describe partial chunks, not
rounded counts of intersected lattice cells. The footer shows the pointer's
signed world tile, chunk, and local 0–63 tile coordinates. Outside-map pointers
retain their world coordinates and are explicitly labeled outside.

With Inspect active, drag between two tiles to measure a rectangle. Both pointed
tiles are included: `(67,67)` to `(60,60)` yields `[60,68)²`, an **8 × 8**
footprint spanning four chunks. Release retains its amber outline and exact tile
dimensions; Escape clears it. Another drag replaces it. Measure again three tiles
over and the dimensions remain 8 × 8; the chunk lattice imposes no snapping.

Measurement begins only inside the map at the existing detail editing threshold.
Outside samples leave the last valid endpoint unchanged. Pan/Space/middle drag
take precedence; wheel is ignored during a measurement. Cancellation, unexpected
capture loss, blur, tool switch, or camera change restore the prior rectangle.
Completed measurements survive pan, zoom and valid bounds growth. Shrinking
bounds past a measurement clears it. No auto-pan or automatic map growth occurs.

`EditorSession.rectangle`/`setRectangle` provide a validated transient half-open
rectangle display seam for Inspect and future selection/rectangle tools.
`rectangleBetween` normalizes inclusive endpoints independently of chunks. This
does not implement tile selection, movement, copying, or painting; those tools
retain their existing unavailable state until their tickets. The readout uses
“Rectangle” so it does not imply an editable selection payload.

The rectangle store is outside MapDocument and CommandHistory. Overlays and
readouts cannot enter document iteration, checkpoints, project content or agent
tile exports. Export codecs are not implemented yet; isolation is verified by
exact before/after model runs, metadata/version, storage and history checks.

## Validation

`tests/domain/grid.test.ts` checks fractional zoom/camera alignment at DPR 1,
1.5, 2 and 3, signed world boundaries, partial edges, line fading, and bounded
overview line counts. `measurement.test.ts` checks reversed/inclusive rectangles,
three-tile offsets, negative/map-edge positions, validation and content isolation.

`tests/grid.spec.ts` reads actual WebGL pixels at DPR 1/2 across multiple zooms,
checks ordinary/chunk contrast and exact line footprint, and tests Inspect drag,
readouts, cancellation and small-window layout. Its shared `gridDocument` fixture
has bounds `[-65,131) × [-65,133)` (196 × 198 tiles), solid terrain, a four-tile
river and a gold `[60,68)²` building on an independent layer. Detail and overview
screenshots show this same document at both DPRs. Existing populated 6400 × 6400
navigation and renderer suites continue to exercise the target scale.

Actual commands, screenshot inspection, failures/fixes and acceptance evidence
are recorded in WRK. Browser screenshots are Chromium evidence, not a claim of
physical hardware input or a native performance budget.
