import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Bounds } from "../src/domain/coordinates";
import type { AnnotationId } from "../src/domain/values";

const panel = (page: Page) =>
  page
    .locator("main")
    .getByRole("region", { name: "Annotations", exact: true });
const action = (page: Page, name: string) =>
  panel(page).getByRole("button", { name, exact: true });
const search = (page: Page) => panel(page).getByLabel("Find an area");
const host = (page: Page) => page.locator(".canvas-host");
async function setup(page: Page, fixture: string) {
  await page.goto(`/tests/editor.html?fixture=${fixture}`);
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.history.markSaved(s.history.captureCheckpoint());
    s.history.markRecovery(s.history.captureCheckpoint());
    window.editorProbe.reset();
  });
}
const persistent = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      bounds: s.document.bounds,
      records: s.document.annotations,
      layers: s.document.layers,
      registry: s.document.registryEntries,
      storage: s.document.storageStats(),
      version: s.document.version,
      history: s.history.state,
    };
  });
async function focusGeometry(page: Page, bounds: Bounds) {
  const state = await page.evaluate((bounds) => {
    const s = window.editorProbe.session;
    const view = s.viewport.getSnapshot(),
      size = s.canvasSize.getSnapshot();
    const pixels = view.zoom * 24;
    return {
      view,
      size,
      centerX: view.x + (size.width / 2 - 24) / pixels,
      centerY: view.y + (size.height / 2 - 24) / pixels,
      left: 24 + (bounds.minX - view.x) * pixels,
      top: 24 + (bounds.minY - view.y) * pixels,
      right: 24 + (bounds.maxX - view.x) * pixels,
      bottom: 24 + (bounds.maxY - view.y) * pixels,
      selected: s.areas.selected.getSnapshot(),
      overlay: s.areas.overlayArea(),
      selection: s.selection.state.getSnapshot(),
    };
  }, bounds);
  expect(state.centerX).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 8);
  expect(state.centerY).toBeCloseTo((bounds.minY + bounds.maxY) / 2, 8);
  expect(state.left).toBeGreaterThanOrEqual(23.999999);
  expect(state.top).toBeGreaterThanOrEqual(23.999999);
  expect(state.right).toBeLessThanOrEqual(state.size.width - 23.999999);
  expect(state.bottom).toBeLessThanOrEqual(state.size.height - 23.999999);
  expect(state.view.zoom).toBeLessThanOrEqual(1);
  expect(state.overlay?.bounds).toEqual(bounds);
  return state;
}

