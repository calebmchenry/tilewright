import { expect, test, type Page } from "@playwright/test";
import {
  grass,
  NEW_GRASS,
  OLD_GRASS,
  RECOLOR_ORIGINS,
} from "./fixtures/recolor";

async function settled(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.tileProbe.stats().overview.pending))
    .toBe(0);
  await expect(page.locator("canvas")).toHaveAttribute("aria-busy", "false");
}
const old = [51, 92, 70, 255],
  updated = [85, 119, 85, 255];
const mountain = [128, 128, 128, 255],
  wall = [129, 129, 129, 255];
for (const dpr of [1, 2]) {
  test(`R08/R20: cross-layer recolor, offscreen cached resolutions and history show current pixels at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async (grass) => {
      const p = window.tileProbe;
      await p.load("recolor");
      p.resize(512, 256);
      p.hide("buildings", true);
      p.session.selectRegisteredColor(grass);
    }, grass);
    const original = await page.evaluate(() => {
      const s = window.tileProbe.session;
      return {
        runs: [...s.document.iterateRuns()],
        registry: s.document.registryEntries,
        annotations: s.document.annotations,
        history: s.history.state,
        version: s.document.version,
      };
    });
    // Populate two positions at two resolutions, leaving the third truly cold.
    for (const x of [0, 1024])
      for (const zoom of [1 / 24, 0.5 / 24]) {
        await page.evaluate(
          ({ x, zoom }) => window.tileProbe.view(x, 0, zoom),
          { x, zoom },
        );
        await settled(page);
      }
    await page.evaluate(() => window.tileProbe.view(0, 0, 4 / 24));
    const before = await page.evaluate(() => window.tileProbe.stats());
    expect(before.overview.entries).toBeGreaterThan(0);
    const rejected = await page.evaluate((grass) => {
      const s = window.tileProbe.session;
      try {
        s.registryCommands.prepare({
          kind: "edit",
          id: grass,
          name: "Do not rename",
          color: "#818181",
        });
      } catch (error) {
        return String(error);
      }
      throw new Error("Expected color collision");
    }, grass);
    expect(rejected).toContain("Stone wall");
    expect(
      await page.evaluate(() => {
        const s = window.tileProbe.session;
        return {
          runs: [...s.document.iterateRuns()],
          registry: s.document.registryEntries,
          annotations: s.document.annotations,
          history: s.history.state,
          version: s.document.version,
        };
      }),
    ).toEqual(original);
    expect(await page.evaluate(() => window.tileProbe.stats())).toEqual(before);

    for (const action of ["recolor", "undo", "redo"] as const) {
      await page.evaluate(
        ({ action, grass, color }) => {
          const p = window.tileProbe,
            s = p.session;
          p.hide("buildings", true);
          p.view(0, 0, 4 / 24);
          p.resetQueries();
          if (action === "recolor") {
            const before = p.stats();
            if (
              !s.commitRegistry(
                s.registryCommands.prepare({
                  kind: "edit",
                  id: grass,
                  name: "Grass",
                  color,
                }),
              )
            )
              throw new Error(s.feedback.getSnapshot().message);
            const after = p.stats();
            // Only the two visible terrain chunks referencing Grass are refreshed.
            if (
              after.builds - before.builds !== 2 ||
              after.uploads - before.uploads !== 2 ||
              after.overview.builds !== before.overview.builds
            )
              throw new Error("Non-targeted detail recolor");
            if (
              p.queries().length !== 2 ||
              p.queries().some((q) => !q.bounds || q.layer !== "terrain")
            )
              throw new Error("Unexpected propagation scan");
          } else s.perform(action);
        },
        { action, grass, color: NEW_GRASS },
      );
      const color = action === "undo" ? old : updated;
      expect(
        await page.evaluate(() => window.tileProbe.session.color.getSnapshot()),
      ).toBe(action === "undo" ? OLD_GRASS : NEW_GRASS);
      for (const origin of RECOLOR_ORIGINS)
        for (const zoom of [4 / 24, 1 / 24, 0.5 / 24]) {
          for (const hidden of [true, false]) {
            await page.evaluate(
              ({ origin, zoom, hidden }) => {
                window.tileProbe.hide("buildings", hidden);
                window.tileProbe.view(origin, 0, zoom);
              },
              { origin, zoom, hidden },
            );
            await settled(page);
            const pixels = await page.evaluate(
              (origin) =>
                window.tileProbe.sample(
                  [12, 28, 44, 60, 76, 92, 108].map((x) => [origin + x, 12]),
                ),
              origin,
            );
            expect(
              pixels,
              `${action}: x=${origin}, zoom=${zoom}, hidden=${hidden}`,
            ).toEqual([
              hidden ? color : wall,
              hidden ? mountain : color,
              old,
              updated,
              mountain,
              wall,
              color,
            ]);
          }
        }
      // Retained image reuse and navigation never mutate model data/history.
      const state = await page.evaluate(() => {
        const s = window.tileProbe.session;
        return {
          runs: [...s.document.iterateRuns()],
          registry: s.document.registryEntries,
          annotations: s.document.annotations,
          history: s.history.state,
          paint: s.currentPaint(),
        };
      });
      expect(state.runs).toEqual(original.runs);
      expect(state.annotations).toEqual(original.annotations);
      expect(state.registry.filter(([id]) => id !== grass)).toEqual(
        original.registry.filter(([id]) => id !== grass),
      );
      expect(state.registry.find(([id]) => id === grass)?.[1]).toEqual({
        name: "Grass",
        rgba: action === "undo" ? OLD_GRASS : NEW_GRASS,
      });
      expect(state.paint).toEqual({ kind: "registered", registryId: grass });
      expect(state.history.undoSteps).toBe(action === "undo" ? 0 : 1);
    }
    await page
      .locator("canvas")
      .screenshot({ path: info.outputPath(`recolor-dpr${dpr}.png`) });
    expect(errors).toEqual([]);
    await context.close();
  });
}
