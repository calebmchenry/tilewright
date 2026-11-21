import { expect, test } from "@playwright/test";
import type { EditorSession } from "../src/editor/session";
import type { CanvasInvalidation } from "../src/editor/invalidation";

declare global {
  interface Window {
    editorProbe: {
      session: EditorSession;
      renders: Record<string, number>;
      invalidations: CanvasInvalidation[];
      edit(): void;
      reset(): void;
      dispose(): void;
    };
  }
}

test("shell displays state, downloads browser projects, and keeps native text undo separate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(
    page.getByRole("button", { name: "Inspect", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Pencil", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Eraser", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Eyedropper", exact: true }),
  ).toBeEnabled();
  for (const name of ["Line", "Rectangle"])
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Fill", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Current color", { exact: true })).toHaveValue(
    "#91baa1",
  );
  const visibility = page.locator(
    '.layer-row[data-active="true"] .layer-visibility-button',
  );
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await expect(visibility).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
  await visibility.click();
  const input = page.locator("main").getByLabel("Layer name", { exact: true });
  await input.fill("Terrain");
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(input).toBeFocused();
  await expect(
    page.locator('.layer-row[data-active="true"] .layer-name'),
  ).toHaveValue("Terrain");
  const search = page.getByLabel("Find an area");
  await search.pressSequentially("village");
  await search.press("ControlOrMeta+z");
  await expect(
    page.locator("main").getByLabel("Layer name", { exact: true }),
  ).toHaveValue("Terrain");
  const canvas = page.getByRole("region", { name: "Canvas keyboard input" });
  await canvas.click();
  await expect(canvas).toBeFocused();
  await canvas.press("ControlOrMeta+z");
  await expect(
    page.locator("main").getByLabel("Layer name", { exact: true }),
  ).toHaveValue("Layer 1");
  await canvas.press("ControlOrMeta+Shift+z");
  await expect(
    page.locator("main").getByLabel("Layer name", { exact: true }),
  ).toHaveValue("Terrain");
  await page.getByLabel("Hex color").fill("bad");
  await page.getByLabel("Hex color").blur();
  await expect(
    page.getByRole("alert", { name: "Action feedback" }),
  ).toContainText("#RRGGBB");
  await page.getByLabel("Hex color").fill("#AB1020");
  await expect(page.getByLabel("Current color", { exact: true })).toHaveValue(
    "#ab1020",
  );
  await canvas.click();
  const download = page.waitForEvent("download");
  await canvas.press("ControlOrMeta+s");
  const requested = await download;
  expect(requested.suggestedFilename()).toBe("Untitled.tilewright");
  expect(await requested.failure()).toBeNull();
  await expect(
    page.getByRole("status", { name: "Project file feedback" }),
  ).toContainText("Download requested");
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await expect(page.locator(".document-status")).toContainText(
    "No changes since download request",
  );
});

