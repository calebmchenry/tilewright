import { expect, test, type Page } from "@playwright/test";
import { exampleProject } from "./fixtures/project";
import type { RecoveryCapture, RecoveryTicket } from "../src/editor/recovery";
import { createHash, randomUUID } from "node:crypto";
import type {
  RecoveryEntry,
  RecoverySelection,
} from "../src/editor/recovery-discovery";
type RecoveryFixture = {
  entry: RecoveryEntry;
  project: typeof exampleProject;
  original: typeof exampleProject | null;
};
import { trackGpu } from "./gpu";

// Exercise the shipping UI and Tauri adapter; only OS IPC/dialogs are substituted.
test.beforeEach(async ({ page }) => {
  await trackGpu(page);
  await page.addInitScript((projectText: string) => {
    const project = JSON.parse(projectText) as typeof exampleProject;
    const probe = {
      recoveryEntries: JSON.parse(
        sessionStorage.getItem("test-recovery") ?? "[]",
      ) as RecoveryFixture[],
      recoveryDiscards: [] as string[],
      recoveries: [] as { capture: RecoveryCapture; project: typeof project }[],
      recoveryControls: [] as {
        status: string;
        documentId: string;
        epoch: number;
      }[],
      exportPicks: [] as {
        protectedPath: string | null;
        suggestedName: string;
      }[],
      exports: [] as string[],
      pendingExport: null as string | null,
      holdExport: false,
      releaseExport: null as (() => void) | null,
      canceledExports: 0,
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
      requestAction: (_id: string) => {},
      menu: [] as { id: string; label: string; enabled: boolean }[],
      textEdits: [] as string[],
      readSaved: false,
    };
    const eventHandlers = new Map<
      string,
      (event: { payload: string }) => void
    >();
    const callbacks = new Map<number, (event: { payload: string }) => void>();
    let callbackId = 0;
    let pendingRecovery: {
      capture: RecoveryCapture;
      project: typeof project;
    } | null = null;
    probe.requestClose = () => {
      probe.closePending = true;
      eventHandlers.get("document-close-requested")?.({ payload: "" });
    };
    probe.requestAction = (id) =>
      eventHandlers.get("application-action")?.({ payload: id });
    Object.assign(window, {
      isTauri: true,
      fileProbe: probe,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: { payload: string }) => void) {
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
          if (command === "discover_recovery")
            return {
              entries: probe.recoveryEntries.map((r) => r.entry),
              warnings: [],
            };
          if (command === "read_recovery") {
            const { selection, source } = args as {
              selection: RecoverySelection;
              source: boolean;
            };
            const record = probe.recoveryEntries.find(
              (r) => r.entry.documentId === selection.documentId,
            )!;
            if (source && !record.original)
              throw new Error("Original file is missing");
            return new TextEncoder().encode(
              JSON.stringify(source ? record.original : record.project),
            ).buffer;
          }
          if (command === "claim_recovery" || command === "release_recovery") {
            const { selection, documentId } = args as {
              selection?: RecoverySelection;
              documentId?: string;
            };
            const record = probe.recoveryEntries.find(
              (r) =>
                r.entry.documentId === (selection?.documentId ?? documentId),
            )!;
            record.entry = {
              ...record.entry,
              current: command === "claim_recovery",
            };
            return;
          }
          if (command === "discard_recovery") {
            const { documentId } = args as { documentId: string };
            probe.recoveryDiscards.push(documentId);
            probe.recoveryEntries = probe.recoveryEntries.filter(
              (r) => r.entry.documentId !== documentId,
            );
            return null;
          }
          if (command === "initialize_recovery") return;
          if (command === "control_recovery") {
            probe.recoveryControls.push(
              (args as { control: (typeof probe.recoveryControls)[number] })
                .control,
            );
            return null;
          }
          if (command === "prepare_recovery") {
            pendingRecovery = {
              capture: JSON.parse(options!.headers["x-recovery-capture"]),
              project: JSON.parse(new TextDecoder().decode(args as Uint8Array)),
            };
            return {
              ...pendingRecovery.capture,
              sequence: probe.recoveries.length + 1,
            };
          }
          if (command === "commit_recovery") {
            const ticket = (args as { ticket: RecoveryTicket }).ticket;
            if (
              !pendingRecovery ||
              pendingRecovery.capture.epoch !== ticket.epoch
            )
              throw new Error("Stale recovery");
            probe.recoveries.push(pendingRecovery);
            pendingRecovery = null;
            return null;
          }
          if (command === "cancel_recovery") {
            pendingRecovery = null;
            return;
          }
          if (command === "plugin:event|listen") {
            const { event, handler } = args as {
              event: string;
              handler: number;
            };
            eventHandlers.set(event, callbacks.get(handler)!);
            return 1;
          }
          if (command === "plugin:event|unlisten") {
            eventHandlers.delete((args as { event: string }).event);
            return;
          }
          if (command === "update_application_menu") {
            probe.menu = (args as { items: typeof probe.menu }).items;
            return;
          }
          if (command === "edit_focused_text") {
            const action = (args as { action: string }).action;
            probe.textEdits.push(action);
            document.execCommand(action); // Native responder is verified separately in the packaged app.
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
          if (command === "choose_agent_export") {
            probe.exportPicks.push(
              args as { protectedPath: string | null; suggestedName: string },
            );
            return probe.cancel
              ? null
              : { token: "agent-1", path: "/maps/café 地図.agent-map.json" };
          }
          if (command === "prepare_agent_export") {
            if (options?.headers["x-export-token"] !== "agent-1")
              throw new Error("Wrong export handle");
            probe.pendingExport = new TextDecoder().decode(args as Uint8Array);
            if (probe.holdExport)
              await new Promise<void>((resolve) => {
                probe.releaseExport = resolve;
              });
            return;
          }
          if (command === "commit_agent_export") {
            if (!probe.pendingExport) throw new Error("Export not prepared");
            probe.exports.push(probe.pendingExport);
            probe.pendingExport = null;
            return null;
          }
          if (command === "cancel_agent_export") {
            probe.canceledExports++;
            probe.pendingExport = null;
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
            return new TextEncoder().encode(
              JSON.stringify(
                probe.readSaved ? probe.writes.at(-1)!.project : project,
              ),
            ).buffer;
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
    await page.locator(".canvas-host").press("Meta+o");
  else {
    await page.locator(".canvas-host").press("Meta+n");
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
      await expect
        .poll(() => menuState(page, "save"))
        .toMatchObject({ enabled: true });
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
        await expect
          .poll(() => menuState(page, "undo"))
          .toMatchObject({ enabled: false });
        if (action === "open") {
          await expect(
            page.locator(
              '.layer-row[data-active="true"] .layer-visibility-button',
            ),
          ).toHaveAttribute("aria-pressed", "false");
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
  await page.locator(".canvas-host").press("Meta+s");
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
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await page.locator(".canvas-host").press("Meta+z");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await page.locator(".canvas-host").press("Meta+Shift+z");
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
      recoveryEntries: RecoveryFixture[];
      recoveryDiscards: string[];
      recoveries: {
        capture: RecoveryCapture;
        project: typeof exampleProject;
      }[];
      recoveryControls: { status: string; documentId: string; epoch: number }[];
      exportPicks: { protectedPath: string | null; suggestedName: string }[];
      exports: string[];
      pendingExport: string | null;
      holdExport: boolean;
      releaseExport: (() => void) | null;
      canceledExports: number;
      cancel: boolean;
      fail: string;
      writes: { token: string; project: typeof exampleProject }[];
      picks: { save: boolean; current?: string; suggestedName?: string }[];
      choice: number;
      closePending: boolean;
      closed: number;
      holdWrite: boolean;
      releaseWrite: (() => void) | null;
      requestClose(): void;
      requestAction(id: string): void;
      menu: { id: string; label: string; enabled: boolean }[];
      textEdits: string[];
      readSaved: boolean;
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
  await page.locator(".canvas-host").press("Meta+Shift+s");
  await expect
    .poll(() => menuState(page, "save-as"))
    .toMatchObject({ enabled: true });
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
  await page.locator(".canvas-host").press("Meta+Shift+s");
  await expect(title).toContainText("café 地図 3.tilewright");
  await name.press("Meta+o");
  await expect(title).toContainText("café 地図 4.tilewright");
  await expect(page.getByTestId("map-dimensions")).toContainText("6400 × 6400");
  await expect(name).toHaveValue("Buildings");
  await expect(
    page.locator('.layer-row[data-active="true"] .layer-visibility-button'),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator(".canvas-host")).toBeFocused();
});

test("Open cancellation/read errors preserve map; dirty Open can be declined; controls fit narrow windows", async ({
  page,
}) => {
  await page.locator(".canvas-host").press("Meta+s");
  const title = page.locator(".document-title");
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await page.locator(".canvas-host").press("Meta+o");
  await expect
    .poll(() => menuState(page, "open"))
    .toMatchObject({ enabled: true });
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.evaluate(() => {
    window.fileProbe.cancel = false;
    window.fileProbe.fail = "read_project";
  });
  await page.locator(".canvas-host").press("Meta+o");
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("read_project");
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue(
    "Layer 1",
  );
  await expect(title).toContainText("café 地図 1.tilewright");
  await page.getByLabel("Layer name", { exact: true }).fill("Keep unsaved");
  await page.getByLabel("Layer name", { exact: true }).press("Enter");
  await page.locator(".canvas-host").press("Meta+o");
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
  await expect
    .poll(() => menuState(page, "save-as"))
    .toMatchObject({ enabled: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
});

async function menuAction(page: Page, id: string) {
  await page.evaluate((id) => window.fileProbe.requestAction(id), id);
}
async function menuState(page: Page, id: string) {
  return page.evaluate(
    (id) => window.fileProbe.menu.find((item) => item.id === id),
    id,
  );
}

test("native New, draw, Cmd+S, edit, menu Save, Open round trip and one history action per invocation", async ({
  page,
}) => {
  await menuAction(page, "new");
  await page
    .getByRole("dialog", { name: "New map", exact: true })
    .getByRole("button", { name: "Create map" })
    .click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  const canvas = page.locator(".canvas-host");
  await canvas.click({ position: { x: 60, y: 60 } });
  await expect
    .poll(() => menuState(page, "undo"))
    .toMatchObject({ label: "Undo Pencil", enabled: true });
  await canvas.press("Meta+s");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  const first = await page.evaluate(() => window.fileProbe.writes[0].project);
  expect(first.document.layers[0].runs.length).toBeGreaterThan(0);
  await canvas.click({ position: { x: 108, y: 60 } });
  await menuAction(page, "undo");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await canvas.press("Meta+Shift+z");
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await menuAction(page, "save");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  const saved = await page.evaluate(
    () => window.fileProbe.writes.at(-1)!.project,
  );
  expect(saved.document.layers[0].runs).not.toEqual(
    first.document.layers[0].runs,
  );
  expect(await page.evaluate(() => window.fileProbe.picks)).toEqual([
    { save: true },
  ]);
  await page.evaluate(() => {
    window.fileProbe.readSaved = true;
  });
  await menuAction(page, "open");
  await expect(page.locator(".document-title")).toContainText(
    "café 地図 2.tilewright",
  );
  // The session is visible while the successful-open recovery receipt finishes.
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
  await menuAction(page, "save");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.writes.length))
    .toBe(3);
  expect(
    await page.evaluate(() => window.fileProbe.writes.at(-1)!.project),
  ).toEqual(saved);
  await expect
    .poll(() => menuState(page, "undo"))
    .toMatchObject({ enabled: false });
});

test("menu and shortcut save spam starts one native picker/write, and menu cancellation/failure retains dirty work", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.holdWrite = true;
  });
  await menuAction(page, "save");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.writes.length))
    .toBe(1);
  await page.keyboard.press("Meta+s");
  await menuAction(page, "save-as");
  await menuAction(page, "save");
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: false });
  expect(await page.evaluate(() => window.fileProbe.picks.length)).toBe(1);
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(1);
  await page.evaluate(() => {
    window.fileProbe.holdWrite = false;
    window.fileProbe.releaseWrite!();
  });
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await page.getByLabel("Layer name", { exact: true }).fill("Still unsaved");
  await page.getByLabel("Layer name", { exact: true }).press("Enter");
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await menuAction(page, "save-as");
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await page.evaluate(() => {
    window.fileProbe.cancel = false;
    window.fileProbe.fail = "write_project";
  });
  await menuAction(page, "save");
  await expect(
    page.getByRole("alert", { name: "Project file feedback" }),
  ).toContainText("permission denied");
  await expect(page.locator(".document-title")).toContainText("Unsaved");
});

