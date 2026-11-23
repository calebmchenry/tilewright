import { expect, test, type Page } from "@playwright/test";
import { grass, newGrass, oldGrass } from "./fixtures/complete-session";

const host = (p: Page) => p.locator(".canvas-host");
const button = (p: Page, name: string) =>
  p.locator("main").getByRole("button", { name, exact: true });
const content = (p: Page) =>
  p.evaluate(() => {
    const d = window.editorProbe.session.document;
    return {
      bounds: d.bounds,
      layers: d.layers,
      registry: d.registryEntries,
      annotations: d.annotations,
      runs: [...d.iterateRuns()],
    };
  });
async function move(p: Page, x: number, y: number) {
  const b = (await host(p).boundingBox())!;
  const v = await p.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await p.mouse.move(
    b.x + 24 + (x + 0.5 - v.x) * 24 * v.zoom,
    b.y + 24 + (y + 0.5 - v.y) * 24 * v.zoom,
  );
}
async function drag(p: Page, x: number, y: number, dx = x, dy = y) {
  await move(p, x, y);
  await p.mouse.down();
  await move(p, dx, dy);
  await p.mouse.up();
}

for (const multi of [false, true])
  test(`complete session UI: drawing, ${multi ? "chosen-layer" : "single-layer"} house, annotations and recolor`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/tests/editor.html?fixture=complete-session");
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    await page.evaluate(() =>
      window.editorProbe.session.viewport.set({ x: 48, y: 48, zoom: 0.5 }),
    );
    const main = page.locator("main");
    await main
      .getByRole("group", { name: "Active layer" })
      .getByLabel("Layer name: Furniture", { exact: true })
      .click();
    await main
      .getByRole("button", { name: "Show Furniture", exact: true })
      .click();
    await main
      .getByRole("group", { name: "Active layer" })
      .getByLabel("Layer name: Walls", { exact: true })
      .click();
    const states = [await content(page)];
    const baseSteps = await page.evaluate(
      () => window.editorProbe.session.history.state.undoSteps,
    );
    const checkpoint = async () => {
      states.push(await content(page));
      expect(
        await page.evaluate(
          () => window.editorProbe.session.history.state.undoSteps,
        ),
      ).toBe(baseSteps + states.length - 1);
    };
    await main.getByLabel("Hex color", { exact: true }).fill("#112233");
    await main.getByLabel("Pencil size", { exact: true }).selectOption("3");
    await host(page).press("b");
    await drag(page, 74, 74);
    await checkpoint();
    await main.getByLabel("Pencil size", { exact: true }).selectOption("1");
    await host(page).press("e");
    await drag(page, 74, 74);
    await checkpoint();
    await host(page).press("l");
    await drag(page, 72, 78, 76, 78);
    await checkpoint();
    await host(page).press("r");
    await main.getByLabel("Rectangle style").selectOption("filled");
    await drag(page, 72, 80, 76, 84);
    await checkpoint();
    await main.getByLabel("Rectangle style").selectOption("outline");
    await drag(page, 80, 80, 85, 85);
    await checkpoint();
    await main.getByLabel("Hex color", { exact: true }).fill("#998877");
    await host(page).press("g");
    await drag(page, 73, 81);
    await expect
      .poll(() =>
        page.evaluate(() => window.editorProbe.session.history.state.undoLabel),
      )
      .toBe("Fill");
    await checkpoint();
    await host(page).press("d");
    await drag(page, 58, 55);
    await expect(
      main.getByRole("button", { name: "Paint with Grass" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await content(page)).toEqual(states.at(-1));
    await host(page).press("v");
    await drag(page, 60, 60, 67, 67);
    await expect(page.getByTestId("selection-dimensions")).toContainText(
      "8 × 8 tiles",
    );
    if (multi)
      await main
        .getByRole("checkbox", {
          name: "Include Furniture",
          exact: true,
        })
        .check();
    const beforeMove = await content(page);
    await drag(page, 62, 62, 65, 62);
    await checkpoint();
    expect((await content(page)).annotations).toEqual(beforeMove.annotations);
    await host(page).press("ControlOrMeta+z");
    expect(await content(page)).toEqual(beforeMove);
    await host(page).press("ControlOrMeta+Shift+z");
    expect(await content(page)).toEqual(states.at(-1));
    await host(page).press("v");
    await drag(page, 63, 60, 70, 67);
    if (multi)
      await main
        .getByRole("checkbox", {
          name: "Include Furniture",
          exact: true,
        })
        .check();
    await host(page).press("ControlOrMeta+c");
    await host(page).press("ControlOrMeta+v");
    await move(page, 80, 60);
    await host(page).press("z");
    await host(page).press("x");
    await button(page, "Apply paste").click();
    await checkpoint();
    await host(page).press("y");
    await button(page, "Apply transform").click();
    await checkpoint();
    for (const state of states) {
      expect(state.annotations).toEqual(states[0].annotations);
      expect(state.runs.filter((r) => r.layerId === "terrain")).toEqual(
        states[0].runs.filter((r) => r.layerId === "terrain"),
      );
    }
    await main
      .getByRole("button", {
        name: "Blacksmith's house detail · house",
        exact: true,
      })
      .click();
    await main
      .getByLabel("Description", { exact: true })
      .fill("Explicit annotation edit after moving tiles — 家");
    await button(page, "Apply area").click();
    await checkpoint();
    await button(page, "Deselect area").click();
    await button(page, "More options for Grass").click();
    await page
      .getByRole("menuitem", { name: "Edit Grass", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Named color hex").fill(newGrass.slice(0, 7));
    await dialog
      .getByRole("button", { name: "Edit named color", exact: true })
      .click();
    await checkpoint();
    expect(states.at(-1)!.runs).toEqual(states.at(-2)!.runs);
    for (let i = states.length - 2; i >= 0; i--) {
      await host(page).press("ControlOrMeta+z");
      expect(await content(page)).toEqual(states[i]);
    }
    for (let i = 1; i < states.length; i++) {
      await host(page).press("ControlOrMeta+Shift+z");
      expect(await content(page)).toEqual(states[i]);
    }
    await page.screenshot({
      path: info.outputPath("complete-session-close.png"),
    });
    expect(errors).toEqual([]);
  });

for (const dpr of [1, 2])
  test(`authored session labels and hidden/offscreen overview recoloring at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    // Hosted software rendering must finish every cache/pixel assertion;
    // the aggregate runtime is not the deferred rendering performance budget.
    test.setTimeout(120000);
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1100, height: 760 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async () => {
      await window.tileProbe.load("complete-session");
      window.tileProbe.resize(960, 640);
    });
    const settled = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => window.tileProbe.stats().overview.pending),
        )
        .toBe(0);
      await expect(page.locator("canvas")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    };
    const before = await page.evaluate(
      () => window.tileProbe.session.captureProjectSnapshot().project.document,
    );
    for (const [name, x, y, zoom, expected] of [
      ["close", 48, 48, 1, ["house", "storehouse"]],
      ["locality", 0, 0, 3 / 24, ["village"]],
      ["region", -64, -64, 0.09 / 24, ["region"]],
    ] as const) {
      await page.evaluate(
        ({ x, y, zoom }) => window.tileProbe.view(x, y, zoom),
        { x, y, zoom },
      );
      await settled();
      expect(
        await page.evaluate(() =>
          window.tileProbe.stats().labels.labels.map((l) => l.id),
        ),
      ).toEqual(expected);
      await page
        .locator("canvas")
        .screenshot({ path: info.outputPath(`session-${name}-dpr${dpr}.png`) });
    }
    for (const action of ["recolor", "undo", "redo"] as const) {
      // Warm both locations/resolutions before EACH history action. Keep layer
      // visibility unchanged until all warm images are checked: otherwise a
      // visibility refresh could mask missing registry cache invalidation.
      await page.evaluate(() => window.tileProbe.hide("furniture", true));
      for (const origin of [48, 6016])
        for (const p of [1, 0.5]) {
          await page.evaluate(
            ({ origin, p }) => window.tileProbe.view(origin, origin, p / 24),
            { origin, p },
          );
          await settled();
        }
      expect(
        await page.evaluate(() => window.tileProbe.stats().overview.entries),
      ).toBeGreaterThan(0);
      await page.evaluate(() => window.tileProbe.view(48, 48, 1));
      await page.evaluate(
        ({ action, grass, newGrass }) => {
          const s = window.tileProbe.session;
          if (action === "recolor") {
            if (
              !s.commitRegistry(
                s.registryCommands.prepare({
                  kind: "edit",
                  id: grass,
                  name: "Grass",
                  color: newGrass,
                }),
              )
            )
              throw Error("Recolor failed");
          } else s.perform(action);
        },
        { action, grass, newGrass },
      );
      for (const origin of [48, 6016])
        for (const p of [1, 0.5]) {
          await page.evaluate(
            ({ origin, p }) => window.tileProbe.view(origin, origin, p / 24),
            { origin, p },
          );
          await settled();
          const point: [number, number] =
            origin === 48 ? [58, 50] : [6020, 6020];
          expect(
            await page.evaluate(
              (point) => window.tileProbe.sample([point]),
              point,
            ),
            `${action}: warm cache ${origin} ${p}, without visibility changes`,
          ).toEqual([
            action === "undo" ? [51, 92, 70, 255] : [85, 119, 85, 255],
          ]);
        }
      for (const origin of [48, 6016])
        for (const p of [12, 1, 0.5])
          for (const hidden of [true, false]) {
            await page.evaluate(
              ({ origin, p, hidden }) => {
                window.tileProbe.hide("furniture", hidden);
                window.tileProbe.view(origin, origin, p / 24);
              },
              { origin, p, hidden },
            );
            await settled();
            const points: [number, number][] =
              origin === 48
                ? [
                    [58, 50],
                    [82, 50],
                    [50, 50],
                  ]
                : [
                    [6020, 6020],
                    [6036, 6036],
                  ];
            const color =
              action === "undo" ? [51, 92, 70, 255] : [85, 119, 85, 255];
            expect(
              await page.evaluate(
                (points) => window.tileProbe.sample(points),
                points,
              ),
              `${action} ${origin} ${p} ${hidden}`,
            ).toEqual(
              origin === 48
                ? [color, color, [51, 92, 70, 255]]
                : [color, color],
            );
          }
      const after = await page.evaluate(
        () =>
          window.tileProbe.session.captureProjectSnapshot().project.document,
      );
      expect(after.layers).toEqual(before.layers);
      expect(after.annotations).toEqual(before.annotations);
      expect(after.registry.find((r) => r.id === grass)).toEqual({
        id: grass,
        name: "Grass",
        rgba: action === "undo" ? oldGrass : newGrass,
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
