---
id: wrk-ae1f5f2b
title: 'TW-045: Add native agent-export action, progress, and reliable output writes'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-5e43190b
priority: normal
labels:
  - v1
  - export
  - implementation
fields:
  sequence: 45
  source: INTENT.md
---
## Outcome

Let an author save an agent-readable whole-map result as a separate local file.

## Source and scope

**Source:** INTENT.md — Project files and agent exports; INTENT.md — Local operation.

**Execution order:** 45 of 54. Phase: export.

**Prerequisite:** [wrk-5e43190b](wrk-5e43190b.md) — TW-044: Implement whole-map agent export with complete semantic content.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Provide a clearly named Export for Agent action and native destination dialog with the chosen format/extension.
- Integrate snapshot/codec output, responsive progress and cancellation for large exports, and reliable file replacement.
- Keep export lifecycle distinct from project save/recovery state and prevent accidental overwriting of the active project path.

## Acceptance criteria

- [x] Export writes the complete current committed map to a separate chosen file, including unsaved edits.
- [x] Export does not mark the project saved, change its active path, replace its project file, or discard recovery state.
- [x] Cancellation and write failures give clear feedback and leave no apparently successful partial export.
- [x] The operation works offline in the packaged app and remains responsive for target-scale maps.

## Validation

- Export an unsaved edited project, then inspect dirty state, original project bytes, recovery data, and output.
- Test cancel, existing destination, unwritable location, and large-export progress.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-046: Verify agent-export completeness with an independent consumer fixture](wrk-d0e8e734.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session without delegation,
using WRK state instead of a sprint ledger. Prerequisite wrk-5e43190b is done.
Read the sprint-execute skill, AGENTS.md, ticket runner, INTENT.md, README and
relevant desktop, foundation, project-format, recovery-policy, agent-format and
performance guidance. Fetched the skill weather report (gpt-6-astra coding
recommendation); retained the requested in-session strategy.

- [x] Phase 1: native destination protection, staged atomic output, independent
  export coordinator and functional/failure tests.
- [x] Phase 2: toolbar/File-menu/shortcut action, progress and cancellation,
  shared operation gating and shipping UI/IPC validation.
- [x] Phase 3: packaged native checks, full regression, acceptance review and
  implementation/validation evidence.

## Implementation and decisions

- `src/editor/agent-export.ts`: independent `AgentExports` coordinator captures
  the whole committed revision before the native picker, including unsaved edits.
  No save/recovery acknowledgement, history mutation, path association or recovery
  resolution occurs. Edits during encoding/writing stay in the editor for the next
  export. Failure, cancellation and successful publication have separate feedback.
- `src/domain/agent-export.ts`: optional actual encoded-byte progress callback;
  the existing bounded asynchronous encoder and cancellation signal are retained.
  UI uses an indeterminate progress bar and KiB encoded, without inventing a total.
- `src/native/agent-export.ts`, `src-tauri/src/agent_export.rs`: four narrow
  picker/prepare/commit/cancel commands with separate single-use handles. JSON
  default is `<name>.agent-map.json`; native panels own extension and overwrite
  confirmation. Binary IPC is capped at 256 MiB. Blocking workers prepare a private
  sibling, write and sync complete bytes, then publish with atomic rename and
  parent-directory sync. Existing Unix modes are preserved; new files are private.
  Native cancellation discards the unpublished sibling after pending preparation
  settles. The short final publication phase is explicitly noncancelable. A
  post-rename directory-sync failure reports a completed export with a durability
  warning, never a false failed/canceled write.
- Canonical path and device/inode checks reject the active project and symlink /
  hard-link aliases, including projects opened with a JSON suffix. Non-JSON
  resolved targets, substituted symlinks, nonregular/read-only destinations,
  missing parents and unwritable folders reject without truncating the destination.
  `project_files.rs` exposes only its existing path-normalization helper for reuse.
- `src/editor/document-lifecycle.ts`, `src/editor/application-actions.ts`,
  `src-tauri/src/application_menu.rs`, `src/main.tsx`, `src/App.tsx`, and
  `src/FileControls.tsx`: Export for Agent toolbar/File menu and Cmd+Shift+E share
  the document-action gate. New/Open/Save/restore/close cannot race an export;
  ordinary editing and automatic recovery continue. Native file panels retain
  their own text editing and Cancel. Main-window capability/build command lists
  and generated narrow permissions are updated; no general filesystem, shell,
  remote or dialog-plugin authority is added.
- `tests/domain/agent-export-files.test.ts`, export cases in
  `tests/project-files.spec.ts`, and native `agent_export.rs` tests cover snapshots,
  late edits, path/checkpoint/history isolation, cleanup, failure stages,
  cancellation, target-scale progress, overwrite, aliases, native menu events,
  shortcut dispatch, recovery while exporting and 640-pixel layout.
- `docs/agent-export-format.md#native-export-workflow-tw-045`, README and desktop
  development guidance record the behavior, native authority and limitations.

## Actual validation evidence

Environment: macOS 15.8.1 (24H32), Darwin arm64; pinned Node v24.22.3 and repository
Rust toolchain. Logs and native comparison evidence are retained locally in
`.wrk-runs/wrk-ae1f5f2b-validation/` (ignored artifacts).

- Phase 1: `npm run build` passed; 23 focused agent codec/coordinator tests passed;
  `npm run test:domain` passed 421/421; five new native export tests and Clippy passed.
- Phase 2: build and 36 focused export/application-action/lifecycle tests passed;
  four focused Chromium checks passed, including native-adapter export and narrow
  layout. The native bridge alone is substituted in these browser tests.
- Final frozen-source `npm test`: **422/422 domain tests and 145/145 Chromium
  WebGL browser tests passed**, no skips. Browser suite completed in 7.6 minutes.
  Source stayed unchanged during this run, including the native validation work.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 31/31 passed.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`:
  passed without warnings.
- `npm run build:desktop`: production release macOS bundle passed. An isolated
  build using product `Tilewright TW045` / identifier `app.tilewright.tw045check`
  also passed, using the same implementation and embedded frontend. The isolated
  identifier keeps existing user recovery data untouched.
- `npm run format:check`, `git diff --check` and `wrk validate`: passed.
- The first shell validation selected global Node 22.11.0 and could not run native
  TypeScript tests. Switched PATH to the already-installed pinned Node 24.22.3;
  all subsequent builds/tests used that version. Two test-only TypeScript errors
  during development were fixed before the passing phase-1 build. No product
  assertions were weakened or skipped.

### Actual packaged native scenarios

Operated the embedded `tauri://localhost` release WKWebView and real macOS panels
with test projects under `/private/tmp/tw045-native-validation/`. The production
CSP permits native IPC only, and this workflow performs no network requests or
runtime-server calls. A separate Vite server served the concurrent Chromium suite;
it was not the packaged app's origin. Network interfaces were not disabled.

1. Opened the reviewed semantic example and renamed Terrain to
   `Unsaved native export` without saving. Cmd+Shift+E opened the native JSON panel
   with `example.agent-map.json`; Cancel produced clear cancellation feedback.
   The original path and Unsaved status remained, with a ready recovery checkpoint.
2. Exported via the real File > Export for Agent menu. Independently parsed the
   result and compared every field with the reviewed example plus the unsaved
   layer-name edit. Output was 1,147 bytes, SHA-256
   `0cea30332e40ccdc730b996793ace7d18ab00f8214b8418a3f876906e70d3fd9`.
   Original project SHA-256 remained
   `0cfc8155b40de2d8bb3bc77f499a8d2493a81a48a92daa2acadd615946807761`.
   Recovery state, payload, metadata and lock bytes were identical before/after.
   The UI retained Unsaved, original path and Undo Rename layer.
3. Repeated export to the same destination, accepted the native Replace prompt,
   and verified exact output bytes plus unchanged original/recovery bytes.
4. Made only the test export read-only and repeated replacement. Native feedback
   reported permission denied with writable-folder guidance. The previous export,
   original project and recovery bytes were unchanged, with no temporary sibling.
   Restored the test file mode afterwards.
5. Loaded the complete heartland fixture: 6,400 × 6,400, four layers and 1,089
   areas. Native export displayed an indeterminate progress bar, a live encoded-KiB
   count and Cancel export. One run completed before a subsequent click could
   cancel; it correctly reported success. A second run canceled during encoding
   at roughly 2,241 KiB and reported `Export canceled. No output file was changed.`
   That second chosen output did not exist and no temporary sibling remained.
6. The completed native heartland file was byte-identical to an export built from
   the full real fixture document: 8,080,454 bytes, 470,490 canonical runs and
   24,025,200 occupied layer cells, all four layers and 1,089 areas. SHA-256:
   `8748be7e27d236d74c795647a565ed37cba40694551c918cd5d763ee02e57e89`.
   Existing full-fixture tests additionally verify independent golden semantic
   hashes. The clean source remained Saved with its original path. Quit closed the
   isolated validation app normally.

## Acceptance review and limitations

All four criteria are covered by the coordinator, native fault tests, shipping
UI/IPC tests and actual native scenarios above. Export publishes unsaved committed
content, preserves explicit/recovery state, cleans uncommitted cancellation/error
output, and runs locally with visible progress/cancellation on populated target
maps. Native cancellation during temporary I/O waits for the blocking worker;
it cannot instantly interrupt an unavailable disk's system call. Snapshot capture
and final byte assembly retain synchronous work and transient memory copies.
Latency percentiles, peak memory and physical power-loss guarantees are not
claimed. Per AGENTS.md, performance-only refinements remain TW-049/TW-050, with
export profiling in TW-051. The existing >500 kB Vite bundle advisory remains
nonblocking. No scope deviation or additional ticket was introduced.

Unrelated `.wrk/wrk-58cdb442.md` work is excluded from this ticket's commit.
