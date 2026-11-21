import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { consumerGoldenSession } from "./fixtures/agent-consumer";
import { sourceColor, sourceSummary } from "./fixtures/agent-consumer-oracle";
import {
  populatedAgentDocument,
  fixtureRunsFromAgentMap,
} from "./fixtures/agent-export";
import { FIXTURES } from "./fixtures/maps";
import { inspectFixture } from "./fixtures/inspect";
import { EditorSession } from "../src/editor/session";
import { encodeProjectSnapshot } from "../src/domain/project";
import type { AgentMapV1 } from "../src/domain/agent-export-format";

declare global {
  interface Window {
    agentDownloadProbe: {
      created: string[];
      revoked: string[];
      mime: string[];
      hold: boolean;
      paused: boolean;
      resume: () => void;
      block: boolean;
    };
  }
}

// Shipping entry and real downloads. Only browser APIs are instrumented; there
// is no native IPC mock, editor probe or replacement encoder/download transport.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const probe: Window["agentDownloadProbe"] = (window.agentDownloadProbe = {
      created: [],
      revoked: [],
      mime: [],
      hold: false,
      paused: false,
      resume: () => {},
      block: false,
    });
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      probe.created.push(url);
      if (blob instanceof Blob) probe.mime.push(blob.type);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      probe.revoked.push(url);
      revoke(url);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (probe.block) throw new Error("Browser blocked the download");
      click.call(this);
    };
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (
        probe.hold &&
        new Error().stack?.includes("/src/domain/agent-export.ts")
      ) {
        probe.hold = false;
        probe.paused = true;
        probe.resume = () => {
          probe.paused = false;
          timeout(handler, delay, ...args);
        };
        return -1;
      }
      return timeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
});

const exportButton = (page: Page) =>
  page.getByRole("button", { name: "Export for Agent", exact: true });
const feedback = (page: Page) =>
  page.getByRole("status", { name: "Agent export feedback" });
