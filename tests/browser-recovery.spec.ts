import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exampleProject } from "./fixtures/project";
import type { BrowserRecovery } from "../src/platform/browser-recovery";
import type { RecoveryCapture, RecoveryTicket } from "../src/editor/recovery";
import type { RecoverySelection } from "../src/editor/recovery-discovery";

declare global {
  interface Window {
    recoveryBlocker?: IDBDatabase;
    recoveryTest: {
      adapter: BrowserRecovery;
      capture: RecoveryCapture;
      bytes: Uint8Array;
      ticket?: RecoveryTicket;
      selection?: RecoverySelection;
    };
  }
}
const database = "tilewright-recovery";
// A real origin and browser database, with no editor/timers for adapter fault tests.
async function harness(page: Page) {
  await page.route("**/recovery-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Recovery adapter test</title>",
    }),
  );
  await page.goto("/recovery-test");
  await page.evaluate(async (project) => {
    const path = "/src/platform/browser-recovery.ts";
    const { BrowserRecovery } = await import(path);
    const adapter = new BrowserRecovery();
    const capture: RecoveryCapture = {
      documentId: crypto.randomUUID(),
      writerId: crypto.randomUUID(),
      epoch: 1,
      capturedAt: Date.now(),
      historyRevision: 1,
      documentVersion: 1,
      savedRevision: null,
      dirty: true,
      displayName: "café 地図.tilewright",
      saved: null,
    };
    window.recoveryTest = {
      adapter,
      capture,
      bytes: new TextEncoder().encode(project),
    };
    await adapter.initialize();
  }, JSON.stringify(exampleProject));
}
async function publish(page: Page) {
  return page.evaluate(async () => {
    const t = window.recoveryTest;
    await t.adapter.control({ ...t.capture, status: "active" });
    t.ticket = await t.adapter.prepare(t.capture, t.bytes);
    await t.adapter.commit(t.ticket);
    const entry = (await t.adapter.discover()).entries.find(
      (e) => e.documentId === t.capture.documentId,
    )!;
    const m = entry.generations[0].metadata!;
    t.selection = {
      documentId: m.documentId,
      sequence: m.sequence,
      sha256: m.sha256,
    };
    return m;
  });
}
async function records(page: Page) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const tx = db.transaction(["lineages", "payloads"]);
      const get = (store: string) =>
        new Promise<unknown[]>((resolve) => {
          const r = tx.objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result);
        });
      const [lineages, payloads] = await Promise.all([
        get("lineages"),
        get("payloads"),
      ]);
      return JSON.parse(JSON.stringify({ lineages, payloads })) as {
        lineages: {
          documentId: string;
          generations: { sequence: number; displayName: string }[];
        }[];
        payloads: unknown[];
      };
    } finally {
      db.close();
    }
  }, database);
}

test("atomic publication, bounded rotation, interrupted writes, invalid data and stale jobs", async ({
  page,
}) => {
  await harness(page);
  const first = await publish(page);
  for (let index = 0; index < 2; index++) {
    const result = await page.evaluate(async (afterMetadata) => {
      const t = window.recoveryTest;
      t.capture = { ...t.capture, epoch: t.capture.epoch + 1 };
      await t.adapter.control({ ...t.capture, status: "active" });
      const ticket = await t.adapter.prepare(t.capture, t.bytes);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === (afterMetadata ? "lineages" : "payloads"))
          this.transaction.abort();
        return request;
      };
      try {
        await t.adapter.commit(ticket);
        return "unexpected success";
      } catch (error) {
        return String(error);
      } finally {
        IDBObjectStore.prototype.put = put;
        await t.adapter.cancel(ticket);
      }
    }, !!index);
    expect(result).toMatch(/abort|interrupt|inactive|finished/i);
    const state = await records(page);
    expect(state.lineages[0].generations.map((g) => g.sequence)).toEqual([
      first.sequence,
    ]);
    expect(state.payloads).toHaveLength(1);
  }
  const stale = await page.evaluate(async () => {
    const t = window.recoveryTest;
    const ticket = await t.adapter.prepare(t.capture, t.bytes);
    t.capture = { ...t.capture, epoch: t.capture.epoch + 1 };
    await t.adapter.control({ ...t.capture, status: "active" });
    try {
      await t.adapter.commit(ticket);
      return "unexpected success";
    } catch (e) {
      return String(e);
    } finally {
      await t.adapter.cancel(ticket);
    }
  });
  expect(stale).toContain("Stale");
  for (let i = 0; i < 3; i++) await publish(page);
  const state = await records(page);
  expect(state.lineages[0].generations.map((g) => g.sequence)).toEqual([4, 3]);
  expect(state.payloads).toHaveLength(2);
  const invalid = await page.evaluate(async () => {
    const t = window.recoveryTest;
    try {
      await t.adapter.prepare(
        t.capture,
        new TextEncoder().encode('{"bad":true}'),
      );
      return "unexpected success";
    } catch (e) {
      return String(e);
    }
  });
  expect(invalid).not.toBe("unexpected success");
  expect(await records(page)).toEqual(state);
});

