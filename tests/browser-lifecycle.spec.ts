import { chromium, expect, test, type Page } from "@playwright/test";
import { exampleProject } from "./fixtures/project";

declare global {
  interface Window {
    navigationProbe: {
      listeners: Record<string, Set<EventListenerOrEventListenerObject>>;
      shows: boolean[];
      canvas?: HTMLCanvasElement;
    };
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const probe = (window.navigationProbe = {
      listeners: Object.fromEntries(
        ["beforeunload", "pagehide", "pageshow"].map((type) => [
          type,
          new Set<EventListenerOrEventListenerObject>(),
        ]),
      ),
      shows: [] as boolean[],
    });
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      // Vite adds its own development-only unload listener. Count app handlers.
      if (!new Error().stack?.includes("/@vite/client"))
        probe.listeners[type]?.add(listener);
      add(type, listener, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      probe.listeners[type]?.delete(listener);
      remove(type, listener, options);
    }) as typeof window.removeEventListener;
    // Keep the probe itself out of application listener accounting.
    add("pageshow", (event) => probe.shows.push(event.persisted));
  });
}
const ready = (page: Page) =>
  expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
const warningCount = (page: Page) =>
  page.evaluate(() => window.navigationProbe.listeners.beforeunload.size);
async function openSource(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "source.tilewright",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exampleProject)),
  });
  await page
    .getByRole("dialog", { name: "Open another project" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(page.locator(".project-filename")).toHaveText(
    "source.tilewright",
  );
  await ready(page);
}
async function rename(page: Page, name: string) {
  await page
    .getByRole("textbox", { name: "Layer name", exact: true })
    .fill(name);
  await page
    .getByRole("textbox", { name: "Layer name", exact: true })
    .press("Enter");
}
async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project", exact: true })
    .click();
  return pending;
}

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("warnings follow local-source risk and stay after request-only downloads; status and timestamps track exact revisions", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  expect(await warningCount(page)).toBe(1);
  await openSource(page);
  await expect.poll(() => warningCount(page)).toBe(0);
  await expect(page.locator(".document-title .document-status")).toHaveText(
    "Opened file · no changes",
  );
  await rename(page, "At risk");
  await expect.poll(() => warningCount(page)).toBe(1);
  await download(page);
  const timestamp = await page
    .getByTestId("download-timestamp")
    .locator("time")
    .getAttribute("datetime");
  await expect(page.getByTestId("download-timestamp")).toContainText(
    "Download requested",
  );
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await expect(page.locator(".document-title .document-status")).toHaveText(
    "No changes since download request",
  );
  expect(await warningCount(page)).toBe(1); // cancellation/completion is not observable by the app
  await page.locator(".canvas-host").press("Control+z");
  await expect.poll(() => warningCount(page)).toBe(0);
  await expect(page.locator(".document-title .document-status")).toHaveText(
    "Changes since download request",
  );
  await page.locator(".canvas-host").press("Control+Shift+z");
  expect(await warningCount(page)).toBe(1);
  await page.getByRole("button", { name: "Show At risk", exact: true }).click();
  await expect(page.locator(".document-title .document-status")).toHaveText(
    "Changes since download request",
  );
  await expect(
    page.getByTestId("download-timestamp").locator("time"),
  ).toHaveAttribute("datetime", timestamp!);
  const prevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("New button offers cancel, download-and-stay and explicit continuation even when shortcuts are reserved", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "Keep this map");
  const begin = async () => {
    await page.getByRole("button", { name: "New map", exact: true }).click();
    await page.getByRole("button", { name: "Create map", exact: true }).click();
  };
  const dialog = page.getByRole("dialog", { name: "Create another map" });
  await begin();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Keep this map");
  await begin();
  const event = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download project and stay" })
    .click();
  await event;
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Keep this map");
  await begin();
  await dialog
    .getByRole("button", { name: "Continue without another download" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Layer 1");
  await expect(page.getByTestId("download-timestamp")).toBeEmpty();
  await expect(page.locator(".document-title .document-status")).toHaveText(
    "Not downloaded",
  );
  await page.setViewportSize({ width: 640, height: 480 });
  for (const name of ["New map", "Open…", "Download project"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeInViewport();
});

test("browser keyboard preserves text undo/clipboard, modal isolation and editing tools", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "Committed");
  const input = page.getByRole("textbox", { name: "Layer name", exact: true });
  await input.focus();
  await input.press("ControlOrMeta+a");
  await input.pressSequentially("Draft b r v");
  await input.press("ControlOrMeta+z");
  await expect(input).not.toHaveValue("Draft b r v");
  await expect(
    page.getByRole("button", { name: "Inspect", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Capture native text-command routing, without substituting the clipboard.
  for (const key of ["z", "x", "c", "v"]) {
    expect(
      await input.evaluate((element, key) => {
        const event = new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, key),
    ).toBe(false);
  }
  await input.fill("Committed");
  await input.press("Enter");
  const event = page.waitForEvent("download");
  await input.press("Control+s");
  expect((await event).suggestedFilename()).toBe("Untitled.tilewright");
  await page.getByRole("button", { name: "New map", exact: true }).click();
  const width = page.getByRole("textbox", { name: "Width (tiles)" });
  await width.press("Control+s");
  await width.press("Control+z");
  await expect(
    page.getByRole("dialog", { name: "New map", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("Committed");
  await page.locator(".canvas-host").press("b");
  await expect(
    page.getByRole("button", { name: "Pencil", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".canvas-host").press("Control+z");
  await expect(input).toHaveValue("Layer 1");
  const picker = page.waitForEvent("filechooser");
  await input.press("Control+o");
  await picker;
  await page.locator('input[type="file"]').dispatchEvent("cancel");
  await expect(
    page.getByRole("button", { name: "Open…", exact: true }),
  ).toBeEnabled();
  const shifted = page.waitForEvent("download");
  await input.press("Meta+Shift+s");
  expect((await shifted).suggestedFilename()).toBe("Untitled.tilewright");
});

test("reload uses the generic browser warning, cancel retains edits, accepted reload creates a usable fresh editor", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "Do not lose me");
  const canceled = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const warning = await canceled;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Do not lose me");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Layer 1");
  await rename(page, "Fresh editor works");
});

test("persisted pagehide/pageshow retains one live editor; final teardown removes warning and lifecycle handlers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await rename(page, "Before cache");
  await page.evaluate(() => {
    window.navigationProbe.canvas = document.querySelector("canvas")!;
  });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(page.locator("canvas")).toHaveCount(1);
    expect(
      await page.evaluate(
        () =>
          document.querySelector("canvas") === window.navigationProbe.canvas,
      ),
    ).toBe(true);
    expect(await warningCount(page)).toBe(1);
    await rename(page, `After cache ${i}`);
    await page.locator(".canvas-host").press("Control+z");
    await expect(
      page.getByRole("textbox", { name: "Layer name", exact: true }),
    ).toHaveValue("Before cache");
  }
  await download(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(window.navigationProbe.listeners).map(
          ([name, listeners]) => [name, listeners.size],
        ),
      ),
    ),
  ).toEqual({ beforeunload: 0, pagehide: 0, pageshow: 0 });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("real back/forward navigation restores a usable cached or fresh editor", async ({
  baseURL,
}, info) => {
  const browser = await chromium.launch({
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
  });
  const page = await browser.newPage();
  try {
    await instrument(page);
    await page.goto(baseURL!);
    await ready(page);
    await openSource(page);
    await rename(page, "Cached edit");
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${baseURL}/tests/navigation-away.html`);
    await page.goBack({ waitUntil: "commit" });
    await ready(page);
    const persisted = await page.evaluate(() =>
      window.navigationProbe.shows.includes(true),
    );
    await expect(
      page.getByRole("textbox", { name: "Layer name", exact: true }),
    ).toHaveValue(persisted ? "Cached edit" : "Layer 1");
    await rename(page, "Returning editor works");
    await download(page);
    await page.goForward({ waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: "Navigation destination" }),
    ).toBeVisible();
    await page.goBack({ waitUntil: "commit" });
    await ready(page);
    await rename(page, "Second return works");
    await info.attach("bfcache-observation", {
      body: JSON.stringify({
        persisted,
        shows: await page.evaluate(() => window.navigationProbe.shows),
      }),
      contentType: "application/json",
    });
  } finally {
    await browser.close();
  }
});
