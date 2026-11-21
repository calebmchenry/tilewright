import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { exampleProject, fixtureRunsFromProject } from "../fixtures/project";
import {
  populatedAgentDocument,
  fixtureRunsFromAgentMap,
} from "../fixtures/agent-export";
import { FIXTURES } from "../fixtures/maps";
import { inspectFixture } from "../fixtures/inspect";
import { sourceSummary } from "../fixtures/agent-consumer-oracle";
import { EditorSession } from "../../src/editor/session";
import { encodeProjectSnapshot } from "../../src/domain/project";
import {
  test,
  expect,
  button,
  host,
  start,
  open,
  choose,
  replace,
  drop,
  project,
  download,
  rename,
  consume,
} from "./support";

declare global {
  interface Window {
    releaseRead?: () => void;
    readPaused?: boolean;
  }
}
const canonical = () =>
  readFile("tests/fixtures/project-v1.canonical.tilewright");

test("malformed and canceled imports preserve complete project, source, undo and recovery", async ({
  page,
}) => {
  await start(page);
  await open(page, await canonical(), "original.tilewright");
  await rename(page, "Keep these edits");
  const expected = await project(page);
  for (const bytes of [
    Buffer.from("{broken"),
    Buffer.from('{"format":"tilewright-project","version":2}'),
    Buffer.from('{"format":"tilewright-agent-map","version":1}'),
    Buffer.from(
      JSON.stringify(exampleProject).replace(
        '"version":1',
        '"version":1,"version":1',
      ),
    ),
  ]) {
    expect(await drop(page, bytes)).toBe(true);
    await replace(page);
    await expect(
      page.getByRole("alert", { name: "Project file feedback" }),
    ).toBeVisible();
    expect(await project(page)).toEqual(expected);
    await expect(page.locator(".project-filename")).toHaveText(
      "original.tilewright",
    );
  }
  await choose(page, await canonical());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await project(page)).toEqual(expected);
  await host(page).press("Control+z");
  expect(await project(page)).toEqual(exampleProject);
  await host(page).press("Control+Shift+z");
  expect(await project(page)).toEqual(expected);
  expect(await drop(page, await canonical())).toBe(true);
  await replace(page);
  expect((await download(page)).bytes).toEqual(await canonical());
});

test("stale File read cannot replace later edits or their source", async ({
  page,
}) => {
  await start(page);
  await open(page, await canonical(), "keep.tilewright");
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      File.prototype.arrayBuffer = read;
      window.readPaused = true;
      await new Promise<void>((resolve) => {
        window.releaseRead = resolve;
      });
      return read.call(this);
    };
  });
  await choose(page, await canonical(), "stale.tilewright");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.readPaused)).toBe(true);
  await rename(page, "New work while reading");
  await page.evaluate(() => window.releaseRead!());
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("workspace changed");
  const expected = structuredClone(exampleProject);
  (expected.document.layers[1] as { name: string }).name =
    "New work while reading";
  expect(await project(page)).toEqual(expected);
  await expect(page.locator(".project-filename")).toHaveText("keep.tilewright");
});

test("unsaved New choices and browser navigation warning preserve work after download", async ({
  page,
}, info) => {
  await start(page);
  await open(page, await canonical());
  const prevented = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await prevented()).toBe(false);
  await rename(page, "Must keep");
  const expected = await project(page);
  expect(await prevented()).toBe(true);
  const begin = async () => {
    await button(page, "New map").click();
    await button(page, "Create map").click();
  };
  await begin();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await project(page)).toEqual(expected);
  await begin();
  const event = page.waitForEvent("download");
  await button(page, "Download project and stay").click();
  expect(
    JSON.parse(await readFile((await (await event).path())!, "utf8")),
  ).toEqual(expected);
  expect(await project(page)).toEqual(expected);
  expect(await prevented()).toBe(true);
  // Real generic warning: dismiss a page-initiated reload, keeping full content.
  const warning = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(await project(page)).toEqual(expected);
  await info.attach("navigation-warning.json", {
    body: JSON.stringify({ type: dialog.type(), dismissed: true }),
    contentType: "application/json",
  });
  await begin();
  await button(page, "Continue without another download").click();
  expect((await project(page)).document.layers[0].name).toBe("Layer 1");
});

for (const fixture of FIXTURES) {
  test(`${fixture.id}: populated project roundtrip and independent whole-map agent consumption`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const session = new EditorSession(populatedAgentDocument(fixture));
    try {
      for (const layer of session.document.layers.slice(1))
        session.setLayerVisible(layer.id, false);
      const bytes = Buffer.from(
        await encodeProjectSnapshot(session.captureProjectSnapshot(), {
          yieldControl: async () => {},
        }),
      );
      const expected = JSON.parse(
        await readFile("tests/fixtures/expected.json", "utf8"),
      )[fixture.id];
      await start(page);
      const started = Date.now();
      await open(page, bytes, `${fixture.id}.tilewright`);
      await page.getByLabel("Zoom", { exact: true }).selectOption("1");
      const saved = await download(page);
      expect(saved.bytes).toEqual(bytes);
      expect(
        inspectFixture(
          fixture,
          fixtureRunsFromProject(JSON.parse(saved.bytes.toString())),
        ),
      ).toEqual(expected);
      const reopened = `${fixture.id}-reopened.tilewright`;
      await saved.file.saveAs(info.outputPath(reopened));
      await open(page, info.outputPath(reopened), reopened);
      expect((await download(page)).bytes).toEqual(bytes);
      await button(page, "Fit map").click();
      await expect(page.locator("canvas")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 60_000 },
      );
      await page.screenshot({
        path: info.outputPath(`${fixture.id}-overview.png`),
      });
      const exported = await download(page, "Export for Agent");
      const report = consume(exported.bytes);
      expect(report).toEqual(sourceSummary(session.document));
      expect(
        inspectFixture(
          fixture,
          fixtureRunsFromAgentMap(JSON.parse(exported.bytes.toString())),
        ),
      ).toEqual(expected);
      await info.attach("populated-evidence.json", {
        body: JSON.stringify(
          {
            fixture: fixture.id,
            browser: info.project.name,
            projectBytes: bytes.length,
            projectSha256: createHash("sha256").update(bytes).digest("hex"),
            agentBytes: exported.bytes.length,
            agentSha256: createHash("sha256")
              .update(exported.bytes)
              .digest("hex"),
            occupiedLayerCells: report.occupiedLayerCells,
            areas: report.areas.length,
            workflowMs: Date.now() - started,
            timingScope:
              "one correctness run including assertions; not a performance benchmark",
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      session.dispose();
    }
  });
}
