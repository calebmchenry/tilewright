import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

// Preserve every sample in a compact adjacent archive; keep the review table small.
const [output, ...directories] = process.argv.slice(2);
if (!output || !directories.length)
  throw new Error(
    "Usage: node scripts/native-performance-report.ts OUTPUT.json RUN_DIRECTORY...",
  );
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.ceil(sorted.length * q) - 1];
  return {
    count: values.length,
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: sorted.at(-1),
  };
}
interface MemorySample {
  start_time: { date: string };
  end_time: { date: string };
  "total footprint": number;
  errors: unknown[];
  warnings: unknown[];
}
interface MemoryCapture {
  samples: MemorySample[];
}
const runs = directories.map((directory) => {
  const environment = JSON.parse(
    readFileSync(join(directory, "environment.json"), "utf8"),
  );
  const events = readFileSync(join(directory, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const memory: MemoryCapture | undefined = existsSync(
    join(directory, "memory.json"),
  )
    ? JSON.parse(readFileSync(join(directory, "memory.json"), "utf8"))
    : undefined;
  const processes = JSON.parse(
    readFileSync(join(directory, "processes.json"), "utf8"),
  );
  const stderr = readFileSync(join(directory, "stderr.log"), "utf8");
  return {
    name: basename(directory),
    environment,
    events,
    processes,
    stderr,
    memory,
  };
});
const archive = join(dirname(output), "native-performance-samples.json.gz");
writeFileSync(archive, gzipSync(JSON.stringify(runs) + "\n", { level: 9 }));
const report = {
  date: new Date().toISOString(),
  gatePassed: false,
  status:
    "Presentation evidence must be validated separately; proxy summaries never establish a gate pass.",
  samples: basename(archive),
  fixtures: JSON.parse(readFileSync("tests/fixtures/expected.json", "utf8")),
  runs: runs.map(({ name, environment, events, processes, memory }) => ({
    name,
    environment,
    processes,
    memory:
      memory &&
      (() => {
        const samples = memory.samples;
        if (!samples.length) throw new Error(`${name}: empty memory capture`);
        const started = (sample: MemorySample) =>
          Date.parse(sample.start_time.date);
        const windows = events
          .filter((e) =>
            ["memory-before-cycles", "memory-after-cycles"].includes(e.kind),
          )
          .map((e) => ({
            fixture: e.fixture,
            kind: e.kind,
            at: e.at,
            footprintBytes: stats(
              samples
                .filter((s) => e.at - 1000 <= started(s) && started(s) <= e.at)
                .map((s) => s["total footprint"]),
            ),
          }));
        return {
          method:
            "footprint total footprint with group/shared accounting; 100 ms requested cadence",
          scope:
            "20 edit/undo/redo/reset trials for each of 8, 512 and 1024 sizes, followed by overview; fixtures sequential in one process",
          sampleCount: samples.length,
          sampleIntervalMs: stats(
            samples.slice(1).map((s, i) => started(s) - started(samples[i])),
          ),
          peakSampledFootprintBytes: Math.max(
            ...samples.map((s) => s["total footprint"]),
          ),
          errors: samples.flatMap((s) => s.errors),
          warnings: samples.flatMap((s) => s.warnings),
          steadyWindows: windows,
          growthBytes: windows
            .filter((e) => e.kind === "memory-before-cycles")
            .map((before) => {
              const after = windows.find(
                (e) =>
                  e.fixture === before.fixture &&
                  e.kind === "memory-after-cycles",
              );
              if (!after?.footprintBytes.max || !before.footprintBytes.max)
                throw new Error(`${name}: missing steady memory samples`);
              return {
                fixture: before.fixture,
                bytes: after.footprintBytes.max - before.footprintBytes.max,
                boundary:
                  "maximum sample in final second of each 10-second idle, before/after all three command sizes (60 trials total)",
              };
            }),
        };
      })(),
    complete: events.some((e) => e.kind === "complete"),
    failures: events.filter((e) => e.kind === "failure"),
    webview: events.find((e) => e.kind === "environment"),
    cold: events
      .filter((e) => e.kind === "cold")
      .map(({ fixture, scenario, repetition, initialReadyMs, stats }) => ({
        fixture,
        scenario,
        repetition,
        initialReadyMs,
        stats,
      })),
    navigation: events
      .filter((e) => e.kind === "navigation")
      .map(
        ({
          fixture,
          scenario,
          repetition,
          frameSummary,
          cpuSummary,
          proxySummary,
          hidden,
          queries,
          maxQueryArea,
          stats,
        }) => ({
          fixture,
          scenario,
          repetition,
          frameSummary,
          cpuSummary,
          proxySummary,
          hidden,
          queries,
          maxQueryArea,
          stats,
        }),
      ),
    edits: events
      .filter((e) => e.kind === "edits")
      .map((e) => ({
        fixture: e.fixture,
        size: e.size,
        actions: ["edit", "undo", "redo"].map((action) => {
          const samples = e.operations.filter(
            (s: { action: string }) => s.action === action,
          );
          return {
            action,
            submissionMs: stats(
              samples.map((s: { submissionMs: number }) => s.submissionMs),
            ),
            nextFrameProxyMs: stats(
              samples.map(
                (s: { nextFrameProxyMs: number }) => s.nextFrameProxyMs,
              ),
            ),
            queries: stats(samples.map((s: { queries: number }) => s.queries)),
            maxQueryArea: Math.max(
              ...samples.map((s: { maxQueryArea: number }) => s.maxQueryArea),
            ),
            maxDetailBuilds: Math.max(
              ...samples.map((s: { detailBuilds: number }) => s.detailBuilds),
            ),
          };
        }),
      })),
    invalidation: events
      .filter((e) => e.kind === "invalidation")
      .map((e) => ({
        fixture: e.fixture,
        actions: ["edit", "undo", "redo"].map((action) => {
          const samples = e.rebuilds.filter(
            (s: { action: string }) => s.action === action,
          );
          return {
            action,
            nextFrameProxyMs: stats(
              samples.map(
                (s: { nextFrameProxyMs: number }) => s.nextFrameProxyMs,
              ),
            ),
            rebuilt: stats(samples.map((s: { rebuilt: number }) => s.rebuilt)),
            maxQueryArea: Math.max(
              ...samples.map((s: { maxQueryArea: number }) => s.maxQueryArea),
            ),
          };
        }),
        stats: e.stats,
      })),
  })),
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote ${output} and ${archive}; gate remains unverified.`);
