import { expect, test } from "@playwright/test";

// Shipping entry, real WebGL and no Tauri globals, IPC mocks or editor harness.
test("browser startup and editing never load native services", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(
    false,
  );
  await expect(page.locator(".app-header")).not.toHaveClass(/native-titlebar/);
  await expect(
    page.getByRole("button", { name: "More options", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("status", { name: "Browser availability" }),
  ).toContainText("Recovery stays in this browser");
  await expect(
    page.getByRole("status", { name: "Browser availability" }),
  ).toHaveCSS("clip", "auto");
  const host = page.locator(".canvas-host");
  await host.press("b");
  await expect(
    page.getByRole("button", { name: "Pencil", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(1, 1);
  const canvas = host.locator("canvas");
  const pixels = await canvas.screenshot();
  await host.click({ position: { x: 100, y: 100 } });
  await page.mouse.move(1, 1);
  await expect
    .poll(async () => (await canvas.screenshot()).equals(pixels))
    .toBe(false);
  await host.press("Control+z");
  await page.mouse.move(1, 1);
  await expect
    .poll(async () => (await canvas.screenshot()).equals(pixels))
    .toBe(true);
  const download = page.waitForEvent("download");
  await host.press("Control+s");
  expect((await download).suggestedFilename()).toBe("Untitled.tilewright");
  await expect(
    page.getByRole("status", { name: "Project file feedback" }),
  ).toContainText("Download requested");
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
  await host.press("Control+n");
  await page.getByRole("button", { name: "Create map", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Create another map" });
  await expect(
    prompt.getByRole("button", { name: "Download project and stay" }),
  ).toBeEnabled();
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(canvas).toBeVisible();
  expect(
    requests.filter((url) =>
      /\/src\/native\/|\/platform\/tauri|\/assets\/tauri-|^ipc:|ipc\.localhost/.test(
        url,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("browser-platform.png") });
});