test("canvas menu clipboard shares keyboard placement; name, description and modal focus isolate map actions", async ({
  page,
}) => {
  const canvas = page.locator(".canvas-host");
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  await canvas.click({ position: { x: 60, y: 60 } });
  await canvas.press("v");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 75);
  await page.mouse.up();
  await expect
    .poll(() => menuState(page, "copy"))
    .toMatchObject({ enabled: true });
  await menuAction(page, "copy");
  await expect
    .poll(() => menuState(page, "paste"))
    .toMatchObject({ enabled: true });
  await menuAction(page, "cut");
  await expect
    .poll(() => menuState(page, "undo"))
    .toMatchObject({ label: "Undo Cut" });
  await canvas.press("Meta+z");
  await menuAction(page, "paste");
  await canvas.press("ArrowRight");
  await canvas.press("Enter");
  await expect
    .poll(() => menuState(page, "undo"))
    .toMatchObject({ label: "Undo Paste" });
  await menuAction(page, "save");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  const selected = await page.getByTestId("selection-bounds").textContent();
  const name = page.getByLabel("Layer name", { exact: true });
  await name.focus();
  for (const key of [
    "ArrowRight",
    "Meta+c",
    "Meta+x",
    "Meta+v",
    "Meta+z",
    "Meta+Shift+z",
  ])
    await name.press(key);
  await menuAction(page, "undo");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.textEdits.at(-1)))
    .toBe("undo");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  expect(await page.getByTestId("selection-bounds").textContent()).toBe(
    selected,
  );
  await page.getByRole("button", { name: "New area", exact: true }).click();
  const description = page.getByLabel("Description", { exact: true });
  await description.fill("Text draft");
  await description.press("ArrowLeft");
  for (const id of ["undo", "redo", "copy", "cut", "paste"])
    await menuAction(page, id);
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await description.press("Meta+n");
  const dialog = page.getByRole("dialog", { name: "New map", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Width (tiles)").press("ArrowRight");
  await menuAction(page, "copy");
  await menuAction(page, "save");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  for (const id of ["undo", "cut", "paste", "save", "open", "new"])
    await menuAction(page, id);
  await dialog.press("Meta+s");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(1);
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  await dialog.press("Escape");
});

