import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator(".canvas-host");
const panel = (page: Page) =>
  page
    .locator("main")
    .getByRole("region", { name: "Tile selection", exact: true });
const action = (page: Page, name: string) =>
  panel(page).getByRole("button", { name, exact: true });
const content = (page: Page) =>
  page.evaluate(() => {
    const d = window.editorProbe.session.document;
    return {
      bounds: d.bounds,
      layers: d.layers,
      registry: d.registryEntries,
      annotations: d.annotations,
      runs: [...d.iterateRuns()],
    };
  });
async function move(page: Page, x: number, y: number) {
  const box = (await host(page).boundingBox())!;
  const v = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(
    box.x + 24 + (x + 0.5 - v.x) * 24 * v.zoom,
    box.y + 24 + (y + 0.5 - v.y) * 24 * v.zoom,
  );
}

for (const multi of [false, true])
  for (const dpr of [1, 2])
    test(`8x8 house three-tile move and composed workflow: ${multi ? "chosen layers" : "active layer"}, DPR ${dpr}`, async ({
      browser,
    }, info) => {
      const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      await page.goto("/tests/editor.html?fixture=selection-move");
      await expect(
        page.getByRole("status", { name: "Canvas status" }),
      ).toHaveText("Canvas ready");
      const states = [await content(page)];
      const saveState = async () => {
        states.push(await content(page));
        expect(
          await page.evaluate(
            () => window.editorProbe.session.history.state.undoSteps,
          ),
        ).toBe(states.length - 1);
      };
      await host(page).press("v");
      await move(page, 67, 67);
      await page.mouse.down();
      await move(page, 60, 60);
      await page.mouse.up();
      await expect(panel(page).getByTestId("selection-dimensions")).toHaveText(
        "8 × 8 tiles · 64 positions",
      );
      if (multi)
        await panel(page)
          .getByRole("checkbox", {
            name: "Include Furniture",
            exact: true,
          })
          .check();
      await move(page, 62, 62);
      await page.mouse.down();
      await move(page, 65, 62);
      expect(await content(page)).toEqual(states[0]);
      await host(page).screenshot({
        path: info.outputPath("house-three-tile-preview.png"),
      });
      await page.mouse.up();
      await saveState();
      // Exact cell-by-cell movement oracle, including overwritten destinations,
      // empty cells, alpha-zero paint and every unrelated terrain/furniture cell.
      expect(
        await page.evaluate(
          ({ runs, multi }) => {
            const d = window.editorProbe.session.document;
            const before = new Map<string, unknown>();
            for (const r of runs)
              for (let x = r.x; x < r.x + r.length; x++)
                before.set(`${r.layerId}:${x}:${r.y}`, r.value);
            const at = (id: string, x: number, y: number) =>
              before.get(`${id}:${x}:${y}`) ?? null;
            for (const l of d.layers)
              for (let y = d.bounds.minY; y < d.bounds.maxY; y++)
                for (let x = d.bounds.minX; x < d.bounds.maxX; x++) {
                  let expected = at(l.id, x, y);
                  if (l.id === "walls" || (multi && l.id === "furniture")) {
                    if (x >= 63 && x < 71 && y >= 60 && y < 68)
                      expected = at(l.id, x - 3, y) ?? expected;
                    else if (x >= 60 && x < 68 && y >= 60 && y < 68)
                      expected = null;
                  }
                  if (
                    JSON.stringify(d.getCell(l.id, x, y)) !==
                    JSON.stringify(expected)
                  )
                    return `${l.id}:${x}:${y}`;
                }
            return "all cells match";
          },
          { runs: states[0].runs, multi },
        ),
      ).toBe("all cells match");
      // Change scope between operations, leaving terrain excluded throughout.
      await panel(page)
        .getByRole("checkbox", {
          name: "Include Furniture",
          exact: true,
        })
        .setChecked(!multi);
      await host(page).press("ControlOrMeta+x");
      await saveState();
      await host(page).press("ControlOrMeta+v");
      await move(page, 62, 62);
      await host(page).press("z");
      await host(page).press("x");
      await host(page).press("y");
      expect(await content(page)).toEqual(states.at(-1));
      await action(page, "Apply paste").click();
      await saveState();
      await host(page).press("ControlOrMeta+c");
      await host(page).press("ControlOrMeta+v");
      await move(page, 70, 70);
      await host(page).press("Shift+z");
      await action(page, "Apply paste").click();
      await saveState();
      await host(page).press("x");
      await host(page).press("ArrowRight");
      await action(page, "Apply transform").click();
      await saveState();
      const final = states.at(-1)!;
      expect(final.annotations).toEqual(states[0].annotations);
      expect(final.registry).toEqual(states[0].registry);
      expect(final.layers).toEqual(states[0].layers);
      expect(final.bounds).toEqual(states[0].bounds);
      expect(final.runs.filter((r) => r.layerId === "terrain")).toEqual(
        states[0].runs.filter((r) => r.layerId === "terrain"),
      );
      for (let i = states.length - 2; i >= 0; i--) {
        await host(page).press("Control+z");
        expect(await content(page)).toEqual(states[i]);
      }
      expect(
        await page.evaluate(
          () => window.editorProbe.session.history.state.dirty,
        ),
      ).toBe(false);
      await host(page).screenshot({
        path: info.outputPath("workflow-undone.png"),
      });
      for (let i = 1; i < states.length; i++) {
        await host(page).press("Control+Shift+z");
        expect(await content(page)).toEqual(states[i]);
      }
      await context.close();
    });
