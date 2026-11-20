# Tilewright

## Project goal

Build a visual map-design tool for a grid-based game. The game is 3D, but map
layout can be designed as a two-dimensional grid in which each square represents
one game tile and is displayed as a solid color.

Tilewright should make it easy to draw a map, inspect the scale of its regions,
and rearrange areas without redrawing them. It will be a desktop app built with
web technologies and packaged with Tauri for macOS. The app is single-user and
local, with no cloud services or server requirement during normal use.

The product name is **Tilewright**. The project directory is `tilewright`.

## First-version scope

- Draw tiles on a grid using colors to represent the map visually.
- Allow arbitrary colors, as in a pixel editor, with a named registry that gives
  individual colors meaning when desired.
- Organize map content into layers.
- Select an area of tiles and move it by whole-tile increments. For example,
  select an 8 × 8 house footprint and shift it three tiles to the side. Selection
  affects the active layer by default, with an option to include multiple layers.
- Use rectangular selections with cut, copy, paste, arrow-key nudging, 90-degree
  rotation, and horizontal or vertical flipping.
- Show tile grid lines so individual cells are easy to identify.
- Emphasize boundaries every 64 × 64 tiles with a different color or heavier
  line weight. These regions are called chunks and help communicate scale.
  Chunks are currently a visual and conceptual aid; they do not imply a storage
  format, streaming system, or restriction on editing across boundaries.
- Annotate named areas with descriptions and on-map labels whose visibility
  depends on zoom level.
- Save and reopen editable local projects, with Cmd+S and separate crash recovery.
- Export the whole map for an AI agent, preserving layers, color meanings, and
  named areas in a format separate from the editor project.

## Intended experience

Treat map layout much like drawing pixel art, with each colored square
corresponding to a game tile rather than a screen pixel. Make spatial iteration
quick: draw an area, assess its size and placement, then select and reposition it.

## Map use and meaning

The map is primarily a visual reference for building the game world. It should
also be possible to give the map to an AI agent in a simple, structured format,
such as JSON. Direct import into the game is not a current requirement.

Painting is freeform rather than restricted to predefined tile types. A named
color registry lets the designer label a unique color: one shade of green might
mean grass, one gray might mean mountain, and a different gray might mean stone
wall. The registry connects visual choices to meaning that a person or agent can
understand. The behavior of unlabeled colors in exports remains to be decided.

Changing a registered color updates all existing tiles using that registry entry
throughout the map, including across layers. For example, changing the shade
registered as grass recolors existing grass tiles without requiring repainting.
The entry's meaning and association with its tiles must survive a color change.
How to handle a change to a color already used by another entry remains open.

Layers are part of the editing model. Selection and movement affect the active
layer by default, with an option to include multiple chosen layers. For example,
the designer can move a house's walls and furniture together while leaving the
terrain layer untouched. Annotations are independent of tile selections. The
remaining details of layer management can be set during implementation.

## Drawing and rearranging

The starting drawing toolset includes:

- A pencil with adjustable size.
- An eraser and an eyedropper.
- Flood fill.
- Straight lines.
- Filled and outlined rectangles.

Selections are rectangular in the first version. Support cut, copy, paste,
arrow-key nudging in whole-tile increments, rotation in 90-degree steps, and
horizontal and vertical flips. Freeform selection is not required initially.

When moving a selection, occupied source cells overwrite destination content on
the same layer. Empty cells within the selection leave destination content
untouched. Moving tiles must be undoable, including restoring any overwritten
destination content.

## Named areas and labels

The designer can name an area, such as a blacksmith's house or a starting village,
and attach a description. Names should appear on the map, with different label
tiers visible at different zoom levels. For example, a close view of a village
shows individual house labels; a farther-out view shows the village name instead
of all its house labels.

This should help the designer navigate and understand the map at different
scales, and help an AI agent interpret the intended meaning of map features.
Named areas and descriptions should survive project saves and be included in
agent exports.

Start with three author-selected label tiers:

- Detail: individual houses or similarly small features.
- Locality: villages or similarly sized places.
- Region: larger areas visible at broader map scales.

Moving a tile selection does not move its labels or named-area bounds, even when
the selection fully encloses a named area. Annotations remain at their existing
map positions. Coupling annotations to tile selection operations is outside the
initial scope.

Custom label tiers are not needed initially. Visibility thresholds, area shapes,
label placement, and any parent-child relationships between areas remain
implementation details to resolve.

## Map size and navigation

Aim to support maps in the ballpark of 100 × 100 chunks. At 64 × 64 tiles per
chunk, that is 6,400 × 6,400 tiles, or 40,960,000 tile positions per layer. This is
a target canvas scale, not a requirement that every position contain content.

Maps have fixed dimensions. The author explicitly chooses when to grow the
canvas; drawing does not automatically expand its bounds. Initial dimensions,
growth increments, and which directions a map can grow remain to be decided.

