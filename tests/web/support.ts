import { expect, test as base, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { ProjectV1 } from "../../src/domain/project-format";
import { decodeProject } from "../../src/domain/project-decoding";
import { sourceSummary } from "../fixtures/agent-consumer-oracle";

export { expect };
export const test = base.extend<{ audit: void }>({
  audit: [
    async ({ context, browser }, use, info) => {
      const errors: string[] = [];
      const requests: string[] = [];
      const watch = (page: Page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      context.on("request", (request) => {
        const url = request.url();
        requests.push(url);
        if (
          request.method() !== "GET" ||
          !url.startsWith(String(info.project.use.baseURL)) ||
          /\/assets\/tauri-/.test(url)
        )
          errors.push(`Unexpected request: ${url}`);
      });
      context.on("requestfailed", (request) =>
        errors.push(`Failed: ${request.url()}`),
      );
      context.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`);
      });
      await use();
      await info.attach("browser-audit.json", {
        body: JSON.stringify(
          {
            engine: info.project.name,
            version: browser.version(),
            requests,
            errors,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
export const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
export const host = (page: Page) => page.locator(".canvas-host");
export async function ready(page: Page) {
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-webgl-version",
    "2",
  );
}
export async function start(page: Page) {
  await page.goto("./");
  await ready(page);
}
export async function rename(page: Page, name: string) {
  const input = page.getByRole("textbox", { name: "Layer name", exact: true });
  await input.fill(name);
  await input.press("Enter");
}
export async function choose(
  page: Page,
  buffer: Buffer | string,
  name = "session.tilewright",
) {
  const event = page.waitForEvent("filechooser");
  await button(page, "Open…").click();
  await (
    await event
  ).setFiles(
    typeof buffer === "string"
      ? buffer
      : { name, mimeType: "application/json", buffer },
  );
}
export async function replace(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: /Discard changes|Continue without another download/,
    })
    .click();
  // Complete populated imports perform bounded async decoding and recovery
  // transition work. This is a correctness deadline, not a latency budget.
  await expect(button(page, "Open…")).toBeEnabled({ timeout: 90_000 });
}
export async function open(
  page: Page,
  buffer: Buffer | string,
  name = "session.tilewright",
) {
  await choose(page, buffer, name);
  await replace(page);
  await expect(page.locator(".project-filename")).toHaveText(name, {
    timeout: 90_000,
  });
  await ready(page);
}
export async function download(page: Page, name = "Download project") {
  const event = page.waitForEvent("download");
  await button(page, name).click();
  const file = await event;
  expect(await file.failure()).toBeNull();
  const path = (await file.path())!;
  return { file, path, bytes: await readFile(path) };
}
export async function project(page: Page): Promise<ProjectV1> {
  return JSON.parse((await download(page)).bytes.toString());
}
export async function drop(
  page: Page,
  bytes: Buffer,
  name = "dropped.tilewright",
) {
  return page.locator(".canvas-host").evaluate(
    (element, { contents, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(contents)], name, {
          type: "application/json",
        }),
      );
      const event = new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { contents: [...bytes], name },
  );
}
export function consume(bytes: Buffer) {
  const result = spawnSync(
    "python3",
    ["-I", "scripts/consume-agent-map.py", "-"],
    {
      input: bytes,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
export async function compareAgent(projectBytes: Buffer, agentBytes: Buffer) {
  const decoded = await decodeProject(projectBytes, {
    yieldControl: async () => {},
  });
  expect(consume(agentBytes)).toEqual(sourceSummary(decoded.document));
}
export async function review(page: Page) {
  await button(page, "More options").click();
  await button(page, "Review recovery…").click();
  await expect(button(page, "Refresh recovery")).toBeEnabled();
}
export async function recoveryRows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<
        {
          documentId: string;
          generations: { sequence: number; displayName: string }[];
        }[]
      >((resolve, reject) => {
        const r = db.transaction("lineages").objectStore("lineages").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
export async function checkpoint(page: Page) {
  await expect(
    page.getByRole("status", { name: "Recovery feedback" }),
  ).toContainText("checkpoint ready", { timeout: 20_000 });
}
