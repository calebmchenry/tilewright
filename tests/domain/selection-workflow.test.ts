import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument, type TileWrite } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import type { Bounds } from "../../src/domain/coordinates.ts";
import {
  captureSelection,
  planSelectionMove,
  planSelectionTransform,
  transformSelection,
  type SelectionTransform,
} from "../../src/domain/selection.ts";
import {
  captureClipboard,
  planClipboardCut,
  planClipboardPaste,
  transformClipboard,
} from "../../src/domain/clipboard.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
  equalCells,
  type Cell,
} from "../../src/domain/values.ts";

const ids = ["terrain", "walls", "furniture", "canopy"].map(layerId);
const stone = registryId("stone");
const palette = [
  null,
  null,
  rawColor("#00000000"),
  rawColor("#aabbccff"),
  rawColor("#b18b4dff"), // Same appearance as stone, distinct identity.
  registeredColor(stone),
] as const;
const transforms: SelectionTransform[] = [
  "rotate-clockwise",
  "rotate-counterclockwise",
  "flip-horizontal",
  "flip-vertical",
];
type Matrix = Cell[][];
type Model = Matrix[];
const copy = (model: Model): Model =>
  model.map((rows) => rows.map((r) => [...r]));
const metadata = (doc: MapDocument) => ({
  bounds: doc.bounds,
  layers: doc.layers,
  registry: doc.registryEntries,
  annotations: doc.annotations,
});

test("large composed multilayer transform capacity rejection preserves every cell, redo and checkpoints", () => {
  const doc = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
    layers: ids.map((id) => ({ id, name: id })),
  });
  const writes: TileWrite[] = [];
  for (const l of [1, 2])
    for (let y = 248; y < 780; y++)
      writes.push({
        layerId: ids[l],
        x: 248,
        y,
        length: 532,
        value: palette[2 + ((y + l) % 4)],
      });
  doc.writeBatch(writes);
  doc.applyCommands([
    {
      kind: "registry",
      id: stone,
      value: { name: "Stone", rgba: "#b18b4dff" },
    },
  ]);
  const history = new CommandHistory(doc, {
    initiallySaved: true,
    limits: { maxBytes: 4096 },
  });
  history.markRecovery(history.captureCheckpoint());
  history.execute("Temporary", [
    {
      kind: "tiles",
      writes: [{ layerId: ids[0], x: 1, y: 1, length: 1, value: palette[3] }],
    },
  ]);
  history.undo();
  const persistent = () => ({
    ...metadata(doc),
    runs: [...doc.iterateRuns()],
    version: doc.version,
    history: history.state,
  });
  const original = persistent();
  const payload = captureSelection(
    doc,
    { minX: 252, minY: 252, maxX: 764, maxY: 636 },
    [ids[1], ids[2]],
  );
  const transformed = transformSelection(
    transformSelection(payload, "rotate-clockwise"),
    "flip-vertical",
  );
  const plan = planSelectionTransform(doc, payload, transformed, {
    minX: 255,
    minY: 257,
    maxX: 639,
    maxY: 769,
  });
  let events = 0;
  doc.subscribe(() => events++);
  assert.throws(
    () =>
      history.execute("Large transform", [
        { kind: "tiles", writes: plan.writes },
      ]),
    /history byte limit/,
  );
  assert.deepEqual(persistent(), original);
  assert.equal(events, 0);
  history.redo();
  assert.deepEqual(doc.getCell(ids[0], 1, 1), palette[3]);
});
// Independent dense transpose/reverse oracle: never reads a production payload,
// plan, or change record to construct expected results.
function turn(rows: Matrix, op: SelectionTransform): Matrix {
  if (op === "flip-horizontal") return rows.map((r) => [...r].reverse());
  if (op === "flip-vertical") return [...rows].reverse();
  const columns = rows[0].map((_, x) => rows.map((r) => r[x]));
  return op === "rotate-clockwise"
    ? columns.map((r) => r.reverse())
    : columns.reverse();
}

