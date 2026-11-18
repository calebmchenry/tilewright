import assert from "node:assert/strict";
import test from "node:test";
import { CommandHistory } from "../../src/domain/history.ts";
import {
  RegistryCommands,
  RegistryCollisionError,
  type RegistryRequest,
} from "../../src/domain/registry.ts";
import {
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import type { DocumentChange, MapDocument } from "../../src/domain/document.ts";
import type { ColorInput } from "../../src/domain/colors.ts";
import { resolveColor } from "../../src/renderer/colors.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { bindDocument } from "../../src/renderer/bindDocument.ts";
import type { CanvasInvalidation } from "../../src/editor/invalidation.ts";
import {
  registryDocument,
  terrain,
  buildings,
  mountain,
  wall,
} from "../fixtures/registry.ts";

const content = (d: MapDocument) => ({
  bounds: d.bounds,
  layers: d.layers,
  registry: d.registryEntries,
  annotations: d.annotations,
  runs: [...d.iterateRuns()],
});
function fixture(maxBytes?: number) {
  const document = registryDocument();
  const history = new CommandHistory(document, {
    limits: { maxBytes: maxBytes ?? 64 * 1024 * 1024 },
  });
  const commands = new RegistryCommands(history);
  const events: DocumentChange[] = [];
  document.subscribe((event) => {
    for (const run of document.iterateRuns())
      if (run.value.kind === "registered")
        assert.ok(document.getRegistryEntry(run.value.registryId));
    events.push(event);
  });
  const checkpoint = history.captureCheckpoint();
  history.markSaved(checkpoint);
  history.markRecovery(checkpoint);
  const snapshot = () => ({
    content: content(document),
    version: document.version,
    history: history.state,
  });
  const run = (request: RegistryRequest) => {
    const plan = commands.prepare(request);
    assert.deepEqual(commands.commit(plan).observerErrors, []);
    return plan;
  };
  const roundTrip = (request: RegistryRequest) => {
    const before = content(document),
      steps = history.state.undoSteps,
      count = events.length;
    const plan = run(request),
      after = content(document);
    assert.equal(events.length, count + 1);
    assert.equal(history.state.undoSteps, steps + 1);
    assert.deepEqual(history.undo().observerErrors, []);
    assert.deepEqual(content(document), before);
    assert.deepEqual(history.redo().observerErrors, []);
    assert.deepEqual(content(document), after);
    assert.equal(events.length, count + 3);
    return plan;
  };
  return { document, history, commands, events, snapshot, run, roundTrip };
}
const grass = (adopt = false) =>
  ({ kind: "add", name: " Grass ", color: "#335C46", adopt }) as const;

test("R02/R03/R04/R19: explicit all-layer adoption, targeted spans and exact undo/redo", () => {
  for (const adopt of [false, true]) {
    const f = fixture();
    const plan = f.roundTrip(grass(adopt));
    assert.match(plan.id, /^registry-/);
    assert.equal(plan.entry.name, "Grass");
    assert.equal(plan.entry.rgba, "#335c46ff");
    assert.equal(plan.cellCount, 2);
    assert.equal(plan.layerCount, 2);
    for (const [layer, x] of [
      [terrain, 0],
      [buildings, 64],
    ] as const)
      assert.deepEqual(
        f.document.getCell(layer, x, 0),
        adopt ? registeredColor(plan.id) : rawColor("#335c46ff"),
      );
    const first = f.events[0];
    assert.equal(first.kind, "transaction");
    if (first.kind !== "transaction") throw new Error("Expected transaction");
    assert.deepEqual(
      first.changes.filter((c) => c.kind === "registry").map((c) => c.id),
      [plan.id],
    );
    const changed = first.changes
      .filter((c) => c.kind === "tiles")
      .flatMap((c) => c.runs);
    assert.deepEqual(
      changed.map((r) => [r.layerId, r.x, r.y, r.length]),
      adopt
        ? [
            [terrain, 0, 0, 1],
            [buildings, 64, 0, 1],
          ]
        : [],
    );
    if (!adopt) f.roundTrip({ kind: "adopt", id: plan.id });
    const before = f.snapshot(),
      count = f.events.length;
    f.run({ kind: "adopt", id: plan.id });
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.events.length, count);
    assert.equal(f.document.storageStats().occupiedCells, 8);
  }
});

