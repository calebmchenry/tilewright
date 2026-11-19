import { expect, test, type Page } from "@playwright/test";
import { exampleProject } from "./fixtures/project";
import { trackGpu } from "./gpu";

// Exercise the shipping UI and Tauri adapter; only OS IPC/dialogs are substituted.
test.beforeEach(async ({ page }) => {
  await trackGpu(page);
  await page.addInitScript((projectText: string) => {
    const project = JSON.parse(projectText) as typeof exampleProject;
    const probe = {
      cancel: false,
      fail: "",
      writes: [] as { token: string; project: typeof project }[],
      picks: [] as { save: boolean; current?: string }[],
      choice: 0,
      closePending: location.search.includes("pending-close"),
      closed: 0,
      holdWrite: false,
      releaseWrite: null as (() => void) | null,
      requestClose: () => {},
    };
    let eventHandler: (() => void) | null = null;
    const callbacks = new Map<number, () => void>();
    let callbackId = 0;
    probe.requestClose = () => {
      probe.closePending = true;
      eventHandler?.();
    };
    Object.assign(window, {
      isTauri: true,
      fileProbe: probe,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback: () => void) {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        async invoke(
          command: string,
          args: unknown,
          options?: { headers: Record<string, string> },
        ) {
          if (probe.fail === command)
            throw `Could not ${command}: permission denied. Check folder permissions or use Save As.`;
          if (command === "plugin:event|listen") {
            eventHandler = callbacks.get(
              (args as { handler: number }).handler,
            )!;
            return 1;
          }
          if (command === "plugin:event|unlisten") {
            eventHandler = null;
            return;
          }
          if (command === "take_document_close_request") {
            const pending = probe.closePending;
            probe.closePending = false;
            return pending;
          }
          if (command === "finish_document_close") {
            probe.closed++;
            return;
          }
          if (command === "choose_project") {
            probe.picks.push(args as { save: boolean; current?: string });
            if (probe.cancel) return null;
            probe.choice++;
            return {
              token: String(probe.choice),
              path: `/maps/café 地図 ${probe.choice}.tilewright`,
            };
          }
          if (command === "read_project")
            return new TextEncoder().encode(JSON.stringify(project)).buffer;
          if (command === "write_project") {
            probe.writes.push({
              token: options!.headers["x-project-token"],
              project: JSON.parse(new TextDecoder().decode(args as Uint8Array)),
            });
            if (probe.holdWrite)
              await new Promise<void>((resolve) => {
                probe.releaseWrite = resolve;
              });
            return null;
          }
          throw new Error(`Unexpected command ${command}`);
        },
      },
    });
  }, JSON.stringify(exampleProject));
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
});

async function request(page: Page, action: "new" | "open" | "close") {
  if (action === "close")
    await page.evaluate(() => window.fileProbe.requestClose());
  else if (action === "open")
    await page.getByRole("button", { name: "Open…", exact: true }).click();
  else {
    await page.getByRole("button", { name: "New map", exact: true }).click();
    const setup = page.getByRole("dialog", { name: "New map", exact: true });
    await setup.getByLabel("Width (tiles)").fill("101");
    await setup.getByLabel("Height (tiles)").fill("130");
    await setup.getByRole("button", { name: "Create map" }).click();
  }
  return page.getByRole("dialog", {
    name:
      action === "new"
        ? "Create another map"
        : action === "open"
          ? "Open another project"
          : "Close Tilewright",
    exact: true,
  });
}

for (const action of ["new", "open", "close"] as const) {
  for (const choice of [
    "save",
    "discard",
    "cancel",
    "failed-save",
    "canceled-save",
  ] as const) {
    test(`${action} UI: ${choice} through the shared workflow`, async ({
      page,
    }) => {
      const name = page.getByLabel("Layer name", { exact: true });
      await name.fill("Keep unsaved work");
      await name.press("Enter");
      const original = await page.locator("canvas").elementHandle();
      const dialog = await request(page, action);
      await expect(dialog).toBeVisible();
      await page.evaluate((choice) => {
        window.fileProbe.fail = choice === "failed-save" ? "write_project" : "";
        window.fileProbe.cancel = choice === "canceled-save";
      }, choice);
      await dialog
        .getByRole("button", {
          name:
            choice === "discard"
              ? "Discard changes"
              : choice === "cancel"
                ? "Cancel"
                : "Save and continue",
          exact: true,
        })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toBeEnabled();
      const success = choice === "save" || choice === "discard";
      if (!success) {
        await expect(name).toHaveValue("Keep unsaved work");
        await expect(page.locator(".document-title")).toContainText("Unsaved");
        expect(await original!.evaluate((canvas) => canvas.isConnected)).toBe(
          true,
        );
      } else if (action !== "close") {
        await expect(name).toHaveValue(
          action === "new" ? "Layer 1" : "Buildings",
        );
        await expect(page.getByTestId("map-dimensions")).toContainText(
          action === "new" ? "101 × 130" : "6400 × 6400",
        );
        expect(await original!.evaluate((canvas) => canvas.isConnected)).toBe(
          false,
        );
        await expect(page.locator("canvas")).toHaveCount(1);
        await expect
          .poll(() => page.evaluate(() => window.gpuProbe().contexts))
          .toBe(1);
        await expect(
          page.getByRole("button", { name: "Undo", exact: true }),
        ).toBeDisabled();
        if (action === "open") {
          await expect(
            page.getByRole("checkbox", { name: "Show active layer" }),
          ).not.toBeChecked();
          await expect(page.locator(".document-title")).not.toContainText(
            "Unsaved",
          );
        }
      }
      expect(await page.evaluate(() => window.fileProbe.closed)).toBe(
        action === "close" && success ? 1 : 0,
      );
      if (choice === "save")
        expect(
          await page.evaluate(
            () => window.fileProbe.writes[0].project.document.layers[0].name,
          ),
        ).toBe("Keep unsaved work");
      if (choice === "failed-save")
        await expect(
          page.getByRole("alert", { name: "Project file feedback" }),
        ).toContainText("permission denied");
    });
  }
}

