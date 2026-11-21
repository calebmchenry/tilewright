import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  button,
  start,
  open,
  project,
  download,
  rename,
  checkpoint,
  recoveryRows,
  review,
  replace,
  compareAgent,
} from "./support";

async function newestProject(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(["lineages", "payloads"]);
        const row = tx.objectStore("lineages").get(id);
        row.onsuccess = () => {
          const r = tx
            .objectStore("payloads")
            .get([id, row.result.generations[0].sequence]);
          r.onsuccess = () =>
            resolve(JSON.parse(new TextDecoder().decode(r.result.bytes)));
        };
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, id);
}

test("two real tabs isolate checkpoints and protect active writers, then restore full released work", async ({
  page,
  context,
}) => {
  await start(page);
  await open(
    page,
    await readFile("tests/fixtures/project-v1.canonical.tilewright"),
    "First tab.tilewright",
  );
  await rename(page, "First tab edits");
  const expected = await project(page);
  await checkpoint(page);
  const id = (await recoveryRows(page))[0].documentId;
  expect(await newestProject(page, id)).toEqual(expected);
  const second = await context.newPage();
  await start(second);
  await review(second);
  const recovery = second.getByRole("dialog", { name: "Recover unsaved work" });
  const first = recovery.getByRole("article", { name: new RegExp(id) });
  await expect(first).toContainText("another tab");
  await expect(
    first.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  await expect(
    first.getByRole("button", { name: "Discard recovery…" }),
  ).toBeDisabled();
  await button(second, "Not now").click();
  await rename(second, "Second tab edits");
  await checkpoint(second);
  expect((await recoveryRows(second)).length).toBe(2);
  expect(await newestProject(second, id)).toEqual(expected);
  await page.close();
  await review(second);
  await expect(
    first.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeEnabled();
  await first.getByRole("button", { name: "Restore as unsaved copy" }).click();
  await replace(second);
  expect(await project(second)).toEqual(expected);
  await checkpoint(second);
  expect((await recoveryRows(second)).map((r) => r.documentId)).toEqual([id]);
});

for (const failure of ["quota", "transaction", "unavailable"] as const) {
  test(`${failure} recovery failure preserves prior bytes and allows downloads, agent export and retry`, async ({
    page,
  }) => {
    await start(page);
    await open(
      page,
      await readFile("tests/fixtures/project-v1.canonical.tilewright"),
    );
    await rename(page, "Prior committed work");
    const prior = await project(page);
    await checkpoint(page);
    const rows = await recoveryRows(page),
      id = rows[0].documentId;
    expect(await newestProject(page, id)).toEqual(prior);
    if (failure === "unavailable") {
      // A fresh load with disabled storage exercises initialization failure.
      await page.addInitScript(() => {
        const original = indexedDB.open.bind(indexedDB);
        indexedDB.open = () => {
          throw new DOMException("Browser storage disabled", "SecurityError");
        };
        window.restoreStorage = () => {
          indexedDB.open = original;
        };
      });
      page.once("dialog", (d) => void d.accept());
      await page.reload();
    } else {
      await page.evaluate((failure) => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "payloads") {
            if (failure === "quota")
              throw new DOMException("quota", "QuotaExceededError");
            this.transaction.abort();
          }
          return original.apply(this, args);
        };
        window.restoreStorage = () => {
          IDBObjectStore.prototype.put = original;
        };
      }, failure);
    }
    await rename(page, "Edits survive storage failure");
    const feedback = page.getByRole("alert", { name: "Recovery feedback" });
    await expect(feedback).toContainText("Recovery unavailable", {
      timeout: 20_000,
    });
    const saved = await download(page);
    const current = JSON.parse(saved.bytes.toString());
    expect(
      current.document.layers.find(
        (l: { name: string }) => l.name === "Edits survive storage failure",
      ),
    ).toBeTruthy();
    const exported = await download(page, "Export for Agent");
    await compareAgent(saved.bytes, exported.bytes);
    await page.evaluate(() => window.restoreStorage!());
    expect(await newestProject(page, id)).toEqual(prior);
    expect(await recoveryRows(page)).toEqual(rows);
    await feedback.getByRole("button", { name: "Retry recovery" }).click();
    await checkpoint(page);
    const after = await recoveryRows(page);
    const activeId =
      failure === "unavailable"
        ? after.find((r) => r.documentId !== id)!.documentId
        : id;
    expect(await newestProject(page, activeId)).toEqual(current);
    expect(await project(page)).toEqual(current);
  });
}

declare global {
  interface Window {
    restoreStorage?: () => void;
  }
}

test("corrupt newest generation cannot replace the editor and complete fallback remains recoverable", async ({
  page,
}) => {
  await start(page);
  await open(
    page,
    await readFile("tests/fixtures/project-v1.canonical.tilewright"),
    "Fallback.tilewright",
  );
  await rename(page, "Valid fallback");
  const fallback = await project(page);
  await checkpoint(page);
  const id = (await recoveryRows(page))[0].documentId;
  await rename(page, "Newest generation");
  const latest = await project(page);
  await expect
    .poll(() => newestProject(page, id), { timeout: 20_000 })
    .toEqual(latest);
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tilewright-recovery");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["lineages", "payloads"], "readwrite");
        const r = tx.objectStore("lineages").get(id);
        r.onsuccess = () =>
          tx.objectStore("payloads").put({
            documentId: id,
            sequence: r.result.generations[0].sequence,
            bytes: new Uint8Array([1, 2, 3]),
          });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, id);
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  const row = dialog.getByRole("article", { name: new RegExp(id) });
  await expect(row).toContainText("older fallback");
  const selector = row.getByRole("combobox");
  const previous = await selector.inputValue();
  const newest = (await recoveryRows(page)).find((r) => r.documentId === id)!
    .generations[0].sequence;
  await selector.selectOption(String(newest));
  await expect(
    row.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  await selector.selectOption(previous);
  await row.getByRole("button", { name: "Restore as unsaved copy" }).click();
  await replace(page);
  expect(await project(page)).toEqual(fallback);
});
