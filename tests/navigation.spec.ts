import { expect, test } from "@playwright/test";

for (const dpr of [1, 2]) {
  test(`anchored wheel/pinch, pan, keyboard, resize and panel picking at DPR ${dpr}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: dpr,
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:1420/tests/editor.html");
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    const host = page.locator(".canvas-host");
    const initial = await page.evaluate(() => ({
      bounds: window.editorProbe.session.document.bounds,
      version: window.editorProbe.session.document.version,
      history: window.editorProbe.session.history.state,
    }));
    let box = (await host.boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 160);
    // Chromium CDP scales injected wheel deltas with emulated DPR. Assert the
    // transform against the CSS deltas actually delivered to the host.
    await host.evaluate((element) =>
      element.addEventListener(
        "wheel",
        (event) => {
          element.dataset.wheelX = String((event as WheelEvent).deltaX);
          element.dataset.wheelY = String((event as WheelEvent).deltaY);
        },
        { once: true },
      ),
    );
    await page.mouse.wheel(48 * dpr, 72 * dpr);
    await expect(host).toHaveAttribute("data-wheel-x", "48");
    await expect(host).toHaveAttribute("data-wheel-y", "72");
    await expect
      .poll(() =>
        page.evaluate(() => window.editorProbe.session.viewport.getSnapshot()),
      )
      .toEqual({ x: 2, y: 3, zoom: 1 });
    // Fractional pixel deltas model high-resolution trackpad motion. No quantization.
    await host.dispatchEvent("wheel", {
      deltaMode: 0,
      deltaX: 0.25,
      deltaY: -0.5,
      clientX: box.x + 200,
      clientY: box.y + 160,
    });
    const before = await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    );
    expect(before.x).toBeCloseTo(2 + 0.25 / 24, 12);
    const anchor = { x: 200, y: 160 };
    for (let i = 0; i < 20; i++) {
      for (const deltaY of [-100, 100])
        await host.dispatchEvent("wheel", {
          deltaMode: 0,
          deltaY,
          ctrlKey: true,
          clientX: box.x + anchor.x,
          clientY: box.y + anchor.y,
        });
    }
    const after = await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    );
    expect(after.zoom).toBeCloseTo(before.zoom, 12);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    // Native WebKit event shape: cumulative scale and duplicate wheel suppression.
    const gesture = await host.evaluate(
      (element, point) => {
        const session = window.editorProbe.session;
        const original = session.viewport.getSnapshot();
        const send = (type: string, scale: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.assign(event, { scale, clientX: point.x, clientY: point.y });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        };
        const start = send("gesturestart", 1);
        send("gesturechange", 1.25);
        element.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -100,
            ctrlKey: true,
            cancelable: true,
          }),
        );
        send("gesturechange", 2);
        const doubled = session.viewport.getSnapshot();
        send("gesturechange", 1);
        const restored = session.viewport.getSnapshot();
        const end = send("gestureend", 1);
        return { original, doubled, restored, start, end };
      },
      { x: box.x + anchor.x, y: box.y + anchor.y },
    );
    expect(gesture.start && gesture.end).toBe(true);
    expect(gesture.doubled.zoom).toBe(gesture.original.zoom * 2);
    expect(gesture.restored).toEqual(gesture.original);
    // Tool pan and temporary Space pan both grab content rather than move camera with it.
    await page
      .locator("main")
      .getByRole("button", { name: "Pan", exact: true })
      .click();
    await page.mouse.move(box.x + 200, box.y + 160);
    await page.mouse.down();
    await page.mouse.move(box.x + 248, box.y + 184);
    await page.mouse.up();
    expect(
      await page.evaluate(
        () => window.editorProbe.session.viewport.getSnapshot().x,
      ),
    ).toBeCloseTo(before.x - 2, 10);
    await host.press("i");
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 160);
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(
      await page.evaluate(
        () => window.editorProbe.session.viewport.getSnapshot().x,
      ),
    ).toBeCloseTo(before.x, 10);
    await expect(host).toHaveAttribute("data-navigation", "inspect");
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(box.x + 224, box.y + 160);
    await page.mouse.up({ button: "middle" });
    expect(
      await page.evaluate(
        () => window.editorProbe.session.viewport.getSnapshot().x,
      ),
    ).toBeCloseTo(before.x - 1, 10);
    await host.press("f");
    await expect(
      page.getByRole("status", { name: "Editing availability" }),
    ).toContainText("Overview");
    await expect(
      page.locator("main").getByRole("button", { name: "Pencil", exact: true }),
    ).toHaveAccessibleDescription(/Zoom in to edit tiles/);
    await host.click();
    await expect(
      page.getByRole("status", { name: "Action feedback" }),
    ).toContainText("Overview");
    await host.press("0");
    await expect(
      page.getByRole("status", { name: "Editing availability" }),
    ).toHaveCount(0);
    for (const dimensions of [
      { width: 900, height: 620 },
      { width: 640, height: 452 },
      { width: 1200, height: 800 },
    ]) {
      const view = await page.evaluate(() =>
        window.editorProbe.session.viewport.getSnapshot(),
      );
      await page.setViewportSize(dimensions);
      box = (await host.boundingBox())!;
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.editorProbe.session.canvasSize.getSnapshot(),
          ),
        )
        .toEqual({ width: box.width, height: box.height });
      await page.mouse.move(box.x + 101, box.y + 103);
      await expect(page.getByTestId("coordinate-readout")).toHaveText(
        `Tile ${Math.floor(view.x + 77 / 24)}, ${Math.floor(view.y + 79 / 24)}`,
      );
      expect(
        await page.evaluate(() =>
          window.editorProbe.session.viewport.getSnapshot(),
        ),
      ).toEqual(view);
    }
    const end = await page.evaluate(() => ({
      bounds: window.editorProbe.session.document.bounds,
      version: window.editorProbe.session.document.version,
      history: window.editorProbe.session.history.state,
    }));
    expect(end).toEqual(initial);
    await context.close();
  });
}

test("wheel units, pan bounds, text focus, drag cancellation and cleanup", async ({
  page,
}) => {
  await page.goto("/tests/editor.html");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const host = page.locator(".canvas-host");
  const box = (await host.boundingBox())!;
  const wheel = (values: object) =>
    host.dispatchEvent("wheel", {
      clientX: box.x + 150,
      clientY: box.y + 150,
      ...values,
    });
  await wheel({ deltaMode: 1, deltaY: 3, shiftKey: true });
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual({ x: 2, y: 0, zoom: 1 });
  await wheel({ deltaMode: 2, deltaY: 1 });
  expect(
    await page.evaluate(
      () => window.editorProbe.session.viewport.getSnapshot().y,
    ),
  ).toBeCloseTo(box.height / 24, 10);
  await wheel({ deltaMode: 0, deltaY: 1e9 });
  const bounded = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  expect(24 + (256 - bounded.y) * 24).toBeCloseTo(48, 8);
  // One event is capped to exp(2); two reach the zoom limit from 100%.
  await wheel({ deltaMode: 0, deltaY: -1e9, metaKey: true });
  await wheel({ deltaMode: 0, deltaY: -1e9, metaKey: true });
  expect(
    await page.evaluate(
      () => window.editorProbe.session.viewport.getSnapshot().zoom,
    ),
  ).toBe(8);
  for (let i = 0; i < 8; i++)
    await wheel({ deltaMode: 0, deltaY: 1e9, ctrlKey: true });
  expect(
    await page.evaluate(
      () => window.editorProbe.session.viewport.getSnapshot().zoom,
    ),
  ).toBe(1 / 1024);
  const input = page.locator("main").getByLabel("Layer name", { exact: true });
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await input.focus();
  await input.press("f");
  await input.press("ArrowRight");
  await input.press("0");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(view);
  await host.press("f");
  await host.press("0");
  await host.press("h");
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await expect(host).toHaveAttribute("data-navigation", "dragging");
  await host.dispatchEvent("pointercancel");
  await expect(host).toHaveAttribute("data-navigation", "pan");
  const canceled = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(box.x + 170, box.y + 170);
  await page.mouse.up();
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(canceled);
  await host.press("i");
  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("Space");
  await expect(host).toHaveAttribute("data-navigation", "inspect");
  const cleanup = await host.evaluate((element) => {
    const session = window.editorProbe.session;
    const before = session.viewport.getSnapshot();
    window.editorProbe.dispose();
    element.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, cancelable: true }),
    );
    return {
      before,
      after: session.viewport.getSnapshot(),
      mode: element.dataset.navigation,
    };
  });
  expect(cleanup.after).toEqual(cleanup.before);
  expect(cleanup.mode).toBeUndefined();
});