test("prepared bytes disappear on tab termination; published checkpoints and full semantics survive", async ({
  page,
  context,
}) => {
  await harness(page);
  const first = await publish(page);
  await page.evaluate(async () => {
    const t = window.recoveryTest;
    t.ticket = await t.adapter.prepare(t.capture, t.bytes);
  });
  await page.close();
  const next = await context.newPage();
  await harness(next);
  const result = await next.evaluate(async () => {
    const t = window.recoveryTest;
    const entry = (await t.adapter.discover()).entries[0];
    const meta = entry.generations[0].metadata!;
    const selection = {
      documentId: meta.documentId,
      sequence: meta.sequence,
      sha256: meta.sha256,
    };
    await t.adapter.claim(selection, t.capture.writerId);
    return {
      entry,
      project: JSON.parse(
        new TextDecoder().decode(await t.adapter.read(selection)),
      ),
    };
  });
  expect(result.entry.current).toBe(false);
  expect(result.entry.generations).toHaveLength(1);
  expect(result.entry.generations[0].metadata?.sequence).toBe(first.sequence);
  expect(result.project).toEqual(exampleProject);
});

test("live tabs cannot claim, discard or overwrite another writer; released work can be claimed once", async ({
  page,
  context,
}) => {
  await harness(page);
  const first = await publish(page);
  const second = await context.newPage();
  await harness(second);
  await publish(second);
  const selection = {
    documentId: first.documentId,
    sequence: first.sequence,
    sha256: first.sha256,
  };
  const failures = await second.evaluate(async (selection) => {
    const t = window.recoveryTest,
      results: string[] = [];
    for (const action of [
      () => t.adapter.claim(selection, crypto.randomUUID()),
      () => t.adapter.discard(selection.documentId),
      () =>
        t.adapter.control({
          ...t.capture,
          documentId: selection.documentId,
          status: "active",
        }),
    ]) {
      try {
        await action();
        results.push("unexpected success");
      } catch (e) {
        results.push(String(e));
      }
    }
    return { results, entries: (await t.adapter.discover()).entries };
  }, selection);
  expect(failures.results.every((s) => s.includes("another tab"))).toBe(true);
  expect(failures.entries.every((e) => e.current)).toBe(true);
  expect((await records(page)).lineages).toHaveLength(2);
  await page.close();
  await second.evaluate(async (selection) => {
    const t = window.recoveryTest;
    const writer = crypto.randomUUID();
    await t.adapter.claim(selection, writer);
    await t.adapter.release(selection.documentId, writer);
    await t.adapter.discard(selection.documentId);
  }, selection);
  expect((await records(second)).lineages).toHaveLength(1);
});

