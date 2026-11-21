import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exampleProject } from "./fixtures/project";
import { decodeProject } from "../src/domain/project-decoding";
import { captureProjectSnapshot } from "../src/domain/project";
import { CommandHistory } from "../src/domain/history";

declare global {
  interface Window {
    browserFileProbe: {
      created: string[];
      revoked: string[];
      pickerActivation: boolean[];
      holdEncode: boolean;
      encodingPaused: boolean;
      resumeEncode: () => void;
      holdRead: boolean;
      readingPaused: boolean;
      resumeRead: () => void;
    };
  }
}

// Shipping browser entry. Only instrument standard browser APIs to inspect
// resource cleanup and pause real I/O/encoding; no native IPC or editor harness.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const probe: Window["browserFileProbe"] = (window.browserFileProbe = {
      created: [] as string[],
      revoked: [] as string[],
      pickerActivation: [] as boolean[],
      holdEncode: false,
      encodingPaused: false,
      resumeEncode: () => {},
      holdRead: false,
      readingPaused: false,
      resumeRead: () => {},
    });
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      probe.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      probe.revoked.push(url);
      revoke(url);
    };
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === "file") {
        probe.pickerActivation.push(navigator.userActivation.isActive);
        if (!navigator.userActivation.isActive)
          throw new Error("Picker requires user activation");
      }
      click.call(this);
    };
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (
        probe.holdEncode &&
        new Error().stack?.includes("/src/domain/project.ts")
      ) {
        probe.holdEncode = false;
        probe.encodingPaused = true;
        probe.resumeEncode = () => {
          probe.encodingPaused = false;
          timeout(handler, delay, ...args);
        };
        return -1;
      }
      return timeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (probe.holdRead) {
        probe.holdRead = false;
        probe.readingPaused = true;
        await new Promise<void>((resolve) => {
          probe.resumeRead = () => {
            probe.readingPaused = false;
            resolve();
          };
        });
      }
      return read.call(this);
    };
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
});

const prompt = (page: Page) =>
  page.getByRole("dialog", { name: "Open another project" });
