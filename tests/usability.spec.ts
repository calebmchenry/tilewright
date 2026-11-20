import { expect, test, type Page } from "@playwright/test";

const button = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
const host = (page: Page) => page.locator(".canvas-host");
async function start(page: Page, fixture = "pencil") {
  await page.goto(`/tests/editor.html?fixture=${fixture}`);
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
}
async function move(page: Page, x: number, y: number) {
  const box = (await host(page).boundingBox())!;
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(
    box.x + 24 + (x + 0.5 - view.x) * 24 * view.zoom,
    box.y + 24 + (y + 0.5 - view.y) * 24 * view.zoom,
  );
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await move(page, ...from);
  await page.mouse.down();
  await move(page, ...to);
  await page.mouse.up();
}
const content = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      layers: s.document.layers,
      registry: s.document.registryEntries,
      annotations: s.document.annotations,
      history: s.history.state,
      version: s.document.version,
    };
  });

test("continuous keyboard/mouse tool session, panel shortcuts, preview cancel and history", async ({
  page,
}) => {
  await start(page);
  for (const [key, name] of [
    ["b", "Pencil"],
    ["e", "Eraser"],
    ["l", "Line"],
    ["r", "Rectangle"],
  ]) {
    await button(page, "Register color").focus();
    await page.keyboard.press(key);
    await expect(button(page, name)).toHaveAttribute("aria-pressed", "true");
    const before = await content(page);
    await drag(page, [60, 60], [62, 62]);
    const after = await content(page);
    expect(after.history.undoSteps).toBe(before.history.undoSteps + 1);
    await host(page).press("ControlOrMeta+z");
    expect((await content(page)).runs).toEqual(before.runs);
    await host(page).press("ControlOrMeta+Shift+z");
    expect((await content(page)).runs).toEqual(after.runs);
  }
  await page
    .locator("main")
    .getByLabel("Rectangle style")
    .selectOption("outline");
  await drag(page, [64, 60], [66, 62]);
  expect(
    await page.evaluate(
      () => window.editorProbe.session.history.state.undoLabel,
    ),
  ).toBe("Rectangle");
  await host(page).press("d");
  await move(page, 60, 60);
  await page.mouse.down();
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.editorProbe.session.color.getSnapshot()),
  ).toBe("#ff0000ff");
  await host(page).press("i");
  await drag(page, [60, 60], [62, 62]);
  expect(
    await page.evaluate(() => {
      const r = window.editorProbe.session.rectangle.getSnapshot()!;
      return [r.maxX - r.minX, r.maxY - r.minY];
    }),
  ).toEqual([3, 3]);
  await button(page, "Register color").press("Escape");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.rectangle.getSnapshot(),
    ),
  ).toBeNull();
  await host(page).press("v");
  await drag(page, [60, 60], [62, 62]);
  await expect(page.getByTestId("selection-dimensions")).toContainText(
    "3 × 3 tiles",
  );
  await host(page).press("ArrowRight");
  await expect(page.getByTestId("selection-bounds")).toContainText(
    "X [61, 64)",
  );
  await host(page).press("ControlOrMeta+c");
  await host(page).press("ControlOrMeta+v");
  const beforeCancel = await content(page);
  await host(page).press("z");
  await button(page, "Register color").press("Escape");
  await expect(button(page, "Apply paste")).toHaveCount(0);
  expect(await content(page)).toEqual(beforeCancel);
  await host(page).press("x");
  await button(page, "Cancel transform").click();
  await expect(host(page)).toBeFocused();
  await host(page).press("h");
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await drag(page, [60, 60], [61, 61]);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).not.toEqual(view);
  await host(page).press("a");
  await expect(button(page, "Areas")).toHaveAttribute("aria-pressed", "true");
  await host(page).press("f");
  await expect(
    page.getByRole("status", { name: "Editing availability" }),
  ).toBeVisible();
  await expect(button(page, "Pencil")).toBeEnabled();
  await expect(button(page, "Eraser")).toBeEnabled();
  await expect(button(page, "Line")).toBeDisabled();
  await host(page).press("0");
  await expect(button(page, "Pencil")).toBeEnabled();
  // A fill on the known small occupied region completes as one atomic edit.
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.viewport.set({ x: 55, y: 55, zoom: 1 });
    s.setColor("#223344");
  });
  await host(page).press("g");
  await move(page, 61, 60);
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.editorProbe.session.history.state.undoLabel),
    )
    .toBe("Fill");
});

