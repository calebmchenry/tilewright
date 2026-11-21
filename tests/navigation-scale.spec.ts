import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

for (const [fixture, cells] of [
  ["frontier", 6620700],
  ["heartland", 24025200],
] as const) {
  test(`${fixture}: repeated populated 100 by 100 chunk overview/detail navigation`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:1420/tests/editor.html?fixture=${fixture}`,
    );
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    const initial = await page.evaluate(() => {
      const session = window.editorProbe.session;
      return {
        stats: session.document.storageStats(),
        version: session.document.version,
        bounds: session.document.bounds,
        history: session.history.state,
      };
    });
    expect(initial.stats.occupiedCells).toBe(cells);
    const cycles = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const start = Date.now();
      await page
        .locator("main")
        .getByRole("button", { name: "Fit map", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Editing availability" }),
      ).toContainText("Overview");
      const fit = await page.evaluate(() => {
        const session = window.editorProbe.session,
          view = session.viewport.getSnapshot(),
          size = session.canvasSize.getSnapshot(),
          bounds = session.document.bounds;
        const scale = 24 * view.zoom;
        return {
          view,
          size,
          left: 24 + (bounds.minX - view.x) * scale,
          top: 24 + (bounds.minY - view.y) * scale,
          right: 24 + (bounds.maxX - view.x) * scale,
          bottom: 24 + (bounds.maxY - view.y) * scale,
          editable: session.editableTileAt({
            x: size.width / 2,
            y: size.height / 2,
          }),
        };
      });
      expect(fit.left).toBeGreaterThanOrEqual(23.999999);
      expect(fit.top).toBeGreaterThanOrEqual(23.999999);
      expect(fit.right).toBeLessThanOrEqual(fit.size.width - 23.999999);
      expect(fit.bottom).toBeLessThanOrEqual(fit.size.height - 23.999999);
      // Precise picking retains the release baseline's 8px/tile threshold.
      // Pencil and Eraser have their own any-zoom path and separate coverage.
      expect(fit.editable).toBeNull();
      if (cycle === 0)
        await page.screenshot({
          path: testInfo.outputPath(`${fixture}-overview.png`),
        });
      const canvas = page.locator(".canvas-host"),
        box = (await canvas.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(center.x, center.y);
      await canvas.dispatchEvent("wheel", {
        clientX: center.x,
        clientY: center.y,
        deltaY: -100,
        ctrlKey: true,
      });
      await canvas.dispatchEvent("wheel", {
        clientX: center.x,
        clientY: center.y,
        deltaX: 10.25,
        deltaY: -15.75,
      });
      // Fit again is deterministic, regardless of previous zoom/pan.
      await canvas.press("f");
      expect(
        await page.evaluate(() =>
          window.editorProbe.session.viewport.getSnapshot(),
        ),
      ).toEqual(fit.view);
      await canvas.press("0");
      await expect(
        page.getByRole("status", { name: "Editing availability" }),
      ).toHaveCount(0);
      const detail = await page.evaluate(() => {
        const session = window.editorProbe.session,
          size = session.canvasSize.getSnapshot();
        return {
          view: session.viewport.getSnapshot(),
          tile: session.editableTileAt({
            x: size.width / 2,
            y: size.height / 2,
          }),
        };
      });
      expect(detail.view.zoom).toBe(1);
      expect(detail.tile).toEqual({ x: 3200, y: 3200 });
      await canvas.press("ArrowRight");
      await canvas.press("Shift+ArrowDown");
      const end = await page.evaluate(() => {
        const session = window.editorProbe.session;
        return {
          stats: session.document.storageStats(),
          version: session.document.version,
          bounds: session.document.bounds,
          history: session.history.state,
        };
      });
      expect(end).toEqual(initial);
      cycles.push({ cycle, fit, detail, automationWallMs: Date.now() - start });
    }
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${fixture}-detail.png`),
    });
    await writeFile(
      testInfo.outputPath(`${fixture}-navigation.json`),
      JSON.stringify(
        {
          fixture,
          dpr: 2,
          initial,
          cycles,
          errors,
          timing:
            "Automation wall time, not frame latency or a performance gate",
        },
        null,
        2,
      ) + "\n",
    );
    await page.evaluate(() => window.editorProbe.dispose());
    await expect(page.locator("canvas")).toHaveCount(0);
    await context.close();
  });
}