test("R01/R05/R06/R07: canonical collisions and equivalent recolor preserve complete history/checkpoints/redo", () => {
  const f = fixture();
  const owner = f.run({
    kind: "add",
    name: "Pastel",
    color: "#abc",
    adopt: false,
  });
  const g = f.run(grass());
  f.run({ kind: "edit", id: g.id, name: "Meadow", color: "#335c46" });
  f.history.undo();
  const before = f.snapshot(),
    count = f.events.length;
  for (const color of [
    "#AbC",
    "#ABCF",
    "#AABBCCFF",
    [170, 187, 204],
  ] satisfies ColorInput[])
    for (const name of ["Pastel", "Other"])
      for (const adopt of [false, true])
        assert.throws(
          () => f.run({ kind: "add", name, color, adopt }),
          (e) =>
            e instanceof RegistryCollisionError && e.owners[0][0] === owner.id,
        );
  for (const name of ["Mountain", "Renamed mountain"])
    assert.throws(
      () => f.run({ kind: "edit", id: mountain, name, color: "#818181" }),
      RegistryCollisionError,
    );
  f.run({ kind: "edit", id: g.id, name: "Grass", color: "#335C46FF" });
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.events.length, count);
});

test("R10/R11: trimmed/duplicate names, stable IDs, unused removal and no-op rename", () => {
  const f = fixture(),
    g = f.run(grass());
  f.roundTrip({
    kind: "edit",
    id: g.id,
    name: " Meadow ",
    color: g.entry.rgba,
  });
  const before = f.snapshot(),
    count = f.events.length;
  f.run({ kind: "edit", id: g.id, name: "Meadow", color: g.entry.rgba });
  assert.throws(
    () => f.run({ kind: "edit", id: g.id, name: "  ", color: g.entry.rgba }),
    /name/,
  );
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.events.length, count);
  f.roundTrip({
    kind: "edit",
    id: g.id,
    name: "Mountain",
    color: g.entry.rgba,
  });
  assert.equal(
    f.document.registryEntries.filter(([, e]) => e.name === "Mountain").length,
    2,
  );
  const remove = f.roundTrip({ kind: "remove", id: g.id });
  assert.equal(remove.cellCount, 0);
  assert.deepEqual(f.document.getCell(terrain, 0, 0), rawColor(g.entry.rgba));
});

test("R12/R19: Grass/Mountain/Stone wall walkthrough preserves meanings, occupied cells and raw matches", () => {
  const f = fixture();
  const g = f.roundTrip(grass(true));
  const tiles = content(f.document).runs;
  f.roundTrip({ kind: "edit", id: g.id, name: "Grass", color: "#557755" });
  assert.deepEqual(content(f.document).runs, tiles);
  assert.deepEqual(
    resolveColor(f.document, registeredColor(g.id)),
    [85, 119, 85, 255],
  );
  assert.deepEqual(f.document.getCell(buildings, 65, 0), rawColor("#557755ff"));
  const pixels = [...f.document.iterateRuns()].flatMap((run) =>
    Array.from({ length: run.length }, () =>
      resolveColor(f.document, run.value),
    ),
  );
  const removed = f.roundTrip({ kind: "remove", id: g.id });
  assert.equal(removed.cellCount, 2);
  assert.equal(removed.layerCount, 2);
  assert.deepEqual(
    [...f.document.iterateRuns()].flatMap((run) =>
      Array.from({ length: run.length }, () =>
        resolveColor(f.document, run.value),
      ),
    ),
    pixels,
  );
  assert.equal(f.document.storageStats().occupiedCells, 8);
  assert.equal(
    [...f.document.iterateRuns()]
      .filter((r) => r.value.kind === "registered")
      .reduce((n, r) => n + r.length, 0),
    4,
  );
  const g2 = f.run({ ...grass(), color: "#557755" });
  assert.notEqual(g2.id, g.id);
  const adoption = f.roundTrip({ kind: "adopt", id: g2.id });
  assert.equal(adoption.cellCount, 3);
  assert.equal(adoption.layerCount, 2);
  for (const layer of [terrain, buildings])
    assert.deepEqual(
      f.document.getCell(layer, 63, 0),
      registeredColor(mountain),
    );
  assert.deepEqual(f.document.getCell(terrain, 64, 0), registeredColor(wall));
  assert.deepEqual(f.document.getCell(buildings, 0, 0), registeredColor(wall));
});

