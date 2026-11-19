import { expect, test } from "@playwright/test";
import { exampleProject } from "./fixtures/project";

// Exercise the shipping UI and Tauri adapter; only OS IPC/dialogs are substituted.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((projectText: string) => {
    const project = JSON.parse(projectText) as typeof exampleProject;
    const probe = {
      cancel: false,
      fail: "",
      writes: [] as { token: string; project: typeof project }[],
      picks: [] as { save: boolean; current?: string }[],
      choice: 0,
    };
    Object.assign(window, {
      isTauri: true,
      fileProbe: probe,
      __TAURI_INTERNALS__: {
        async invoke(
          command: string,
          args: unknown,
          options?: { headers: Record<string, string> },
        ) {
          if (probe.fail === command)
            throw `Could not ${command}: permission denied. Check folder permissions or use Save As.`;
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

declare global {
  interface Window {
    fileProbe: {
      cancel: boolean;
      fail: string;
      writes: { token: string; project: typeof exampleProject }[];
      picks: { save: boolean; current?: string }[];
      choice: number;
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
