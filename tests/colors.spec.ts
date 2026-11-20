import { expect, test } from "@playwright/test";
import type { RegistryId } from "../src/domain/values";

test("picker and hex update live while incomplete drafts preserve paint and history", async ({
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
  const snapshot = () =>
    page.evaluate(() => ({
      version: window.editorProbe.session.document.version,
      history: window.editorProbe.session.history.state,
      registry: window.editorProbe.session.document.registryEntries,
      runs: [...window.editorProbe.session.document.iterateRuns()],
    }));
  const original = await snapshot();
  await hex.fill(" #AbCf ");
  await expect(picker).toHaveValue("#aabbcc");
  await expect(hex).toHaveValue(" #AbCf ");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#aabbcc");

  // Shorthand updates paint without expanding the text or moving the caret.
  await hex.fill("");
  await hex.pressSequentially("#123");
  await expect(picker).toHaveValue("#112233");
  await expect(hex).toHaveValue("#123");
  await hex.pressSequentially("456");
  await expect(picker).toHaveValue("#123456");
  await expect(hex).toHaveValue("#123456");
  expect(
    await page.evaluate(() => window.editorProbe.session.currentPaint()),
  ).toEqual({ kind: "raw", rgba: "#123456ff" });
  await picker.fill("#808080");
  await expect(hex).toHaveValue("#808080");
  for (const bad of ["", "#12345", "#80808080", "transparent"]) {
    await hex.fill(bad);
    await expect(picker).toHaveValue("#808080");
    expect(
      await page.evaluate(() => window.editorProbe.session.currentPaint()),
    ).toEqual({ kind: "raw", rgba: "#808080ff" });
    await hex.blur();
    await expect(hex).toHaveAttribute("aria-invalid", "true");
    await expect(hex).toHaveAccessibleDescription(/fully opaque/);
  }
  await picker.fill("#818181");
  await expect(hex).toHaveValue("#818181");
  await expect(hex).toHaveAttribute("aria-invalid", "false");
  // Equivalent input normalizes on blur even without a color-store change.
  await hex.fill("#818181FF");
  await hex.blur();
  await expect(hex).toHaveValue("#818181");
  expect(await snapshot()).toEqual(original);
  expect(
    await page.evaluate(() => window.editorProbe.session.currentPaint()),
  ).toEqual({ kind: "raw", rgba: "#818181ff" });

  // Hex retains native text/arrow shortcuts and cannot undo a map edit.
  await page.evaluate(() => window.editorProbe.edit());
  const edited = await snapshot();
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await hex.fill("");
  await hex.pressSequentially("#100");
  await hex.press("ControlOrMeta+z");
  await hex.press("ArrowUp");
  expect(await snapshot()).toEqual(edited);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(view);
  await hex.fill("#818181");
  await hex.blur();
  await page.setViewportSize({ width: 640, height: 452 });
  await hex.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".left-sidebar")
      .evaluate((sidebar) => sidebar.scrollWidth <= sidebar.clientWidth),
  ).toBe(true);
  await expect(hex).toBeInViewport();
  await expect(picker).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("color-controls-small.png"),
  });
});

test("registry changes preserve raw paint and named selection synchronizes the compact controls", async ({
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
  const hex = panel.getByLabel("Hex color");
  const picker = panel.getByLabel("Current color", { exact: true });
  const paint = () =>
    page.evaluate(() => window.editorProbe.session.currentPaint());
  await hex.fill("#808080");
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
  await registry("Stone", "#808080ff");
  await expect(
    panel.getByRole("button", { name: "Paint with Stone" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({
    path: testInfo.outputPath("color-controls-and-raw-fixture.png"),
  });
  await registry("Mountain", "#808080ff");
  await expect(
    panel.getByRole("button", { name: "Paint with Mountain" }),
  ).toHaveAttribute("aria-pressed", "false");
  await registry("Mountain", "#818181ff");
  await expect(picker).toHaveValue("#808080");
  expect(await paint()).toEqual({ kind: "raw", rgba: "#808080ff" });
  await page.evaluate(() => window.editorProbe.session.perform("undo"));
  await expect(picker).toHaveValue("#808080");
  await page.evaluate(() =>
    window.editorProbe.session.execute("Remove registry fixture", [
      { kind: "registry", id: "stone" as RegistryId, value: null },
    ]),
  );
  await expect(
    panel.getByRole("button", { name: "Paint with Mountain" }),
  ).toHaveCount(0);
  await expect(hex).toHaveValue("#808080");
  expect(await paint()).toEqual({ kind: "raw", rgba: "#808080ff" });

  await registry("Mountain", "#818181ff");
  await hex.fill("invalid");
  await hex.blur();
  await panel.getByRole("button", { name: "Paint with Mountain" }).click();
  await expect(hex).toHaveValue("#818181");
  await expect(picker).toHaveValue("#818181");
  await expect(hex).toHaveAttribute("aria-invalid", "false");
  await hex.focus();
  await hex.press("Enter");
  await hex.blur();
  expect(await paint()).toEqual({ kind: "registered", registryId: "stone" });
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
