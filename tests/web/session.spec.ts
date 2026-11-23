import type { Page } from "@playwright/test";
import type { ProjectV1 } from "../../src/domain/project-format";
import {
  test,
  expect,
  button,
  host,
  start,
  rename,
  project,
  download,
  open,
  compareAgent,
  checkpoint,
  replace,
} from "./support";

// Fit and the zoom selector preserve the map center. Derive pointer coordinates
// from the DOM size and public 24px/tile scale, never a shipping editor test hook.
async function point(page: Page, x: number, y: number) {
  const box = (await host(page).boundingBox())!;
  await page.mouse.move(
    box.x + box.width / 2 + (x + 0.5 - 64) * 24,
    box.y + box.height / 2 + (y + 0.5 - 64) * 24,
  );
  await expect(page.getByTestId("coordinate-readout")).toHaveText(
    `Tile ${x}, ${y}`,
  );
}
async function drag(page: Page, x: number, y: number, endX = x, endY = y) {
  await point(page, x, y);
  await page.mouse.down();
  await point(page, endX, endY);
  await page.mouse.up();
}
function cells(project: ProjectV1, layerName: string) {
  const layer = project.document.layers.find((l) => l.name === layerName)!;
  const result: Record<string, unknown> = {};
  for (const [x, y, length, paint] of layer.runs)
    for (let i = 0; i < length; i++)
      result[`${x + i},${y}`] = project.document.palette[paint];
  return result;
}
async function area(page: Page, name: string, tier: string, bounds: number[]) {
  await button(page, "New area").click();
  await page.getByLabel("Area name", { exact: true }).fill(name);
  await page
    .getByLabel("Description", { exact: true })
    .fill(`${name} — 家\nA complete description.`);
  await page.getByLabel("Tier", { exact: true }).selectOption(tier);
  for (const [index, label] of [
    "Minimum X",
    "Minimum Y",
    "Maximum X",
    "Maximum Y",
  ].entries())
    await page.getByLabel(label, { exact: true }).fill(String(bounds[index]));
  await button(page, "Apply area").click();
  await button(page, "Deselect area").click();
}

