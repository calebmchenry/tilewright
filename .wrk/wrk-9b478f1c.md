---
id: wrk-9b478f1c
title: 'TW-042: Verify crash recovery and persistence under interruption and failure'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-cd70e4f4
priority: high
labels:
  - v1
  - recovery
  - verification
fields:
  sequence: 42
  source: INTENT.md
---
## Outcome

Prove that saved and unsaved work remain distinguishable under realistic failures.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Project files and agent exports; INTENT.md — First-version success criteria.

**Execution order:** 42 of 54. Phase: recovery.

**Prerequisite:** [wrk-cd70e4f4](wrk-cd70e4f4.md) — TW-041: Implement startup recovery discovery, restore, and deliberate discard.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Build fault-injection coverage for encoding/write/replace failures, abrupt exit, and save/recovery races.
- Run packaged macOS scenarios for first save, repeated save, Save As, failed Open, recovery restore, and unsaved close handling.
- Fix any partial-file, lost-revision, misleading-dirty-state, or incorrect-retention defects.

## Acceptance criteria

- [x] The last successful explicit save remains loadable after interrupted writes and recovery attempts.
- [x] A crash after unsaved edits restores the latest complete recovery snapshot without claiming uncaptured edits were preserved.
- [x] Canceled/failed operations neither replace the active document nor mark unsaved work clean.
- [x] Evidence covers overlapping layers, a recolored registry entry, independent named areas, and an untitled project.

## Validation