test("R14: invalid inputs, malformed targets, unknown/duplicate IDs and ambiguous ownership never mutate", () => {
  const f = fixture();
  const before = f.snapshot();
  for (const color of ["bad", "#335c4680", "#335c4600"])
    assert.throws(() => f.run({ ...grass(true), color }), /opaque/);
  assert.throws(() => f.run({ ...grass(), name: " " }), /name/);
  for (const kind of ["adopt", "remove"] as const)
    assert.throws(
      () => f.run({ kind, id: registryId("missing") }),
      /no longer/,
    );
  assert.throws(
    () =>
      f.run({
        kind: "edit",
        id: registryId("missing"),
        name: "Missing",
        color: "#fff",
      }),
    /no longer/,
  );
  const duplicate = new RegistryCommands(f.history, () => mountain);
  assert.throws(
    () => duplicate.prepare(grass()),
    /Duplicate registry identity/,
  );
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.events.length, 0);

  f.history.execute("Legacy ambiguity", [
    {
      kind: "registry",
      id: registryId("duplicate"),
      value: { name: "Other", rgba: "#808080ff" },
    },
  ]);
  const ambiguous = f.snapshot(),
    count = f.events.length;
  for (const request of [
    { kind: "remove", id: mountain },
    { kind: "adopt", id: mountain },
    { kind: "edit", id: mountain, name: "Changed", color: "#123456" },
  ] satisfies RegistryRequest[])
    assert.throws(() => f.run(request), /Ambiguous/);
  assert.deepEqual(f.snapshot(), ambiguous);
  assert.equal(f.events.length, count);
  f.history.execute("Legacy malformed", [
    {
      kind: "registry",
      id: registryId("broken"),
      value: { name: "", rgba: "#123456ff" },
    },
  ]);
  const broken = f.snapshot();
  assert.throws(
    () => f.run({ kind: "remove", id: registryId("broken") }),
    /Invalid named/,
  );
  assert.throws(() => f.run({ ...grass(), color: "#123456" }), /Invalid named/);
  assert.deepEqual(f.snapshot(), broken);
});

test("R13/R15: canceled, stale and foreign plans preserve state; refreshed plans work", () => {
  const f = fixture(),
    g = f.run(grass());
  for (const request of [
    grass(true),
    { kind: "adopt", id: g.id },
    { kind: "remove", id: g.id },
    { kind: "edit", id: g.id, name: "Meadow", color: "#123456" },
  ] satisfies RegistryRequest[]) {
    const valid =
      request.kind === "add" ? { ...request, color: "#123456" } : request;
    const before = f.snapshot(),
      count = f.events.length;
    const plan = f.commands.prepare(valid);
    f.commands.cancel(plan);
    assert.throws(() => f.commands.commit(plan), /canceled/);
    assert.throws(
      () => f.commands.prepare(valid, f.document.version, { aborted: true }),
      /canceled/,
    );
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.events.length, count);
  }
  for (const kind of ["adopt", "remove"] as const) {
    const plan = f.commands.prepare({ kind, id: g.id });
    f.history.execute("Change map", [
      { kind: "rename-layer", id: terrain, name: kind },
    ]);
    const changed = f.snapshot();
    assert.throws(() => f.commands.commit(plan), /map changed/);
    assert.throws(
      () => f.commands.prepare({ kind, id: g.id }, plan.version),
      /map changed/,
    );
    assert.deepEqual(f.snapshot(), changed);
  }
  const plan = f.commands.prepare({ kind: "adopt", id: g.id });
  assert.throws(
    () => new RegistryCommands(f.history).commit(plan),
    /another session/,
  );
  f.commands.commit(plan);
  assert.throws(() => f.commands.commit(plan), /already submitted/);
});

