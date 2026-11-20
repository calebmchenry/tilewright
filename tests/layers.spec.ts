import { expect, test, type Locator, type Page } from "@playwright/test";

const panelFor = (page: Page) =>
  page.locator("main").getByRole("region", { name: "Layers", exact: true });
const activeName = (panel: Locator) =>
  panel.getByLabel("Layer name", { exact: true });
async function order(panel: Locator, names: string[]) {
  await expect
    .poll(() =>
      panel
        .locator(".layer-name")
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        ),
    )
    .toEqual(names);
}
async function dragLayer(
  page: Page,
  panel: Locator,
  from: string,
  to: string,
  edge: "top" | "bottom",
  release = true,
) {
  const handle = panel.getByRole("button", {
    name: `Reorder ${from}`,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const start = (await handle.boundingBox())!;
  const end = (await panel
    .locator(".layer-row")
    .filter({
      has: page.getByRole("button", { name: `Reorder ${to}`, exact: true }),
    })
    .boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    end.x + end.width / 2,
    end.y + (edge === "top" ? 2 : end.height - 2),
    { steps: 8 },
  );
  if (release) await page.mouse.up();
}

test("compact rows select and rename inline, add above active, and protect the last layer", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = panelFor(page);
  const remove = panel.getByRole("button", {
    name: "Remove Layer 1",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription(
    "Keep at least one layer in the map.",
  );
  await expect(
    panel.locator(".hint, .layer-badges, .layer-actions"),
  ).toHaveCount(0);
  const name = activeName(panel);
  await name.fill("  Terrain  ");
  await name.press("Enter");
  await expect(name).toHaveValue("Terrain");
  await expect(name).toBeFocused();
  await name.fill("Discard this");
  await name.press("Escape");
  await expect(name).toHaveValue("Terrain");
  await name.fill("  ");
  await name.press("Enter");
  await expect(name).toHaveValue("Terrain");
  await panel.getByRole("button", { name: "Add layer", exact: true }).click();
  await name.fill("Buildings");
  // Clicking away saves the name; it does not require a Rename button.
  await panel.getByRole("heading", { name: "Layers 2" }).click();
  await order(panel, ["Buildings", "Terrain"]);
  await panel.getByLabel("Layer name: Terrain", { exact: true }).click();
  await expect(name).toHaveValue("Terrain");
  await panel.getByRole("button", { name: "Add layer", exact: true }).click();
  await order(panel, ["Buildings", "Layer 1", "Terrain"]);
  await panel
    .getByRole("button", { name: "Remove Buildings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(name).toHaveValue("Layer 1"); // Removing another row preserves selection.
  await panel
    .getByRole("button", { name: "Remove Layer 1", exact: true })
    .click();
  await expect(name).toHaveValue("Terrain");
  await expect(name).toBeFocused();
  await page.locator(".canvas-host").press("Meta+z");
  await order(panel, ["Layer 1", "Terrain"]);
  await expect(name).toHaveValue("Terrain");
  await panel
    .getByLabel("Layer name: Layer 1", { exact: true })
    .fill("Long layer name ".repeat(20));
  await activeName(panel).press("Enter");
  await page.setViewportSize({ width: 640, height: 452 });
  await panel.scrollIntoViewIfNeeded();
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

test("drag handles reorder multiple positions atomically without changing selection; canceled drags preserve history", async ({
  page,
}) => {
  await page.goto("/tests/editor.html?fixture=grid");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = panelFor(page);
  for (const name of ["Objects", "Labels"]) {
    await panel.getByRole("button", { name: "Add layer", exact: true }).click();
    await activeName(panel).fill(name);
    await activeName(panel).press("Enter");
  }
  await panel.getByLabel("Layer name: Terrain", { exact: true }).click();
  const snapshot = () =>
    page.evaluate(() => ({
      layers: window.editorProbe.session.document.layers,
      runs: [...window.editorProbe.session.document.iterateRuns()].sort(
        (a, b) => a.layerId.localeCompare(b.layerId) || a.y - b.y || a.x - b.x,
      ),
      history: window.editorProbe.session.history.state,
    }));
  const before = await snapshot();
  await order(panel, ["Buildings", "Labels", "Objects", "Terrain"]);
  await dragLayer(page, panel, "Buildings", "Terrain", "bottom");
  await order(panel, ["Labels", "Objects", "Terrain", "Buildings"]);
  await expect(activeName(panel)).toHaveValue("Terrain");
  expect((await snapshot()).history.undoSteps).toBe(
    before.history.undoSteps + 1,
  );
  expect((await snapshot()).runs).toEqual(before.runs);
  await page.locator(".canvas-host").press("Meta+z");
  await order(panel, ["Buildings", "Labels", "Objects", "Terrain"]);
  await page.locator(".canvas-host").press("Meta+Shift+z");
  await order(panel, ["Labels", "Objects", "Terrain", "Buildings"]);
  await dragLayer(page, panel, "Buildings", "Labels", "top");
  await order(panel, ["Buildings", "Labels", "Objects", "Terrain"]);
  const unchanged = await snapshot();
  for (const cancel of [
    "escape",
    "outside",
    "pointercancel",
    "same-position",
  ] as const) {
    await dragLayer(
      page,
      panel,
      "Buildings",
      cancel === "same-position" ? "Buildings" : "Terrain",
      "bottom",
      false,
    );
    if (cancel === "escape") await page.keyboard.press("Escape");
    if (cancel === "outside") await page.mouse.move(300, 100);
    if (cancel === "pointercancel")
      await panel
        .getByRole("button", { name: "Reorder Buildings" })
        .dispatchEvent("pointercancel");
    await page.mouse.up();
    expect(await snapshot()).toEqual(unchanged);
    await expect(
      panel.locator('[data-drop-before="true"], [data-drop-end="true"]'),
    ).toHaveCount(0);
  }
  const handle = panel.getByRole("button", {
    name: "Reorder Buildings",
    exact: true,
  });
  await handle.press("ArrowDown");
  await order(panel, ["Labels", "Buildings", "Objects", "Terrain"]);
  await expect(handle).toBeFocused();
  await handle.press("End");
  await order(panel, ["Labels", "Objects", "Terrain", "Buildings"]);
  await handle.press("Home");
  await order(panel, ["Buildings", "Labels", "Objects", "Terrain"]);
  const atTop = await snapshot();
  await handle.press("ArrowUp");
  expect(await snapshot()).toEqual(atTop);
  await expect(activeName(panel)).toHaveValue("Terrain");
});

test("per-row visibility and populated removal preserve the selected target, and undo restores hidden content", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/editor.html?fixture=grid");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = panelFor(page);
  const original = await page.evaluate(() => ({
    layers: window.editorProbe.session.document.layers,
    runs: [...window.editorProbe.session.document.iterateRuns()],
  }));
  await panel
    .getByRole("button", { name: "Reorder Buildings" })
    .press("ArrowDown");
  await panel
    .getByRole("button", { name: "Hide Buildings", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Show Buildings", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(activeName(panel)).toHaveValue("Terrain");
  const before = await page.evaluate(() => ({
    history: window.editorProbe.session.history.state,
    runs: [...window.editorProbe.session.document.iterateRuns()],
  }));
  const remove = panel.getByRole("button", {
    name: "Remove Buildings",
    exact: true,
  });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove layer?" });
  await expect(dialog).toContainText("Buildings");
  await expect(dialog).toContainText("including hidden content");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect(
    await page.evaluate(() => ({
      history: window.editorProbe.session.history.state,
      runs: [...window.editorProbe.session.document.iterateRuns()],
    })),
  ).toEqual(before);
  await remove.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await remove.click();
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
  await expect(activeName(panel)).toHaveValue("Terrain");
  await expect(activeName(panel)).toBeFocused();
  await expect(
    panel.getByRole("button", { name: "Remove Terrain", exact: true }),
  ).toBeDisabled();
  await page.locator(".canvas-host").press("Meta+z");
  await expect(
    panel.getByRole("button", { name: "Hide Buildings", exact: true }),
  ).toBeVisible();
  await page.locator(".canvas-host").press("Meta+Shift+z");
  await expect(
    panel.getByRole("button", { name: "Remove Buildings", exact: true }),
  ).toHaveCount(0);
  await page.locator(".canvas-host").press("Meta+z");
  await page.locator(".canvas-host").press("Meta+z");
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
