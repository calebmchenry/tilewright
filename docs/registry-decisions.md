# Named color identity, adoption, and collisions

Decision record for [TW-015](../.wrk/wrk-e811af32.md), following
[INTENT.md](../INTENT.md#map-use-and-meaning). These are **implementation
decisions**, not additional confirmed user requirements. They define the contract
for [TW-016](../.wrk/wrk-230b4c1d.md) registry editing and
[TW-017](../.wrk/wrk-8110dbc9.md) recoloring. TW-015 established the contract;
TW-016 now provides the [authoring implementation](#tw-016-implementation)
and executable validation below. Generic metadata primitives still permit opaque
records and unresolved references; authoring uses the validated feature commands.

The intent requires freeform raw paint, unique named colors, and associations
that survive color changes across all layers. The policy is: **link by stable ID,
adopt raw tiles only by explicit choice, reject registered-color collisions, and
preserve tile appearance when removing a meaning**.

## Identity and exact color

An entry has a stable `RegistryId` plus a record containing `name` and `rgba`,
using the existing [metadata seam](command-history.md#ownership-and-commands).
New authoring entries receive `registry-` plus a random UUID, checked against live
IDs. IDs are independent of name, color, row order, and internal palette tokens.
Rename and recolor keep the ID; undo/redo restores the same ID. A new creation,
including after deletion or an undo branch, generates a fresh ID rather than
reusing the old entry's ID. Names are trimmed, nonblank display labels. Duplicate
names are allowed, as with layers; name equality never merges entries. UI rows
show a name and swatch, with the ID available to disambiguate identical names.

Authored entry colors use the [TW-014 color contract](color-selection.md): opaque
8-bit sRGB, normalized to lowercase `#rrggbbff` by `normalizePaintColor`. Accept
hex shorthand/full hex and RGB input through the same validated controls. For
example, `" #AbC "`, `#ABCF`, `#AABBCC`, `#AABBCCFF`, and RGB `(170, 187, 204)`
all mean `#aabbccff`. Reject malformed or nonopaque input before making changes.
Compare canonical bytes, never displayed swatches, CSS strings, approximate
distance, renderer samples, or composited pixels. `#808080ff` and `#818181ff`
are distinct colors even if they look similar.

Among valid registry entries, each canonical color has **at most one owner ID**.
Raw tiles may share any entry's color without sharing its meaning. A registered
tile stores only `{ kind: "registered", registryId }`; its appearance comes from
that entry's current `rgba`. A raw tile stores `{ kind: "raw", rgba }`. Equality
of rendered color does not change either kind. Empty remains `null` on one layer.

Existing low-level RGBA data is preserved. Exact raw adoption compares all eight
normalized digits: `#335c4600` and `#335c4680` do not match opaque `#335c46ff`.
Neither alpha-zero paint nor empty cells are candidates for opaque adoption.
Do not coerce old alpha values, resolve dangling IDs by RGB, or silently repair
duplicate/malformed records. Feature commands validate their target and relevant
color ownership; ambiguous ownership rejects the operation with an error.
Whole-document import validation/migration belongs to
[TW-033](../.wrk/wrk-eef53dd9.md) and its codec implementation, not this decision.

## Operations and future strokes

### Add and explicitly adopt

Creating an entry requires a valid name and an unowned canonical color. Offer
**Adopt matching raw tiles on all layers**, unchecked by default, with the exact
matching cell count and affected layer count. The scope includes hidden layers,
offscreen cells, and tiles covered by other layers; it is independent of the
active layer and selection. Count occupied source values, not visible pixels.

With adoption off, only the entry is created; existing raw tiles stay raw. With
adoption on, create the entry and replace every exact matching raw tile with that
new ID in one transaction. Already registered tiles, near colors, empty cells,
layer order, bounds, and annotations are unchanged. Adoption with zero matches
still creates the entry normally. Successful creation selects the new entry for
future painting; it does not repaint any cells beyond the requested adoption.

An existing entry also offers an explicit **Adopt matching raw tiles** action,
showing the same counts and requiring confirmation. It converts only raw values
equal to that entry's current color, in one undoable edit. Zero matches is a no-op.
It never reassigns another entry's tiles and does not change the current paint
selection. This permits deliberate adoption after initially creating without it.

Adding a color already owned by an entry is rejected, even if the proposed name
is identical or adoption was checked. Show the existing owner's name/swatch and
allow the author to choose that existing entry or its explicit adoption action.
Do not rename it, select it automatically, create a second ID, or adopt tiles as
a side effect of the rejected add.

### Select, rename, and recolor

Selecting a registry row sets a transient registered paint choice by ID. Future
strokes write that ID, resolving its latest color for the swatch/preview. The
arbitrary color picker and hex/RGB Apply choose **raw** paint, even when the value
matches a registry entry or the previously selected registered shade. Editing an
entry's color is a separate explicit registry operation. Selection alone changes
no document content, history, saved checkpoint, or redo branch. Drawing tools
must consume the selected raw/registered value without an RGB-to-ID lookup.

Renaming changes only `name`, retaining ID, color, and all tile associations.
Submitting the same trimmed name is a no-op. An explicit rename is the author's
change to the meaning label; recoloring never changes that label.

Recoloring normalizes and validates the proposed color, excluding the target ID
from the ownership check:

- The target's own current canonical color is a no-op, including equivalent input
  spellings. No adoption occurs, even if matching raw tiles exist.
- Another entry owns the color: reject the entire edit and identify that owner.
  There is no implicit merge, swap, overwrite, nearest-color substitution, or
  reassignment of either entry's tiles. To use that shade, the author must first
  explicitly free it through a separate rename-independent recolor or removal.
- No other entry owns the color: update only the target record's `rgba`.
  Registered tiles retain the same ID and meaning across all layers and resolve
  to the new shade. Raw tiles at either the old or new shade stay raw and unchanged.
  Matching raw tiles may be adopted only by the separate explicit action.

If a dialog edits name and color together, validate both before commit: a color
collision must not partially save the new name. A raw current paint choice stays
raw and keeps its bytes when a matching entry changes. A registered choice keeps
its ID and shows the new name/color, including after undo/redo.

### Remove without erasing

An unused entry can be removed immediately. For an in-use entry, show its name,
swatch, cell count, and affected layer count in a confirmation dialog. Explain
that removal keeps the tiles' current appearance but removes their named
association. Cancel receives initial focus; Cancel/Escape performs no edit.

On confirmation, replace **all references to that ID on all layers** with raw
paint using the entry's current canonical color, then remove the entry in the
same transaction. Do not erase tiles, expose underlying content, or transfer
references to another entry. Already raw cells remain raw. Undo restores the
entry's original ID/name/color and precisely the formerly linked cells; it must
not link preexisting raw cells of the same shade. Redo detaches those same cells.

If removal or undoing creation invalidates the current registered paint choice,
fall back to raw paint using that entry's last resolved color. Undo/redo that
restores the entry does not steal the current paint selection. Existing valid
registered selections keep their IDs; raw selections remain raw. Transient paint
selection is not document history. Creating another entry of the freed color
uses a fresh ID and follows the same explicit adoption choice.

## Atomicity, cancellation, and notifications

Registry feature commands validate names, colors, ownership, IDs, and expected
document state before dispatching through `CommandHistory`. Preview/dialog drafts
do not edit the document. Adoption/removal planning visits occupied runs across
all layers, never every possible canvas position, and retains complete before
values. Recoloring requires no tile rewrite. Keep these operations single undo
steps under the existing [history contract](command-history.md).

Capture the document version when preparing a preview or confirmation. If it
changes before submission, reject the stale plan and require refreshed counts
and review; do not apply a partial or out-of-date plan. Cancellation during
planning drops the staged work. Commit is synchronous and atomic; an already
committed edit is reversed with Undo, not reported as canceled.

Canceled, invalid, conflicting, stale, or history-capacity-rejected operations
preserve document content and version, entry IDs/records, every layer's cell
values, undo/redo stacks, saved/recovery checkpoints, and current paint selection.
Only draft/error/focus feedback may change. No document event escapes. A no-op
also preserves these states. Do not silently split a large adoption/removal into
several commits or make it irreversible to evade history limits. Process OOM is
outside the existing recoverable transaction guarantee. A post-commit observer
error is reported as a committed edit with a view error, not a failed operation
that should be retried.

Successful effective edits emit one transaction and one undo step, containing
the changed registry IDs and, for adoption/removal, exact changed tile spans.
Undo/redo emits the corresponding inverse/forward changes. Subscribers see a
complete state with no newly dangling references. Name-only edits update metadata
UI without recoloring. Recolor notifications invalidate affected detail and
overview views across hidden/offscreen content through the existing renderer
bridge; showing a layer or panning/zooming back must resolve current colors.
Conservative overview invalidation is permitted by the existing baseline.

## Two-layer acceptance walkthrough

This is a worked decision example and a fixture specification for TW-016/TW-017,
not a claim that the registry UI or feature validation already exists. Use a
128 × 128 map, bottom **Terrain** (`T`) and top **Buildings** (`B`). Start with B
hidden and T active. IDs `M` and `W` mean Mountain `#808080ff` and Stone wall
`#818181ff`. `raw(c)` denotes raw bytes; `ref(id)` denotes an ID association.
All unlisted cells are empty; optional test annotations remain fixed.

| Cell       | Initial value    | Purpose                                       |
| ---------- | ---------------- | --------------------------------------------- |
| T `(0,0)`  | raw(`#335c46ff`) | Grass candidate, covered when B is shown      |
| T `(1,0)`  | raw(`#335d46ff`) | Near green that must never be adopted         |
| T `(63,0)` | ref(`M`)         | Mountain on terrain                           |
| T `(64,0)` | ref(`W`)         | Underlying wall across the 64-tile boundary   |
| B `(0,0)`  | ref(`W`)         | Wall above the grass candidate                |
| B `(63,0)` | ref(`M`)         | Mountain on a second, initially hidden layer  |
| B `(64,0)` | raw(`#335c46ff`) | Second grass candidate, above underlying wall |
| B `(65,0)` | raw(`#557755ff`) | Future recolor target, deliberately raw       |

Work through the following sequence, asserting stored kinds/IDs independently
of rendered colors. Occupancy stays **8 cells** throughout this sequence.

1. Add Grass `#335c46` as fresh ID `G`, with adoption checked. The preview counts
   **2 raw cells on 2 layers**. Only T `(0,0)` and B `(64,0)` become `ref(G)`;
   appearance is unchanged. M and W retain 2 references each; 2 cells remain raw.
   The paint choice becomes `ref(G)`. Undo restores those two exact raw values
   and removes G; redo restores the same G and associations. Select G again for
   the remaining steps if undo triggered the raw-selection fallback.
2. Attempt to add Meadow `#335C46FF`, including with adoption checked: reject
   because G owns that canonical color. There are still 3 entries and 8 cells;
   no history or selection change. Recolor G to `#335C46` next: a no-op.
3. Attempt Mountain M → `#818181`: reject because W owns it. Both entries retain
   their names, distinct IDs, original shades, and their 2 references on T/B.
   Submitting a simultaneous Mountain rename must also leave its old name intact.
4. Recolor G → `#557755`. Only G's record changes. T `(0,0)` and B `(64,0)` remain
   `ref(G)` and now resolve to `#557755ff`; B `(65,0)` remains raw at that same
   shade. T `(1,0)` remains near green. Undo/redo changes only G's record and
   restores/reapplies appearance. With G selected, the swatch follows its color.
5. Show B, pan away/back, and switch detail → overview → detail. B `(0,0)` still
   displays W above the grass tile; hide B to see G at T `(0,0)`. B `(64,0)` and
   B `(65,0)` look equal but retain different kinds. M and W remain distinct.
   View changes add no document history; reveal all underlying values by queries.
6. Remove G: preview **2 references on 2 layers**, excluding B `(65,0)`. Cancel
   first and compare the complete state; then confirm. T `(0,0)` and B `(64,0)`
   become raw `#557755ff`, B `(65,0)` remains raw, and G disappears. There are now
   2 entries, 4 registered cells (M/W), and 4 raw cells. Appearance and occupancy
   are unchanged. Selected G falls back to raw `#557755ff`.
7. Undo removal: G and its **2** original references return; B `(65,0)` stays raw.
   Redo restores the removed state. Recreate Grass at `#557755` without adoption:
   the new ID `G2` differs from G, has zero references, and is selected for future
   strokes. Explicitly adopt into G2: now **3 raw cells on 2 layers** become
   `ref(G2)`. Undo that adoption restores all 3 to raw without deleting G2. The
   nearby `#335d46ff`, M, W, layers, and annotations never change.

## Concrete cases for the implementation tickets

Reset the walkthrough fixture for each independent case unless a step is named.
For every rejected/no-op case, compare the complete invariants in the atomicity
section and assert zero document notifications. For every effective operation,
assert one undo step/event, exact affected values/IDs, undo to the before snapshot,
and redo to the after snapshot. These were future executable cases in TW-015. TW-016 coverage is recorded
[below](#tw-016-implementation); TW-017-specific integration remains its next ticket.

| Case | Setup and action                                                                                                       | Required result                                                                                                                                       | Owner           |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| R01  | Normalize `#AbC`, `#ABCF`, `#AABBCCFF`, RGB `(170,187,204)`; add each after an owner exists                            | All canonicalize to `#aabbccff`; all later adds collide with that same owner                                                                          | TW-016          |
| R02  | Initial fixture; add G without adoption                                                                                | Both green cells stay raw; G has zero uses and becomes selected                                                                                       | TW-016          |
| R03  | Initial fixture; add G with adoption                                                                                   | Exactly the 2 green cells across T/B become G, including hidden/covered content; undo removes G and restores raw values                               | TW-016          |
| R04  | R02 result; explicitly adopt into G, then repeat                                                                       | First action changes exactly 2 cells; second is a no-op; selection is unchanged                                                                       | TW-016          |
| R05  | G exists; add same color with same/different name and adoption off/on                                                  | Every variant rejects; no automatic select, rename, adoption, or second ID                                                                            | TW-016          |
| R06  | G exists; recolor to its equivalent current color while matching raw cells exist                                       | No-op; raw cells are never adopted                                                                                                                    | TW-016 / TW-017 |
| R07  | M → W's color, alone and with a name edit                                                                              | Reject entire edit; both identities, names, colors, and all references remain intact                                                                  | TW-016 / TW-017 |
| R08  | Before step 4, add raw old shade at T `(2,0)`; G → raw target shade                                                    | G references resolve to new color on both layers; raw old/new-color cells retain kind/bytes; undo/redo preserves that distinction                     | TW-017          |
| R09  | G → unused `#446644`; select G and then select raw old shade in separate trials                                        | Only G's record changes; registered swatch follows G, raw selection stays fixed; no tile rewrite                                                      | TW-017          |
| R10  | Rename G to `" Meadow "`, then `Meadow`, then blank; also use an existing display name                                 | Trimmed rename retains ID/color/tiles; same name no-op; blank rejected; duplicate display name allowed without merging                                | TW-016          |
| R11  | Add unused G without adoption; remove it                                                                               | Only G disappears; raw cells stay raw; undo restores the same unused ID                                                                               | TW-016          |
| R12  | Walkthrough steps 6–7, including raw target shade and M/W                                                              | Remove detaches only 2 G references; undo does not adopt the third raw match; recreate uses G2                                                        | TW-016          |
| R13  | Cancel/Escape add, edit, adoption, and populated removal dialogs                                                       | No document/history/selection change; no modal shortcut edits behind the dialog                                                                       | TW-016          |
| R14  | Invalid hex, nonopaque alpha, blank name, unknown/stale target ID, duplicate ID, or ambiguous existing color ownership | Reject without partial metadata/tile changes; never infer a replacement ID from color/name                                                            | TW-016          |
| R15  | Stage adoption/removal, then change document; separately force history byte-limit rejection                            | Stale plan rejects and refreshes review; capacity rejection rolls back the whole operation with redo/checkpoints intact                               | TW-016          |
| R16  | Select G; paint one T/B cell through command seams; choose raw same shade and paint other cells                        | First pair stores G; second pair stays raw; later recolor affects only first pair; selection alone adds no undo                                       | TW-016 / TW-017 |
| R17  | Extend initial fixture with raw `#335c4680`, `#335c4600`, opaque black/white, and an empty cell                        | G adoption changes only the original 2 opaque matches; other raw values and emptiness survive adoption/removal/undo                                   | TW-016          |
| R18  | Add/adopt with zero matches; then remove/undo creation while its entry is selected                                     | Creation still succeeds; separate zero-match adoption is no-op; missing selected ID falls back to raw; restoration does not reselect it               | TW-016          |
| R19  | Successful combined add/adopt or detach/remove; then rename/recolor, undo/redo                                         | One complete event per edit, exact spans/IDs, no newly dangling references; rename has no tile recolor; relevant panels/caches update                 | TW-016 / TW-017 |
| R20  | Hidden B and offscreen references; recolor, then pan back/show B/change zoom and undo/redo                             | All displayed references resolve current shade in detail/overview; raw same-colored tiles remain independent; record populated-map latency separately | TW-017          |

TW-016 owns command/UI policy enforcement, adoption, removal, selection, and
collision rejection. TW-017 verifies cross-layer recoloring, active swatches,
detail/overview invalidation and latency on populated maps. Existing generic
commands, color normalization, history, and rendering tests establish the
integration baseline only. Do not treat those tests as implementation of the
new feature rules. TW-015 introduced no production registry behavior; TW-016
implements its owned cases below.

## Scope and rationale

Explicit adoption lets an author distinguish coincidental colors from intended
meaning; making it the default would silently relabel hidden/underlying content.
Rejecting registered collisions preserves both meanings; implicit merges or swaps
would change unrelated tiles. Appearance-preserving removal lets the author stop
using a meaning without erasing a map region. Keeping raw selection explicit
preserves freeform painting and the TW-014 separation between matching and linking.

This record does not define a project/export wire schema, an automatic repair or
merge workflow, per-layer registries, or a transparency authoring UI. In particular,
representation, naming, warnings, or rejection of **unnamed colors in exports**
remain decisions for [TW-043](../.wrk/wrk-eeabc6ef.md). A raw tile remains unnamed
in the editor even when its bytes match an entry; this does not choose its export
encoding. Performance refinement remains TW-049/TW-050 under AGENTS.md; correctness
and atomicity still require validation in the implementation tickets.

## TW-016 implementation

`src/domain/registry.ts` implements this contract over the existing generic
commands. `RegistryCommands.prepare(request, expectedVersion?, signal?)` validates
an add/edit/adopt/remove request, creates a fresh UUID for additions, and returns
an immutable preview with the entry, document version, matching cell count, and
layer count. Commands are private to that controller and preview; forged,
canceled, reused, foreign, and stale previews cannot commit. `cancel(plan)` drops
staged work without notifications. Dropping a preview is also inert.

`commit(plan)` executes one atomic history transaction. Add/adopt and detach/remove
use occupied runs from every layer, preserving exact inverse values through the
existing history journal. Edits retain extra metadata fields. Equivalent name/color
edits and zero-match adoption are no-ops. Duplicate colors identify their owners;
malformed targets, ambiguous relevant ownership, invalid IDs/input and duplicate
generated IDs reject. Generic commands remain the loading/test seam, not an
alternative authoring API or an import-repair policy.

`EditorSession.registryCommands` prepares previews; `commitRegistry(plan)` reports
failures and selects a successfully added entry. `selectRegisteredColor(id)` and
`selectedRegistryId` implement transient ID selection. `color` tracks its resolved
swatch, and `currentPaint()` returns the selected registered reference or raw
bytes directly. Removing/undoing a selected entry falls back to its last resolved
raw color; restoration never reselects it. Arbitrary color Apply always selects
raw paint, even at the same shade. Future drawing tools consume `currentPaint()`;
this ticket does not add pencil gestures.

`src/RegistryControls.tsx` supplies rows with name, swatch, ID in the tooltip, and
Edit/Adopt/Remove actions. Register starts with adoption unchecked. Add/edit dialogs
share opaque hex, RGB and native-picker validation with raw authoring. A collision
shows its owner and explicit Choose/Adopt actions. Existing adoption and populated
removal show exact counts and require confirmation; Cancel has initial focus.
Unused removal is immediate. All dialogs isolate map shortcuts, support Escape,
and require **Refresh preview** if the document changes. Drafts never edit content.

Only open dialogs subscribe to history to detect stale previews. Closed registry
controls do not scan tiles or rerender for ordinary tile edits. Persistent events
still carry changed registry IDs and exact spans. `src/editor/invalidation.ts`
filters name-only changes from tile invalidation while leaving metadata/history
notifications intact. Recolor uses the existing detail/overview invalidation path;
TW-017 owns broader offscreen/populated recolor and latency validation.

Validation lives in `tests/domain/registry.test.ts` and `tests/registry.spec.ts`.
The shared `tests/fixtures/registry.ts` constructs Mountain and Stone wall through
feature commands, then supplies the two-layer eight-cell walkthrough. Domain
cases cover R01–R07, R10–R19, including full content/history/checkpoint snapshots,
exact associations, targeted events, cancellation, malformed/ambiguous input,
stale previews, history capacity rollback, raw/registered paint selection and
observer errors. Basic recolor checks exercise the R08/R09 behavior needed by
Edit; R20's dedicated populated integration remains TW-017. Browser cases cover
all four dialogs, collision actions, RGB validation, focus/shortcuts, refreshed
counts, duplicate names and the 640 × 452 layout. WebGL tests at DPR 1/2 adopt
3,136 green cells on two layers and compare pixels before/after removal and
undo/redo in detail and overview, including hidden/covered content.

Planning and commit are synchronous, with signal checks during occupied-run
planning. This is not an asynchronous worker or a UI latency guarantee. Draft
changes may rescan occupied runs; staged spans and the existing transaction
journal require transient memory. History-capacity rejection remains atomic.
No new timing or memory budget pass is claimed; large-edit refinement remains
TW-050 and rendering/presentation refinement remains TW-049 under AGENTS.md.
Actual commands, results and native smoke observations are recorded in
[the implementation ticket](../.wrk/wrk-230b4c1d.md).