test("R15: history capacity rejection rolls back combined adoption/removal and retains redo/checkpoints", () => {
  for (const kind of ["add", "remove"] as const) {
    const f = fixture(900);
    f.history.execute("Rename", [
      { kind: "rename-layer", id: terrain, name: "T" },
    ]);
    f.history.undo();
    const before = f.snapshot(),
      count = f.events.length;
    assert.throws(
      () => f.run(kind === "add" ? grass(true) : { kind, id: mountain }),
      /history byte limit/,
    );
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.events.length, count);
    assert.equal(f.history.state.redoSteps, 1);
  }
});

test("R17/R18: exact opaque bytes, zero matches and new identity after undo branch", () => {
  const f = fixture();
  f.history.execute("Legacy paint", [
    {
      kind: "tiles",
      writes: ["#335c4680", "#335c4600", "#000000ff", "#ffffffff"].map(
        (rgba, x) => ({
          layerId: terrain,
          x: x + 2,
          y: 0,
          length: 1,
          value: rawColor(rgba),
        }),
      ),
    },
  ]);
  const before = content(f.document);
  const g = f.roundTrip(grass(true));
  assert.equal(g.cellCount, 2);
  for (let x = 2; x < 6; x++)
    assert.deepEqual(
      f.document.getCell(terrain, x, 0),
      before.runs.find((r) => r.layerId === terrain && r.x === x)?.value,
    );
  assert.equal(f.document.getCell(terrain, 6, 0), null);
  f.roundTrip({ kind: "remove", id: g.id });
  assert.deepEqual([...f.document.iterateRuns()], before.runs);
  const unused = f.roundTrip({ ...grass(true), color: "#abcdef" });
  assert.equal(unused.cellCount, 0);
  const state = f.snapshot();
  f.run({ kind: "adopt", id: unused.id });
  assert.deepEqual(f.snapshot(), state);
  f.history.undo();
  const fresh = f.run({ ...grass(), color: "#abcdef" });
  assert.notEqual(fresh.id, unused.id);
});

test("R16/R18: named selection writes IDs, raw matching selection stays raw and removal/undo fall back without reselection", () => {
  const session = new EditorSession(registryDocument());
  session.setLayerVisible(buildings, false);
  const plan = session.registryCommands.prepare(grass(true));
  assert.equal(session.commitRegistry(plan), true);
  assert.deepEqual(session.currentPaint(), registeredColor(plan.id));
  const paint = (x: number) =>
    session.execute("Paint selected", [
      {
        kind: "tiles",
        writes: [terrain, buildings].map((layerId) => ({
          layerId,
          x,
          y: 1,
          length: 1,
          value: session.currentPaint(),
        })),
      },
    ]);
  paint(0);
  const version = session.document.version,
    state = session.history.state;
  session.setColor(plan.entry.rgba);
  assert.deepEqual(session.currentPaint(), rawColor(plan.entry.rgba));
  assert.equal(session.document.version, version);
  assert.deepEqual(session.history.state, state);
  paint(1);
  const edit = session.registryCommands.prepare({
    kind: "edit",
    id: plan.id,
    name: "Meadow",
    color: "#557755",
  });
  session.commitRegistry(edit);
  assert.equal(session.color.getSnapshot(), plan.entry.rgba); // Raw preference stays fixed.
  session.selectRegisteredColor(plan.id);
  assert.equal(session.color.getSnapshot(), "#557755ff");
  session.perform("undo");
  assert.deepEqual(session.currentPaint(), registeredColor(plan.id));
  assert.equal(session.color.getSnapshot(), plan.entry.rgba);
  session.perform("redo");
  assert.equal(session.color.getSnapshot(), "#557755ff");
  for (const layer of [terrain, buildings]) {
    assert.deepEqual(
      session.document.getCell(layer, 0, 1),
      registeredColor(plan.id),
    );
    assert.deepEqual(
      session.document.getCell(layer, 1, 1),
      rawColor(plan.entry.rgba),
    );
  }
  session.commitRegistry(
    session.registryCommands.prepare({ kind: "adopt", id: mountain }),
  );
  assert.deepEqual(session.currentPaint(), registeredColor(plan.id));
  session.commitRegistry(
    session.registryCommands.prepare({ kind: "remove", id: plan.id }),
  );
  assert.deepEqual(session.currentPaint(), rawColor("#557755ff"));
  session.perform("undo");
  assert.deepEqual(session.currentPaint(), rawColor("#557755ff"));
  session.perform("redo");
  const fresh = session.registryCommands.prepare({
    ...grass(),
    color: "#557755",
  });
  session.commitRegistry(fresh);
  assert.notEqual(fresh.id, plan.id);
  assert.deepEqual(session.currentPaint(), registeredColor(fresh.id));
  session.perform("undo");
  assert.deepEqual(session.currentPaint(), rawColor("#557755ff"));
  session.perform("redo");
  assert.deepEqual(session.currentPaint(), rawColor("#557755ff"));
  assert.deepEqual(session.hiddenLayers.getSnapshot(), [buildings]);
  session.dispose();
  assert.equal(session.selectRegisteredColor(mountain), false);
});

