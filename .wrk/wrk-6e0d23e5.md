---
id: wrk-6e0d23e5
title: 'TW-049: Meet final populated-map rendering and navigation budgets'
status: blocked
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-74cf177c
priority: high
labels:
  - v1
  - release
  - verification
fields:
  sequence: 49
  source: INTENT.md
---
## Outcome

Confirm the complete editor remains responsive near 100 by 100 chunks.

## Source and scope

**Source:** INTENT.md — Map size and navigation; INTENT.md — Chosen technology; INTENT.md — First-version success criteria.

**Execution order:** 49 of 54. Phase: release.

**Prerequisite:** [wrk-74cf177c](wrk-74cf177c.md) — TW-048: Validate the complete drawing, rearrangement, and annotation session.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Rerun the early benchmark suite with all tools, panels, annotations, layers, and registry behavior enabled in a release-like macOS build.
- Profile detail editing, overview navigation, layer composition, label culling, cache updates, and repeated document/view changes.
- Fix regressions against the chosen budgets and document the final supported fixture envelope.

## Acceptance criteria

- [ ] Results cover approximately 6,400 by 6,400 maps with quantified populated areas and overlapping layers, not just empty canvases.
- [ ] Frame time, input latency, CPU/GPU memory, cache rebuilds, and repeated-navigation memory behavior meet documented budgets.
- [ ] Zoom transitions, registry recolors, and label tiers remain visually correct under stress.
- [ ] Any remaining limitation is measured and reconciled with core responsive-navigation requirements before closure.

## Validation

- Record reproducible release-build measurements with hardware and fixture statistics.
- Compare against the early gate and inspect long-session resource growth.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-050: Meet final large-edit and undo memory/latency budgets](wrk-e61b329b.md).

## Deferred TW-011 work — user decision, 2026-11-18

The user accepted the early baseline to prioritize feature development and
explicitly deferred performance refinement. TW-011 closes under that revised
scope; its original performance gate has not passed. This ticket retains its
existing late-backlog dependency and owns the following follow-up:

- Obtain valid presented-frame and input-to-display timing with input-ID
  correlation at fixed 60 Hz in the complete native editor. Earlier Instruments
  captures returned impossible multi-year lifetimes or no frame events; rAF and
  submission timing remain proxies. Diagnose the capture setup or use calibrated
  external capture, then repeat the documented protocol.
- Repeat populated-fixture stress navigation and visual/input correctness in the
  complete editor; inspect long-session renderer/cache resource growth.
- Use `docs/native-performance.md`, `docs/native-performance-baseline.json` and
  the compressed native performance/presentation samples as the retained baseline.
  Preserve invalid/occluded diagnostic runs as explicitly invalid evidence.
- Coordinate large-edit/history memory and scheduling work with TW-050. Do not
  require this follow-up before intervening feature tickets can complete.

## Execution record — blocked at measurement preflight (2026-11-19)

Strategy A (Orchestrated), in this Codex session without delegation; WRK state
replaces the sprint ledger. Started with `wrk update wrk-6e0d23e5 --status
in-progress`. Prerequisite `wrk-74cf177c` is done. Source revision:
`5b68ab01ca9a06a3b653821e30d24e1b83b13562`.

Read the requested sprint-execute skill, AGENTS.md, ticket runner, README,
INTENT.md, desktop development, performance budgets and native performance
baseline/protocol. Fetched the weather report (gpt-6-astra coding recommendation);
retained the user's selected in-session Strategy A.

### Phase checklist

- [x] Read sprint, prerequisite status, build/test commands and commit guidance.
- [ ] Establish valid native measurement conditions and presentation capture.
- [ ] Profile complete-editor populated fixtures and repeated navigation/views.
- [ ] Fix measured regressions and validate visual/data correctness.
- [ ] Run final regression and reconcile every budget/limitation; commit completion.

### Blocker and actual evidence

`docs/native-performance.md` (Reproduce) and `docs/performance.md` (Named baseline
and build modes) require AC power, Low Power Mode off and fixed 60 Hz for the
release baseline. Repeated `pmset -g batt` queries returned:

```text
Now drawing from 'Battery Power'
2%; discharging; 0:07 remaining present: true
Battery Warning: Final
```

The machine is not on AC power and has critically low battery. A sustained native
performance/long-session resource run cannot satisfy the documented power
precondition in this unattended session. Connecting external power cannot be done
by repository code. No timing budget was relaxed and no battery-mode run was
substituted for release acceptance evidence. `pmset -g custom` reports
`lowpowermode 0` for both power profiles; low-power mode is not the blocker.

Additional preflight: `system_profiler SPDisplaysDataType` reports Apple M1 Pro,
14 GPU cores, built-in 3024×1964 display. Fixed 60 Hz was not established.
`xcrun xctrace version` reports 26.0 (17C529), distinct from the historical report's
26.3 description; its presentation capture has not been revalidated. Shell Node
is v22.11.0 and must be switched to the repository's pinned 24.22.3 before builds;
Rust is the pinned 1.100.0. These checks exited zero. Exact timestamped preflight
outputs are retained locally in
`.wrk-runs/wrk-6e0d23e5-validation/preflight.json`.