test("recovery checkpoints untitled and saved edits through binary IPC without writing the explicit file", async ({
  page,
}) => {
  await page
    .getByLabel("Layer name", { exact: true })
    .fill("Untitled recovered");
  await page.getByLabel("Layer name", { exact: true }).press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.recoveries.length))
    .toBe(1);
  const first = await page.evaluate(() => window.fileProbe.recoveries[0]);
  expect(first.capture.saved).toBeNull();
  expect(first.project.document.layers[0].name).toBe("Untitled recovered");
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(0);
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await page.locator(".canvas-host").press("Meta+s");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  const saved = await page.evaluate(() =>
    JSON.stringify(window.fileProbe.writes),
  );
  await page
    .getByLabel("Layer name", { exact: true })
    .fill("Later unsaved 地図");
  await page.getByLabel("Layer name", { exact: true }).press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.recoveries.length), {
      timeout: 10000,
    })
    .toBe(2);
  const second = await page.evaluate(() => window.fileProbe.recoveries[1]);
  expect(second.capture.documentId).toBe(first.capture.documentId);
  expect(second.capture.saved?.path).toBe("/maps/café 地図 1.tilewright");
  expect(second.capture.saved?.byteHash).toMatch(/^[a-f0-9]{64}$/);
  expect(second.project.document.layers[0].name).toBe("Later unsaved 地図");
  expect(
    await page.evaluate(() => JSON.stringify(window.fileProbe.writes)),
  ).toBe(saved);
  await expect(
    page.getByRole("status", { name: "Recovery feedback" }),
  ).toContainText("Last capture");
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  await page.setViewportSize({ width: 640, height: 480 });
  await expect(
    page.getByRole("status", { name: "Recovery feedback" }),
  ).toBeVisible();
});