async function open(
  page: Page,
  session: EditorSession,
  name = "café 地図.tilewright",
) {
  const buffer = Buffer.from(
    await encodeProjectSnapshot(session.captureProjectSnapshot(), {
      yieldControl: async () => {},
    }),
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/json", buffer });
  await page
    .getByRole("dialog", { name: "Open another project" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.locator(".project-filename")).toHaveText(name, {
    timeout: 60_000,
  });
  await expect(exportButton(page)).toBeEnabled();
}
async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}
async function download(page: Page, shortcut = false) {
  const event = page.waitForEvent("download");
  if (shortcut) await page.locator(".canvas-host").press("Control+Shift+e");
  else await exportButton(page).click();
  const result = await event;
  await expect(feedback(page)).toContainText("Agent map download requested");
  return { download: result, bytes: await bytes(result) };
}
function consume(buffer: Buffer, ...args: string[]) {
  const result = spawnSync(
    "python3",
    ["-I", "scripts/consume-agent-map.py", "-", ...args],
    {
      input: buffer,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}
async function rename(page: Page, name: string) {
  const input = page.getByRole("textbox", { name: "Layer name", exact: true });
  await input.fill(name);
  await input.press("Enter");
}
async function projectEvidence(page: Page) {
  return {
    name: await page.locator(".project-filename").textContent(),
    status: await page
      .locator(".document-title .document-status")
      .textContent(),
    downloaded: await page.getByTestId("download-timestamp").innerHTML(),
    saved: await page.getByTestId("save-timestamp").innerHTML(),
  };
}
async function cleanup(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => window.agentDownloadProbe.revoked.length))
    .toBe(count);
  const probe = await page.evaluate(() => window.agentDownloadProbe);
  expect(probe.revoked).toEqual(probe.created);
  expect(probe.mime).toEqual(Array(count).fill("application/json"));
  expect(await page.locator("a[download]").count()).toBe(0);
}

test("golden browser downloads independently reconstruct hidden layers, raw/registered colors and all areas at any selection/zoom", async ({
  page,
}, info) => {
  const session = consumerGoldenSession();
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" ||
      /\/src\/native\/|\/platform\/tauri|\/assets\/tauri-|^ipc:/.test(r.url())
    )
      requests.push(r.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await open(page, session);
    await expect(
      page.getByRole("button", { name: "Show Walls", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show Furniture", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Zoom", exact: true })
      .selectOption("1");
    const host = page.locator(".canvas-host");
    await host.press("v");
    const canvas = (await host.boundingBox())!;
    await host.click({
      position: { x: canvas.width / 2, y: canvas.height / 2 },
    });
    await expect(page.getByTestId("selection-dimensions")).toContainText(
      "1 × 1 tiles",
    );
    const before = await projectEvidence(page);
    const first = await download(page);
    expect(first.download.suggestedFilename()).toBe("café 地図.agent-map.json");
    expect(createHash("sha256").update(first.bytes).digest("hex")).toBe(
      "95ad511e2a18b0c467fbe50f4541eb95d686f394b26533b1f76a28edf5e49d7b",
    );
    expect(JSON.parse(first.bytes.toString())).toEqual(
      JSON.parse(
        await readFile("docs/examples/agent-consumer-v1.json", "utf8"),
      ),
    );
    expect(JSON.parse(consume(first.bytes))).toEqual(
      sourceSummary(session.document),
    );
    const expected = [...session.document.iterateCells()].map((cell) => ({
      layerId: cell.layerId,
      layerOrder: session.document.layers.findIndex(
        (l) => l.id === cell.layerId,
      ),
      x: cell.x,
      y: cell.y,
      color: sourceColor(session.document, cell.value),
    }));
    expect(
      consume(first.bytes, "--cells")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(expected);
    await page
      .getByRole("combobox", { name: "Zoom", exact: true })
      .selectOption("0.125");
    expect((await download(page, true)).bytes).toEqual(first.bytes);
    expect(await projectEvidence(page)).toEqual(before);
    await expect(feedback(page)).toContainText(
      "saving to disk is not confirmed",
    );
    await expect(feedback(page)).toContainText(
      "cancel the download in your browser",
    );
    await expect(feedback(page)).toHaveCSS("clip", "auto");
    await cleanup(page, 2);
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(exportButton(page)).toBeInViewport();
    const title = (await page.locator(".document-title").boundingBox())!;
    const controls = (await page
      .getByRole("region", { name: "Project files" })
      .boundingBox())!;
    expect(
      title.y + title.height <= controls.y ||
        title.x + title.width <= controls.x,
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("agent-export-compact.png"),
    });
    await page
      .getByRole("button", { name: "Dismiss agent export notification" })
      .click();
    await expect(feedback(page)).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  } finally {
    session.dispose();
  }
});

test("edits during encoding stay in the editor; exports leave the project download checkpoint and undo history unchanged", async ({
  page,
}) => {
  const session = consumerGoldenSession();
  try {
    await open(page, session);
    const projectDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download project", exact: true })
      .click();
    await bytes(await projectDownload);
    await page.evaluate(() => {
      window.agentDownloadProbe.hold = true;
    });
    const event = page.waitForEvent("download");
    await exportButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.agentDownloadProbe.paused))
      .toBe(true);
    await expect(
      page.getByRole("progressbar", { name: "Agent export progress" }),
    ).toBeVisible();
    await expect(feedback(page)).toContainText("Cancel before download starts");
    for (const name of [
      "New map",
      "Open…",
      "Download project",
      "Export for Agent",
    ])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeDisabled();
    await rename(page, "Late committed edit");
    const afterEdit = await projectEvidence(page);
    await page.evaluate(() => window.agentDownloadProbe.resume());
    const first = await bytes(await event);
    expect(JSON.parse(consume(first))).toEqual(sourceSummary(session.document));
    expect(await projectEvidence(page)).toEqual(afterEdit);
    expect(afterEdit.status).toBe("Changes since download request");
    session.renameLayer(session.document.layers[0].id, "Late committed edit");
    expect(JSON.parse(consume((await download(page)).bytes))).toEqual(
      sourceSummary(session.document),
    );
    expect(await projectEvidence(page)).toEqual(afterEdit);
    await page.locator(".canvas-host").press("Control+z");
    await expect(page.locator(".document-title .document-status")).toHaveText(
      "No changes since download request",
    );
    await page.locator(".canvas-host").press("Control+Shift+z");
    await expect(
      page.getByRole("textbox", { name: "Layer name", exact: true }),
    ).toHaveValue("Late committed edit");
    expect(await projectEvidence(page)).toEqual(afterEdit);
    await cleanup(page, 3);
  } finally {
    session.dispose();
  }
});

