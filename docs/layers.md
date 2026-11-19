# Layer management

TW-013 implementation decisions, following [INTENT.md](../INTENT.md). These
conventional defaults complete the existing [document](map-document.md),
[history](command-history.md), and [editor session](editor-shell.md) layer seams.

## Controls and policy

- Every document has at least one layer. New Map starts with one empty, visible
  `Layer 1`. A map may have no painted tiles, but may not have zero layers.
  **Remove layer** is disabled for the last layer with an explanation; the session
  and model also reject that removal.
- The panel lists the stack **top to bottom**; the model retains its established
  bottom-to-top order. The active row is pressed and labeled **Active**. Selecting
  a layer changes the editing target without moving it in the stack.
- **Add layer** creates an empty visible layer immediately above the active layer
  and selects it. The initial name is the first unused `Layer N`. IDs use
  `layer-` plus a random UUID, independent of names and indices. Undo/redo restores
  the same ID; creating after undo generates a fresh ID for the new history branch.
- Rename trims surrounding whitespace and rejects blank names. Duplicate display
  names are allowed; identity and tile ownership never depend on a name.
- **Move layer up/down** swaps the active layer with its immediate neighbor.
  Buttons at the top/bottom explain why no further move is possible. Rename and
  reorder preserve every layer's cells and registry associations.
- An empty layer removes immediately. A populated layer opens a modal naming the
  layer and explaining that its tiles (including hidden content) will be removed
  and can be restored with Undo. Cancel receives initial focus; Cancel and Escape
  leave content/history untouched. Map shortcuts do not run behind the dialog.
  Removal captures the selected ID, and revalidates at confirmation. Errors stay
  visible in the dialog; an oversized history operation is rejected atomically,
  never silently made irreversible.
- If an operation removes the active layer, select the top remaining layer, even
  if it is hidden. Any still-valid active ID remains selected on reorder, undo,
  and redo. Restoring a removed layer does not steal focus from a valid target.

## Visibility, drawing, and selection

**Show active layer** is a transient view preference, as established in TW-007.
Hidden rows are explicitly marked **Hidden**. Hiding leaves every stored tile,
registry association, and layer order untouched. It does not add undo steps,
change the content revision, or discard redo. All layers may be hidden. Selecting
one does not silently reveal it; the panel asks the author to show it before
editing its tiles.

Drawing and tile selection default to the active **visible** layer. Future
multi-layer selection may include explicitly chosen visible layers; hidden and
missing IDs are excluded. `EditorSession.editableLayerIds()` supplies this target
filter (with optional chosen IDs). `editableTileAt()` provides inside-map picking.
The [drawing pipeline](drawing-gestures.md) applies the same readiness/overview
gates, captures the active ID and clips candidate footprints to fixed bounds. Inspect measurements
and navigation are independent of layer visibility. Painting and tile-selection
UI remain their later feature tickets; this ticket validates their layer-target
and command integration seams with independent terrain/building edits.

Visibility and active selection are outside document history and are not a file
format decision. Removal drops that layer's hidden preference; undo restores the
layer **visible**, at its original position with its original ID, name, and all
tiles. New Map resets these preferences with the session. Low-level document
commands can still change hidden data (e.g. undo or a registered-color change);
visibility is an interactive tool policy, not a model write restriction.

## History, rendering, and validation

`src/editor/session.ts` routes add, rename, reorder, and removal through the
existing atomic `CommandHistory`. The pure model already journals removed runs;
no alternate tile ownership or history format is introduced. The removal
confirmation check reads only the first occupied run rather than materializing
all tiles. `src/LayerPanel.tsx` owns controls and dialog drafts and subscribes only
to small layer/active/visibility summaries. Ordinary tile edits do not rerender
this panel.

Membership/order changes, undo, and redo follow document rendering notifications.
Rename only updates panel metadata. Visibility uses the renderer's existing
session subscription: detail caches release hidden content and requery it when
shown; overview composition is invalidated and rebuilt with current visible
order. Both preserve the authoritative hidden data.

- `tests/domain/layers.test.ts` covers default/last layer, insertion order and
  identities across branches, empty/populated removal, active-target fallback,
  complete populated lifecycle undo/redo, all run/registry preservation, independent
  active-layer edits, invalid/no-op operations preserving redo, and visibility's
  interactive target policy.
- `tests/layers.spec.ts` exercises real controls, order/active/hidden indicators,
  populated confirmation, Cancel/Escape, modal shortcut isolation, restored focus,
  640 × 452 layout, and populated removal undo/redo. WebGL pixel readbacks at
  DPR 1 and 2 compare overlapping registered building/terrain content before and
  after visibility, reorder, removal, and undo in detail and cached overview.
- Build, full domain/browser tests, formatting, and a packaged desktop build are
  required. Actual results and native smoke evidence are recorded in WRK.

No new performance budget is claimed. Large layer removal still synchronously
journals occupied runs under existing history limits; refinement remains TW-050.
Rendering/presentation refinement remains TW-049 under AGENTS.md.
