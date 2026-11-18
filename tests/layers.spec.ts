import { expect, test } from "@playwright/test";

// The editor/tiles suites declare the shared test-only window probes.
test("layer controls add above active, rename, reorder, remove empty layers and protect the last layer", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = page.getByRole("region", { name: "Layers", exact: true });
  const stack = panel.getByRole("group", { name: "Active layer" });
  const remove = panel.getByRole("button", {
    name: "Remove layer",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription(
    "Keep at least one layer in the map.",
  );
  await panel.getByLabel("Layer name", { exact: true }).fill("Terrain");
  await panel.getByRole("button", { name: "Rename", exact: true }).click();
  await panel.getByRole("button", { name: "Add layer", exact: true }).click();
  await panel.getByLabel("Layer name", { exact: true }).fill("Buildings");
  await panel.getByLabel("Layer name", { exact: true }).press("Enter");
  await expect(stack.getByRole("button")).toHaveText([
    "▱BuildingsActive",
    "▱Terrain",
  ]);
  await expect(
    panel.getByRole("button", { name: "Move layer up" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Move layer down" }).click();
  await expect(stack.getByRole("button")).toHaveText([
    "▱Terrain",
    "▱BuildingsActive",
  ]);
  await expect(
    panel.getByRole("button", { name: "Move layer down" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Undo Reorder layers", exact: true })
    .click();
  await expect(stack.getByRole("button")).toHaveText([
    "▱BuildingsActive",
    "▱Terrain",
  ]);
  await page
    .getByRole("button", { name: "Redo Reorder layers", exact: true })
    .click();
  await panel.getByLabel("Layer name", { exact: true }).fill("  ");
  await expect(
    panel.getByRole("button", { name: "Rename", exact: true }),
  ).toBeDisabled();
  await stack.getByRole("button", { name: "Terrain", exact: true }).click();
  await panel.getByRole("button", { name: "Add layer", exact: true }).click();
  await expect(stack.getByRole("button")).toHaveText([
    "▱Layer 1Active",
    "▱Terrain",
    "▱Buildings",
  ]);
  await remove.click(); // Empty layers need no extra confirmation.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(stack.getByRole("button")).toHaveText([
    "▱TerrainActive",
    "▱Buildings",
  ]);
  await page
    .getByRole("button", { name: "Undo Remove layer", exact: true })
    .click();
  await expect(stack.getByRole("button")).toHaveText([
    "▱Layer 1",
    "▱TerrainActive",
    "▱Buildings",
  ]);
  await page.setViewportSize({ width: 640, height: 452 });
  await panel
    .getByRole("button", { name: "Add layer", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("layers-small-window.png"),
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
  expect(
    await page
      .locator(".right-sidebar")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("populated removal confirms the exact layer, cancel/Escape preserve history and undo restores hidden content", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/editor.html?fixture=grid");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = page
    .locator("main")
    .getByRole("region", { name: "Layers", exact: true });
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 55, y: 55, zoom: 1 }),
  );
  await panel.getByRole("button", { name: "Buildings", exact: true }).click();
  const original = await page.evaluate(() => ({
    layers: window.editorProbe.session.document.layers,
    runs: [...window.editorProbe.session.document.iterateRuns()],
  }));
  await panel.getByRole("button", { name: "Move layer down" }).click();
  await panel.getByLabel("Show active layer").uncheck();
  await expect(
    panel.getByRole("button", { name: "Buildings Active Hidden" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Show this layer before drawing");
  const before = await page.evaluate(() => ({
    history: window.editorProbe.session.history.state,
    runs: [...window.editorProbe.session.document.iterateRuns()],
  }));
  await panel
    .getByRole("button", { name: "Remove layer", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Remove layer?" });
  await expect(dialog).toContainText("Buildings");
  await expect(dialog).toContainText("including hidden content");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Meta+z"); // Must not reorder behind the modal.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Remove layer", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(() => ({
      history: window.editorProbe.session.history.state,
      runs: [...window.editorProbe.session.document.iterateRuns()],
    })),
  ).toEqual(before);
  await panel
    .getByRole("button", { name: "Remove layer", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await panel
    .getByRole("button", { name: "Remove layer", exact: true })
    .click();
  await page.setViewportSize({ width: 640, height: 452 });
  await expect(
    dialog.getByRole("button", { name: "Remove layer", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("remove-populated-layer.png"),
  });
  await dialog
    .getByRole("button", { name: "Remove layer", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Terrain Active" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByRole("button", { name: "Remove layer", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Undo Remove layer", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Buildings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Redo Remove layer", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Buildings", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo Remove layer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo Reorder layers", exact: true })
    .click();
  expect(
    await page.evaluate(() => ({
      layers: window.editorProbe.session.document.layers,
      runs: [...window.editorProbe.session.document.iterateRuns()],
    })),
  ).toEqual(original);
});

for (const density of [1, 2]) {
  test(`layer management preserves overlap pixels and stored data in detail and overview at DPR ${density}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ deviceScaleFactor: density });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async () => {
      await window.tileProbe.load("grid");
      window.tileProbe.registry("wall", "#b18b4dff");
      window.tileProbe.reference("buildings", 61, 61, "wall");
    });
    const original = await page.evaluate(() => ({
      runs: [...window.tileProbe.session.document.iterateRuns()],
      registry: window.tileProbe.session.document.registryEntries,
    }));
    const pixels = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => window.tileProbe.stats().overview.pending),
        )
        .toBe(0);
      return page.evaluate(() =>
        window.tileProbe.sample([
          [61, 61],
          [58, 61],
        ]),
      );
    };
    const gold = [177, 139, 77, 255],
      green = [51, 92, 70, 255];
    for (const zoom of [1, 1 / 24]) {
      await page.evaluate((zoom) => window.tileProbe.view(55, 55, zoom), zoom);
      expect(await pixels()).toEqual([gold, green]);
      const beforeVisibility = await page.evaluate(
        () => window.tileProbe.session.history.state,
      );
      await page.evaluate(() => window.tileProbe.hide("buildings", true));
      expect(await pixels()).toEqual([green, green]);
      expect(
        await page.evaluate(() => ({
          runs: [...window.tileProbe.session.document.iterateRuns()],
          registry: window.tileProbe.session.document.registryEntries,
        })),
      ).toEqual(original);
      expect(
        await page.evaluate(() => window.tileProbe.session.history.state),
      ).toEqual(beforeVisibility);
      await page.evaluate(() => window.tileProbe.hide("buildings", false));
      expect(await pixels()).toEqual([gold, green]);
      await page.evaluate(() => {
        const session = window.tileProbe.session;
        const id = session.document.layers.find(
          (layer) => layer.name === "Buildings",
        )!.id;
        session.selectLayer(id);
        session.moveLayer(id, "down");
      });
      expect(await pixels()).toEqual([green, green]);
      await page.evaluate(() => window.tileProbe.hide("terrain", true));
      expect((await pixels())[0]).toEqual(gold);
      await page.evaluate(() => {
        window.tileProbe.hide("terrain", false);
        window.tileProbe.session.perform("undo");
      });
      expect(await pixels()).toEqual([gold, green]);
      await page.evaluate(() => {
        const session = window.tileProbe.session;
        session.removeLayer(session.activeLayer.getSnapshot(), true);
      });
      expect(await pixels()).toEqual([green, green]);
      await page.evaluate(() => window.tileProbe.session.perform("undo"));
      expect(await pixels()).toEqual([gold, green]);
      expect(
        await page.evaluate(() => ({
          runs: [...window.tileProbe.session.document.iterateRuns()],
          registry: window.tileProbe.session.document.registryEntries,
        })),
      ).toEqual(original);
    }
    await context.close();
  });
}
