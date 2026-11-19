import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnotationCommands,
  AreaValidationError,
  validateNamedArea,
} from "../../src/domain/annotations.ts";
import { MapDocument, type DocumentChange } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { annotationId } from "../../src/domain/values.ts";
import { canvasInvalidation } from "../../src/editor/invalidation.ts";

const mapBounds = { minX: -64, minY: -64, maxX: 6400, maxY: 6400 };
const house = {
  name: "  Blacksmith's house  ",
  description: " Forge downstairs.\n家 upstairs. ",
  tier: "detail",
  bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
  label: { placement: "center" },
};
function fixture(maxBytes?: number) {
  const document = new MapDocument({ bounds: mapBounds });
  const history = new CommandHistory(document, {
    initiallySaved: true,
    limits: { maxBytes: maxBytes ?? 1e6 },
  });
  const commands = new AnnotationCommands(history);
  const events: DocumentChange[] = [];
  document.subscribe((e) => {
    events.push(e);
  });
  const snapshot = () => ({
    records: document.annotations,
    version: document.version,
    history: history.state,
    events: events.length,
  });
  return { document, history, commands, events, snapshot };
}

test("named house/village/region lifecycle keeps independent data, IDs, exact history and dirty checkpoints", () => {
  const f = fixture();
  const initial = f.document.annotations;
  const ids = ["detail", "locality", "region"].map((tier, i) => {
    const { id, result } = f.commands.execute({
      kind: "create",
      value: { ...house, tier, description: i === 1 ? "" : house.description },
    });
    assert.match(id, /^area-[0-9a-f-]{36}$/);
    assert.deepEqual(result.observerErrors, []);
    assert.equal(f.events.length, i + 1);
    return id;
  });
  assert.equal(new Set(ids).size, 3);
  const created = f.document.annotations;
  assert.equal(f.document.getAnnotation(ids[0])!.name, "Blacksmith's house");
  assert.equal(f.document.getAnnotation(ids[1])!.description, "");
  assert.equal(f.history.state.dirty, true);
  f.history.markSaved(f.history.captureCheckpoint());
  const edit = {
    ...house,
    name: "Smithy",
    description: "New description",
    tier: "region",
    bounds: { minX: -64, minY: -64, maxX: -63, maxY: -63 },
  };
  f.commands.execute({ kind: "edit", id: ids[0], value: edit });
  assert.equal(f.history.state.undoSteps, 4);
  assert.equal(f.history.state.dirty, true);
  assert.deepEqual(
    f.document.getAnnotation(ids[1]),
    created.find(([id]) => id === ids[1])![1],
  );
  const changed = f.document.annotations;
  f.history.undo();
  assert.equal(f.history.state.dirty, false);
  assert.deepEqual(f.document.annotations, created);
  f.history.redo();
  assert.deepEqual(f.document.annotations, changed);
  const beforeNoop = f.snapshot();
  f.commands.execute({ kind: "edit", id: ids[0], value: edit });
  assert.deepEqual(f.snapshot(), beforeNoop);
  f.commands.execute({ kind: "remove", id: ids[1] });
  assert.equal(f.document.getAnnotation(ids[1]), null);
  assert.equal(f.document.annotations.length, 2);
  f.history.undo();
  assert.deepEqual(f.document.annotations, changed);
  f.history.redo();
  for (let i = 0; i < 5; i++) f.history.undo();
  assert.deepEqual(f.document.annotations, initial);
  for (let i = 0; i < 5; i++) f.history.redo();
  assert.equal(f.document.annotations.length, 2);
  for (const e of f.events) {
    const dirty = canvasInvalidation(e);
    assert.equal(dirty.annotationIds.length, 1);
    assert.equal(dirty.regions.length, 0);
  }
});

test("complete validation rejects missing fields, invalid tiers/geometry/placement without partial updates", () => {
  const f = fixture();
  const { id } = f.commands.execute({ kind: "create", value: house });
  const cases: unknown[] = [
    null,
    {},
    ...["name", "description", "bounds", "tier", "label"].map((key) =>
      Object.fromEntries(Object.entries(house).filter(([k]) => k !== key)),
    ),
    ...[
      "",
      " \t",
      "House\nVillage",
      "House\rVillage",
      "House\u2028Village",
    ].map((name) => ({ ...house, name })),
    ...[null, 2].map((description) => ({ ...house, description })),
    ...["custom", "Detail", "", null].map((tier) => ({ ...house, tier })),
    ...[null, {}, { placement: "edge" }, { placement: "center", x: 1 }].map(
      (label) => ({ ...house, label }),
    ),
    ...[
      null,
      {},
      { minX: 0, minY: 0, maxX: 0, maxY: 8 },
      { minX: 8, minY: 0, maxX: 0, maxY: 8 },
      { minX: 0.5, minY: 0, maxX: 8, maxY: 8 },
      { minX: "0", minY: 0, maxX: 8, maxY: 8 },
      { minX: -65, minY: 0, maxX: 8, maxY: 8 },
      { minX: 6399, minY: 0, maxX: 6401, maxY: 8 },
      { minX: 0, minY: 0, maxX: Infinity, maxY: 8 },
      {
        minX: -Number.MAX_SAFE_INTEGER,
        minY: 0,
        maxX: Number.MAX_SAFE_INTEGER,
        maxY: 8,
      },
    ].map((bounds) => ({ ...house, bounds })),
  ];
  const snapshot = f.snapshot();
  for (const value of cases) {
    for (const request of [
      { kind: "create", value },
      { kind: "edit", id, value },
    ] as const) {
      assert.throws(() => f.commands.execute(request), AreaValidationError);
      assert.deepEqual(f.snapshot(), snapshot);
    }
  }
  assert.deepEqual(
    validateNamedArea({ ...house, bounds: mapBounds }, mapBounds).bounds,
    mapBounds,
  );
});

test("identity collision, missing targets, history capacity and detached inputs are safe", () => {
  const f = fixture();
  const input = structuredClone(house);
  const { id } = f.commands.execute({ kind: "create", value: input });
  const before = f.snapshot();
  input.bounds.minX = 0;
  input.description = "mutated";
  assert.deepEqual(f.snapshot(), before);
  assert.ok(Object.isFrozen(f.document.getAnnotation(id)!.bounds));
  assert.throws(
    () =>
      new AnnotationCommands(f.history, () => id).execute({
        kind: "create",
        value: house,
      }),
    /Duplicate/,
  );
  for (const kind of ["edit", "remove"] as const)
    assert.throws(
      () =>
        f.commands.execute({ kind, id: annotationId("missing"), value: house }),
      /no longer available/,
    );
  assert.deepEqual(f.snapshot(), before);
  const limited = fixture(1);
  const original = limited.snapshot();
  assert.throws(
    () => limited.commands.execute({ kind: "create", value: house }),
    /history byte limit/,
  );
  assert.deepEqual(limited.snapshot(), original);
});