No new release measurements, build, tests or implementation changes were made.
All four acceptance criteria remain unchecked. Prior TW-011 proxy timings and
invalid presentation traces remain historical evidence, not a TW-049 pass.
The earlier performance deferral applies to intervening feature tickets and does
not remove this ticket's rendering/presentation gate.

### Resume requirement and disposition

Connect this Mac to AC power with sufficient charge, then resume this ticket.
Establish/record fixed 60 Hz and working input-ID-correlated native presentation
measurement (or calibrated external capture) before claiming presentation/input
budgets. Continue with the complete-editor harness, both populated fixtures,
cache/visual correctness, repeated navigation/document changes and long-session
resource evidence required above. Large-edit/history work remains TW-050's scope.

Marked blocked through WRK under the user's explicit incomplete-work instruction.
No completion commit was created because the ticket is incomplete. Only this
ticket's record was changed; the pre-existing `.wrk/wrk-58cdb442.md` edit and all
staged work are preserved. No other ticket was executed.

## Restart preparation (2026-11-19T19:19:58+00:00)

The user requested preparation for a manual runner restart after the battery
ran out. Current `pmset -g batt` reports AC Power, 2% and charging;
`pmset -g custom` reports lowpowermode 0 for both profiles. The prior AC-power
blocker is cleared while the Mac remains connected to power. Available disk
space is approximately 45 GiB. The pinned Node v24.22.3 is installed and verified
with `nvm use`; WRK, Codex, Python 3, caffeinate, the executable runner and its
sprint-execute skill are available. No existing ticket runner was active.

Requeued through WRK for the user's manual launch. Continue the original TW-049
scope and preserve its prior evidence. Fixed 60 Hz and working presentation/input
capture still need to be established and recorded during execution; this restart
preparation is not a benchmark pass or completion claim. Keep the Mac on AC power.
The launch command uses caffeinate to prevent idle system and display sleep.
No implementation changes were left by the blocked attempt. Preserve the
unrelated `.wrk/wrk-58cdb442.md` change. The runner has not been started here.

## Resumed execution (2026-11-19)

Strategy A, in this Codex session without delegation; WRK replaces the ledger.
Marked in-progress through WRK. Read the full ticket, prior blocked/restart
records, prerequisite and relevant project guidance. The weather report still
recommends gpt-6-astra for hard coding; no strategy/model change was made.

- [x] Confirm prerequisite TW-048 is done and preserve unrelated work.
- [x] Clear environmental preflight: AC power, Low Power Mode off; temporarily
  set the built-in display from ProMotion to fixed 60 Hertz using System Settings.
- [x] Rebuild the release benchmark with pinned Node 24.22.3 / Rust 1.100.0.
- [ ] Establish valid native presentation capture and input-ID correlation.
- [ ] Profile the complete editor on both populated fixtures, including labels,
  recolors, layer composition, cache refresh and repeated document/view changes.
- [ ] Fix regressions, run final validation, reconcile all budgets, then commit.

Evidence is retained in `.wrk-runs/wrk-6e0d23e5-validation/`.
`resume-build-performance.log` records successful release build/typecheck.
`resume-preflight.json` records commands, machine/power/toolchains and refresh
setup. Animation Hitches capture and the alternative Metal System Trace both
recorded successfully but did not produce valid presentation events. The final
Instruments-launched capture also failed to establish presentation. No acceptance
criterion is complete. The full ticket and previous evidence remain intact.

### Capture investigation and blocking evidence (2026-11-19T19:28Z)

The AC-power blocker is cleared. The resumed run is blocked on the **native
presentation/input-to-display measurement gate**, not on the battery or the
ordinary build. All three capture attempts were at fixed 60 Hertz, with AC power
and Low Power Mode off, embedded release WKWebView/WebGL2 assets, a visible
always-on-top benchmark and a 1024×640 CSS-pixel canvas at DPR 2. System Settings
confirmed 60 Hertz immediately before and after the captures. Original ProMotion
was restored and verified afterward. All benchmark/profiler processes exited.

Machine remains TW-M1Pro-16: MacBookPro18,3, Apple M1 Pro, 16 GiB, macOS 15.8.1
(24H32), built-in 3024×1964 display. `xcodebuild -version` reports **Xcode 26.3,
build 17C529** and `xcrun xctrace version` reports **26.0 (17C529)**. These are the
same installed suite; the earlier preflight's apparent Xcode version discrepancy
is not an established cause. Root cause of the invalid/missing trace events is
not established. No OS/toolchain/security settings were changed. Other desktop
applications remained running; these were diagnostic captures, not clean timing
acceptance runs. The Metal diagnostic also overlapped export of the first trace.

