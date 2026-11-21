import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { exampleProject } from "../fixtures/project";
import { webBase } from "../../scripts/web-base";

const base = webBase();

test("only production assets are served, including every lazy/worker environment chunk", async ({
  page,
  request,
}, info) => {
  const files = (await readdir("dist-web", { recursive: true })).filter(
    (file) => file !== "assets",
  );
  expect(files).toContain("index.html");
  expect(files.length).toBeGreaterThan(3);
  for (const file of files) {
    expect(file).toMatch(/^index\.html$|^assets\/[\w-]+\.(js|css)$/);
    const response = await request.get(`${base}${file}`);
    expect(response.status(), file).toBe(200);
    expect(await response.body(), file).toEqual(
      await readFile(`dist-web/${file}`),
    );
    expect(response.headers()["content-type"], file).toMatch(
      file.endsWith(".js")
        ? /javascript/
        : file.endsWith(".css")
          ? /text\/css/
          : /text\/html/,
    );
  }
  for (const path of [
    "tests/editor.html",
    "tests/renderer.html",
    "tests/native-performance.html",
    "src/main.tsx",
    "@vite/client",
    "assets/missing.js",
  ]) {
    expect((await request.get(`${base}${path}`)).status(), path).toBe(404);
  }
  if (base !== "/") {
    expect((await request.get("/index.html")).status()).toBe(404);
    expect(
      (
        await request.get(`/${files.find((file) => file.endsWith(".css"))}`)
      ).status(),
    ).toBe(404);
  }

  await page.goto("./");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(page.locator('script[type="module"]')).toHaveAttribute(
    "src",
    `${base}${files.find((file) => /assets\/index-.*\.js$/.test(file))}`,
  );
  // Exercise module resolution for all non-entry chunks, even the native branch
  // (without binding native services) and Pixi's unused worker environment entry.
  // The current app creates no Worker; this does not claim a worker workload.
  const chunks = files.filter(
    (file) => file.endsWith(".js") && !/assets\/index-/.test(file),
  );
  expect(chunks.some((file) => file.includes("tauri-"))).toBe(true);
  expect(chunks.some((file) => file.includes("webworkerAll-"))).toBe(true);
  await page.evaluate(
    async (urls) => {
      for (const url of urls) await import(url);
    },
    chunks.map((file) => `${base}${file}`),
  );
  await info.attach("production-assets.json", {
    body: JSON.stringify({ base, files, importedChunks: chunks }, null, 2),
    contentType: "application/json",
  });
});

async function downloadProject(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project", exact: true })
    .click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test("production editor opens, edits, undoes, downloads, exports and reloads at its mount path", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("./");
  const ready = page.getByRole("status", { name: "Canvas status" });
  await expect(ready).toHaveText("Canvas ready");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-webgl-version",
    "2",
  );
  await expect(page.locator(".app-header")).not.toHaveClass(/native-titlebar/);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await (
    await chooser
  ).setFiles("tests/fixtures/project-v1.canonical.tilewright");
  await page
    .getByRole("dialog", { name: "Open another project" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.locator(".project-filename")).toHaveText(
    "project-v1.canonical.tilewright",
  );
  expect(await downloadProject(page)).toEqual(exampleProject);

  const layer = page.getByRole("textbox", { name: "Layer name", exact: true });
  await layer.fill("Production subpath edit");
  await layer.press("Enter");
  const edited = structuredClone(exampleProject);
  (edited.document.layers[1] as { name: string }).name =
    "Production subpath edit";
  expect(await downloadProject(page)).toEqual(edited);
  await page.locator(".canvas-host").press("Control+z");
  expect(await downloadProject(page)).toEqual(exampleProject);

  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export for Agent", exact: true })
    .click();
  const exported = await event;
  expect(await exported.failure()).toBeNull();
  expect(exported.suggestedFilename()).toMatch(/\.agent-map\.json$/);
  const agent = JSON.parse(await readFile((await exported.path())!, "utf8"));
  expect(agent.format).toBe("tilewright-agent-map");

  await page.screenshot({ path: info.outputPath("production-subpath.png") });
  await page.reload();
  await expect(ready).toHaveText("Canvas ready");
  expect(new URL(page.url()).pathname).toBe(base);
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(
    false,
  );
  expect(
    requests.every((url) => url.startsWith(`http://127.0.0.1:4173${base}`)),
  ).toBe(true);
  expect(requests.some((url) => /\/assets\/tauri-/.test(url))).toBe(false);
  expect(requests.some((url) => /\/assets\/browserAll-/.test(url))).toBe(true);
  expect(errors).toEqual([]);
});