test("recovery failure remains visible with Retry while explicit Save stays available", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.fail = "prepare_recovery";
  });
  await expect(
    page.getByRole("alert", { name: "Recovery feedback" }),
  ).toContainText("permission denied");
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
  expect(await page.evaluate(() => window.fileProbe.recoveries.length)).toBe(0);
  await page.evaluate(() => {
    window.fileProbe.fail = "";
  });
  await page
    .getByRole("button", { name: "Retry recovery", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.recoveries.length), {
      timeout: 10000,
    })
    .toBe(1);
  await expect(
    page.getByRole("status", { name: "Recovery feedback" }),
  ).toContainText("checkpoint ready");
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(0);
  await expect(page.locator(".document-title")).toContainText("Unsaved");
});

function recoveryFixture(
  source: string | null,
  original: typeof exampleProject | null = null,
): RecoveryFixture {
  const project = structuredClone(exampleProject);
  const sha256 = createHash("sha256")
    .update(JSON.stringify(project))
    .digest("hex");
  const saved = source
    ? {
        path: source,
        savedAt: Date.now() - 15000,
        byteHash: "0".repeat(64),
        canonicalHash: "0".repeat(64),
      }
    : null;
  const documentId = randomUUID();
  return {
    project,
    original,
    entry: {
      documentId,
      saved,
      error: null,
      discardable: true,
      current: false,
      generations: [
        {
          sequence: 3,
          error: null,
          metadata: {
            format: "tilewright-recovery",
            version: 1,
            documentId,
            writerId: randomUUID(),
            epoch: 6,
            sequence: 3,
            capturedAt: Date.now() - 10000,
            completedAt: Date.now() - 9000,
            historyRevision: 1,
            documentVersion: 15,
            savedRevision: 8,
            dirty: true,
            displayName: source?.split("/").at(-1) ?? "Untitled",
            saved,
            projectFormat: "tilewright-project",
            projectVersion: 1,
            byteLength: Buffer.byteLength(JSON.stringify(project)),
            sha256,
          },
        },
      ],
    },
  };
}
async function seedRecovery(page: Page, fixtures: RecoveryFixture[]) {
  await page.evaluate(
    (fixtures) => sessionStorage.setItem("test-recovery", fixtures),
    JSON.stringify(fixtures),
  );
  await page.reload();
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
}