for (const dpr of [1, 2]) {
  test(`resize and zoom preserve world coordinates at DPR ${dpr}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: dpr,
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:1420/");
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 620 },
      { width: 640, height: 480 },
      // Native minimum is 480 including its 28px title bar.
      { width: 640, height: 452 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const canvas = document.querySelector("canvas")!;
            const host = document.querySelector(".canvas-host")!;
            return {
              width: canvas.width,
              css: canvas.clientWidth,
              host: host.clientWidth,
              height: canvas.height,
              hostHeight: host.clientHeight,
              overflow:
                document.documentElement.scrollWidth > innerWidth ||
                document.documentElement.scrollHeight > innerHeight,
            };
          }),
        )
        .toEqual({
          width: (size.width - (size.width > 900 ? 448 : 372)) * dpr,
          css: size.width - (size.width > 900 ? 448 : 372),
          host: size.width - (size.width > 900 ? 448 : 372),
          height: expect.any(Number),
          hostHeight: expect.any(Number),
          overflow: false,
        });
      const dimensions = await page.locator("canvas").evaluate((canvas) => ({
        backing: (canvas as HTMLCanvasElement).height,
        css: canvas.clientHeight,
      }));
      expect(dimensions.backing).toBe(dimensions.css * dpr);
      const box = (await page.locator(".canvas-host").boundingBox())!;
      await page.mouse.move(box.x + 24 + 3 * 24 + 12, box.y + 24 + 4 * 24 + 12);
      await expect(page.getByTestId("coordinate-readout")).toHaveText(
        "Tile 3, 4",
      );
      expect(
        await page
          .locator(".left-sidebar")
          .evaluate((sidebar) => sidebar.scrollWidth <= sidebar.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator(".right-sidebar")
          .evaluate((sidebar) => sidebar.scrollWidth <= sidebar.clientWidth),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    const box = (await page.locator(".canvas-host").boundingBox())!;
    const centerTile = {
      x: Math.floor((box.width / 2 - 24) / 24),
      y: Math.floor((box.height / 2 - 24) / 24),
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("coordinate-readout")).toHaveText(
      `Tile ${centerTile.x}, ${centerTile.y}`,
    );
    await page.getByLabel("Zoom", { exact: true }).selectOption("2");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("coordinate-readout")).toHaveText(
      `Tile ${centerTile.x}, ${centerTile.y}`,
    );
    await context.close();
  });
}

test("small edit targets canvas spans/history without rendering unrelated panels or recreating canvas", async ({
  page,
}) => {
  await page.goto("/tests/editor.html");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await page.evaluate(() => window.editorProbe.reset());
  const original = await page.locator("canvas").elementHandle();
  await page.evaluate(() => window.editorProbe.edit());
  expect(
    await page.evaluate(
      () => window.editorProbe.session.history.state.undoLabel,
    ),
  ).toBe("Small edit");
  const measured = await page.evaluate(() => ({
    renders: window.editorProbe.renders,
    dirty: window.editorProbe.invalidations,
  }));
  expect(measured.renders).toEqual({
    tools: 0,
    colors: 0,
    layers: 0,
    annotations: 0,
    view: 0,
  });
  expect(measured.dirty).toEqual([
    {
      regions: [{ layerId: "buildings", minX: 3, minY: 4, maxX: 5, maxY: 5 }],
      composition: false,
      bounds: false,
      registryIds: [],
      annotationIds: [],
    },
  ]);
  expect(
    await original!.evaluate(
      (canvas) => canvas === document.querySelector("canvas"),
    ),
  ).toBe(true);
  await page
    .locator("main")
    .getByLabel("Layer name: Buildings", { exact: true })
    .click();
  await expect(
    page.locator("main").getByLabel("Layer name", { exact: true }),
  ).toHaveValue("Buildings");
  await page
    .locator("main")
    .getByLabel("Layer name", { exact: true })
    .fill("Structures");
  await page
    .locator("main")
    .getByLabel("Layer name", { exact: true })
    .press("Enter");
  await expect(
    page.locator("main").getByLabel("Layer name", { exact: true }),
  ).toHaveValue("Structures");
  const after = await page.evaluate(() => window.editorProbe.renders);
  expect(after.layers).toBeGreaterThan(0);
  expect(after.colors + after.annotations + after.tools + after.view).toBe(0);
  await page.evaluate(() => window.editorProbe.dispose());
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("density-change notification resizes the backing buffer even when CSS bounds stay fixed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    const queries: MediaQueryList[] = [];
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query.startsWith("(resolution:")) queries.push(result);
      return result;
    };
    Object.assign(window, {
      notifyDensity: () => {
        for (const query of [...queries])
          if (!query.matches) query.dispatchEvent(new Event("change"));
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const css = await page
    .locator("canvas")
    .evaluate((canvas) => canvas.clientWidth);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
  });
  // CDP updates DPR and query.matches but does not emit the monitor-change
  // notification. Supply that notification explicitly; no CSS resize is induced.
  await page.evaluate(() =>
    (window as unknown as { notifyDensity(): void }).notifyDensity(),
  );
  await expect
    .poll(() =>
      page.locator("canvas").evaluate((canvas) => ({
        css: canvas.clientWidth,
        backing: (canvas as HTMLCanvasElement).width,
      })),
    )
    .toEqual({ css, backing: css * 2 });
});