- Run deterministic I/O failure tests plus an actual force-quit/relaunch desktop smoke scenario.
- Compare saved file bytes and full document state at each recovery/save checkpoint.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-043: Specify a separate whole-map agent-export schema](wrk-eeabc6ef.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session; WRK replaces the sprint
ledger. Prerequisite wrk-cd70e4f4 is done. Read the requested sprint-execute skill,
AGENTS.md, INTENT.md, README, ticket runner and relevant recovery, project-format,
lifecycle, desktop, foundation, history, editor and validation guidance. Fetched
the weather report (gpt-6-astra coding recommendation); no delegation.

- [x] Phase 1: extend deterministic fault/race coverage and validate integrity.
- [x] Phase 2: packaged macOS file workflows, two SIGKILL/relaunch scenarios and
  exact checkpoint/full-state comparisons.
- [x] Phase 3: complete-suite validation, acceptance review and evidence recording.

## Implementation and decisions

- `src/editor/project-files.ts`: optional encoder injection matching the existing
  RecoveryCoordinator seam; production still uses the normal project encoder.
- `src-tauri/src/atomic_io.rs`, `recovery.rs`, `project_files.rs`: fault boundaries
  for pending-directory sync and explicit-save parent sync after atomic rename.
  Shipping callbacks remain no-ops; existing publication/dirty/retention policy
  is unchanged. No data-integrity defect was exposed by this campaign.
- `tests/domain/recovery.test.ts`: four new integration tests, including a
  12-case first/repeated/Save As encode/write/replace failure matrix. They compare
  entire canonical workspace/recovery bytes, history, dirty state, path and disk
  contents. Recovery encoding failure retains the previous capture/time; retry
  captures later edits. Delayed committed recovery acknowledgement racing Save As
  cannot clean or drop edits, and a failed native close after discard recaptures
  unchanged dirty content without another edit. The richer fixture recolors Grass
  and moves a building tile while leaving all named-area bounds/descriptions intact.
- `src-tauri/src/persistence_fault_tests.rs` (test-only module registered in
  `recovery_discovery.rs`): nine deterministic prepare faults distinguish state,
  payload and metadata partial writes/syncs, state rename/parent sync and pending
  directory sync. Restart discovers the preceding complete pair, explicit bytes
  are unchanged, retries advance sequences and retention stays at two generations.
  Seven real SIGKILL subprocess cases cover partial state/payload/metadata,
  pending-directory sync, before/after publication and after a discard marker
  before cleanup. Discovery selects only complete generations and durable discard
  does not resurrect; the process lock is reacquired after death.
- `src-tauri/src/project_files.rs`: eight SIGKILL subprocess cases cover first and
  repeated saves at partial write, file sync, before rename and after rename.
  Paths remain absent/old before publication and complete new bytes afterward;
  retries work despite orphan siblings. Post-rename directory-sync faults are
  successful commits with durability warnings for both first and repeated Save.
- `docs/recovery-policy.md#interruption-and-failure-verification-tw-042`: repeatable
  commands, boundary/assertion matrix, implementation locations, native desktop
  procedure and the distinction between process interruption and physical power loss.

## Actual validation evidence

Host: MacBookPro18,3, arm64, 16 GiB RAM, macOS 15.8.1 (24H32), about 29 GiB free.
Node 24.22.3 selected explicitly via PATH (the shell default is Node 22); pinned
Rust 1.100.0. Logs, captured files, metadata, comparison receipts and source hashes
are retained locally in `.wrk-runs/wrk-9b478f1c-validation/` (ignored artifacts).

- Baseline: **394 domain tests / 22 native tests passed** before implementation.
- Focused coordinator validation: **18 passed**, including four new tests and
  their parameterized failure cases.
- Final `npm test`: **398 domain tests and 142 Playwright tests passed**, zero
  failures/skips/cancellations; browser duration **7.7 minutes**. Implementation
  and test source stayed unchanged throughout this full run. The usual intentional
  unavailable-WebGL diagnostic was exercised by its passing recovery test.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: **26 passed**,
  including all 15 new SIGKILL child-process cases and nine prepare-fault points.
- `npm run build`: TypeScript and Vite passed.
- `npm run format:check`: Prettier and rustfmt passed, including final documentation.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`:
  passed without warnings.
- `npm run build:desktop`: final production `Tilewright.app` build passed.
- Isolated release package: `npx tauri build --config <qa.conf.json> --bundles app
  -- --locked` passed using product `Tilewright TW042` and identifier
  `app.tilewright.tw042check`, with the same implementation and embedded frontend.
- All ten recorded canonical desktop checkpoint files passed complete production
  decode/re-encode byte equality, including hidden content, registry associations,
  annotations, bounds and editor preferences. `desktop-evidence.json` records hashes.
- `wrk validate` and `git diff --check` passed. The original unrelated change to
  `.wrk/wrk-58cdb442.md` is byte-identical and excluded from this ticket's commit;
  the initial index was empty and unrelated staged/unstaged work is preserved.

### Actual packaged macOS scenarios

Used real WKWebView, native file panels and application Quit controls, with projects
in `/private/tmp/tw042-native-validation/` and the isolated app-data recovery root.
No existing user recovery store or project was modified.

1. **Untitled / uncaptured edit gap.** Renamed a never-saved map's layer to
   `Untitled TW042 checkpoint`. Canceled first Save and canceled Quit; it stayed
   Unsaved and its completed recovery remained. Renamed again to
   `Uncaptured edit after checkpoint`, immediately opened first Save (pausing new
   recovery), and verified on disk that complete snapshots still contained only
   the earlier name. SIGKILL terminated QA PID 96242 while the panel was open.
   Relaunch offered capture 3 with its time and the warning that later changes may
   be missing. Restore installed the earlier name, fresh empty history and Unsaved
   state. New recovery sequence 4 matched the pre-crash bytes exactly. The missing
   later edit was neither restored nor claimed preserved.
2. **First / repeated Save.** The recovered first Save picker suggested
   `Untitled (Recovered)` and wrote `untitled-first.tilewright`. Captured, restored
   and first-save payloads were byte-identical: **282 bytes**, SHA-256
   `36d91af030c4de4bac58aef5e3b7f35a15db02850d4c1c8aabf64ca436fcab44`.
   Renamed to `Untitled repeated save`, pressed Cmd+S, and compared the entire
   updated file against the expected document: **279 bytes**, hash
   `4f18fa0d0f0cd6a6158a28f58b99c4fa9bdf217360120a4b62311df547ce37bf`.
3. **Layered fixture / canceled Save As / failed Open and Save.** Opened the
   reviewed 6400 x 6400 fixture (three overlapping-content layers, three registry
   entries, three independent named areas, active/hidden Buildings). Recolored
   Grass from #629653 to #127844 in the actual editor. Canceled Save As. Chose
   Discard in Open, then selected malformed JSON: actionable parse error, same
   dirty map and undo action, and unchanged full recovery/source bytes. Made the
   test source read-only and pressed Cmd+S: native permission error, still dirty,
   exact original/recovery bytes preserved. Restored the test file's permission.
4. **Successful Save As.** Wrote `layered-saved-as.tilewright`; its **1,421 bytes**
   exactly matched the recolored recovery checkpoint, SHA-256
   `7bc8fbfc9df78e1f577e4884610d4502238fc0e0677f845a62eddb09914c96b4`.
   The original source was unchanged and the current document became Saved.
5. **Saved project / unsaved crash / restore.** Renamed hidden Buildings to
   `Recovered buildings TW042`, verified complete recovery sequence 5 against
   the source with only the intended recolor/rename, then SIGKILL terminated QA
   PID 97742. Relaunch showed the actual Save As source, capture/save times and
   Unsaved changes since last known save. Restore produced a dirty, pathless copy
   with empty history; its sequence 6 matched sequence 5 exactly: **1,437 bytes**,
   SHA-256 `c428c122bef6fa9a2dfeb82e8d6238f4779a382a35d25734bfd72f610c926ea3`.
   The complete payload comparison included all runs and underlying overlap,
   registry identity/recolor, independent area bounds/text/tiers, grown bounds,
   active layer and hidden layer preferences. Both explicit files stayed unchanged.
6. **Close Save/Cancel/Discard.** Quit + Save and continue + canceled native Save
   left the recovered document dirty and open. Retrying with Save and continue
   wrote `layered-recovered.tilewright` byte-identically to recovery, then exited;
   the recovery root contained only `.lock`. Relaunch had no old recovery offer.
   Opened the recovered explicit file successfully as Saved. Renamed its hidden
   layer to `Deliberately discarded TW042`, verified a complete **1,440-byte**
   checkpoint, then Quit + Discard changes exited. Next launch's recovery review
   listed only the new currently-open blank map; the discarded lineage was absent.
   Closed that blank map by Discard. Final root again contained only `.lock` and
   all three explicit save files retained their expected bytes.

Throughout the campaign the original fixture source remained SHA-256
`9ee9729d45758949e56fa04bf5ac6cdb08af4b88456cec082b7e4c1f4998fb75`.
Independent expected-state comparisons at each checkpoint were followed by full
production decoder/canonical encoder round trips of all captured desktop artifacts.

## Limitations and acceptance review

All four acceptance criteria and both requested validation workflows are met.
No product failure required a behavioral fix; this ticket adds executable evidence
and the missing injection seams. A local QA config generation typo was corrected
before its successful build; it did not affect app source or validation results.
Native path-field automation required setting its accessible value when simulated
text input did not fill the field; the actual Open/read and Save/write paths passed.
Background WKWebView discovery completed upon window activation. The packaged
windows used `tauri://localhost`; a separate browser-test Vite server ran during
part of the campaign. Network was not disabled, so no additional offline claim is
made. Existing Vite bundle-size warnings remain. Physical power loss, storage-device
loss and all performance budgets remain unmeasured; rendering/presentation belongs
to TW-049, large edit/history/memory to TW-050 and persistence profiling to TW-051
under the accepted delivery priority. No separate sprint document or extra tickets.