test("startup recovery offers corrupt fallback, guards restore and saves exact captured content only after a picker", async ({
  page,
}) => {
  const fixture = recoveryFixture("/missing/café 地図.tilewright");
  fixture.entry = {
    ...fixture.entry,
    generations: [
      { sequence: 4, metadata: null, error: "Recovery checksum mismatch" },
      ...fixture.entry.generations,
    ],
  };
  await seedRecovery(page, [fixture]);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("older fallback");
  await expect(dialog).toContainText("Original file is missing");
  await dialog.getByRole("button", { name: "Restore as unsaved copy" }).click();
  await expect(
    page.getByRole("dialog", { name: "Restore recovered map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Restore as unsaved copy" }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".document-title")).toContainText(
    "Recovered — café 地図.tilewright",
  );
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  expect(await page.evaluate(() => window.fileProbe.writes)).toEqual([]);
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("button", { name: "Review recovery…" }).click();
  await expect(dialog).toContainText("Currently open");
  await expect(
    dialog.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Discard recovery…" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await page.locator(".canvas-host").press("Meta+s");
  await expect(page.locator(".document-title")).not.toContainText("Unsaved");
  const written = await page.evaluate(() => ({
    project: window.fileProbe.writes[0].project,
    pick: window.fileProbe.picks[0],
  }));
  expect(written.project).toEqual(fixture.project);
  expect(written.pick.current).toBeUndefined();
  expect(written.pick.suggestedName).toBe("café 地図 (Recovered).tilewright");
});

test("stale recovery is reviewable without prompting and Escape keeps it at narrow size", async ({
  page,
}) => {
  await seedRecovery(page, [
    recoveryFixture("/maps/already-saved.tilewright", exampleProject),
  ]);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(
    page.getByRole("button", { name: "More options", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 640, height: 480 });
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("button", { name: "Review recovery…" }).click();
  await expect(dialog).toContainText("Already matches saved file");
  const size = await dialog.boundingBox();
  expect(size!.x).toBeGreaterThanOrEqual(0);
  expect(size!.x + size!.width).toBeLessThanOrEqual(640);
  await dialog.getByRole("button", { name: "Not now" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => window.fileProbe.recoveryEntries.length),
  ).toBe(1);
  expect(await page.evaluate(() => window.fileProbe.recoveryDiscards)).toEqual(
    [],
  );
});

test("multiple same-source maps remain distinct and corrupt recovery discard is named, confirmed and scoped", async ({
  page,
}) => {
  const first = recoveryFixture("/maps/shared.tilewright"),
    second = recoveryFixture("/maps/shared.tilewright"),
    bad = recoveryFixture(null);
  bad.entry = {
    ...bad.entry,
    generations: [
      { sequence: 1, metadata: null, error: "Unsupported recovery metadata" },
    ],
  };
  await seedRecovery(page, [first, second, bad]);
  const dialog = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(dialog).toContainText("2 separate maps with this source");
  const row = dialog.getByRole("article", {
    name: `Unavailable recovery — ${bad.entry.documentId}`,
  });
  await expect(
    row.getByRole("button", { name: "Restore as unsaved copy" }),
  ).toBeDisabled();
  await row.getByRole("button", { name: "Discard recovery…" }).click();
  await expect(row).toContainText(bad.entry.documentId);
  await expect(row).toContainText(
    "The saved project and other recovery maps will remain",
  );
  await row.getByRole("button", { name: "Keep recovery" }).click();
  expect(await page.evaluate(() => window.fileProbe.recoveryDiscards)).toEqual(
    [],
  );
  await row.getByRole("button", { name: "Discard recovery…" }).click();
  await row.getByRole("button", { name: "Discard this recovery" }).click();
  await expect(row).toBeHidden();
  expect(await page.evaluate(() => window.fileProbe.recoveryDiscards)).toEqual([
    bad.entry.documentId,
  ]);
  await expect(dialog.getByRole("article")).toHaveCount(2);
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(0);
});

test("agent export includes unsaved edits and retains explicit save, path and recovery data", async ({
  page,
}) => {
  await page.locator(".canvas-host").press("Meta+s");
  await expect(page.locator(".document-title")).toContainText("Saved");
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Unsaved export layer");
  await name.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.recoveries.length), {
      timeout: 12000,
    })
    .toBeGreaterThan(0);
  const before = await page.evaluate(() =>
    JSON.stringify({
      writes: window.fileProbe.writes,
      recoveries: window.fileProbe.recoveries,
      controls: window.fileProbe.recoveryControls,
    }),
  );
  await page.locator(".canvas-host").press("Meta+Shift+e");
  await expect(
    page.getByRole("status", { name: "Agent export feedback" }),
  ).toContainText("Exported the whole map");
  const exported = await page.evaluate(() =>
    JSON.parse(window.fileProbe.exports[0]),
  );
  expect(exported.format).toBe("tilewright-agent-map");
  expect(exported.layers[0].name).toBe("Unsaved export layer");
  expect(await page.evaluate(() => window.fileProbe.exportPicks[0])).toEqual({
    protectedPath: "/maps/café 地図 1.tilewright",
    suggestedName: "café 地図 1.agent-map.json",
  });
  await expect(page.locator(".document-title")).toContainText(
    "café 地図 1.tilewright",
  );
  await expect(page.locator(".document-title")).toContainText("Unsaved");
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        writes: window.fileProbe.writes,
        recoveries: window.fileProbe.recoveries,
        controls: window.fileProbe.recoveryControls,
      }),
    ),
  ).toBe(before);
  await page.setViewportSize({ width: 640, height: 480 });
  await expect
    .poll(() => menuState(page, "export-agent"))
    .toMatchObject({ enabled: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
});