test("save while editing updates only its checkpoint; undo is clean, redo dirty, and close during Save is prevented", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.holdWrite = true;
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.writes.length))
    .toBe(1);
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Edit during save");
  await name.press("Enter");
  await page.evaluate(() => window.fileProbe.requestClose());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.fileProbe.closed)).toBe(0);
  await page.evaluate(() => {
    window.fileProbe.releaseWrite!();
  });
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await page
    .getByRole("button", { name: "Undo Rename layer", exact: true })
    .click();
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await page
    .getByRole("button", { name: "Redo Rename layer", exact: true })
    .click();
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  const dialog = await request(page, "close");
  await expect(dialog).toBeVisible();
  await dialog.press("Escape");
  expect(await page.evaluate(() => window.fileProbe.closed)).toBe(0);
});

test("close requested before listener registration is protected, and native close errors retain the editor", async ({
  page,
}) => {
  await page.goto("/?pending-close");
  const dialog = page.getByRole("dialog", { name: "Close Tilewright" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    window.fileProbe.fail = "finish_document_close";
  });
  await request(page, "close");
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Document workflow feedback" }),
  ).toContainText("finish_document_close");
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(await page.evaluate(() => window.fileProbe.closed)).toBe(0);
});

declare global {
  interface Window {
    fileProbe: {
      cancel: boolean;
      fail: string;
      writes: { token: string; project: typeof exampleProject }[];
      picks: { save: boolean; current?: string }[];
      choice: number;
      closePending: boolean;
      closed: number;
      holdWrite: boolean;
      releaseWrite: (() => void) | null;
      requestClose(): void;
    };
  }
}

test("native adapter controls, text-focused Cmd+S, Save As cancellation/failure and successful Open", async ({
  page,
}) => {
  const title = page.locator(".document-title");
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Saved 地図");
  await name.press("Enter");
  await name.press("Meta+s");
  await expect(title).toContainText("café 地図 1.tilewright");
  await expect(title).toContainText("Saved");
  expect(
    await page.evaluate(
      () => window.fileProbe.writes[0].project.document.layers[0].name,
    ),
  ).toBe("Saved 地図");
  await name.fill("Unsaved work");
  await name.press("Enter");
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await page.getByRole("button", { name: "Save As…", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save As…", exact: true }),
  ).toBeEnabled();
  await expect(title).toContainText("café 地図 1.tilewright");
  await expect(title).toContainText("Unsaved");
  await page.evaluate(() => {
    window.fileProbe.cancel = false;
    window.fileProbe.fail = "write_project";
  });
  await name.press("Meta+Shift+s");
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("permission denied");
  await expect(title).toContainText("café 地図 1.tilewright");
  await expect(title).toContainText("Unsaved");
  await page.evaluate(() => {
    window.fileProbe.fail = "";
  });
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Meta+s");
  await expect(title).not.toContainText("Unsaved");
  expect(await page.evaluate(() => window.fileProbe.writes.at(-1)!.token)).toBe(
    "1",
  );
  await page.getByRole("button", { name: "Save As…", exact: true }).click();
  await expect(title).toContainText("café 地図 3.tilewright");
  await name.press("Meta+o");
  await expect(title).toContainText("café 地図 4.tilewright");
  await expect(page.getByTestId("map-dimensions")).toContainText("6400 × 6400");
  await expect(name).toHaveValue("Buildings");
  await expect(
    page.getByRole("checkbox", { name: "Show active layer" }),
  ).not.toBeChecked();
  await expect(page.locator("canvas")).toHaveCount(1);
});

test("Open cancellation/read errors preserve map; dirty Open can be declined; controls fit narrow windows", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const title = page.locator(".document-title");
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open…", exact: true }),
  ).toBeEnabled();
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.evaluate(() => {
    window.fileProbe.cancel = false;
    window.fileProbe.fail = "read_project";
  });
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("read_project");
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue(
    "Layer 1",
  );
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.getByLabel("Layer name", { exact: true }).fill("Keep unsaved");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Open another project",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue(
    "Keep unsaved",
  );
  expect(await page.evaluate(() => window.fileProbe.picks.length)).toBe(3);
  await page.setViewportSize({ width: 640, height: 480 });
  await expect(
    page.getByRole("button", { name: "Save As…", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
});
