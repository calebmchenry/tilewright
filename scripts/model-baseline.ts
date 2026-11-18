import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  fixtureRunsFromDocument,
  IMPORT_BATCH_RUNS,
  loadFixtureDocument,
} from "../tests/fixtures/document.ts";
import { inspectFixture } from "../tests/fixtures/inspect.ts";
import { FIXTURE_BOUNDS, FIXTURES } from "../tests/fixtures/maps.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const expected = JSON.parse(
  readFileSync(resolve(root, "tests/fixtures/expected.json"), "utf8"),
);

function measure(id: string) {
  if (!global.gc) throw new Error("Model measurement requires --expose-gc.");
  const fixture = FIXTURES.find((item) => item.id === id);
  if (!fixture && id !== "empty") throw new Error(`Unknown fixture: ${id}`);
  global.gc();
  const before = process.memoryUsage();
  const start = performance.now();
  const document = loadFixtureDocument(fixture);
  const initializationMs = performance.now() - start;
  const afterInitialization = process.memoryUsage();
  const initializationProcessMaxRssBytes =
    process.resourceUsage().maxRSS * 1024;
  global.gc();
  const retained = process.memoryUsage();
  const storage = document.storageStats();
  const validationStart = performance.now();
  const content = fixture
    ? inspectFixture(fixture, fixtureRunsFromDocument(document))
    : null;
  if (fixture) {
    assert.deepEqual(content, expected[id]);
    assert.equal(storage.occupiedCells, expected[id].occupiedLayerCells);
  } else {
    assert.equal(storage.partitions, 0);
    assert.equal(storage.paletteEntries, 0);
  }
  const validationMs = performance.now() - validationStart;
  return {
    id,
    initializationMs,
    validationMs,
    matchesGolden: fixture ? true : null,
    memoryBytes: {
      before,
      afterInitialization,
      retained,
      retainedDelta: Object.fromEntries(
        Object.keys(before).map((key) => [
          key,
          retained[key as keyof typeof retained] -
            before[key as keyof typeof before],
        ]),
      ),
      retainedHeapAndArrayBuffersDelta:
        retained.heapUsed -
        before.heapUsed +
        retained.arrayBuffers -
        before.arrayBuffers,
    },
    initializationProcessMaxRssBytes,
    processMaxRssIncludingValidationBytes:
      process.resourceUsage().maxRSS * 1024,
    storage,
    content,
  };
}

if (args.length === 2 && args[0] === "--measure") {
  console.log(JSON.stringify(measure(args[1])));
} else {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output"))
    throw new Error("Usage: npm run perf:model -- [--output path.json]");
  const measurements = ["empty", ...FIXTURES.map((fixture) => fixture.id)].map(
    (id) => {
      const passes = [1, 2].map((pass) => {
        const result = JSON.parse(
          execFileSync(
            process.execPath,
            ["--expose-gc", fileURLToPath(import.meta.url), "--measure", id],
            { encoding: "utf8", maxBuffer: 1024 * 1024 },
          ),
        ) as ReturnType<typeof measure>;
        console.log(
          `${id} pass ${pass}: ${result.initializationMs.toFixed(2)} ms initialization; ${(result.memoryBytes.retainedHeapAndArrayBuffersDelta / 2 ** 20).toFixed(2)} MiB retained heap + array buffer delta; ${result.storage.occupiedCells} cells`,
        );
        return { pass, ...result };
      });
      assert.deepEqual(passes[0].content, passes[1].content);
      assert.deepEqual(passes[0].storage, passes[1].storage);
      return { id, equivalent: true, passes };
    },
  );
  const native = (command: string, commandArgs: string[]) =>
    execFileSync(command, commandArgs, { encoding: "utf8" }).trim();
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    scope:
      "Real sparse document initialization and full model readback; no renderer, history, native I/O, or editor performance gate.",
    buildMode:
      "Node native TypeScript stripping, unbundled, fresh --expose-gc child process per sample",
    method: `Two independent processes per input. Time construction + generation + validated imports in batches of ${IMPORT_BATCH_RUNS} runs, including temporary deltas. No subscribers/history retained. GC before/after initialization outside timing. Post-GC heapUsed + arrayBuffers delta approximates retained model memory and includes runtime/JIT overhead; external already contains arrayBuffers and must not be added again. RSS/maxRSS are whole-process, not model-only. Golden validation reads all model content after memory sampling and outside initialization timing.`,
    bounds: FIXTURE_BOUNDS,
    importBatchRuns: IMPORT_BATCH_RUNS,
    inputsSha256: Object.fromEntries(
      [
        ".nvmrc",
        "package.json",
        "package-lock.json",
        "tsconfig.domain.json",
        "src/domain/coordinates.ts",
        "src/domain/values.ts",
        "src/domain/storage.ts",
        "src/domain/document.ts",
        "tests/fixtures/maps.ts",
        "tests/fixtures/inspect.ts",
        "tests/fixtures/document.ts",
        "tests/fixtures/expected.json",
        "scripts/model-baseline.ts",
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
    : resolve(root, "artifacts/performance/model-baseline.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${output}`);
}
