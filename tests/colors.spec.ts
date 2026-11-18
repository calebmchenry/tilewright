import { expect, test } from "@playwright/test";
import type { RegistryId } from "../src/domain/values";

test("picker, hex and numeric RGB stay synchronized and reject invalid drafts without changing paint or history", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/editor.html");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = page
    .locator("main")
    .getByRole("region", { name: "Color controls" });
  const hex = panel.getByLabel("Hex color");
  const picker = panel.getByLabel("Current color", { exact: true });
  const selected = panel.getByLabel("Selected color");
  const snapshot = () =>
    page.evaluate(() => ({
      version: window.editorProbe.session.document.version,
      history: window.editorProbe.session.history.state,
      registry: window.editorProbe.session.document.registryEntries,
      runs: [...window.editorProbe.session.document.iterateRuns()],
    }));
  const original = await snapshot();
  await hex.fill(" #AbCf ");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#aabbcc");
  await expect(picker).toHaveValue("#aabbcc");
  for (const [channel, value] of [
    ["Red", "170"],
    ["Green", "187"],
    ["Blue", "204"],
  ])
    await expect(panel.getByLabel(channel, { exact: true })).toHaveValue(value);
  await picker.fill("#808080");
  await expect(selected).toHaveText("#808080");
  await expect(hex).toHaveValue("#808080");
  await expect(panel.getByTestId("color-match")).toContainText("Unregistered");
  await expect(panel.getByTestId("color-association")).toContainText(
    "Not linked",
  );
  for (const bad of ["#12345", "#80808080", "transparent"]) {
    await hex.fill(bad);
    await panel
      .getByRole("button", { name: "Apply color", exact: true })
      .click();
    await expect(hex).toHaveAttribute("aria-invalid", "true");
    await expect(hex).toHaveAccessibleDescription(/fully opaque/);
    await expect(picker).toHaveValue("#808080");
    await expect(selected).toHaveText("#808080");
  }
  for (const bad of ["", "-1", "256", "1.5", "1e2"]) {
    await panel.getByLabel("Red", { exact: true }).fill(bad);
    await panel.getByRole("button", { name: "Apply RGB" }).click();
    await expect(panel.getByLabel("Red", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(selected).toHaveText("#808080");
  }
  for (const channel of ["Red", "Green", "Blue"])
    await panel.getByLabel(channel, { exact: true }).fill("129");
  await panel.getByLabel("Blue", { exact: true }).press("Enter");
  await expect(hex).toHaveValue("#818181");
  await expect(picker).toHaveValue("#818181");
  await expect(selected).toHaveText("#818181");
  await expect(panel.locator('[aria-invalid="true"]')).toHaveCount(0);
  // Equivalent input still resets drafts, even without a store notification.
  await panel.getByLabel("Red", { exact: true }).fill("bad");
  await panel.getByRole("button", { name: "Apply RGB" }).click();
  await hex.fill("#818181FF");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#818181");
  await expect(panel.getByLabel("Red", { exact: true })).toHaveValue("129");
  await expect(panel.locator('[aria-invalid="true"]')).toHaveCount(0);
  expect(await snapshot()).toEqual(original);
  expect(
    await page.evaluate(() => window.editorProbe.session.currentPaint()),
  ).toEqual({ kind: "raw", rgba: "#818181ff" });

  // RGB fields retain native text/arrow shortcuts and cannot undo a map edit.
  await page.evaluate(() => window.editorProbe.edit());
  const edited = await snapshot();
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  const red = panel.getByLabel("Red", { exact: true });
  await red.fill("");
  await red.pressSequentially("100");
  await red.press("ControlOrMeta+z");
  await red.press("ArrowUp");
  expect(await snapshot()).toEqual(edited);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(view);
  await hex.fill("#818181");
  await hex.press("Enter");
  await page.setViewportSize({ width: 640, height: 452 });
  await panel.getByLabel("Selected color").scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".left-sidebar")
      .evaluate((sidebar) => sidebar.scrollWidth <= sidebar.clientWidth),
  ).toBe(true);
  await expect(panel.getByLabel("Selected color")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("color-controls-small.png"),
  });
});

