import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "../tests/fixtures/maps.ts";
import { inspectFixture } from "../tests/fixtures/inspect.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output")) {
  throw new Error("Usage: npm run perf:baseline -- [--output path.json]");
}
if (!global.gc)
  throw new Error("Run via npm run perf:baseline to enable controlled GC.");
const expected = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/expected.json", import.meta.url),
    "utf8",
  ),
);
const native = (command: string, commandArgs: string[]) =>
  execFileSync(command, commandArgs, { encoding: "utf8" }).trim();

const measurements = FIXTURES.map((fixture) => {
  const passes = [1, 2].map((pass) => {
    global.gc!();
    const before = process.memoryUsage();
    const start = performance.now();
    const content = inspectFixture(fixture);
    const elapsedMs = performance.now() - start;
    const after = process.memoryUsage();
    global.gc!();
    const retained = process.memoryUsage();
    return {
      pass,
      elapsedMs,
      memoryBytes: { before, after, retained },
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      content,
    };
  });
  assert.deepEqual(
    passes[0].content,
    passes[1].content,
    `${fixture.id}: two generations differ`,
  );
  assert.deepEqual(
    passes[0].content,
    expected[fixture.id],
    `${fixture.id}: differs from reviewed fixture`,
  );
  return { id: fixture.id, equivalent: true, matchesGolden: true, passes };
});
const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  scope:
    "Fixture generation + validation + occupancy counting + SHA-256 only; no editor performance measured.",
  buildMode:
    "Node native TypeScript stripping, unbundled, no renderer, --expose-gc",
  method:
    "Two sequential full generations per fixture; GC before/after each; performance.now wall time; process.memoryUsage snapshots; process-wide cumulative maxRSS (not per-fixture peak).",
  inputsSha256: Object.fromEntries(
    [
      ".nvmrc",
      "package.json",
      "package-lock.json",
      "tsconfig.domain.json",
      "src/domain/coordinates.ts",
      "tests/fixtures/maps.ts",
      "tests/fixtures/inspect.ts",
      "tests/fixtures/expected.json",
      "scripts/fixture-baseline.ts",
    ].map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(resolve(root, path)))
        .digest("hex"),
    ]),
  ),
  machine: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    model:
      process.platform === "darwin"
        ? native("sysctl", ["-n", "hw.model"])
        : null,
    macOS:
      process.platform === "darwin"
        ? native("sw_vers", ["-productVersion"])
        : null,
    macOSBuild:
      process.platform === "darwin"
        ? native("sw_vers", ["-buildVersion"])
        : null,
  },
  measurements,
};
const output = args.length
  ? resolve(args[1])
  : resolve(root, "artifacts/performance/fixture-baseline.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
for (const fixture of measurements) {
  const content = fixture.passes[0].content;
  console.log(
    `${fixture.id}: ${content.occupiedLayerCells} layer cells; ${content.uniqueOccupiedPositions} unique positions; ${content.overlappingPositions} overlapping; SHA-256 ${content.contentSha256}; equal x2 + golden`,
  );
  console.log(
    `  full scan ms: ${fixture.passes.map((pass) => pass.elapsedMs.toFixed(2)).join(", ")}`,
  );
}
console.log(`Wrote ${output}`);
