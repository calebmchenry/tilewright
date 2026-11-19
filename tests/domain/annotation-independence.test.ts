import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationCommands } from "../../src/domain/annotations.ts";
import { selectionTransforms } from "../../src/domain/selection.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import {
  movementDocument,
  walls,
  furniture,
  terrain,
} from "../fixtures/selection.ts";
import { rawColor } from "../../src/domain/values.ts";

const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function setup(multiple: boolean) {
  const document = movementDocument();
  // An asymmetric corner ensures every committed transform changes real cells.
  document.setCell(walls, 60, 60, rawColor("#ff0000ff"));
  const s = new EditorSession(document);
  const commands = new AnnotationCommands(s.history);
  for (const value of [
    {
      name: "Enclosed house",
      description: "Exact Unicode — 家\n  spaces  ",
      tier: "detail",
      bounds: { minX: 61, minY: 61, maxX: 67, maxY: 67 },
    },
    {
      name: "Overlapping village",
      description: "",
      tier: "locality",
      bounds: { minX: 64, minY: 64, maxX: 72, maxY: 72 },
    },
    {
      name: "Surrounding region",
      description: "No inferred hierarchy",
      tier: "region",
      bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
    },
  ])
    commands.execute({
      kind: "create",
      value: { ...value, label: { placement: "center" } },
    });
  s.canvasState.set("ready");
  s.selectLayer(walls);
  s.perform("select");
  s.selection.begin(1, point(60, 60));
  s.selection.commit(1, point(67, 67));
  if (multiple) s.selection.setIncluded(furniture, true);
  s.history.markSaved(s.history.captureCheckpoint());
  return s;
}
type Operation = readonly [string, (s: EditorSession) => void, number];
const operations: Operation[] = [
  [
    "move",
    (s) => {
      assert.ok(s.selection.begin(2, point(62, 62)));
      assert.ok(s.selection.commit(2, point(65, 62)));
    },
    1,
  ],
  [
    "nudge",
    (s) => {
      assert.ok(s.selection.nudge(3, 0));
    },
    1,
  ],
  [
    "copy",
    (s) => {
      assert.ok(s.perform("copy"));
    },
    0,
  ],
  [
    "cut",
    (s) => {
      assert.ok(s.perform("cut"));
    },
    1,
  ],
  [
    "paste twice",
    (s) => {
      assert.ok(s.perform("copy"));
      for (const x of [63, 75]) {
        assert.ok(s.perform("paste"));
        assert.ok(s.selection.positionPaste({ x, y: 60 }));
        assert.ok(s.selection.commitPaste());
      }
    },
    2,
  ],
  ...Object.keys(selectionTransforms).flatMap((op) => {
    const operation = op as keyof typeof selectionTransforms;
    return [
      [
        operation,
        (s: EditorSession) => {
          assert.ok(s.perform(operation));
          assert.ok(s.selection.commitPlacement());
        },
        1,
      ],
      [
        `paste ${operation}`,
        (s: EditorSession) => {
          assert.ok(s.perform("copy"));
          assert.ok(s.perform("paste"));
          assert.ok(s.perform(operation));
          assert.ok(s.selection.positionPaste({ x: 63, y: 60 }));
          assert.ok(s.selection.commitPaste());
        },
        1,
      ],
    ] as Operation[];
  }),
];

for (const multiple of [false, true])
  for (const [name, run, steps] of operations)
    test(`${name}, ${multiple ? "chosen layers" : "active layer"}: fully enclosed and overlapping real named-area records remain byte-identical`, () => {
      const s = setup(multiple),
        annotations = s.document.annotations,
        bytes = JSON.stringify(annotations);
      const beforeRuns = [...s.document.iterateRuns()],
        beforeSteps = s.history.state.undoSteps;
      let events = 0;
      const stop = s.document.subscribe((change) => {
        events++;
        assert.equal(JSON.stringify(s.document.annotations), bytes);
        assert.deepEqual(s.document.annotations, annotations);
        assert.ok(
          (change.kind === "transaction" ? change.changes : [change]).every(
            (c) => c.kind !== "annotation",
          ),
        );
      });
      run(s);
      assert.equal(s.history.state.undoSteps, beforeSteps + steps);
      assert.equal(events, steps);
      const afterRuns = [...s.document.iterateRuns()];
      for (let i = 0; i < steps; i++) s.perform("undo");
      assert.deepEqual([...s.document.iterateRuns()], beforeRuns);
      assert.equal(s.history.state.dirty, false);
      for (let i = 0; i < steps; i++) s.perform("redo");
      assert.deepEqual([...s.document.iterateRuns()], afterRuns);
      assert.equal(events, steps * 3);
      assert.equal(JSON.stringify(s.document.annotations), bytes);
      assert.deepEqual(s.document.annotations, annotations);
      stop();
      s.dispose();
    });

test("paint, erase, fill, layer operations and growth preserve all annotation fields", async () => {
  const s = setup(true),
    annotations = s.document.annotations;
  const before = [...s.document.iterateRuns()],
    steps = s.history.state.undoSteps;
  const assertAreas = () =>
    assert.deepEqual(s.document.annotations, annotations);
  s.document.subscribe(assertAreas);
  for (const value of [rawColor("#ff0000ff"), null]) {
    s.execute("Paint or erase", [
      {
        kind: "tiles",
        writes: [{ layerId: walls, x: 61, y: 61, length: 3, value }],
      },
    ]);
    assertAreas();
  }
  s.perform("fill");
  s.setColor("#0000ff");
  await s.fill.start(point(61, 61));
  assertAreas();
  s.setLayerVisible(terrain, false);
  s.renameLayer(walls, "Renamed walls");
  s.moveLayer(walls, "up");
  s.removeLayer(furniture, true);
  s.growCanvas({ left: 1, top: 1, right: 1, bottom: 1 });
  assertAreas();
  const added = s.history.state.undoSteps - steps;
  for (let i = 0; i < added; i++) s.perform("undo");
  assert.deepEqual([...s.document.iterateRuns()], before);
  assertAreas();
  for (let i = 0; i < added; i++) s.perform("redo");
  assertAreas();
  s.dispose();
});
