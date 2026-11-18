# Color selection and empty cells

TW-014 implementation decisions, following [INTENT.md](../INTENT.md) and the
[foundation empty-cell contract](foundation-decisions.md). These are authoring
defaults, not additional requirements or registry collision/adoption decisions.

## Inputs and canonical color

The picker and editable Hex / Red / Green / Blue fields can choose any of the
16,777,216 opaque 8-bit sRGB colors without creating a registry entry. The picker
applies immediately; typed fields apply together on their form's Apply button or
Enter. Drafts never partially change the selected color. Successful submission
synchronizes all inputs and the selected-color swatch/readout, even when the
canonical value was already selected. Native text undo and arrow keys stay in
the fields rather than operating on the map.

`src/domain/colors.ts` defines `PaintColor`: lowercase `#rrggbbff`, matching the
existing model's RGBA encoding with alpha fixed at 255. The hex control displays
six digits and accepts `#RGB`, `#RRGGBB`, and fully opaque `#RGBA` / `#RRGGBBAA`.
Case and surrounding whitespace normalize; shorthand repeats each nibble. For
example, `#AbC`, `#ABCF`, `#AABBCCFF`, and RGB `(170,187,204)` all become
`#aabbccff`. The `#` is required. RGB fields accept decimal whole channels 0–255,
with surrounding whitespace and up to three digits (including leading zeroes).
No rounding, clamping, exponent notation, percentages, CSS names or CSS functions
are accepted. Blank channels are invalid, never implicitly zero.

Malformed input and any alpha below 255 leave the selected color, swatch,
document, registry, and history unchanged. Errors appear beside the relevant
fields with accessible invalid/error descriptions and in shared action feedback.
There is no opacity slider or transparent paint choice. Erasing is a separate
operation, not a color-picker value.

The RGB bytes denote sRGB; the controls do not offer Display P3, HDR, ICC profiles,
or custom color management. Solid opaque tile centers preserve those bytes in
the existing RGBA8 renderer. Display appearance can depend on the platform;
grid overlays and distant overview downsampling can blend colors. Existing
source-over/overview math remains unchanged, with no new linear-light blending
claim. The low-level document still accepts historical/test RGBA values with
other alpha values, and the renderer still composites them. They remain occupied
tiles even at alpha zero; this ticket does not rewrite or discard them.

## Selection and registry meaning

`EditorSession.color` holds the validated canonical color outside the document
and history. `setColor` accepts hex or a numeric RGB tuple; `currentPaint()`
returns an immutable raw tile value for command construction when raw paint is
selected. TW-016 also supports explicit registered selection by ID, as described
in the [registry implementation](registry-decisions.md#tw-016-implementation). Selecting colors
does not allocate tile storage, add undo steps, discard redo, or alter saved
revisions. A new session starts with `#91baa1ff`.

The Color panel displays the current swatch and exact hex value. It explicitly
labels raw selection **Raw color · Not linked to a named entry** (or the selected
named entry with TW-016) and shows either
**Unregistered color · No named match** or the names of exact matching entries.
Matching uses the existing registry `rgba` convention (eight digits, case
insensitive), and updates on registry changes and undo/redo. Multiple matches
are all shown; this does not invent a collision policy. A record without a string
name displays its ID, as in the existing metadata list.

An equal RGB value does not attach raw paint to an entry or recolor the selected
raw value when that entry changes. Existing registered tiles keep their IDs.
The [TW-015 registry decisions](registry-decisions.md) specify explicit adoption,
collision rejection, and future-stroke identity; TW-016 implements registry
editing/selection. Matching alone never opts into registration or adoption;
select a named row to paint with its ID. Pencil/eraser gestures remain
their drawing-tool tickets; the selected-paint and erasure command seams are
validated here.

## Empty is absence

`Cell = null` is empty on one layer. Every raw color, including black, white and
the map-background color `#1d2732ff`, is occupied. Writing `null` through the
existing tile command erases only the target layer, reveals lower visible content,
and participates in ordinary undo/redo and detail/overview invalidation. Hidden
or underlying layers retain their complete original data. There is no special
paint color for emptiness and no change to storage or file formats.

## Validation

- `tests/domain/colors.test.ts`: canonical equivalence; all 256 gray values;
  invalid, nonopaque and malformed runtime inputs; RGB field parsing; transient
  selected state and redo/saved-checkpoint preservation; raw/registered separation;
  occupied black/white/background/transparent paint; erasure and exact undo/redo.
- `tests/colors.spec.ts`: actual picker, hex and RGB input synchronization,
  invalid-draft feedback, native text shortcut isolation, 640 × 452 layout,
  named matches after rename/recolor/removal/undo, and selected raw-paint identity.
- `tests/fixtures/colors.ts`: two layers and seven unregistered swatches, including
  `#808080` and `#818181`, black, white, background, orange and teal. WebGL readback
  at DPR 1/2 verifies exact colors in detail and cached overview, selected gray
  painting, lower-layer reveal on erasure, and exact content restoration on undo.
  Screenshots retain the fixture and real editor controls.

Run build, full domain/browser tests, formatting, and the packaged desktop build.
Actual command results, inspected screenshots and native smoke evidence are
recorded in WRK. No new performance budget is claimed; rendering/presentation
and large edit/history/memory refinement remain TW-049 and TW-050.