test("names, descriptions, search, select and IME never invoke map keys or tile clipboard", async ({
  page,
}) => {
  await start(page);
  await host(page).press("v");
  await drag(page, [60, 60], [62, 62]);
  await host(page).press("ControlOrMeta+c");
  await button(page, "New area").click();
  const before = await content(page);
  const clipboard = await page.evaluate(() =>
    window.editorProbe.session.selection.clipboard.getSnapshot(),
  );
  for (const field of [
    "Layer name",
    "Area name",
    "Description",
    "Find an area",
    "Hex color",
  ]) {
    const input = page.locator("main").getByLabel(field, { exact: true });
    await input.fill("b e d g l r v a h i f");
    for (const key of [
      "ArrowRight",
      "ArrowLeft",
      "Backspace",
      "Delete",
      "ControlOrMeta+a",
      "ControlOrMeta+c",
      "ControlOrMeta+x",
      "ControlOrMeta+v",
      "ControlOrMeta+z",
      "ControlOrMeta+Shift+z",
    ])
      await input.press(key);
    if (field === "Layer name") await input.press("Escape"); // Cancel the inline draft before leaving the row.
    expect(await content(page)).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.activeTool.getSnapshot(),
      ),
    ).toBe("area");
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.selection.clipboard.getSnapshot(),
      ),
    ).toEqual(clipboard);
  }
  await page
    .locator("main")
    .getByLabel("Tier", { exact: true })
    .press("ArrowDown");
  await button(page, "Register color").dispatchEvent("keydown", {
    key: "b",
    isComposing: true,
    bubbles: true,
  });
  expect(await content(page)).toEqual(before);
  await page
    .locator("main")
    .getByLabel("Description", { exact: true })
    .press("Escape");
  await expect(
    page.locator("main").getByLabel("Description", { exact: true }),
  ).toHaveCount(0);
  await expect(button(page, "New area")).toBeFocused();
  expect(await content(page)).toEqual(before);
});

test("dialogs preserve drafts and restore keyboard focus after Escape", async ({
  page,
}) => {
  await start(page, "registry");
  const before = await content(page);
  const grow = button(page, "Grow canvas");
  await grow.click();
  const dialog = page.getByRole("dialog", { name: "Grow canvas", exact: true });
  await dialog.getByLabel("Left edge", { exact: true }).check();
  await dialog.getByLabel("Left increments", { exact: true }).fill("invalid");
  await expect(
    dialog.getByRole("button", { name: "Apply growth" }),
  ).toBeDisabled();
  await dialog.getByLabel("Left increments", { exact: true }).press("Escape");
  await expect(grow).toBeFocused();
  const register = button(page, "Register color");
  await register.click();
  const registry = page.getByRole("dialog", {
    name: "Register color",
    exact: true,
  });
  await registry.getByLabel("Name", { exact: true }).fill("b e g v a");
  await registry
    .getByRole("button", { name: "Cancel", exact: true })
    .press("ControlOrMeta+z");
  await registry.press("Escape");
  await expect(register).toBeFocused();
  expect(await content(page)).toEqual(before);
});

test("populated long-name panels, error feedback and controls remain reachable at desktop sizes", async ({
  page,
}, info) => {
  await start(page, "areas");
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.renameLayer(s.activeLayer.getSnapshot(), "VeryLongLayerName".repeat(20));
    s.report(
      "Cannot write /maps/" +
        "LongDirectory".repeat(30) +
        "/map.tilewright. Check folder permissions or use Save As.",
      "error",
    );
    s.areas.newArea();
    s.areas.update({
      name: "Long area name ".repeat(12),
      description: "Description\n".repeat(12),
    });
  });
  for (const size of [
    { width: 1200, height: 800 },
    { width: 900, height: 620 },
    { width: 640, height: 452 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(size.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(size.height);
    expect((await host(page).boundingBox())!.height).toBeGreaterThan(100);
    for (const selector of [".left-sidebar", ".right-sidebar", "footer"]) {
      expect(
        await page
          .locator(selector)
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
    }
    for (const name of [
      "Pencil",
      "Areas",
      "Register color",
      "Add layer",
      "New area",
      "Apply area",
      "Cancel area edit",
    ]) {
      const control = button(page, name);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
    await page
      .getByRole("alert", { name: "Action feedback" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`populated-${size.width}x${size.height}.png`),
    });
  }
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await button(page, "Cancel area edit").click();
  await expect(button(page, "New area")).toBeFocused();
});

test("mouse tool activation leaves text ownership and window refocus refreshes the readout", async ({
  page,
}) => {
  await start(page);
  const name = page.locator("main").getByLabel("Layer name", { exact: true });
  await name.focus();
  const pencil = button(page, "Pencil");
  // Emulate WebKit's lack of default button focus; the explicit pointer policy
  // must own focus before the browser's mousedown default action.
  await pencil.evaluate((element) =>
    element.addEventListener("mousedown", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await pencil.click();
  await expect(pencil).toBeFocused();
  await page.keyboard.press("e");
  await expect(button(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
  await expect(name).toHaveValue("Buildings");
  await name.focus();
  await pencil.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(pencil).toBeFocused();
  await page.keyboard.press("e");
  await expect(button(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
  await host(page).focus();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(
    await page.evaluate(() => window.editorProbe.session.focus.getSnapshot()),
  ).toBe("outside");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(
    await page.evaluate(() => window.editorProbe.session.focus.getSnapshot()),
  ).toBe("canvas");
});