test("encoding cancellation requests no download; observable handoff errors clean up and allow retry", async ({
  page,
}) => {
  const events: Download[] = [];
  page.on("download", (d) => events.push(d));
  const before = await projectEvidence(page);
  for (const shortcut of [false, true]) {
    await page.evaluate(() => {
      window.agentDownloadProbe.hold = true;
    });
    await exportButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.agentDownloadProbe.paused))
      .toBe(true);
    if (shortcut) await page.locator(".canvas-host").press("Escape");
    else
      await page
        .getByRole("button", { name: "Cancel export", exact: true })
        .click();
    await page.evaluate(() => window.agentDownloadProbe.resume());
    await expect(feedback(page)).toContainText(
      "Export canceled. No download was requested.",
    );
    expect(events).toHaveLength(0);
    expect(await projectEvidence(page)).toEqual(before);
    await cleanup(page, 0);
  }
  await page.evaluate(() => {
    window.agentDownloadProbe.block = true;
  });
  await exportButton(page).click();
  await expect(
    page.getByRole("alert", { name: "Agent export feedback" }),
  ).toContainText("Browser blocked the download");
  await cleanup(page, 1);
  expect(events).toHaveLength(0);
  expect(await projectEvidence(page)).toEqual(before);
  await page.evaluate(() => {
    window.agentDownloadProbe.block = false;
  });
  const result = await download(page);
  expect(result.download.suggestedFilename()).toBe("Untitled.agent-map.json");
  expect(JSON.parse(consume(result.bytes)).occupiedLayerCells).toBe(0);
  // URL cleanup must also finish when the application is torn down after handoff.
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  await cleanup(page, 2);
});

for (const fixture of FIXTURES)
  test(`${fixture.id}: actual browser download matches independent consumer and full semantic fixture`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const session = new EditorSession(populatedAgentDocument(fixture));
    try {
      for (const layer of session.document.layers.slice(1))
        session.setLayerVisible(layer.id, false);
      const expected = sourceSummary(session.document);
      await open(page, session, `${fixture.id}.tilewright`);
      // Detail zoom shows only a tiny fraction of this 6,400 × 6,400 map.
      await page
        .getByRole("combobox", { name: "Zoom", exact: true })
        .selectOption("1");
      const result = await download(page);
      const report = JSON.parse(consume(result.bytes));
      expect(report).toEqual(expected);
      const map: AgentMapV1 = JSON.parse(result.bytes.toString());
      const golden = JSON.parse(
        await readFile("tests/fixtures/expected.json", "utf8"),
      )[fixture.id];
      expect(inspectFixture(fixture, fixtureRunsFromAgentMap(map))).toEqual(
        golden,
      );
      expect(result.bytes.length).toBe(
        fixture.id === "frontier-v1" ? 2306718 : 8080454,
      );
      expect(report.areas).toHaveLength(1089);
      await info.attach("download-evidence", {
        body: JSON.stringify({
          fixture: fixture.id,
          bytes: result.bytes.length,
          sha256: createHash("sha256").update(result.bytes).digest("hex"),
          occupiedLayerCells: report.occupiedLayerCells,
          areas: report.areas.length,
        }),
        contentType: "application/json",
      });
      await cleanup(page, 1);
    } finally {
      session.dispose();
    }
  });