async function choose(
  page: Page,
  name = "café 地図.tilewright",
  contents = JSON.stringify(exampleProject),
) {
  const picked = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open file…", exact: true }).click();
  const chooser = await picked;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
}
async function discard(page: Page) {
  await prompt(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(prompt(page)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download project", exact: true }),
  ).toBeEnabled();
}
async function drop(
  page: Page,
  files: { name: string; contents: string }[],
  target = "body",
) {
  return page.locator(target).evaluate((element, entries) => {
    const transfer = new DataTransfer();
    entries.forEach(({ name, contents }) =>
      transfer.items.add(
        new File([contents], name, { type: "application/json" }),
      ),
    );
    const dragover = new DragEvent("dragover", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    const drop = new DragEvent("drop", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(dragover);
    element.dispatchEvent(drop);
    return {
      dragPrevented: dragover.defaultPrevented,
      dropPrevented: drop.defaultPrevented,
    };
  }, files);
}
async function downloaded(download: Download) {
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  const decoded = await decodeProject(bytes, { yieldControl: async () => {} });
  const project = captureProjectSnapshot(
    new CommandHistory(decoded.document),
    decoded.preferences,
  ).project;
  return { bytes, project };
}
async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project", exact: true })
    .click();
  const result = await event;
  return { ...(await downloaded(result)), name: result.suggestedFilename() };
}
async function rename(page: Page, name: string) {
  const input = page.getByRole("textbox", { name: "Layer name", exact: true });
  await input.fill(name);
  await input.press("Enter");
}

test("real chooser and repeated downloads preserve full desktop project semantics and release object URLs", async ({
  page,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || !r.url().startsWith("http://127.0.0.1:1420/"))
      requests.push(r.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await choose(page);
  await discard(page);
  await expect(page.locator(".project-filename")).toHaveText(
    "café 地図.tilewright",
  );
  const first = await download(page),
    second = await download(page);
  expect(first.project).toEqual(exampleProject);
  expect(first.bytes.equals(second.bytes)).toBe(true);
  expect(first.name).toBe("café 地図.tilewright");
  expect(first.bytes).toEqual(
    await readFile("tests/fixtures/project-v1.canonical.tilewright"),
  );
  await rename(page, "Hidden houses — edited");
  const expected = structuredClone(exampleProject);
  (expected.document.layers[1] as { name: string }).name =
    "Hidden houses — edited";
  expect((await download(page)).project).toEqual(expected);
  await page
    .getByRole("button", { name: "Show Hidden houses — edited", exact: true })
    .click();
  expect((await download(page)).project).toEqual({
    ...expected,
    editor: { ...expected.editor, hiddenLayerIds: [] },
  });
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await expect(page.locator(".document-status")).toContainText("Unsaved");
  await expect(
    page.getByRole("status", { name: "Project file feedback" }),
  ).toContainText("saving to disk is not confirmed");
  await expect(
    page.getByRole("status", { name: "Project file feedback" }),
  ).toHaveCSS("clip", "auto");
  await expect
    .poll(() => page.evaluate(() => window.browserFileProbe.revoked.length))
    .toBe(4);
  const resources = await page.evaluate(() => window.browserFileProbe);
  expect(resources.revoked).toEqual(resources.created);
  expect(resources.pickerActivation).toEqual([true]);
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  expect(await page.locator("a[download]").count()).toBe(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 640, height: 720 });
  await expect(
    page.getByRole("button", { name: "Open file…" }),
  ).toBeInViewport();
  await expect(page.getByText("Drop one .tilewright file here")).toBeVisible();
  await page.screenshot({ path: info.outputPath("browser-files-compact.png") });
});

test("synthetic File drops prevent navigation, reject multiple/unsupported files and preserve edits on failure or cancel", async ({
  page,
}) => {
  await choose(page);
  await discard(page);
  await rename(page, "Keep this edited layer");
  const expected = (await download(page)).project;
  const url = page.url();
  const valid = {
    name: "dropped.tilewright",
    contents: JSON.stringify(exampleProject),
  };
  expect(await drop(page, [valid, valid], ".canvas-host")).toEqual({
    dragPrevented: true,
    dropPrevented: true,
  });
  await expect(
    page.getByRole("alert", { name: "Document workflow feedback" }),
  ).toContainText("one .tilewright");
  for (const contents of [
    "{broken",
    JSON.stringify({ ...exampleProject, version: 2 }),
    '{"format":"tilewright-agent-map","version":1}',
  ]) {
    expect(
      (await drop(page, [{ name: "unsupported.txt", contents }])).dropPrevented,
    ).toBe(true);
    await discard(page);
    await expect(
      page.getByRole("alert", { name: "Project file feedback" }),
    ).toBeVisible();
    expect((await download(page)).project).toEqual(expected);
    expect(page.url()).toBe(url);
  }
  await drop(page, [valid]);
  await prompt(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await download(page)).project).toEqual(expected);
  await drop(page, [valid]);
  expect((await drop(page, [valid], "dialog[open]")).dropPrevented).toBe(true);
  await discard(page);
  expect((await download(page)).project).toEqual(exampleProject);
  await expect(page.locator(".project-filename")).toHaveText(valid.name);
});

test("picker cancellation and download-before-replacement keep the current map; retries have fresh user activation", async ({
  page,
}) => {
  const initial = (await download(page)).project;
  const canceled = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open file…" }).click();
  await canceled;
  // Playwright cannot dismiss the OS dialog; exercise its standard cancel event.
  await page.locator('input[type="file"]').dispatchEvent("cancel");
  await expect(page.getByRole("button", { name: "Open file…" })).toBeEnabled();
  expect((await download(page)).project).toEqual(initial);
  for (let i = 0; i < 2; i++) {
    await choose(page);
    const event = page.waitForEvent("download");
    await prompt(page)
      .getByRole("button", { name: "Download project and stay" })
      .click();
    expect((await downloaded(await event)).project).toEqual(initial);
    await expect(page.locator(".project-filename")).toHaveText("Untitled map");
    await expect(prompt(page)).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open file…" }),
    ).toBeEnabled();
  }
  await choose(page);
  await discard(page);
  expect((await download(page)).project).toEqual(exampleProject);
  expect(
    await page.evaluate(() => window.browserFileProbe.pickerActivation),
  ).toEqual([true, true, true, true]);
});

test("edits during real encoder yields survive the snapshot download and replacement remains guarded", async ({
  page,
}) => {
  await choose(page);
  await discard(page);
  await page.evaluate(() => {
    window.browserFileProbe.holdEncode = true;
  });
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.browserFileProbe.encodingPaused))
    .toBe(true);
  await rename(page, "Made while encoding");
  await expect(page.getByRole("button", { name: "Open file…" })).toBeDisabled();
  await page.evaluate(() => window.browserFileProbe.resumeEncode());
  expect((await downloaded(await event)).project).toEqual(exampleProject);
  const expected = structuredClone(exampleProject);
  (expected.document.layers[1] as { name: string }).name =
    "Made while encoding";
  expect((await download(page)).project).toEqual(expected);
  await expect(page.locator(".document-status")).toContainText("Unsaved");
  await choose(page);
  await prompt(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await download(page)).project).toEqual(expected);
});

test("edits while File bytes are pending supersede Open without changing source or content", async ({
  page,
}) => {
  await choose(page);
  await discard(page);
  await page.evaluate(() => {
    window.browserFileProbe.holdRead = true;
  });
  await drop(page, [
    { name: "later.tilewright", contents: JSON.stringify(exampleProject) },
  ]);
  await prompt(page).getByRole("button", { name: "Discard changes" }).click();
  await expect
    .poll(() => page.evaluate(() => window.browserFileProbe.readingPaused))
    .toBe(true);
  await rename(page, "New work while reading");
  await page.evaluate(() => window.browserFileProbe.resumeRead());
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("workspace changed");
  await expect(page.locator(".project-filename")).toHaveText(
    "café 地図.tilewright",
  );
  const expected = structuredClone(exampleProject);
  (expected.document.layers[1] as { name: string }).name =
    "New work while reading";
  expect((await download(page)).project).toEqual(expected);
});