test("ten-map capacity never evicts unresolved work and discard frees a slot", async ({
  page,
}) => {
  await harness(page);
  for (let i = 0; i < 10; i++) {
    await publish(page);
    await page.evaluate(async () => {
      const t = window.recoveryTest;
      await t.adapter.release(t.capture.documentId, t.capture.writerId);
      t.capture = {
        ...t.capture,
        documentId: crypto.randomUUID(),
        writerId: crypto.randomUUID(),
      };
    });
  }
  const before = await records(page);
  await expect(publish(page)).rejects.toThrow(/capacity reached/);
  expect(await records(page)).toEqual(before);
  await page.evaluate(async (id) => {
    const t = window.recoveryTest;
    await t.adapter.cancel(t.ticket!);
    await t.adapter.discard(id);
  }, before.lineages[0].documentId);
  await publish(page);
  expect((await records(page)).lineages).toHaveLength(10);
});

async function rename(page: Page, name: string) {
  const input = page.getByRole("textbox", { name: "Layer name", exact: true });
  await input.fill(name);
  await input.press("Enter");
}
async function ready(page: Page) {
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
}
async function checkpoint(page: Page) {
  await expect(
    page.getByRole("status", { name: "Recovery feedback" }),
  ).toContainText("checkpoint ready", { timeout: 15000 });
}
async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download project", exact: true })
    .click();
  const file = await event;
  return JSON.parse(await readFile((await file.path())!, "utf8"));
}
async function choose(page: Page, contents = JSON.stringify(exampleProject)) {
  const event = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await (
    await event
  ).setFiles({
    name: "café 地図.tilewright",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await page
    .getByRole("dialog", { name: "Open another project" })
    .getByRole("button", {
      name: /Discard changes|Continue without another download/,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Open…", exact: true }),
  ).toBeEnabled();
}
async function review(page: Page) {
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Review recovery…" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh recovery" }),
  ).toBeEnabled();
}

test("shipping edit/checkpoint/reload/restore preserves every project field as an independent unsaved copy", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await choose(page);
  await rename(page, "Recovered hidden houses");
  await checkpoint(page);
  const expected = await download(page);
  const before = await records(page);
  expect(before.lineages).toHaveLength(1);
  await page.reload();
  await ready(page);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("site origin");
  await dialog.getByRole("button", { name: "Restore as unsaved copy" }).click();
  await page
    .getByRole("dialog", { name: "Restore recovered map" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".project-filename")).toContainText("Recovered");
  expect(await download(page)).toEqual(expected);
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await checkpoint(page);
  expect((await records(page)).lineages[0].documentId).toBe(
    before.lineages[0].documentId,
  );
  await page.setViewportSize({ width: 640, height: 720 });
  await review(page);
  await expect(
    dialog.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Discard recovery…" }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("browser-recovery-compact.png"),
  });
});

test("invalid Open preserves recovery; deliberate New/Open retire only the outgoing lineage; download retains it", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "Keep me");
  await checkpoint(page);
  const before = await records(page);
  await download(page);
  expect(await records(page)).toEqual(before);
  await choose(page, "{broken");
  expect(await records(page)).toEqual(before);
  await choose(page);
  await checkpoint(page);
  const opened = await records(page);
  expect(opened.lineages).toHaveLength(1);
  expect(opened.lineages[0].documentId).not.toBe(before.lineages[0].documentId);
  await page.getByRole("button", { name: "New map", exact: true }).click();
  await page.getByRole("button", { name: "Create map", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await checkpoint(page);
  await expect
    .poll(async () => (await records(page)).lineages[0]?.documentId, {
      timeout: 15000,
    })
    .not.toBe(opened.lineages[0].documentId);
  await checkpoint(page);
  const after = await records(page);
  expect(after.lineages).toHaveLength(1);
  expect(after.lineages[0].documentId).not.toBe(opened.lineages[0].documentId);
});