for (const [kind, cells] of [
  ["frontier", 6620700],
  ["heartland", 24025200],
] as const)
  test(`${kind}: search and focus distant populated houses, localities and regions without document edits`, async ({
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1200, height: 900 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page, `areas-${kind}`);
    const before = await persistent(page);
    expect(before.records).toHaveLength(1089);
    expect(before.storage.occupiedCells).toBe(cells);
    const visits = [];
    for (const id of [
      "area-house-0-0-12-12",
      "area-village-9-8",
      "area-region-0-9",
      "area-house-9-8-108-108",
    ]) {
      const record = before.records.find(([key]) => key === id)![1];
      const bounds = record.bounds as unknown as Bounds;
      // Inspect at a scale that hides this tier before using the explicit focus action.
      await page.evaluate((tier) => {
        const s = window.editorProbe.session;
        s.areas.deselect();
        if (tier === "region") s.setZoom(1);
        else s.fitMap();
      }, String(record.tier));
      const previous = await page.evaluate(() =>
        window.editorProbe.session.viewport.getSnapshot(),
      );
      await search(page).fill(String(record.name).toUpperCase());
      const row = panel(page).getByRole("button", {
        name: `${record.name} ${record.tier} · ${id}`,
        exact: true,
      });
      await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
      await expect(
        panel(page).getByLabel("Area name", { exact: true }),
      ).toHaveValue(String(record.name));
      await expect(
        panel(page).getByLabel("Description", { exact: true }),
      ).toHaveValue(String(record.description));
      await expect(panel(page).getByLabel("Tier", { exact: true })).toHaveValue(
        String(record.tier),
      );
      await action(page, "Cancel area edit").click();
      await expect(panel(page).getByLabel("Area dimensions")).toHaveText(
        `${bounds.maxX - bounds.minX} × ${bounds.maxY - bounds.minY} tiles`,
      );
      await expect(panel(page).getByLabel("Area bounds")).toContainText(
        `X [${bounds.minX}, ${bounds.maxX}) · Y [${bounds.minY}, ${bounds.maxY})`,
      );
      await expect(panel(page).locator(".area-description")).toHaveText(
        String(record.description),
      );
      expect(
        await page.evaluate(() =>
          window.editorProbe.session.viewport.getSnapshot(),
        ),
      ).toEqual(previous);
      await action(page, "Focus area").focus();
      await action(page, "Focus area").press("Enter");
      await expect(action(page, "Focus area")).toBeFocused();
      const focused = await focusGeometry(page, bounds);
      expect(focused.selected).toBe(id);
      expect(focused.selection).toBeNull();
      expect(focused.view).not.toEqual(previous);
      if (record.tier === "detail") expect(focused.view.zoom).toBe(1);
      await action(page, "Focus area").click();
      expect((await focusGeometry(page, bounds)).view).toEqual(focused.view);
      await expect(host(page).locator("canvas")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await panel(page).getByLabel("Area dimensions").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${id}.png`) });
      visits.push({ id, bounds, ...focused });
    }
    expect(await persistent(page)).toEqual(before);
    expect(await page.evaluate(() => window.editorProbe.invalidations)).toEqual(
      [],
    );
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath(`${kind}-browsing.json`),
      JSON.stringify(
        {
          kind,
          cells,
          annotations: before.records.length,
          dpr: 2,
          visits,
          history: before.history,
          unchanged: true,
          errors,
        },
        null,
        2,
      ),
    );
    await page.evaluate(() => window.editorProbe.dispose());
    await context.close();
  });

test("panel and on-map selection remain synchronized through filtered rename, delete, undo and redo with an independent tile selection", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await setup(page, "areas");
  const before = await persistent(page);
  const tiles = await page.evaluate(() => [
    ...window.editorProbe.session.document.iterateRuns(),
  ]);
  await search(page).fill("blacksmith");
  const originalRow = () =>
    panel(page).getByRole("button", { name: /^Blacksmith's house detail/ });
  await originalRow().click();
  await action(page, "Cancel area edit").click();
  await action(page, "Focus area").click();
  // Create a real tile selection across the label, then return to the area panel.
  await page
    .locator("main")
    .getByRole("button", { name: "Select", exact: true })
    .click();
  const box = (await host(page).boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx - 84, cy - 84);
  await page.mouse.down();
  await page.mouse.move(cx + 84, cy + 84);
  await page.mouse.up();
  const selection = await page.evaluate(() =>
    window.editorProbe.session.selection.state.getSnapshot(),
  );
  expect(selection?.bounds).toEqual({ minX: 60, minY: 60, maxX: 68, maxY: 68 });
  await originalRow().click();
  await action(page, "Cancel area edit").click();
  await action(page, "Deselect area").click();
  await page.mouse.click(cx, cy);
  await expect(originalRow()).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).getByLabel("Area name", { exact: true }),
  ).toHaveValue("Blacksmith's house");
  expect(await persistent(page)).toEqual(before);
  await panel(page)
    .getByLabel("Area name", { exact: true })
    .fill("Renamed forge");
  await panel(page)
    .getByLabel("Description", { exact: true })
    .fill("New workshop\nUpstairs residence");
  await action(page, "Apply area").click();
  await expect(panel(page)).toContainText("No matching areas.");
  await expect(
    panel(page).getByRole("heading", { name: "Renamed forge", exact: true }),
  ).toBeVisible();
  await expect(panel(page).getByLabel("Area dimensions")).toHaveText(
    "8 × 8 tiles",
  );
  await search(page).fill("renamed");
  const renamedRow = () =>
    panel(page).getByRole("button", { name: /^Renamed forge detail/ });
  await expect(renamedRow()).toHaveAttribute("aria-pressed", "true");
  const afterRename = await page.evaluate(() => {
    const { documentVersion: _version, ...selection } =
      window.editorProbe.session.selection.state.getSnapshot()!;
    return selection;
  });
  const { documentVersion: _version, ...expectedSelection } = selection!;
  expect(afterRename).toEqual(expectedSelection);
  await action(page, "Focus area").click();
  expect(
    await page.evaluate(
      () => window.editorProbe.session.selection.state.getSnapshot()!.bounds,
    ),
  ).toEqual(selection!.bounds);
  await page.screenshot({
    path: info.outputPath("independent-selections.png"),
  });
  await page.locator(".canvas-host").press("Meta+z");
  await expect(panel(page)).toContainText("No matching areas.");
  await expect(
    panel(page).getByRole("heading", {
      name: "Blacksmith's house",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".canvas-host").press("Meta+Shift+z");
  await expect(renamedRow()).toHaveAttribute("aria-pressed", "true");
  await action(page, "Delete area").click();
  await expect(action(page, "Focus area")).toHaveCount(0);
  await expect(panel(page).getByLabel("Area dimensions")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.editorProbe.session.areas.overlayArea()),
  ).toBeNull();
  await page.locator(".canvas-host").press("Meta+z");
  await expect(renamedRow()).toHaveAttribute("aria-pressed", "false");
  await expect(action(page, "Focus area")).toHaveCount(0);
  await renamedRow().click();
  await action(page, "Cancel area edit").click();
  await action(page, "Focus area").click();
  expect(
    await page.evaluate(() => window.editorProbe.session.areas.overlayArea()),
  ).toMatchObject({
    id: "area-house",
    name: "Renamed forge",
    bounds: selection!.bounds,
  });
  // Shared Undo/Redo deliberately deselect tiles. Area restoration/reselection
  // must not create a new tile selection or revive that old tile payload.
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.selection.state.getSnapshot(),
    ),
  ).toBeNull();
  const after = await persistent(page);
  expect(after.storage).toEqual(before.storage);
  expect(after.bounds).toEqual(before.bounds);
  expect(after.layers).toEqual(before.layers);
  expect(
    await page.evaluate(() => [
      ...window.editorProbe.session.document.iterateRuns(),
    ]),
  ).toEqual(tiles);
  expect(after.records.filter(([id]) => id !== "area-house")).toEqual(
    before.records.filter(([id]) => id !== "area-house"),
  );
  await page.screenshot({
    path: info.outputPath("restored-area.png"),
  });
});

test("focus preserves valid draft inspection, guards invalid bounds and fits a resized narrow canvas", async ({
  page,
}, info) => {
  await setup(page, "areas");
  const before = await persistent(page);
  await panel(page)
    .getByRole("button", { name: /^Blacksmith's house detail/ })
    .click();
  await panel(page).getByLabel("Minimum X", { exact: true }).fill("bad");
  await expect(action(page, "Focus area")).toBeDisabled();
  await expect(action(page, "Focus area")).toHaveAccessibleDescription(
    "Enter valid bounds to focus the area.",
  );
  await panel(page).getByLabel("Minimum X", { exact: true }).fill("59");
  await panel(page)
    .getByLabel("Area name", { exact: true })
    .fill("Unapplied name");
  await action(page, "Focus area").click();
  await expect(
    panel(page).getByLabel("Area name", { exact: true }),
  ).toHaveValue("Unapplied name");
  await expect(panel(page).getByLabel("Area dimensions")).toHaveText(
    "9 × 8 tiles",
  );
  await focusGeometry(page, { minX: 59, minY: 60, maxX: 68, maxY: 68 });
  await action(page, "Cancel area edit").click();
  await expect(panel(page).getByLabel("Area dimensions")).toHaveText(
    "8 × 8 tiles",
  );
  await page.evaluate(() => {
    window.editorProbe.session.areas.select("area-region" as AnnotationId);
    window.editorProbe.session.areas.cancelDraft();
  });
  await page.setViewportSize({ width: 640, height: 452 });
  await action(page, "Focus area").click();
  await focusGeometry(page, { minX: -64, minY: -64, maxX: 1024, maxY: 1024 });
  await panel(page).getByLabel("Area dimensions").scrollIntoViewIfNeeded();
  await expect(panel(page).getByLabel("Area dimensions")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await persistent(page)).toEqual(before);
  await page.screenshot({
    path: info.outputPath("narrow-area-inspection.png"),
  });
});