The editor should support both detailed tile editing and an overview of the
large map. Meaningful individual-tile editing is not expected when all 100 × 100
chunks are visible. Responsive navigation and editing at the target map size are
core requirements; exact performance targets and zoom behavior remain open.
Pencil and Eraser remain available at every supported zoom so larger brushes can
be used while viewing a broad area; zooming out must not disable these brushes.

## Project files and agent exports

Distinguish the editable project file from the agent-readable final result:

- The project file should preserve the information needed to reopen and continue
  editing, including layers, the color registry, and named areas with their
  descriptions and label settings. Which additional editor settings it should
  preserve remains to be decided.
- The agent export should communicate the map layout and color meanings in a
  simple structured form, without requiring the agent to interpret editor state.
  It should preserve layers and their names, including underlying content rather
  than only the final visible tile at each position, along with named areas and
  their descriptions. JSON is a candidate format.

Agent export covers the whole map in the initial version. Exporting only a
selected area is outside the initial scope.

These are separate purposes and schemas; they do not necessarily require
different serialization technologies. Exact schemas have not been chosen.

## Local operation

The initial product serves one user on their own machine. It must not require
cloud storage, accounts, collaboration services, or an application server.
macOS is the only required target platform; Windows and Linux are not current
requirements.

Project saving and loading use local files with conventional Open, Save, and
Save As actions. Cmd+S saves the current project, requesting a file location
when the project has not yet been saved. Explicit Save updates the project file.

Automatic local recovery preserves unsaved work separately from the project
file so it can be recovered after a crash. Recovery must not silently replace
the last explicitly saved project. Recovery frequency and the restore interface
remain to be decided.

The packaged desktop app should launch directly and work offline without a
separate local web server. Development tooling may use a local development
server; it is not part of the normal user workflow.

## Chosen technology

- Tauri packages the editor as a desktop application and provides native
  integration, including local file access.
- TypeScript implements the map model, drawing tools, selections, undo, and
  serialization logic.
- React implements the editor interface: toolbars, layer controls, the color
  registry, annotation panels, and settings.
- Vite provides frontend development tooling and builds the frontend assets
  included in the desktop app.
- PixiJS with its WebGL renderer draws the map canvas, grid, selection overlays,
  and on-map labels.
- Rust supports the Tauri shell and native integration where needed. The editor
  logic primarily lives in TypeScript.

Keep the map model and rendering separate from React's UI state. The intended
approach to large maps is chunk-based data, rendering only visible content, and
cached overview images for distant zoom levels. Validate this approach at the
target map scale early; selecting a rendering library alone does not establish
the performance target.

Delivery priority update — 2026-11-18: accept the measured TW-011 baseline and
continue building features despite current performance limitations. Performance
budget enforcement and missing presentation/memory measurements are deferred to
the later refinement tickets TW-049 and TW-050. The early spike is evidence for
future work, not a prerequisite performance pass for further feature development.
Correctness and data integrity remain required; the budgets remain future targets.

Tauri is the chosen delivery mechanism. A standalone browser release is not a
current delivery requirement.

## First-version success criteria

The first version should support a complete map-design session:

1. Create a fixed-size map and explicitly grow it when more space is needed.
2. Draw terrain and buildings on separate layers, using arbitrary colors and
   registering meanings for colors when useful.
3. Select an 8 × 8 house and move it three tiles, optionally including multiple
   layers while leaving terrain untouched. Undo restores both the original
   placement and any overwritten destination content.
4. Copy, paste, rotate, and flip a rectangular tile selection. Named areas and
   labels remain independent of tile selection operations.
5. Label houses and villages, then zoom out to see locality or region labels
   instead of a cluttered collection of detail labels.
6. Change the registered grass color and see existing grass tiles update across
   the map without repainting.
7. Save with Cmd+S, reopen the editable project without losing map information,
   and recover unsaved work after a crash from separate local recovery data.
8. Export the whole map with enough structure for an agent to understand tile
   locations, layer order, color meanings, and named-area descriptions.

Validate detailed editing and overview navigation on representative maps near
100 × 100 chunks. Include populated areas and overlapping layers; an empty
large canvas alone does not demonstrate that the target scale is supported.
The packaged app must run locally on macOS without a network connection or a
separate server process.

## Deferred scope

- Windows, Linux, and a standalone browser release.
- Cloud storage, accounts, sharing, and collaboration.
- Direct game integration or a 3D preview.
- Exporting only a selected area.
- Custom label tiers and automatic movement of annotations with tile selections.
- Freeform selection.

## Remaining implementation decisions

The initial requirements interview establishes the scope above. Use conventional
editor defaults for smaller interactions, and document concrete decisions during
implementation without treating them as additional confirmed user requirements.

- Exact project and agent-export schemas, including efficient whole-map encoding,
  layer order, and representation of unlabeled colors.
- Color registry collision handling and routine layer-management controls.
- Initial canvas size, growth controls, and coordinate conventions.
- Pan and zoom controls, label visibility thresholds, and performance targets.
- Named-area geometry and label placement; nesting is not an established need.
- Recovery frequency, the restore interface, and editor settings saved with a
  project.
