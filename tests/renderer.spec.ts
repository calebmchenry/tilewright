import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const contexts = new Set<WebGLRenderingContext | WebGL2RenderingContext>();
    const observers = new Set<ResizeObserver>();
    const frames = new Set<number>();
    const listeners: {
      target: EventTarget;
      type: string;
      listener: unknown;
    }[] = [];
    const relevant =
      /^(pointermove|pointerup|mousemove|mouseup|touchmove|touchend|wheel|webglcontextlost|webglcontextrestored)$/;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      const result = getContext.apply(this, args);
      // Pixi retains one shared shader-capability probe context. Track the
      // adapter's contexts, whose canvases are labeled before initialization.
      if (
        this.getAttribute("aria-label") === "Map workspace preview" &&
        (result instanceof WebGLRenderingContext ||
          result instanceof WebGL2RenderingContext)
      )
        contexts.add(result);
      return result;
    } as typeof getContext;
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      observe(...args: Parameters<ResizeObserver["observe"]>) {
        observers.add(this);
        super.observe(...args);
      }
      disconnect() {
        observers.delete(this);
        super.disconnect();
      }
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      if (
        relevant.test(type) &&
        (this === window ||
          this === document ||
          this instanceof HTMLCanvasElement)
      ) {
        if (
          !listeners.some(
            (entry) =>
              entry.target === this &&
              entry.type === type &&
              entry.listener === listener,
          )
        )
          listeners.push({ target: this, type, listener });
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      listener,
      options,
    ) {
      const index = listeners.findIndex(
        (entry) =>
          entry.target === this &&
          entry.type === type &&
          entry.listener === listener,
      );
      if (index >= 0) listeners.splice(index, 1);
      return remove.call(this, type, listener, options);
    };
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
      cancel(id);
    };
    Object.assign(window, {
      rendererProbe: () => ({
        liveContexts: [...contexts].filter(
          (context) => !context.isContextLost(),
        ).length,
        observers: observers.size,
        listeners: listeners.length,
        frames: frames.size,
      }),
    });
  });
});

async function expectDisposed(page: import("@playwright/test").Page) {
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { rendererProbe(): unknown }).rendererProbe(),
      ),
    )
    .toEqual({ liveContexts: 0, observers: 0, listeners: 0, frames: 0 });
}

test("starts one WebGL canvas under Strict Mode, resizes, and tears down on pagehide", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Tilewright");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(page.locator("canvas[data-renderer=webgl]")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-webgl-version",
    "2",
  );
  await page.setViewportSize({ width: 900, height: 620 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("canvas")?.clientWidth),
    )
    .toBe(528);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expectDisposed(page);
  expect(errors).toEqual([]);
});

test("repeated mount/unmount and cancellation release GPU contexts, listeners, observers, and frames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/renderer.html");
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Toggle canvas" }).click();
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    await expect(page.locator("canvas")).toHaveCount(1);
    await page.getByRole("button", { name: "Toggle canvas" }).click();
    await expectDisposed(page);
    await page.getByRole("button", { name: "Cancel pending canvas" }).click();
    await expectDisposed(page);
  }
  expect(errors).toEqual([]);
});

test("unavailable WebGL explains recovery and retry succeeds without stale canvases", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).startsWith("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
    Object.assign(window, {
      restoreWebGL: () => {
        HTMLCanvasElement.prototype.getContext = original;
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".canvas-message")).toContainText(
    "Tilewright requires WebGL",
  );
  await expect(page.locator(".canvas-message")).toContainText("update macOS");
  await expectDisposed(page);
  await page.evaluate(() =>
    (window as unknown as { restoreWebGL(): void }).restoreWebGL(),
  );
  await page.getByRole("button", { name: "Retry canvas" }).click();
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expectDisposed(page);
});
