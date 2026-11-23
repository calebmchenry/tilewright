import { expect, test, type Page } from "@playwright/test";
import type { RegistryId } from "../src/domain/values";

const panel = (page: Page) =>
  page.locator("main").getByRole("region", { name: "Color controls" });
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      bounds: s.document.bounds,
      layers: s.document.layers,
      registry: s.document.registryEntries,
      annotations: s.document.annotations,
      runs: [...s.document.iterateRuns()],
      version: s.document.version,
      history: s.history.state,
      paint: s.currentPaint(),
      color: s.color.getSnapshot(),
    };
  });
async function start(page: Page) {
  await page.goto("/tests/editor.html?fixture=registry");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
}
async function addGrass(page: Page, adopt = false) {
  await panel(page)
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Register color",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill(" Grass ");
  await dialog.getByLabel("Named color hex").fill("#335C46");
  await expect(dialog.getByTestId("registry-counts")).toContainText(
    "2 matching raw tiles on 2 layers",
  );
  await expect(
    dialog.getByLabel("Adopt matching raw tiles on all layers"),
  ).not.toBeChecked();
  if (adopt)
    await dialog.getByLabel("Adopt matching raw tiles on all layers").check();
  await dialog
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Paint with Grass" }),
  ).toHaveAttribute("aria-pressed", "true");
  return page.evaluate(() =>
    window.editorProbe.session.selectedRegistryId.getSnapshot()!,
  );
}