for (const failure of ["quota", "unavailable", "transaction"] as const) {
  test(`shipping ${failure} storage failure leaves editing, project download and agent export available`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      if (failure === "unavailable")
        indexedDB.open = () => {
          throw new DOMException("Browser storage disabled", "SecurityError");
        };
      else {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "payloads") {
            if (failure === "quota")
              throw new DOMException("quota", "QuotaExceededError");
            this.transaction.abort();
          }
          return put.apply(this, args);
        };
      }
    }, failure);
    await page.goto("/");
    await ready(page);
    await rename(page, `Editing after ${failure}`);
    const feedback = page.getByRole("alert", { name: "Recovery feedback" });
    await expect(feedback).toContainText("Recovery unavailable", {
      timeout: 15000,
    });
    await expect(feedback).not.toContainText("Last capture");
    expect((await download(page)).document.layers[0].name).toBe(
      `Editing after ${failure}`,
    );
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export for Agent", exact: true })
      .click();
    expect((await event).suggestedFilename()).toMatch(/\.agent-map\.json$/);
    await expect(
      feedback.getByRole("button", { name: "Retry recovery" }),
    ).toBeEnabled();
  });
}

test("corrupt newest checkpoint offers the valid fallback; independent entries remain reviewable and discard is selected", async ({
  page,
}) => {
  await harness(page);
  const old = await publish(page);
  await publish(page);
  await page.evaluate(async () => {
    const t = window.recoveryTest;
    await t.adapter.release(t.capture.documentId, t.capture.writerId);
    t.capture = {
      ...t.capture,
      documentId: crypto.randomUUID(),
      writerId: crypto.randomUUID(),
      displayName: "Other valid map",
    };
  });
  await publish(page);
  await page.evaluate(async (id) => {
    window.recoveryTest.adapter.dispose();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("payloads", "readwrite");
      tx.objectStore("payloads").put({
        documentId: id,
        sequence: 2,
        bytes: new Uint8Array([1, 2, 3]),
      });
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, old.documentId);
  await page.goto("/");
  await ready(page);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(dialog).toBeVisible();
  const fallback = dialog.getByRole("article", {
    name: `café 地図.tilewright — ${old.documentId}`,
    exact: true,
  });
  await expect(fallback).toContainText("older fallback");
  await expect(
    fallback.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeEnabled();
  await fallback.getByRole("combobox").selectOption("2");
  await expect(
    fallback.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  const valid = dialog.getByRole("article", { name: /Other valid map/ });
  await expect(
    valid.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeEnabled();
  await fallback.getByRole("button", { name: "Discard recovery…" }).click();
  await fallback.getByRole("button", { name: "Keep recovery" }).click();
  expect(
    (await records(page)).lineages.some((r) => r.documentId === old.documentId),
  ).toBe(true);
  await fallback.getByRole("button", { name: "Discard recovery…" }).click();
  await fallback.getByRole("button", { name: "Discard this recovery" }).click();
  await expect(fallback).not.toBeVisible();
  expect(
    (await records(page)).lineages.some((r) => r.documentId === old.documentId),
  ).toBe(false);
  await expect(valid).toBeVisible();
});

// Recreate the documented v1 database without the v2 cleanup index, retaining
// actual previously published bytes. Leave its connection open to block upgrades.
async function legacyDatabase(page: Page) {
  await page.evaluate(async () => {
    window.recoveryTest.adapter.dispose();
    const open = (version?: number) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("tilewright-recovery", version);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("lineages", { keyPath: "documentId" });
          r.result.createObjectStore("payloads", {
            keyPath: ["documentId", "sequence"],
          });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const db = await open();
    const tx = db.transaction(["lineages", "payloads"]);
    const read = (store: string) =>
      new Promise<unknown[]>((resolve) => {
        const r = tx.objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [lineages, payloads] = await Promise.all([
      read("lineages"),
      read("payloads"),
    ]);
    db.close();
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase("tilewright-recovery");
      r.onsuccess = () => resolve();
    });
    const legacy = await open(1);
    window.recoveryBlocker = legacy;
    await new Promise<void>((resolve) => {
      const tx = legacy.transaction(["lineages", "payloads"], "readwrite");
      lineages.forEach((v) => tx.objectStore("lineages").put(v));
      payloads.forEach((v) => tx.objectStore("payloads").put(v));
      tx.oncomplete = () => resolve();
    });
    // Deliberately do not react to versionchange; an old tab may block an upgrade.
  });
}

test("blocked database upgrade gives feedback; closing the blocker and retrying migrates v1 without losing bytes", async ({
  page,
  context,
}) => {
  await harness(page);
  await publish(page);
  const original = await records(page);
  await legacyDatabase(page);
  const next = await context.newPage();
  await next.goto("/");
  await ready(next);
  const feedback = next.getByRole("alert", { name: "Recovery feedback" });
  await expect(feedback).toContainText("upgrade blocked", { timeout: 15000 });
  await rename(next, "Editing while upgrade is blocked");
  expect((await download(next)).document.layers[0].name).toBe(
    "Editing while upgrade is blocked",
  );
  await page.close();
  await feedback.getByRole("button", { name: "Retry recovery" }).click();
  await checkpoint(next);
  const migrated = await records(next);
  expect(
    migrated.lineages.find(
      (r) => r.documentId === original.lineages[0].documentId,
    ),
  ).toEqual(original.lineages[0]);
  expect(migrated.payloads).toEqual(expect.arrayContaining(original.payloads));
  await review(next);
  await expect(
    next
      .getByRole("article", { name: /café 地図/ })
      .getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeEnabled();
});

test("future database versions remain untouched and downloads still work", async ({
  page,
}) => {
  await harness(page);
  await publish(page);
  const before = await records(page);
  await page.evaluate(async () => {
    window.recoveryTest.adapter.dispose();
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("tilewright-recovery", 99);
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
  });
  await page.goto("/");
  await ready(page);
  await expect(
    page.getByRole("alert", { name: "Recovery feedback" }),
  ).toContainText("Unsupported recovery database version", { timeout: 15000 });
  await download(page);
  expect(await records(page)).toEqual(before);
});

test("failed publication preserves prior checkpoint and retry captures new committed work", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "First committed layer");
  await checkpoint(page);
  const before = await records(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "payloads") {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("quota", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
  await rename(page, "Next committed layer");
  const feedback = page.getByRole("alert", { name: "Recovery feedback" });
  await expect(feedback).toContainText("storage is full", { timeout: 15000 });
  await expect(feedback).toContainText("Last capture");
  expect(await records(page)).toEqual(before);
  await feedback.getByRole("button", { name: "Retry recovery" }).click();
  await checkpoint(page);
  const after = await records(page);
  expect(after.lineages[0].generations).toHaveLength(2);
  expect((await download(page)).document.layers[0].name).toBe(
    "Next committed layer",
  );
});

test("uncommitted layer drafts and pointer gestures never enter a timed checkpoint", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await rename(page, "Committed name");
  await page
    .getByRole("textbox", { name: "Layer name", exact: true })
    .fill("Uncommitted draft");
  const host = page.locator(".canvas-host");
  // Escape cancels the layer draft before moving focus to the canvas.
  await page
    .getByRole("textbox", { name: "Layer name", exact: true })
    .press("Escape");
  await host.press("b");
  const box = (await host.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 100);
  await checkpoint(page);
  const captured = await records(page);
  expect(captured.payloads).toHaveLength(1);
  const project = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
    });
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const r = db.transaction("payloads").objectStore("payloads").getAll();
      r.onsuccess = () => resolve(r.result[0].bytes);
    });
    db.close();
    return JSON.parse(new TextDecoder().decode(bytes));
  });
  expect(project.document.layers[0].name).toBe("Committed name");
  expect(project.document.layers[0].runs).toEqual([]);
  await page.mouse.up();
  await checkpoint(page);
  expect((await download(page)).document.layers[0].runs.length).toBeGreaterThan(
    0,
  );
});