test("agent export progress stays interactive, gates file actions and cancels prepared output", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.holdExport = true;
    window.fileProbe.requestAction("export-agent");
  });
  const feedback = page.getByRole("status", { name: "Agent export feedback" });
  await expect(feedback).toContainText("temporary file");
  await expect(
    page.getByRole("progressbar", { name: "Agent export progress" }),
  ).toBeVisible();
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: false });
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Edited while exporting");
  await name.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.fileProbe.recoveries.length), {
      timeout: 12000,
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    window.fileProbe.requestClose();
    window.fileProbe.requestAction("save");
  });
  expect(await page.evaluate(() => window.fileProbe.closed)).toBe(0);
  expect(await page.evaluate(() => window.fileProbe.writes.length)).toBe(0);
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(feedback).toContainText("Canceling");
  await page.evaluate(() => window.fileProbe.releaseExport!());
  await expect(feedback).toContainText("Export canceled");
  expect(await page.evaluate(() => window.fileProbe.exports.length)).toBe(0);
  expect(await page.evaluate(() => window.fileProbe.pendingExport)).toBeNull();
  expect(await page.evaluate(() => window.fileProbe.canceledExports)).toBe(1);
  await expect(name).toHaveValue("Edited while exporting");
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
});

test("agent export shortcut, canceled picker, failed write and retry give distinct feedback", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await page.getByLabel("Layer name", { exact: true }).press("Meta+Shift+e");
  await expect(
    page.getByRole("status", { name: "Agent export feedback" }),
  ).toContainText("Export canceled");
  expect(await page.evaluate(() => window.fileProbe.exports.length)).toBe(0);
  await page.evaluate(() => {
    window.fileProbe.cancel = false;
    window.fileProbe.fail = "prepare_agent_export";
  });
  await page.locator(".canvas-host").press("Meta+Shift+e");
  await expect(
    page.getByRole("alert", { name: "Agent export feedback" }),
  ).toContainText("permission denied");
  expect(await page.evaluate(() => window.fileProbe.exports.length)).toBe(0);
  await page.evaluate(() => {
    window.fileProbe.fail = "";
  });
  await page.locator(".canvas-host").press("Meta+Shift+e");
  await expect(
    page.getByRole("status", { name: "Agent export feedback" }),
  ).toContainText("Exported the whole map");
  expect(await page.evaluate(() => window.fileProbe.exports.length)).toBe(1);
  await expect(page.locator(".document-title")).toContainText("Unsaved");
});