test("R14/R15: session rejection preserves registered selection, checkpoints, redo and document", () => {
  const session = new EditorSession(registryDocument());
  session.selectRegisteredColor(mountain);
  session.renameLayer(terrain, "T");
  session.perform("undo");
  session.history.markSaved(session.history.captureCheckpoint());
  session.history.markRecovery(session.history.captureCheckpoint());
  const snapshot = () => ({
    content: content(session.document),
    version: session.document.version,
    history: session.history.state,
    paint: session.currentPaint(),
    color: session.color.getSnapshot(),
  });
  const before = snapshot();
  assert.throws(
    () =>
      session.registryCommands.prepare({ ...grass(true), color: "#808080" }),
    RegistryCollisionError,
  );
  assert.equal(session.selectRegisteredColor(registryId("missing")), false);
  assert.deepEqual(snapshot(), before);
  const plan = session.registryCommands.prepare(grass(true));
  session.renameLayer(terrain, "Changed");
  const changed = snapshot();
  assert.equal(session.commitRegistry(plan), false);
  assert.deepEqual(snapshot(), changed);
  session.dispose();
  assert.equal(
    session.commitRegistry(session.registryCommands.prepare(grass())),
    false,
  );
});

test("R19: rename targets metadata only; adoption/removal notify exact spans and committed view errors never retry", () => {
  const session = new EditorSession(registryDocument());
  const canvas: CanvasInvalidation[] = [];
  const stop = bindDocument(session, (change) => canvas.push(change));
  let panels = 0;
  session.registry.subscribe(() => panels++);
  const before = content(session.document).runs;
  session.commitRegistry(
    session.registryCommands.prepare({
      kind: "edit",
      id: mountain,
      name: "Peaks",
      color: "#808080",
    }),
  );
  assert.equal(panels, 1);
  assert.equal(canvas.length, 0);
  assert.deepEqual(content(session.document).runs, before);
  session.perform("undo");
  session.perform("redo");
  assert.equal(panels, 3);
  assert.equal(canvas.length, 0);
  session.registry.subscribe(() => {
    throw new Error("Broken registry view");
  });
  session.selectedRegistryId.subscribe(() => {
    throw new Error("Broken paint view");
  });
  const plan = session.registryCommands.prepare(grass(true));
  const count = session.history.state.undoSteps;
  assert.equal(session.commitRegistry(plan), true);
  assert.equal(session.history.state.undoSteps, count + 1);
  assert.deepEqual(session.currentPaint(), registeredColor(plan.id));
  assert.equal(session.color.getSnapshot(), plan.entry.rgba);
  assert.match(session.feedback.getSnapshot().message, /committed, but a view/);
  assert.deepEqual(canvas.at(-1)?.registryIds, [plan.id]);
  assert.deepEqual(canvas.at(-1)?.regions, [
    { layerId: terrain, minX: 0, minY: 0, maxX: 1, maxY: 1 },
    { layerId: buildings, minX: 64, minY: 0, maxX: 65, maxY: 1 },
  ]);
  assert.equal(session.commitRegistry(plan), false);
  assert.equal(session.history.state.undoSteps, count + 1);
  stop();
  session.dispose();
});
