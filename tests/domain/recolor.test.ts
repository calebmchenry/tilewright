import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentChange } from "../../src/domain/document.ts";
import { RegistryCollisionError } from "../../src/domain/registry.ts";
import { registeredColor } from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { bindDocument } from "../../src/renderer/bindDocument.ts";
import type { CanvasInvalidation } from "../../src/editor/invalidation.ts";
import { resolveColor } from "../../src/renderer/colors.ts";
import { buildings } from "../fixtures/registry.ts";
import {
  grass,
  NEW_GRASS,
  OLD_GRASS,
  recolorDocument,
} from "../fixtures/recolor.ts";

test("R06–R09/R20: recolor and history retain all layer values without reading or rewriting tiles", () => {
  const document = recolorDocument();
  const session = new EditorSession(document);
  session.setLayerVisible(buildings, false);
  session.selectRegisteredColor(grass);
  session.history.markSaved(session.history.captureCheckpoint());
  session.history.markRecovery(session.history.captureCheckpoint());
  const runs = [...document.iterateRuns()];
  const content = {
    bounds: document.bounds,
    layers: document.layers,
    annotations: document.annotations,
    storage: document.storageStats(),
  };
  const original = document.registryEntries;
  const events: DocumentChange[] = [],
    dirty: CanvasInvalidation[] = [];
  document.subscribe((change) => events.push(change));
  const stop = bindDocument(session, (change) => dirty.push(change));
  // Fail any accidental tile propagation, including hidden/offscreen scans.
  const methods = {
    iterateRuns: document.iterateRuns,
    iterateCells: document.iterateCells,
    getCell: document.getCell,
    writeBatch: document.writeBatch,
  };
  const noTiles = () => {
    throw new Error("Recolor must not enumerate, read or rewrite tiles");
  };
  Object.assign(document, {
    iterateRuns: noTiles,
    iterateCells: noTiles,
    getCell: noTiles,
    writeBatch: noTiles,
  });
  const edit = (color: string, name = "Grass") =>
    session.registryCommands.commit(
      session.registryCommands.prepare({
        kind: "edit",
        id: grass,
        name,
        color,
      }),
    );
  const snapshot = () => ({
    registry: document.registryEntries,
    history: session.history.state,
    version: document.version,
    paint: session.currentPaint(),
    color: session.color.getSnapshot(),
  });
  const before = snapshot();
  assert.equal(edit("#335C46").change, null);
  assert.throws(() => edit("#818181", "Must not save"), RegistryCollisionError);
  assert.deepEqual(snapshot(), before);
  assert.equal(events.length, 0);
  edit(NEW_GRASS);
  assert.equal(session.color.getSnapshot(), NEW_GRASS);
  assert.deepEqual(session.currentPaint(), registeredColor(grass));
  assert.equal(session.history.state.undoSteps, 1);
  assert.equal(session.history.state.dirty, true);
  assert.equal(document.getRegistryEntry(grass)?.name, "Grass");
  assert.deepEqual(
    resolveColor(document, registeredColor(grass)),
    [85, 119, 85, 255],
  );
  session.perform("undo");
  assert.equal(session.color.getSnapshot(), OLD_GRASS);
  assert.deepEqual(document.registryEntries, original);
  assert.equal(session.history.state.dirty, false);
  const undone = snapshot();
  assert.throws(() => edit("#808080"), RegistryCollisionError);
  assert.deepEqual(snapshot(), undone); // Rejection preserves the redo branch/checkpoints.
  session.perform("redo");
  assert.equal(session.color.getSnapshot(), NEW_GRASS);
  assert.equal(events.length, 3);
  assert.equal(dirty.length, 3);
  for (const event of events) {
    assert.equal(event.kind, "transaction");
    if (event.kind !== "transaction") throw new Error("Expected transaction");
    assert.equal(event.changes.length, 1);
    assert.equal(event.changes[0].kind, "registry");
  }
  for (const change of dirty)
    assert.deepEqual(change, {
      regions: [],
      composition: false,
      bounds: false,
      registryIds: [grass],
      annotationIds: [],
    });
  session.setColor(OLD_GRASS);
  session.perform("undo");
  session.perform("redo");
  assert.equal(session.color.getSnapshot(), OLD_GRASS);
  assert.equal(session.currentPaint().kind, "raw");
  Object.assign(document, methods);
  assert.deepEqual([...document.iterateRuns()], runs);
  assert.deepEqual(
    {
      bounds: document.bounds,
      layers: document.layers,
      annotations: document.annotations,
      storage: document.storageStats(),
    },
    content,
  );
  assert.deepEqual(
    document.registryEntries.filter(([id]) => id !== grass),
    original.filter(([id]) => id !== grass),
  );
  assert.equal(
    runs.reduce((n, run) => n + run.length, 0),
    1728,
  );
  assert.equal(
    runs
      .filter(
        (run) =>
          run.value.kind === "registered" && run.value.registryId === grass,
      )
      .reduce((n, run) => n + run.length, 0),
    576,
  );
  assert.deepEqual(session.hiddenLayers.getSnapshot(), [buildings]);
  stop();
  session.dispose();
});