test("registry creates stable meanings, adopts hidden/covered cells, edits atomically and removes without erasing", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await start(page);
  const original = await snapshot(page);
  const id = await addGrass(page, true);
  await expect(
    panel(page).getByRole("button", { name: "Paint with Grass" }),
  ).toHaveAttribute("aria-pressed", "true");
  const linked = await snapshot(page);
  expect(linked.history.undoSteps).toBe(1);
  expect(
    linked.runs
      .filter((r) => r.value.kind === "registered" && r.value.registryId === id)
      .map((r) => [r.layerId, r.x, r.length]),
  ).toEqual([
    ["terrain", 0, 1],
    ["buildings", 64, 1],
  ]);
  expect(linked.annotations).toEqual(original.annotations);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.hiddenLayers.getSnapshot(),
    ),
  ).toEqual(["buildings"]);

  await panel(page)
    .getByRole("button", { name: "More options for Grass" })
    .click();
  await panel(page)
    .getByRole("menuitem", { name: "Edit Grass", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Meadow");
  await dialog.getByLabel("Named color hex").fill("#818181");
  await expect(dialog.getByRole("alert")).toContainText("Stone wall");
  await expect(
    dialog.getByRole("button", { name: "Edit named color", exact: true }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(linked);
  await dialog.getByLabel("Named color hex").fill("#557755");
  await dialog
    .getByRole("button", { name: "Edit named color", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Paint with Meadow" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).getByLabel("Current color", { exact: true }),
  ).toHaveValue("#557755");
  expect((await snapshot(page)).runs).toEqual(linked.runs);
  await page.evaluate(() => window.editorProbe.session.perform("undo"));
  await expect(
    panel(page).getByRole("button", { name: "Paint with Grass" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.editorProbe.session.perform("redo"));
  await panel(page)
    .getByRole("button", { name: "More options for Meadow" })
    .click();
  await panel(page)
    .getByRole("menuitem", { name: "Remove Meadow", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Remove named color" });
  await expect(dialog.getByTestId("registry-counts")).toContainText(
    "2 linked tiles on 2 layers",
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.screenshot({
    path: info.outputPath("registry-remove-confirmation.png"),
  });
  await dialog
    .getByRole("button", { name: "Remove named color", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Register color", exact: true }),
  ).toBeFocused();
  const removed = await snapshot(page);
  expect(removed.paint).toEqual({ kind: "raw", rgba: "#557755ff" });
  expect(removed.registry.some(([key]) => key === id)).toBe(false);
  expect(
    removed.runs
      .filter((r) => r.value.kind === "raw" && r.value.rgba === "#557755ff")
      .reduce((n, r) => n + r.length, 0),
  ).toBe(3);
  await page.evaluate(() => window.editorProbe.session.perform("undo"));
  const restored = await snapshot(page);
  expect(restored.runs).toEqual(linked.runs);
  expect(restored.paint).toEqual(removed.paint);
  await panel(page).getByRole("button", { name: "Paint with Meadow" }).click();
  const state = await snapshot(page);
  await panel(page).getByLabel("Hex color", { exact: true }).fill("#557755FF");
  expect((await snapshot(page)).paint).toEqual({
    kind: "raw",
    rgba: "#557755ff",
  });
  expect((await snapshot(page)).history).toEqual(state.history);
  await panel(page)
    .getByRole("button", { name: "Paint with Mountain" })
    .click();
  await page.screenshot({ path: info.outputPath("registry-entries.png") });
});

test("R13: Cancel and Escape in every registry dialog preserve all state and block map shortcuts", async ({
  page,
}) => {
  await start(page);
  await addGrass(page, true);
  await page.evaluate(() => {
    const h = window.editorProbe.session.history;
    h.markSaved(h.captureCheckpoint());
    h.markRecovery(h.captureCheckpoint());
  });
  const before = await snapshot(page);
  for (const opener of [
    "Register color",
    "Edit Grass",
    "Adopt raw tiles into Grass",
    "Remove Grass",
  ]) {
    for (const cancel of ["button", "escape"]) {
      if (opener !== "Register color")
        await panel(page)
          .getByRole("button", { name: "More options for Grass" })
          .click();
      await panel(page)
        .getByRole(opener === "Register color" ? "button" : "menuitem", {
          name: opener,
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      const button = dialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await button.focus();
      await button.press("ControlOrMeta+z");
      await button.press("ControlOrMeta+Shift+z");
      await button.press("f");
      if (cancel === "button") await button.click();
      else await button.press("Escape");
      await expect(dialog).not.toBeVisible();
      expect(await snapshot(page)).toEqual(before);
      await expect(
        panel(page).getByRole("button", {
          name: opener === "Register color" ? opener : "More options for Grass",
          exact: true,
        }),
      ).toBeFocused();
    }
  }
});

test("R09: Edit recolors the selected named swatch through history while raw selection remains independent", async ({
  page,
}, info) => {
  await start(page);
  const id = await addGrass(page, true);
  const linked = await snapshot(page);
  const edit = async (color: string) => {
    await panel(page)
      .getByRole("button", { name: "More options for Grass" })
      .click();
    await panel(page)
      .getByRole("menuitem", { name: "Edit Grass", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Edit named color",
      exact: true,
    });
    await expect(dialog).toContainText("including hidden and offscreen tiles");
    await dialog.getByLabel("Named color hex").fill(color);
    await page.screenshot({ path: info.outputPath("recolor-dialog.png") });
    await dialog
      .getByRole("button", { name: "Edit named color", exact: true })
      .click();
  };
  await edit("#557755");
  await expect(
    panel(page).getByLabel("Current color", { exact: true }),
  ).toHaveValue("#557755");
  await expect(
    panel(page).getByRole("button", { name: "Paint with Grass" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [action, color] of [
    ["undo", "#335C46"],
    ["redo", "#557755"],
  ] as const) {
    await page.evaluate(
      (action) => window.editorProbe.session.perform(action),
      action,
    );
    await expect(
      panel(page).getByLabel("Current color", { exact: true }),
    ).toHaveValue(color.toLowerCase());
    expect((await snapshot(page)).paint).toEqual({
      kind: "registered",
      registryId: id,
    });
  }
  await panel(page).getByLabel("Hex color", { exact: true }).fill("#335c46");
  await edit("#446644"); // A previously unused shade, with raw paint selected.
  for (const action of ["undo", "redo"] as const) {
    await page.evaluate(
      (action) => window.editorProbe.session.perform(action),
      action,
    );
    await expect(
      panel(page).getByLabel("Current color", { exact: true }),
    ).toHaveValue("#335c46");
    expect((await snapshot(page)).paint).toEqual({
      kind: "raw",
      rgba: "#335c46ff",
    });
  }
  const after = await snapshot(page);
  expect(after.runs).toEqual(linked.runs);
  expect(after.registry.find(([key]) => key === id)?.[1]).toEqual({
    name: "Grass",
    rgba: "#446644ff",
  });
});

test("duplicate registration identifies its owner; explicit adoption and selection remain separate", async ({
  page,
}) => {
  await start(page);
  const id = await addGrass(page);
  await panel(page)
    .getByRole("button", { name: "Paint with Mountain" })
    .click();
  const before = await snapshot(page);
  await panel(page)
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Meadow");
  await dialog.getByLabel("Named color hex").fill("#335c46ff");
  await dialog.getByLabel("Adopt matching raw tiles on all layers").check();
  await expect(dialog.getByRole("alert")).toContainText(
    "already belongs to “Grass”",
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog
    .getByRole("button", { name: "Adopt into Grass", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Adopt matching raw tiles",
    exact: true,
  });
  await expect(dialog.getByTestId("registry-counts")).toContainText(
    "2 matching raw tiles on 2 layers",
  );
  await dialog
    .getByRole("button", { name: "Adopt matching raw tiles", exact: true })
    .click();
  let after = await snapshot(page);
  expect(after.paint).toEqual(before.paint);
  expect(
    after.runs.filter(
      (r) => r.value.kind === "registered" && r.value.registryId === id,
    ),
  ).toHaveLength(2);
  await panel(page)
    .getByRole("button", { name: "More options for Grass" })
    .click();
  await panel(page)
    .getByRole("menuitem", { name: "Adopt raw tiles into Grass", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("registry-counts")).toContainText(
    "0 matching raw tiles on 0 layers",
  );
  await dialog
    .getByRole("button", { name: "Adopt matching raw tiles", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(after);
  await panel(page)
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Meadow");
  await dialog.getByLabel("Named color hex").fill("#335c46");
  await dialog
    .getByRole("button", { name: "Choose Grass", exact: true })
    .click();
  expect((await snapshot(page)).paint).toEqual({
    kind: "registered",
    registryId: id,
  });
  expect((await snapshot(page)).history).toEqual(after.history);
});

test("stale adoption/removal previews require refreshed counts and preserve selection", async ({
  page,
}) => {
  await start(page);
  const id = await addGrass(page);
  for (const kind of ["adopt", "remove"] as const) {
    await panel(page)
      .getByRole("button", { name: "More options for Grass" })
      .click();
    await panel(page)
      .getByRole("menuitem", {
        name: kind === "adopt" ? "Adopt raw tiles into Grass" : "Remove Grass",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await page.evaluate(
      ({ id, kind }) => {
        const s = window.editorProbe.session;
        s.execute("Concurrent edit", [
          {
            kind: "tiles",
            writes: [
              {
                layerId: s.document.layers[0].id,
                x: kind === "adopt" ? 2 : 3,
                y: 1,
                length: 1,
                value:
                  kind === "adopt"
                    ? { kind: "raw", rgba: "#335c46ff" }
                    : { kind: "registered", registryId: id as RegistryId },
              },
            ],
          },
        ]);
      },
      { id, kind },
    );
    const changed = await snapshot(page);
    await expect(dialog.getByRole("alert")).toContainText("map changed");
    const submit = dialog.getByRole("button", {
      name:
        kind === "adopt" ? "Adopt matching raw tiles" : "Remove named color",
      exact: true,
    });
    await expect(submit).toBeDisabled();
    expect(await snapshot(page)).toEqual(changed);
    await dialog.getByRole("button", { name: "Refresh preview" }).click();
    await expect(dialog.getByTestId("registry-counts")).toContainText(
      kind === "adopt" ? "3 matching raw" : "4 linked",
    );
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).not.toBeVisible();
  }
});

test("registry RGB/picker validation, unused removal, duplicate names and minimum-size dialog layout", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 640, height: 452 });
  await start(page);
  await panel(page)
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const before = await snapshot(page);
  await dialog.getByLabel("Name", { exact: true }).fill("Mountain");
  for (const color of ["invalid", "#12345680"]) {
    await dialog.getByLabel("Named color hex").fill(color);
    await expect(
      dialog.getByRole("button", { name: "Register color", exact: true }),
    ).toBeDisabled();
    expect(await snapshot(page)).toEqual(before);
  }
  await dialog.getByLabel("Named color swatch").fill("#aabbcc");
  await expect(dialog.getByLabel("Named color hex")).toHaveValue("#aabbcc");
  await dialog
    .getByRole("combobox", { name: "Color input", exact: true })
    .selectOption("rgb");
  for (const [channel, value] of [
    ["Red", "170"],
    ["Green", "187"],
    ["Blue", "204"],
  ])
    await expect(
      dialog.getByLabel(`Named color ${channel}`, { exact: true }),
    ).toHaveValue(value);
  await dialog.getByLabel("Named color Red", { exact: true }).fill("256");
  await expect(dialog.getByRole("alert")).toContainText("fully opaque");
  await dialog.getByLabel("Named color Red", { exact: true }).fill("171");
  await expect(dialog.getByLabel("Named color swatch")).toHaveValue("#abbbcc");
  await dialog.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(
    dialog.getByRole("button", { name: "Register color", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath("registry-small-dialog.png") });
  await dialog
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  const created = await snapshot(page);
  const id = (created.paint as { kind: "registered"; registryId: RegistryId })
    .registryId;
  expect(
    created.registry.filter(([, e]) => e.name === "Mountain"),
  ).toHaveLength(2);
  const row = panel(page).locator(`[data-registry-id="${id}"]`);
  await expect(
    row.getByRole("button", { name: "Paint with Mountain" }),
  ).toHaveAttribute("title", new RegExp(id));
  await row.getByRole("button", { name: "More options for Mountain" }).click();
  await row
    .getByRole("menuitem", { name: "Remove Mountain", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await snapshot(page)).registry.some(([key]) => key === id)).toBe(
    false,
  );
  expect((await snapshot(page)).runs).toEqual(before.runs);
  await page.evaluate(() => window.editorProbe.session.perform("undo"));
  expect((await snapshot(page)).registry).toEqual(created.registry);
});

for (const dpr of [1, 2]) {
  test(`feature adoption/removal preserves hidden and visible WebGL detail/overview pixels at DPR ${dpr}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async () => {
      await window.tileProbe.load("colors");
      window.tileProbe.resize(1100, 440);
      const s = window.tileProbe.session;
      s.execute("Upper grass", [
        {
          kind: "tiles",
          writes: Array.from({ length: 8 }, (_, i) => ({
            layerId: s.document.layers[1].id,
            x: 78,
            y: 8 + i,
            length: 8,
            value: { kind: "raw" as const, rgba: "#335c46ff" },
          })),
        },
      ]);
      s.setLayerVisible(s.document.layers[1].id, false);
    });
    const original = await page.evaluate(() => [
      ...window.tileProbe.session.document.iterateRuns(),
    ]);
    const id = await page.evaluate(() => {
      const s = window.tileProbe.session;
      let grass = "";
      for (const [name, color] of [
        ["Grass", "#335c46"],
        ["Mountain", "#808080"],
        ["Stone wall", "#818181"],
      ]) {
        const plan = s.registryCommands.prepare({
          kind: "add",
          name,
          color,
          adopt: true,
        });
        if (!s.commitRegistry(plan))
          throw new Error(s.feedback.getSnapshot().message);
        if (name === "Grass") {
          if (plan.cellCount !== 3136 || plan.layerCount !== 2)
            throw new Error("Incorrect hidden/covered adoption counts");
          grass = plan.id;
        }
      }
      return grass;
    });
    const linked = await page.evaluate(() => [
      ...window.tileProbe.session.document.iterateRuns(),
    ]);
    const sample = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => window.tileProbe.stats().overview.pending),
        )
        .toBe(0);
      return page.evaluate(() =>
        window.tileProbe.sample([
          [42, 12],
          [52, 12],
          [82, 12],
        ]),
      );
    };
    for (const zoom of [0.5, 1 / 24]) {
      await page.evaluate((zoom) => window.tileProbe.view(0, 0, zoom), zoom);
      expect(await sample()).toEqual(
        Array.from({ length: 3 }, () => [51, 92, 70, 255]),
      );
      await page.evaluate(() =>
        window.tileProbe.session.setLayerVisible(
          window.tileProbe.session.document.layers[1].id,
          true,
        ),
      );
      expect(await sample()).toEqual([
        [128, 128, 128, 255],
        [129, 129, 129, 255],
        [51, 92, 70, 255],
      ]);
      await page.evaluate((id) => {
        const s = window.tileProbe.session;
        if (
          !s.commitRegistry(
            s.registryCommands.prepare({
              kind: "remove",
              id: id as RegistryId,
            }),
          )
        )
          throw new Error(s.feedback.getSnapshot().message);
      }, id);
      expect(await sample()).toEqual([
        [128, 128, 128, 255],
        [129, 129, 129, 255],
        [51, 92, 70, 255],
      ]);
      const removed = await page.evaluate(() => [
        ...window.tileProbe.session.document.iterateRuns(),
      ]);
      expect(removed.filter((r) => r.layerId === "terrain")).toEqual(
        original.filter((r) => r.layerId === "terrain"),
      );
      await page.evaluate(() => window.tileProbe.session.perform("undo"));
      expect(
        await page.evaluate(() => [
          ...window.tileProbe.session.document.iterateRuns(),
        ]),
      ).toEqual(linked);
      expect(await sample()).toEqual([
        [128, 128, 128, 255],
        [129, 129, 129, 255],
        [51, 92, 70, 255],
      ]);
      await page.evaluate(() => window.tileProbe.session.perform("redo"));
      expect(await sample()).toEqual([
        [128, 128, 128, 255],
        [129, 129, 129, 255],
        [51, 92, 70, 255],
      ]);
      await page.evaluate(() => {
        window.tileProbe.session.perform("undo");
        window.tileProbe.session.setLayerVisible(
          window.tileProbe.session.document.layers[1].id,
          false,
        );
      });
    }
    await context.close();
  });
}