| Capture | Actual result | Disposition |
| --- | --- | --- |
| `capture-preflight.trace`, Animation Hitches, all processes, 20 s limit (21.224171 s recorded) | xctrace exit 0; 18/18 lifetime rows outside trace duration, with durations around 801,739,055 seconds; zero CA commit, displayed-surface, surface-swap and vsync rows | Invalid for presentation or input latency |
| `metal-preflight.trace`, Metal System Trace, all processes, 20 s limit (20.889733 s recorded) | xctrace exit 0; 6,275 command-buffer/frame-assignment rows but zero displayed-surface, surface-swap and vsync rows | GPU work is recorded; no evidence of the first displayed result of an input |
| `launch-preflight.trace`, Animation Hitches launching the app, 25 s limit (25.995141 s recorded) | Saved trace and successful exports; xctrace exit 54; 11/11 lifetime rows outside trace duration, durations around 801,718,965 seconds; zero CA commit/displayed-surface rows | Invalid; target benchmark was interrupted at trace limit, not a completed run |

Reproduction commands (from repository root with pinned Node selected):

```sh
npm run build:performance
npm run perf:native -- --mode quick --output <new-evidence-dir>/native
# While that native diagnostic is running, use one template per separate run:
xcrun xctrace record --template 'Animation Hitches' --all-processes --time-limit 20s --output <new-evidence-dir>/hitches.trace
xcrun xctrace record --template 'Metal System Trace' --all-processes --time-limit 20s --output <new-evidence-dir>/metal.trace
# Separate diagnostic launching the target through Instruments:
xcrun xctrace record --template 'Animation Hitches' --time-limit 25s --env TILEWRIGHT_PERFORMANCE_MODE=quick --target-stdout <new-evidence-dir>/native.log --output <new-evidence-dir>/launch.trace --launch -- "$PWD/src-tauri/target/release/bundle/macos/Tilewright Performance.app/Contents/MacOS/tilewright"
xcrun xctrace export --input <trace> --toc --output <toc.xml>
xcrun xctrace export --input <trace> --xpath '/trace-toc/run[@number="1"]/data/table[@schema="hitches-lifetime-interval"]' --output <lifetimes.xml>
```

Export the corresponding `hitches-ca-commit-interval`,
`displayed-surfaces-interval`, `display-surface-swap`, `display-vsyncs-interval`
and `metal-command-buffer-frame-assignment` tables as applicable.
`summarize-captures.py` in the local evidence directory resolves XML references,
checks lifetime starts/durations against the recorded run length, and regenerates
`capture-summary.json`, `resume-capture-evidence.json.gz` and the SHA-256 manifest
`resume-evidence-manifest.json`. The compressed archive retains raw exported XML,
runner events, source/executable hashes, process inventories, logs and the parser.
Original trace bundles remain adjacent. The historical checked-in TW-011 JSON
and compressed samples were not overwritten. Invalid and interrupted evidence is
explicitly retained, not discarded or counted as a pass.

The measurement boundary follows the existing protocol and Apple's
[frame lifetime explanation](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app):
GPU submission/completion or a following rAF does not identify the first displayed
frame containing a particular input. The current captures cannot support that
correlation. No calibrated external capture equipment/workflow is available in
this session. Replacing this boundary with a JS proxy would leave the ticket's
explicit deferred requirement unmet.

### Validation actually completed on resumption

- `npm run build:performance` passed, including both TypeScript checks, production
  Vite assets, optimized Rust build and macOS app bundling. The existing Vite
  large-chunk advisory remains. Executable SHA-256:
  `c4e99312135b7c4def927224fe5af3e6d4c9df5255ac3bac2a27a18e27cbfd50`.
- Two separate `perf:native -- --mode quick` diagnostics completed with exit 0
  and no failure events. Each retained 42 events, four navigation runs and four
  reported pixel-check passes, plus command/undo restoration and bounded cache
  invalidation assertions. Both used the complete stored frontier/heartland
  fixtures with four overlapping layers and 6,620,700 / 24,025,200 occupied
  layer cells. They are the **existing isolated TW-011 harness**, without the
  complete production React shell/tools or 1,089-area annotation stress. They
  do not pass this ticket's complete-editor acceptance criteria.
- `git diff --check` and `wrk validate` passed (57 tickets). No full domain/UI
  regression, ordinary release build, physical-memory/long-session run or final
  performance-budget validation was claimed or substituted for the missing
  presentation precondition. No production code or harness implementation changed.

### Resume requirement and disposition

Establish a valid native frame/presentation trace with input-ID correlation on
this machine, or provide a calibrated external capture setup. Investigate the
capture/toolchain issue before another acceptance run; simply rerunning the same
three captures has not fixed it. Then implement the complete-editor harness and
finish every remaining phase above, including both populated fixtures, actual
tool inputs, panel/annotation/layer/registry behavior, repeated document/view
changes, resource-growth measurements and final budget reconciliation. The old
performance deferral does not waive TW-049's gate. TW-050 remains untouched.

Marked **blocked** through WRK under the user's incomplete-work instruction.
All four acceptance criteria remain unchecked. No completion commit was created
because the ticket is incomplete. Only this ticket's WRK record changed; all
new diagnostic artifacts are local ignored files. The unrelated pre-existing
`.wrk/wrk-58cdb442.md` change is preserved and the Git index remains untouched.