test("named matches track registry changes and undo without linking or recoloring selected raw paint", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/tests/editor.html?fixture=colors");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const panel = page
    .locator("main")
    .getByRole("region", { name: "Color controls" });
  await panel.getByLabel("Hex color").fill("#808080");
  await panel.getByLabel("Hex color").press("Enter");
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 0, y: 0, zoom: 0.5 }),
  );
  const registry = async (name: string, rgba: string) =>
    page.evaluate(
      ({ name, rgba }) =>
        window.editorProbe.session.execute("Registry fixture", [
          {
            kind: "registry",
            id: "stone" as RegistryId,
            value: { name, rgba },
          },
        ]),
      { name, rgba },
    );
  await registry("Stone", "#808080FF");
  await expect(panel.getByTestId("color-match")).toHaveText(
    "Named match: Stone",
  );
  await panel.getByTestId("color-match").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("color-controls-and-raw-fixture.png"),
  });
  await registry("Mountain", "#808080ff");
  await expect(panel.getByTestId("color-match")).toHaveText(
    "Named match: Mountain",
  );
  await registry("Mountain", "#818181ff");
  await expect(panel.getByTestId("color-match")).toContainText("Unregistered");
  await page.evaluate(() => window.editorProbe.session.perform("undo"));
  await expect(panel.getByTestId("color-match")).toHaveText(
    "Named match: Mountain",
  );
  await page.evaluate(() =>
    window.editorProbe.session.execute("Remove registry fixture", [
      { kind: "registry", id: "stone" as RegistryId, value: null },
    ]),
  );
  await expect(panel.getByTestId("color-match")).toContainText("Unregistered");
  await expect(panel.getByTestId("color-association")).toContainText(
    "Not linked",
  );
  await expect(panel.getByLabel("Selected color")).toHaveText("#808080");
  expect(
    await page.evaluate(() => window.editorProbe.session.currentPaint()),
  ).toEqual({ kind: "raw", rgba: "#808080ff" });
});

for (const dpr of [1, 2]) {
  test(`unregistered shades and empty upper cells render distinctly in detail/overview at DPR ${dpr}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.tileProbe.load("colors"));
    await page.evaluate(() => window.tileProbe.resize(1100, 440));
    const original = await page.evaluate(() => ({
      runs: [...window.tileProbe.session.document.iterateRuns()],
      registry: window.tileProbe.session.document.registryEntries,
    }));
    expect(original.registry).toEqual([]);
    const expected = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [29, 39, 50, 255],
      [128, 128, 128, 255],
      [129, 129, 129, 255],
      [214, 116, 54, 255],
      [56, 162, 173, 255],
      [51, 92, 70, 255],
    ];
    const sample = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => window.tileProbe.stats().overview.pending),
        )
        .toBe(0);
      return page.evaluate(() =>
        window.tileProbe.sample([
          [12, 12],
          [22, 12],
          [32, 12],
          [42, 12],
          [52, 12],
          [62, 12],
          [72, 12],
          [82, 12],
        ]),
      );
    };
    for (const zoom of [0.5, 1 / 24]) {
      await page.evaluate((zoom) => window.tileProbe.view(0, 0, zoom), zoom);
      expect(await sample()).toEqual(expected);
      await page.screenshot({
        path: testInfo.outputPath(
          `unregistered-${zoom === 0.5 ? "detail" : "overview"}.png`,
        ),
      });
      await page.evaluate(() => {
        const session = window.tileProbe.session;
        session.setColor([130, 130, 130]);
        session.execute("Paint selected gray", [
          {
            kind: "tiles",
            writes: Array.from({ length: 8 }, (_, y) => ({
              layerId: session.document.layers[1].id,
              x: 38,
              y: y + 8,
              length: 8,
              value: session.currentPaint(),
            })),
          },
        ]);
      });
      const painted = expected.map((pixel, index) =>
        index === 3 ? [130, 130, 130, 255] : pixel,
      );
      expect(await sample()).toEqual(painted);
      await page.evaluate(() => {
        const session = window.tileProbe.session;
        session.execute("Erase upper swatches", [
          {
            kind: "tiles",
            writes: Array.from({ length: 8 }, (_, y) => ({
              layerId: session.document.layers[1].id,
              x: 8,
              y: y + 8,
              length: 68,
              value: null,
            })),
          },
        ]);
      });
      expect(await sample()).toEqual(expected.map(() => [51, 92, 70, 255]));
      const erased = await page.evaluate(() => {
        const session = window.tileProbe.session;
        return {
          upper: session.document.getCell(
            session.document.layers[1].id,
            42,
            12,
          ),
          lower: [
            ...session.document.iterateRuns(session.document.layers[0].id),
          ],
        };
      });
      expect(erased.upper).toBeNull();
      expect(erased.lower).toEqual(
        original.runs.filter((run) => run.layerId === "terrain"),
      );
      await page.evaluate(() => window.tileProbe.session.perform("undo"));
      expect(await sample()).toEqual(painted);
      await page.evaluate(() => window.tileProbe.session.perform("redo"));
      expect(await sample()).toEqual(expected.map(() => [51, 92, 70, 255]));
      await page.evaluate(() => {
        window.tileProbe.session.perform("undo");
        window.tileProbe.session.perform("undo");
      });
      expect(await sample()).toEqual(expected);
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