test("Escape cancels export from panel focus while text and modal Escape remain local", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fileProbe.holdExport = true;
    window.fileProbe.requestAction("export-agent");
  });
  const feedback = page.getByRole("status", { name: "Agent export feedback" });
  await expect(feedback).toContainText("temporary file");
  const name = page.getByLabel("Layer name", { exact: true });
  await name.press("Escape");
  await expect(feedback).toContainText("temporary file");
  await page.getByRole("button", { name: "Grow canvas", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Grow canvas", exact: true });
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(feedback).toContainText("temporary file");
  await page.setViewportSize({ width: 640, height: 452 });
  const cancel = page.getByRole("button", {
    name: "Cancel export",
    exact: true,
  });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  await cancel.press("Escape");
  await expect(feedback).toContainText("Canceling");
  await page.evaluate(() => window.fileProbe.releaseExport!());
  await expect(feedback).toContainText("Export canceled");
  await expect(page.locator(".canvas-host")).toBeFocused();
  expect(await page.evaluate(() => window.fileProbe.exports)).toEqual([]);
  expect(await page.evaluate(() => window.fileProbe.writes)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
});

test("New and recovery dismissal restore their opener without background map edits", async ({
  page,
}) => {
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Long layer name ".repeat(20));
  await name.press("Enter");
  await page.setViewportSize({ width: 640, height: 452 });
  await name.press("Meta+n");
  const dialog = page.getByRole("dialog", { name: "New map", exact: true });
  await dialog.getByLabel("Width (tiles)").press("Escape");
  await expect(name).toBeFocused();
  const review = page.getByRole("button", { name: "Review recovery…" });
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await review.click();
  const recovery = page.getByRole("dialog", { name: "Recover unsaved work" });
  await recovery.press("Escape");
  await expect(
    page.getByRole("button", { name: "More options", exact: true }),
  ).toBeFocused();
  for (const action of ["new", "open", "save", "save-as", "export-agent"]) {
    await expect
      .poll(() => menuState(page, action))
      .toMatchObject({ enabled: true });
  }
  for (const title of [
    "New map",
    "Open…",
    "Save",
    "Save As…",
    "Export for Agent…",
  ]) {
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
  expect(
    (await page.locator(".canvas-host").boundingBox())!.height,
  ).toBeGreaterThan(75);
  expect(await page.evaluate(() => window.fileProbe.writes)).toEqual([]);
});

test("compact chrome keeps one-line coordinates, save time and keyboard recovery access", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await expect(page.locator("header")).toHaveCSS("height", "36px");
  await expect(page.locator("footer")).toHaveCSS("height", "28px");
  await expect(page.locator("header").getByRole("button")).toHaveCount(1);
  await expect(page.locator("footer")).not.toContainText(
    /Recovery|chunk =|Undo|Rectangle/,
  );
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await page.locator(".canvas-host").press("Meta+s");
  await expect(page.getByTestId("save-timestamp")).toContainText("Saved");
  const saved = await page.getByTestId("save-timestamp").textContent();
  await page.evaluate(() => {
    window.fileProbe.cancel = true;
  });
  await page.locator(".canvas-host").press("Meta+Shift+s");
  await expect
    .poll(() => menuState(page, "save"))
    .toMatchObject({ enabled: true });
  await expect(page.getByTestId("save-timestamp")).toHaveText(saved!);
  const more = page.getByRole("button", { name: "More options", exact: true });
  await more.focus();
  await more.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  const review = page.getByRole("button", { name: "Review recovery…" });
  await expect(review).toBeFocused();
  await review.press("Enter");
  await page
    .getByRole("dialog", { name: "Recover unsaved work" })
    .press("Escape");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(review).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("compact-chrome.png") });
});