test("semantic corruption with a matching checksum and invalid metadata cannot replace the document or hide valid entries", async ({
  page,
}) => {
  await harness(page);
  const invalid = await publish(page);
  await page.evaluate(async () => {
    const t = window.recoveryTest;
    await t.adapter.release(t.capture.documentId, t.capture.writerId);
    t.capture = {
      ...t.capture,
      documentId: crypto.randomUUID(),
      writerId: crypto.randomUUID(),
      displayName: "Valid independent entry",
    };
  });
  const valid = await publish(page);
  await page.evaluate(async (id) => {
    const adapter = window.recoveryTest.adapter;
    adapter.dispose();
    const bytes = new TextEncoder().encode(
      '{"format":"tilewright-project","version":1,"document":{},"editor":{}}',
    );
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(["lineages", "payloads"], "readwrite");
      const r = tx.objectStore("lineages").get(id);
      r.onsuccess = () => {
        const record = r.result;
        record.generations[0].byteLength = bytes.byteLength;
        record.generations[0].sha256 = hash;
        tx.objectStore("lineages").put(record);
        tx.objectStore("payloads").put({ documentId: id, sequence: 1, bytes });
        const corrupt = structuredClone(record);
        corrupt.documentId = crypto.randomUUID();
        corrupt.generations[0].documentId = corrupt.documentId;
        corrupt.generations[0].version = 99;
        tx.objectStore("lineages").put(corrupt);
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, invalid.documentId);
  await page.goto("/");
  await ready(page);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Refresh recovery" }),
  ).toBeEnabled();
  expect(await dialog.getByRole("article").count()).toBe(3);
  expect(
    await dialog
      .getByRole("button", { name: "Restore as unsaved copy", disabled: true })
      .count(),
  ).toBe(2);
  const row = dialog.getByRole("article", {
    name: new RegExp(valid.documentId),
  });
  await expect(
    row.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(
    page.getByRole("textbox", { name: "Layer name", exact: true }),
  ).toHaveValue("Layer 1");
  expect((await download(page)).document.layers[0].runs).toEqual([]);
});

test("epoch changes during asynchronous hashing and disposal prevent stale publication", async ({
  page,
}) => {
  await harness(page);
  await publish(page);
  const before = await records(page);
  const result = await page.evaluate(async () => {
    const t = window.recoveryTest;
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      crypto.subtle.digest = digest;
      started();
      await wait;
      return digest(...args);
    };
    const preparing = t.adapter
      .prepare(t.capture, t.bytes)
      .then(() => "unexpected success", String);
    await entered;
    t.capture = { ...t.capture, epoch: t.capture.epoch + 1 };
    await t.adapter.control({ ...t.capture, status: "active" });
    release();
    const stale = await preparing;
    const ticket = await t.adapter.prepare(t.capture, t.bytes);
    t.adapter.dispose();
    const disposed = await t.adapter
      .commit(ticket)
      .then(() => "unexpected success", String);
    return { stale, disposed };
  });
  expect(result.stale).toContain("Stale");
  expect(result.disposed).not.toBe("unexpected success");
  expect(await records(page)).toEqual(before);
});

test("exhausted sequence counters cannot publish invalid metadata or replace the previous checkpoint", async ({
  page,
}) => {
  await harness(page);
  const first = await publish(page);
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("lineages", "readwrite"),
        store = tx.objectStore("lineages"),
        r = store.get(id);
      r.onsuccess = () => {
        store.put({ ...r.result, nextSequence: Number.MAX_SAFE_INTEGER });
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, first.documentId);
  const before = await records(page);
  await expect(publish(page)).rejects.toThrow(
    /Invalid or unsupported recovery lineage/,
  );
  expect(await records(page)).toEqual(before);
});

test("teardown releases tab ownership when a transaction has already entered commit", async ({
  page,
}) => {
  await harness(page);
  await publish(page);
  const failure = await page.evaluate(async () => {
    const t = window.recoveryTest;
    const ticket = await t.adapter.prepare(t.capture, t.bytes);
    const put = IDBObjectStore.prototype.put;
    let failure = "";
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "lineages") {
        IDBObjectStore.prototype.put = put;
        // A real committing IDBTransaction cannot be aborted. Disposal must
        // still release locks and close the connection without throwing.
        this.transaction.commit();
        try {
          t.adapter.dispose();
        } catch (error) {
          failure = String(error);
        }
      }
      return request;
    };
    try {
      await t.adapter.commit(ticket);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    return failure;
  });
  expect(failure).toBe("");
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.locks.query()).held?.filter((l) =>
          l.name?.startsWith("tilewright-recovery:"),
        ),
      ),
    )
    .toEqual([]);
  expect((await records(page)).lineages[0].generations).toHaveLength(2);
});