for (const seed of [1, 42, 0x1a2b3c4d, 0x5e6f7081, 0xdeadbeef, 0xffffffff])
  for (const origin of [-72, 52])
    test(`composed selection oracle seed=${seed} origin=${origin}`, () => {
      let randomState = seed >>> 0;
      const random = (n: number) => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState % n;
      };
      const side = 28;
      const bounds = {
        minX: origin,
        minY: origin,
        maxX: origin + side,
        maxY: origin + side,
      };
      const doc = new MapDocument({
        bounds,
        layers: ids.map((id) => ({ id, name: id })),
      });
      let model: Model = ids.map(() =>
        Array.from({ length: side }, () =>
          Array.from({ length: side }, () => palette[random(palette.length)]),
        ),
      );
      doc.applyCommands([
        {
          kind: "registry",
          id: stone,
          value: { name: "Stone", rgba: "#b18b4dff" },
        },
        {
          kind: "annotation",
          id: annotationId("house"),
          value: {
            name: "House",
            description: "Never moved",
            bounds,
            tier: "detail",
            anchor: { x: origin + 12, y: origin + 12 },
          },
        },
      ]);
      doc.writeBatch(
        model.flatMap((rows, l) =>
          rows.flatMap((row, y) =>
            row.map((value, x) => ({
              layerId: ids[l],
              x: origin + x,
              y: origin + y,
              length: 1,
              value,
            })),
          ),
        ),
      );
      const originalMetadata = metadata(doc);
      const history = new CommandHistory(doc, { initiallySaved: true });
      history.markRecovery(history.captureCheckpoint());
      const session = {};
      const states = [copy(model)];
      let events = 0;
      doc.subscribe(() => events++);
      function verify(expected: Model, context: string) {
        for (let l = 0; l < ids.length; l++)
          for (let y = 0; y < side; y++)
            for (let x = 0; x < side; x++)
              assert.ok(
                equalCells(
                  doc.getCell(ids[l], origin + x, origin + y),
                  expected[l][y][x],
                ),
                `${context}: ${ids[l]} (${origin + x},${origin + y})`,
              );
        assert.deepEqual(metadata(doc), originalMetadata, context);
      }
      function commit(
        label: string,
        writes: readonly TileWrite[],
        next: Model,
      ) {
        const before = events;
        const result = history.execute(label, [{ kind: "tiles", writes }]);
        assert.deepEqual(result.observerErrors, []);
        assert.equal(events, before + Number(result.change !== null));
        model = next;
        verify(model, label);
        if (result.change) states.push(copy(model));
      }
      function extract(rect: Bounds, scope: number[]): Model {
        return scope.map((l) =>
          model[l]
            .slice(rect.minY - origin, rect.maxY - origin)
            .map((row) => row.slice(rect.minX - origin, rect.maxX - origin)),
        );
      }
      function place(
        source: Bounds | null,
        payload: Model,
        scope: number[],
        x: number,
        y: number,
      ): Model {
        const next = copy(model),
          h = payload[0].length,
          w = payload[0][0].length;
        for (const [i, l] of scope.entries()) {
          if (source)
            for (let sy = source.minY; sy < source.maxY; sy++)
              for (let sx = source.minX; sx < source.maxX; sx++)
                if (!(sx >= x && sx < x + w && sy >= y && sy < y + h))
                  next[l][sy - origin][sx - origin] = null;
          for (let v = 0; v < h; v++)
            for (let u = 0; u < w; u++)
              if (payload[i][v][u] !== null)
                next[l][y + v - origin][x + u - origin] = payload[i][v][u];
        }
        return next;
      }

      // Every cycle includes move, live transforms, copy/cut, transformed paste,
      // repeated placement and scope changes. First rectangles cross +/-64.
      for (let step = 0; step < 36; step++) {
        const w = step === 0 ? 9 : 3 + random(7),
          h = step === 0 ? 9 : 3 + random(7);
        const crossing = origin < 0 ? -66 : 60;
        const x = step === 0 ? crossing : origin + random(side - w);
        const y = step === 0 ? crossing : origin + random(side - h);
        const rect = { minX: x, minY: y, maxX: x + w, maxY: y + h };
        const scope = [[1], [1, 2], [2, 3]][step % 3];
        const scopeIds = scope.map((l) => ids[l]);
        const captured = captureSelection(doc, rect, scopeIds);
        const dense = extract(rect, scope);
        const beforeSelection = history.state;
        verify(model, `capture ${step}`);
        assert.deepEqual(history.state, beforeSelection);
        if (step % 3 === 0) {
          const dx = x + w + 3 <= bounds.maxX ? 3 : -3;
          const plan = planSelectionMove(doc, captured, dx, 0);
          commit(
            `move ${step}`,
            plan.writes,
            place(rect, dense, scope, x + dx, y),
          );
        } else if (step % 3 === 1) {
          const op = transforms[Math.floor(step / 3) % 4],
            op2 = transforms[random(4)];
          const transformed = transformSelection(
            transformSelection(captured, op),
            op2,
          );
          const expected = dense.map((rows) => turn(turn(rows, op), op2));
          const tx = origin + random(side - expected[0][0].length + 1);
          const ty = origin + random(side - expected[0].length + 1);
          const destination = {
            minX: tx,
            minY: ty,
            maxX: tx + expected[0][0].length,
            maxY: ty + expected[0].length,
          };
          commit(
            `transform ${step}`,
            planSelectionTransform(doc, captured, transformed, destination)
              .writes,
            place(rect, expected, scope, tx, ty),
          );
        } else {
          const clip = captureClipboard(doc, session, rect, scopeIds);
          if (step % 2 === 0) {
            const next = copy(model);
            for (const l of scope)
              for (let sy = rect.minY; sy < rect.maxY; sy++)
                for (let sx = rect.minX; sx < rect.maxX; sx++)
                  next[l][sy - origin][sx - origin] = null;
            commit(`cut ${step}`, planClipboardCut(doc, session, clip), next);
          }
          const op = transforms[Math.floor(step / 3) % 4];
          const transformed = transformClipboard(clip, op);
          const expected = dense.map((rows) => turn(rows, op));
          const tx = origin + random(side - expected[0][0].length + 1);
          const ty = origin + random(side - expected[0].length + 1);
          commit(
            `paste ${step}`,
            planClipboardPaste(doc, session, transformed, tx, ty).writes,
            place(null, expected, scope, tx, ty),
          );
          // Reusing the original copy must not inherit the staged transform.
          commit(
            `repeat ${step}`,
            planClipboardPaste(doc, session, clip, x, y).writes,
            place(null, dense, scope, x, y),
          );
        }
        if (doc.version !== captured.documentVersion) {
          const state = history.state,
            version = doc.version;
          assert.throws(() => planSelectionMove(doc, captured, 1, 0), /stale/);
          assert.deepEqual(history.state, state);
          assert.equal(doc.version, version);
        }
        if (step % 5 === 0 && history.state.undoSteps) {
          history.undo();
          verify(states.at(-2)!, `interleaved undo ${step}`);
          const state = history.state,
            version = doc.version;
          const fresh = captureSelection(doc, rect, scopeIds);
          let identity = fresh;
          for (let i = 0; i < 4; i++)
            identity = transformSelection(identity, "rotate-clockwise");
          assert.equal(
            history.execute("identity", [
              {
                kind: "tiles",
                writes: planSelectionTransform(doc, fresh, identity).writes,
              },
            ]).change,
            null,
          );
          assert.deepEqual(history.state, state);
          assert.equal(doc.version, version);
          history.redo();
          verify(model, `interleaved redo ${step}`);
        }
      }
      assert.ok(states.length > 36, "sequence must exercise effective edits");
      assert.equal(history.state.undoSteps, states.length - 1);
      for (let i = states.length - 2; i >= 0; i--) {
        history.undo();
        verify(states[i], `full undo ${i}`);
      }
      assert.equal(history.state.dirty, false);
      assert.equal(history.state.revision, history.state.recoveryRevision);
      for (let i = 1; i < states.length; i++) {
        history.redo();
        verify(states[i], `full redo ${i}`);
      }
    });
