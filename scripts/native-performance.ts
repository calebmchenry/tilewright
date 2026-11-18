import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { cpus, totalmem } from "node:os";

const args = process.argv.slice(2);
const option = (key: string, fallback: string) => {
  const i = args.indexOf(key);
  return i < 0 ? fallback : args[i + 1];
};
const mode = option("--mode", "quick");
if (!["quick", "full", "memory"].includes(mode))
  throw new Error("mode must be quick, full, or memory");
const output = resolve(
  option("--output", `artifacts/performance/native-${mode}-${Date.now()}`),
);
mkdirSync(output, { recursive: true });
const binary = resolve(
  "src-tauri/target/release/bundle/macos/Tilewright Performance.app/Contents/MacOS/tilewright",
);
function processes() {
  return execFileSync("ps", ["-axo", "pid,comm"], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match ? [{ pid: Number(match[1]), name: match[2] }] : [];
    });
}
const previous = new Set(processes().map((p) => p.pid));
const files = execFileSync(
  "git",
  [
    "ls-files",
    "src",
    "tests/fixtures",
    "src-tauri/src",
    "src-tauri/Cargo.lock",
    "package-lock.json",
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
files.push(
  "tests/native-performance.ts",
  "tests/native-performance.html",
  "scripts/native-performance.ts",
  "vite.performance.config.ts",
  "src-tauri/tauri.performance.conf.json",
);
const sha = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const environment = {
  date: new Date().toISOString(),
  mode,
  binarySha256: sha(binary),
  sources: Object.fromEntries(files.map((path) => [path, sha(path)])),
  machine: {
    model: execFileSync("sysctl", ["-n", "hw.model"], {
      encoding: "utf8",
    }).trim(),
    cpu: cpus()[0].model,
    ram: totalmem(),
    os: execFileSync("sw_vers", [], { encoding: "utf8" }),
    power: execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }),
    node: process.version,
  },
  build:
    "npm run build:performance (release arm64, embedded Vite production assets, WKWebView/WebGL2)",
  command: process.argv.slice(1),
};
writeFileSync(
  `${output}/environment.json`,
  JSON.stringify(environment, null, 2) + "\n",
);
const raw = createWriteStream(`${output}/events.jsonl`);
const errors = createWriteStream(`${output}/stderr.log`);
const app = spawn(binary, [], {
  env: { ...process.env, TILEWRIGHT_PERFORMANCE_MODE: mode },
  stdio: ["ignore", "pipe", "pipe"],
});
app.stderr.pipe(errors);
console.log(`Native ${mode}: PID ${app.pid}; evidence ${output}`);
let memory: ReturnType<typeof spawn> | undefined;
let finished = false;
const timeout = setTimeout(
  () => {
    console.error("Native benchmark timeout");
    process.exitCode = 1;
    app.kill();
    memory?.kill();
  },
  mode === "full" ? 25 * 60_000 : 6 * 60_000,
);
const inventory = setTimeout(() => {
  const group = processes().filter(
    (p) =>
      p.pid === app.pid ||
      (!previous.has(p.pid) && p.name.includes("/WebKit.framework/")),
  );
  writeFileSync(
    `${output}/processes.json`,
    JSON.stringify(group, null, 2) + "\n",
  );
  if (mode === "memory") {
    memory = spawn("/usr/bin/footprint", [
      ...group.flatMap((p) => ["-p", String(p.pid)]),
      "--noCategories",
      "-f",
      "bytes",
      "--sample",
      "0.1",
      "-j",
      `${output}/memory.json`,
    ]);
    memory.stdout!.pipe(createWriteStream(`${output}/memory.txt`));
    memory.stderr!.pipe(createWriteStream(`${output}/memory-errors.txt`));
  }
}, 1000);
createInterface({ input: app.stdout }).on("line", (line) => {
  if (!line.startsWith("TW_PERF ")) return;
  raw.write(line.slice(8) + "\n");
  const event = JSON.parse(line.slice(8));
  console.log(
    JSON.stringify({
      kind: event.kind,
      fixture: event.fixture,
      scenario: event.scenario,
      repetition: event.repetition,
      frame: event.frameSummary,
      initialReadyMs: event.initialReadyMs,
      size: event.size,
      error: event.error,
    }),
  );
  if (event.kind === "complete" || event.kind === "failure") {
    finished = true;
    clearTimeout(timeout);
    memory?.kill("SIGINT");
    if (event.kind === "failure") process.exitCode = 1;
    if (!args.includes("--keep-open")) setTimeout(() => app.kill(), 1000);
  }
});
app.on("exit", () => {
  clearTimeout(timeout);
  clearTimeout(inventory);
  memory?.kill("SIGINT");
  raw.end();
  errors.end();
  if (!finished) {
    console.error("App exited without completing benchmark");
    process.exitCode = 1;
  }
});
process.on("SIGINT", () => {
  app.kill();
  memory?.kill("SIGINT");
});
