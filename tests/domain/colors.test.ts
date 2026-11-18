import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePaintColor,
  parseRgbFields,
  rgbChannels,
  type ColorInput,
} from "../../src/domain/colors.ts";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";

test("equivalent opaque hex and RGB inputs have one canonical representation", () => {
  for (const input of [
    "#AbC",
    " #aBcF\n",
    "#AABBCC",
    "#AABBCCFF",
    [170, 187, 204],
  ] satisfies ColorInput[])
    assert.equal(normalizePaintColor(input), "#aabbccff");
  assert.equal(parseRgbFields([" 170 ", "187", "204"]), "#aabbccff");
  assert.equal(parseRgbFields(["000", "255", "001"]), "#00ff01ff");
  for (let value = 0; value <= 255; value++) {
    const color = normalizePaintColor([value, value, value])!;
    assert.equal(color, `#${value.toString(16).padStart(2, "0").repeat(3)}ff`);
    assert.deepEqual(rgbChannels(color), [value, value, value]);
    assert.equal(normalizePaintColor(color), color);
  }
});

test("invalid input and nonopaque paint are rejected without coercion", () => {
  for (const input of [
    "",
    " ",
    "abc",
    "#12",
    "#12345",
    "#1234567",
    "#ggg",
    "#123456789",
    "#12 3456",
    "red",
    "transparent",
    "rgb(1,2,3)",
    "#1230",
    "#123e",
    "#11223300",
    "#112233fe",
    [-1, 0, 0],
    [256, 0, 0],
    [1.2, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    null,
    undefined,
    {},
    [0, 0],
    [0, 0, 0, 0],
    ["1", 0, 0],
    new Array(3),
  ])
    assert.equal(normalizePaintColor(input as ColorInput), null, String(input));
  for (const field of [
    "",
    " ",
    "-1",
    "+1",
    "256",
    "1.5",
    "1e2",
    "0xff",
    "NaN",
    "Infinity",
    "12px",
    "0000",
  ])
    assert.equal(parseRgbFields([field, "0", "0"]), null, field);
  assert.equal(parseRgbFields(new Array(3)), null);
});

test("selection is transient raw paint even when a registry entry has the same color", () => {
  const session = new EditorSession();
  const id = registryId("stone");
  session.execute("Registry fixture", [
    { kind: "registry", id, value: { name: "Stone", rgba: "#808080ff" } },
  ]);
  session.history.markSaved(session.history.captureCheckpoint());
  const before = {
    version: session.document.version,
    history: session.history.state,
    registry: session.document.registryEntries,
    stats: session.document.storageStats(),
  };
  let changes = 0;
  session.color.subscribe(() => changes++);
  for (const input of [
    "#808080",
    [128, 128, 128],
    "#808080FF",
  ] satisfies ColorInput[])
    assert.equal(session.setColor(input), true);
  assert.equal(changes, 1);
  assert.equal(session.color.getSnapshot(), "#808080ff");
  assert.deepEqual(session.currentPaint(), rawColor("#808080ff"));
  for (const input of [
    "invalid",
    "#80808000",
    [128, 128, 256],
  ] satisfies ColorInput[])
    assert.equal(session.setColor(input), false);
  assert.equal(session.color.getSnapshot(), "#808080ff");
  assert.equal(changes, 1);
  assert.deepEqual(
    {
      version: session.document.version,
      history: session.history.state,
      registry: session.document.registryEntries,
      stats: session.document.storageStats(),
    },
    before,
  );
  session.perform("undo");
  const redo = session.history.state;
  session.setColor("#818181");
  session.setColor("#202a36");
  assert.deepEqual(session.history.state, redo);
  session.perform("redo");
  assert.equal(session.color.getSnapshot(), "#202a36ff");
  session.dispose();
  assert.equal(session.setColor("#fff"), false);
  assert.equal(session.color.getSnapshot(), "#202a36ff");
});

test("black, white, background-colored and transparent cells stay occupied; only null erases the upper layer", () => {
  const bottom = layerId("bottom"),
    top = layerId("top");
  const session = new EditorSession(
    new MapDocument({
      layers: [
        { id: bottom, name: "Terrain" },
        { id: top, name: "Paint" },
      ],
    }),
  );
  const value = registeredColor(registryId("grass"));
  session.execute("Terrain", [
    {
      kind: "tiles",
      writes: [{ layerId: bottom, x: 0, y: 0, length: 5, value }],
    },
  ]);
  for (const [x, color] of ["#000", "#fff", "#1d2732", "#808080"].entries()) {
    assert.equal(session.setColor(color), true);
    session.execute("Paint", [
      {
        kind: "tiles",
        writes: [
          { layerId: top, x, y: 0, length: 1, value: session.currentPaint() },
        ],
      },
    ]);
  }
  // Existing low-level RGBA support is retained; alpha zero is still occupied.
  session.execute("Legacy transparent paint", [
    {
      kind: "tiles",
      writes: [
        { layerId: top, x: 4, y: 0, length: 1, value: rawColor("#12345600") },
      ],
    },
  ]);
  const before = [...session.document.iterateRuns()];
  assert.equal(session.document.storageStats().occupiedCells, 10);
  session.execute("Erase", [
    {
      kind: "tiles",
      writes: [{ layerId: top, x: 0, y: 0, length: 5, value: null }],
    },
  ]);
  for (let x = 0; x < 5; x++) {
    assert.equal(session.document.getCell(top, x, 0), null);
    assert.deepEqual(session.document.getCell(bottom, x, 0), value);
  }
  assert.equal(session.document.storageStats().occupiedCells, 5);
  session.perform("undo");
  assert.deepEqual([...session.document.iterateRuns()], before);
  session.perform("redo");
  assert.equal(session.document.storageStats().occupiedCells, 5);
  session.dispose();
});
