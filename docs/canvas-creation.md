# Map creation and explicit growth

TW-012 implementation decisions, following [INTENT.md](../INTENT.md) and the
[foundation coordinate/growth policy](foundation-decisions.md).

## Controls and validation

**New map** opens a dialog with **256 × 256 tiles** (4 × 4 visual chunks).
Width and height accept positive decimal whole numbers in tiles, including 1 × 1,
101 × 130, and 6,400 × 6,400. Partial chunks are allowed; dimensions are never
rounded to chunk boundaries. The preview shows tile dimensions, exact fractional
chunk equivalents, and half-open world bounds starting at `(0, 0)`.

The authoring guardrail is **65,536 tiles per axis** (1,024 chunks). This is a
TW-012 implementation choice to reject accidental extreme sizes, not a measured
performance guarantee or a dense allocation limit. `src/domain/canvas.ts` validates
creation and growth before document construction or command execution. Blank,
negative, fractional, exponential, unsafe-integer, overflowing, and over-limit
form inputs have inline explanations and cannot submit. The low-level document
still supports its existing safe-integer coordinate contract for fixtures and
future import validation. Creating or growing an empty map allocates no tile
partitions, palette entries, or map-sized tile buffers.

New Map explicitly replaces the current map and clears its history. After dimension validation, an unsaved
map uses the shared **Save and continue / Discard changes / Cancel** workflow
([TW-037 lifecycle](project-format.md#document-lifecycle-tw-037)). Cancel or Escape
preserves the current session. A new document has one empty `Layer 1`, fresh
unsaved history, default camera/tool state, and no registry or annotations.
`src/editor/workspace.ts` owns replacement and session disposal outside React;
`Workspace` keys the UI by generation so panel drafts, renderer subscriptions,
pending overview work, and GPU resources cannot leak into the replacement map.
Strict Mode replays rendering effects without disposing the application owner.

**Grow canvas** offers independent left, right, top, and bottom edges. Each
selected edge starts at one 64-tile increment; counts are positive whole numbers.
Unselected edges contribute zero, and the UI requires at least one selected edge.
The domain API accepts all-zero counts as a no-op that preserves redo history.
The preview shows the resulting dimensions and signed bounds before applying.
Several edges apply as **one** `Grow canvas` undo step. For example, adding one
right increment to 101 × 130 produces 165 × 130, with no chunk rounding.

Dialogs use native modal focus handling, keep map shortcuts from firing behind
them, and scroll within short windows. Controls are in `src/CanvasControls.tsx`;
the New Map entry is in the header, and Grow Canvas is beside the dimension readout.

## Content, camera, and cache contract

`EditorSession.growCanvas` computes validated bounds and executes the existing
history `bounds` command. It never rewrites tiles, layers, registry associations,
annotation geometry, or anchors. Left/top growth admits negative world coordinates;
the original world origin and 64-tile grid lattice stay fixed. New space is empty
on every layer. Growth does not change camera position or zoom; **Fit map** remains
a separate action. Pan/zoom limits read the current document bounds on each action.

The existing bounds notification updates dimension readouts, boundary/grid
geometry, detail textures, and overview caches. Overview images are released and
rebuilt against the enlarged bounds, including partially clipped regions. Undo
and redo use the same invalidation path. Subsequent edits in new space undo before
growth, so restoring the previous bounds cannot discard occupied cells. Growth
retains only bounds metadata in history, not copies of all existing content.

Out-of-bounds writes remain invalid; the shared input gate returns no editable
tile outside the fixed bounds. Inspect and navigation drags never grow a map.
Interactive painting tools are still their later tickets and must clip their
candidate cells before dispatch, as required by the foundation policy.

## Validation

- `tests/domain/canvas.test.ts`: default/small/partial/target/maximum creation with
  zero tile allocation; malformed input and replacement isolation; every edge and
  combined growth of a populated two-layer fixture; exact content, metadata,
  registry, annotation, storage and camera preservation; new-space emptiness;
  boundary rejection; growth/edit undo-redo; no-op/overflow preservation and
  updated navigation limits.
- `tests/canvas.spec.ts`: actual New Map and Grow Canvas forms, cancel and unsaved
  confirmation, keyboard isolation, validation, individual/combined edge changes,
  history, a 640 × 452 window, renderer replacement/disposal, and no implicit
  growth from Inspect drags. WebGL pixel checks at DPR 1/2 verify the populated
  fixture's original terrain/buildings at their original world positions in both
  detail and overview, plus empty added space and restored clipping on undo.
- The full existing domain/browser suite includes target-scale populated-map
  navigation, grid, history, and cache regressions. Run build, full tests,
  formatting, and the packaged desktop build; actual outcomes are recorded in WRK.

Performance refinement remains deferred to TW-049/TW-050. This ticket makes no new
native latency, memory-budget, or maximum-occupancy performance claim.