test("complete production session: author, move chosen layers, transform, recolor, reopen and recover", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await start(page);
  await button(page, "New map").click();
  await page.getByLabel("Width (tiles)").fill("128");
  await page.getByLabel("Height (tiles)").fill("128");
  await button(page, "Create map").click();
  await replace(page);
  await expect(page.getByTestId("map-dimensions")).toContainText(
    "128 × 128 tiles",
  );
  await button(page, "Fit map").click();
  await page.getByLabel("Zoom", { exact: true }).selectOption("1");
  await rename(page, "Terrain");
  await page.getByLabel("Hex color", { exact: true }).fill("#335c46");
  await host(page).press("r");
  await drag(page, 56, 56, 74, 74);
  await button(page, "Register color").click();
  const dialog = page.getByRole("dialog", {
    name: "Register color",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Grass");
  await dialog
    .getByRole("button", { name: "Register color", exact: true })
    .click();
  await drag(page, 60, 60, 67, 67);
  await button(page, "Add layer").click();
  await rename(page, "Walls");
  await page.getByLabel("Hex color", { exact: true }).fill("#112233");
  await page.getByLabel("Rectangle style").selectOption("outline");
  await drag(page, 60, 60, 67, 67);
  await host(page).press("g");
  await page.getByLabel("Hex color", { exact: true }).fill("#998877");
  await drag(page, 62, 62);
  await expect(
    page.getByRole("status", { name: "Action feedback" }),
  ).toContainText("Fill");
  await host(page).press("e");
  await drag(page, 63, 67);
  await host(page).press("l");
  await drag(page, 60, 59, 64, 57);
  await host(page).press("b");
  await page.getByLabel("Pencil size").selectOption("3");
  await drag(page, 72, 72);
  await page.getByLabel("Pencil size").selectOption("1");
  await host(page).press("d");
  await drag(page, 58, 58);
  await expect(page.getByLabel("Hex color", { exact: true })).toHaveValue(
    "#335c46",
  );
  await button(page, "Add layer").click();
  await rename(page, "Furniture");
  await page.getByLabel("Hex color", { exact: true }).fill("#aa2244");
  await host(page).press("b");
  await drag(page, 61, 61);
  await drag(page, 64, 64);
  await area(page, "Blacksmith", "detail", [60, 60, 68, 68]);
  await area(page, "Village", "locality", [52, 52, 100, 100]);
  await area(page, "Region", "region", [0, 0, 128, 128]);
  await page.getByLabel("Layer name: Walls", { exact: true }).click();
  const before = await project(page);
  expect(Object.keys(cells(before, "Terrain"))).toHaveLength(361);
  expect(Object.keys(cells(before, "Furniture"))).toHaveLength(2);
  expect(before.document.annotations).toHaveLength(3);
  await host(page).press("v");
  await drag(page, 60, 60, 67, 67);
  await expect(page.getByTestId("selection-dimensions")).toContainText(
    "8 × 8 tiles",
  );
  await page
    .getByRole("checkbox", { name: "Include Furniture", exact: true })
    .check();
  await drag(page, 62, 62, 65, 62);
  const moved = await project(page);
  expect(moved.document.annotations).toEqual(before.document.annotations);
  expect(cells(moved, "Terrain")).toEqual(cells(before, "Terrain"));
  for (const name of ["Walls", "Furniture"]) {
    const old = cells(before, name),
      expected = { ...old };
    for (const key of Object.keys(old)) {
      const [x, y] = key.split(",").map(Number);
      if (x >= 60 && x < 63 && y >= 60 && y < 68) delete expected[key];
    }
    for (const [key, paint] of Object.entries(old)) {
      const [x, y] = key.split(",").map(Number);
      if (x >= 60 && x < 68 && y >= 60 && y < 68)
        expected[`${x + 3},${y}`] = paint;
    }
    expect(cells(moved, name)).toEqual(expected);
  }
  await host(page).press("Control+z");
  expect((await project(page)).document).toEqual(before.document);
  await host(page).press("Control+Shift+z");
  expect(await project(page)).toEqual(moved);
  // History restores content, not transient selections. Select the moved house.
  await host(page).press("v");
  await drag(page, 63, 60, 70, 67);
  await page
    .getByRole("checkbox", { name: "Include Furniture", exact: true })
    .check();
  await host(page).press("Control+c");
  await host(page).press("Control+v");
  await point(page, 76, 60);
  await host(page).press("z");
  await host(page).press("x");
  await button(page, "Apply paste").click();
  const pasted = await project(page);
  expect(pasted.document.annotations).toEqual(before.document.annotations);
  expect(Object.keys(cells(pasted, "Furniture"))).toHaveLength(
    Object.keys(cells(moved, "Furniture")).length * 2,
  );
  for (const name of ["Walls", "Furniture"]) {
    const original = cells(moved, name),
      expected = { ...original };
    for (const [key, paint] of Object.entries(original)) {
      const [x, y] = key.split(",").map(Number);
      // Clockwise quarter-turn then horizontal flip transposes local (u, v).
      if (x >= 63 && x < 71 && y >= 60 && y < 68)
        expected[`${76 + y - 60},${60 + x - 63}`] = paint;
    }
    expect(cells(pasted, name)).toEqual(expected);
  }
  await host(page).press("y");
  await button(page, "Apply transform").click();
  const transformed = await project(page);
  expect(transformed.document.annotations).toEqual(before.document.annotations);
  for (const name of ["Walls", "Furniture"]) {
    const original = cells(pasted, name),
      expected = { ...original };
    for (const [key, paint] of Object.entries(original)) {
      const [x, y] = key.split(",").map(Number);
      // Same-rectangle transforms preserve destination cells under payload holes.
      if (x >= 76 && x < 84 && y >= 60 && y < 68)
        expected[`${x},${127 - y}`] = paint;
    }
    expect(cells(transformed, name)).toEqual(expected);
  }
  await host(page).press("Control+z");
  expect(await project(page)).toEqual(pasted);
  await host(page).press("Control+Shift+z");
  expect(await project(page)).toEqual(transformed);
  await page.screenshot({ path: info.outputPath("session-close.png") });
  await host(page).press("Escape");
  await button(page, "Hide Furniture").click();
  await page.getByLabel("Zoom", { exact: true }).selectOption("0.125");
  await button(page, "More options for Grass").click();
  await page.getByRole("menuitem", { name: "Edit Grass", exact: true }).click();
  await page.getByLabel("Named color hex").fill("#557755");
  await button(page, "Edit named color").click();
  const final = await download(page);
  const finalProject: ProjectV1 = JSON.parse(final.bytes.toString());
  expect(finalProject.document.layers).toEqual(transformed.document.layers);
  expect(finalProject.document.registry[0].rgba).toBe("#557755ff");
  expect(finalProject.document.palette).toContainEqual({
    kind: "raw",
    rgba: "#335c46ff",
  });
  expect(finalProject.editor.hiddenLayerIds).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("session-overview.png") });
  const status = await page
    .locator(".document-title .document-status")
    .textContent();
  const agent = await download(page, "Export for Agent");
  await compareAgent(final.bytes, agent.bytes);
  expect(
    await page.locator(".document-title .document-status").textContent(),
  ).toBe(status);
  // Reopen the actual file written by the browser's download manager.
  await final.file.saveAs(info.outputPath("roundtrip.tilewright"));
  await open(
    page,
    info.outputPath("roundtrip.tilewright"),
    "roundtrip.tilewright",
  );
  expect((await download(page)).bytes).toEqual(final.bytes);
  await rename(page, "Recovered walls");
  const recover = await download(page);
  await checkpoint(page);
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  const recovery = page.getByRole("dialog", { name: "Recover unsaved work" });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Restore as unsaved copy" })
    .click();
  await replace(page);
  await expect(page.locator(".project-filename")).toContainText("Recovered");
  expect((await download(page)).bytes).toEqual(recover.bytes);
  await expect(page.getByTestId("save-timestamp")).toBeEmpty();
});
