import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationCommands } from "../../src/domain/annotations.ts";
import {
  annotationId,
  rawColor,
  registeredColor,
  type Cell,
} from "../../src/domain/values.ts";
import { resolveColor } from "../../src/renderer/colors.ts";
import {
  createDrawingSession,
  documentState,
  point,
  terrain,
  walls,
  furniture,
  grass,
  oldGrass,
  newGrass,
  house,
} from "../fixtures/complete-session.ts";

for (const multi of [false, true])
  test(`complete drawing, rearrangement, annotation and recolor session (${multi ? "chosen layers" : "single layer"})`, async () => {
    const { session: s, states } = await createDrawingSession();
    const d = s.document;
    try {
      assert.deepEqual(d.bounds, {
        minX: -64,
        minY: -64,
        maxX: 6400,
        maxY: 6400,
      });
      assert.deepEqual(d.getCell(walls, 61, 61), rawColor("#d2b48cff"));
      assert.equal(d.getCell(walls, 63, 67), null);
      for (const [x, y] of [
        [61, 61],
        [62, 61],
        [61, 62],
        [62, 62],
      ])
        assert.deepEqual(d.getCell(furniture, x, y), rawColor("#aabbccff"));
      assert.deepEqual(d.getCell(terrain, -1, -1), registeredColor(grass));
      const beforeSample = documentState(s);
      s.perform("eyedropper");
      assert.ok(s.sampleColorAt(point(s, 58, 50)));
      assert.deepEqual(s.currentPaint(), registeredColor(grass));
      assert.ok(s.sampleColorAt(point(s, 50, 50)));
      assert.deepEqual(s.currentPaint(), rawColor(oldGrass));
      assert.deepEqual(documentState(s), beforeSample);
      // Undo/redo every authoring transaction, including growth and all areas.
      for (let i = states.length - 2; i >= 0; i--) {
        assert.ok(s.perform("undo"));
        assert.deepEqual(documentState(s), states[i], `authoring undo ${i}`);
      }
      assert.equal(s.history.state.dirty, false);
      for (let i = 1; i < states.length; i++) {
        assert.ok(s.perform("redo"));
        assert.deepEqual(documentState(s), states[i], `authoring redo ${i}`);
      }
      s.setLayerVisible(furniture, true);
      s.selectLayer(walls);
      const select = () => {
        s.perform("select");
        assert.ok(s.selection.begin(2, point(s, 60, 60)));
        assert.ok(s.selection.commit(2, point(s, 67, 67)));
        if (multi) s.selection.setIncluded(furniture, true);
      };
      select();
      const before = documentState(s),
        fixed = before.annotations;
      const source = new Map<string, Cell>();
      for (const r of before.runs)
        for (let x = r.x; x < r.x + r.length; x++)
          source.set(`${r.layerId}:${x}:${r.y}`, r.value);
      const at = (id: string, x: number, y: number) =>
        source.get(`${id}:${x}:${y}`) ?? null;
      const expectedCells = new Map(source);
      assert.ok(s.selection.nudge(3, 0));
      // Independent cell oracle over the complete affected footprint; also
      // compare all other runs so distant/hidden content cannot silently change.
      for (const id of [walls, furniture])
        for (let y = 59; y <= 68; y++)
          for (let x = 59; x <= 71; x++) {
            let expected = at(id, x, y);
            if (id === walls || multi) {
              if (x >= 63 && x < 71 && y >= 60 && y < 68)
                expected = at(id, x - 3, y) ?? expected;
              else if (x >= 60 && x < 68 && y >= 60 && y < 68) expected = null;
            }
            assert.deepEqual(d.getCell(id, x, y), expected, `${id} ${x},${y}`);
            const key = `${id}:${x}:${y}`;
            if (expected === null) expectedCells.delete(key);
            else expectedCells.set(key, expected);
          }
      const actualCells = new Map<string, Cell>();
      for (const r of d.iterateRuns())
        for (let x = r.x; x < r.x + r.length; x++)
          actualCells.set(`${r.layerId}:${x}:${r.y}`, r.value);
      assert.deepEqual(actualCells, expectedCells);
      const moved = documentState(s);
      assert.deepEqual(
        moved.runs.filter((r) => r.layerId === terrain),
        before.runs.filter((r) => r.layerId === terrain),
      );
      assert.deepEqual(moved.annotations, fixed);
      assert.notDeepEqual(moved.runs, before.runs);
      assert.ok(s.perform("undo"));
      assert.deepEqual(documentState(s), before);
      assert.ok(s.perform("redo"));
      assert.deepEqual(documentState(s), moved);
      assert.ok(s.perform("undo"));
      assert.deepEqual(documentState(s), before);
      select();
      const edits = [before];
      const stop = d.subscribe(() => edits.push(documentState(s)));
      assert.ok(s.perform("copy"));
      assert.ok(s.perform("paste"));
      assert.ok(s.selection.positionPaste({ x: 80, y: 60 }));
      assert.ok(s.perform("rotate-clockwise"));
      assert.ok(s.perform("flip-horizontal"));
      assert.ok(s.selection.commitPaste());
      for (const operation of [
        "rotate-counterclockwise",
        "flip-vertical",
      ] as const) {
        assert.ok(s.perform(operation));
        assert.ok(s.selection.commitPlacement());
      }
      assert.ok(s.perform("cut"));
      assert.ok(s.perform("paste"));
      assert.ok(s.selection.positionPaste({ x: 80, y: 60 }));
      assert.ok(s.selection.commitPaste());
      stop();
      assert.equal(edits.length, 6);
      for (const state of edits) {
        assert.deepEqual(state.annotations, fixed);
        assert.deepEqual(
          state.runs.filter((r) => r.layerId === terrain),
          before.runs.filter((r) => r.layerId === terrain),
        );
      }
      for (let i = edits.length - 2; i >= 0; i--) {
        s.perform("undo");
        assert.deepEqual(documentState(s), edits[i]);
      }
      for (let i = 1; i < edits.length; i++) {
        s.perform("redo");
        assert.deepEqual(documentState(s), edits[i]);
      }
      const beforeArea = documentState(s);
      const area = d.getAnnotation(annotationId("house"))!;
      new AnnotationCommands(s.history).execute({
        kind: "edit",
        id: annotationId("house"),
        value: {
          ...area,
          description: "Explicit edit — labels stay independent",
          bounds: { ...house, minX: 63, maxX: 71 },
        },
      });
      const editedArea = documentState(s);
      assert.deepEqual(editedArea.runs, beforeArea.runs);
      s.perform("undo");
      assert.deepEqual(documentState(s), beforeArea);
      s.perform("redo");
      assert.deepEqual(documentState(s), editedArea);
      s.setLayerVisible(furniture, false);
      s.selectRegisteredColor(grass);
      assert.ok(
        s.commitRegistry(
          s.registryCommands.prepare({
            kind: "edit",
            id: grass,
            name: "Grass",
            color: newGrass,
          }),
        ),
      );
      const recolored = documentState(s);
      assert.deepEqual(recolored.runs, editedArea.runs);
      assert.deepEqual(recolored.annotations, editedArea.annotations);
      assert.equal(d.getRegistryEntry(grass)?.name, "Grass");
      for (const [id, x, y] of [
        [terrain, 58, 50],
        [furniture, 82, 50],
        [terrain, 6018, 6018],
        [furniture, 6034, 6034],
      ] as const) {
        assert.deepEqual(d.getCell(id, x, y), registeredColor(grass));
        assert.deepEqual(
          resolveColor(d, d.getCell(id, x, y)!),
          [85, 119, 85, 255],
        );
      }
      assert.deepEqual(d.getCell(terrain, 50, 50), rawColor(oldGrass));
      s.perform("undo");
      assert.deepEqual(documentState(s), editedArea);
      s.perform("redo");
      assert.deepEqual(documentState(s), recolored);
    } finally {
      s.dispose();
    }
  });
