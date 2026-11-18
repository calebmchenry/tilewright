import { test } from "node:test";
import assert from "node:assert/strict";
import { rectangleBetween } from "../../src/editor/measurement.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { gridDocument } from "../fixtures/grid.ts";

test("inclusive, reversed and signed measurements cross chunks without changing document or history", () => {
  const session = new EditorSession(gridDocument());
  const before = {
    version: session.document.version,
    history: session.history.state,
    runs: [...session.document.iterateRuns()],
    stats: session.document.storageStats(),
  };
  const expected = { minX: 60, minY: 60, maxX: 68, maxY: 68 };
  assert.deepEqual(
    rectangleBetween({ x: 60, y: 60 }, { x: 67, y: 67 }),
    expected,
  );
  assert.deepEqual(
    rectangleBetween({ x: 67, y: 67 }, { x: 60, y: 60 }),
    expected,
  );
  session.setRectangle(expected);
  expected.minX = 0;
  assert.equal(session.rectangle.getSnapshot()?.minX, 60);
  session.setRectangle(rectangleBetween({ x: 70, y: 67 }, { x: 63, y: 60 }));
  assert.equal(
    session.rectangle.getSnapshot()!.maxX -
      session.rectangle.getSnapshot()!.minX,
    8,
  );
  session.setRectangle(rectangleBetween({ x: -1, y: -1 }, { x: -8, y: -8 }));
  session.setRectangle(
    rectangleBetween({ x: 130, y: 132 }, { x: 130, y: 132 }),
  );
  assert.throws(() =>
    session.setRectangle({ minX: 0, minY: 0, maxX: 132, maxY: 134 }),
  );
  assert.throws(() => rectangleBetween({ x: 0.5, y: 0 }, { x: 1, y: 1 }));
  session.setRectangle(null);
  assert.deepEqual(
    {
      version: session.document.version,
      history: session.history.state,
      runs: [...session.document.iterateRuns()],
      stats: session.document.storageStats(),
    },
    before,
  );
  session.dispose();
});
