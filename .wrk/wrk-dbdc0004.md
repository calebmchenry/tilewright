---
id: wrk-dbdc0004
title: 'TW-039: Define recovery cadence, identity, retention, and restore policy'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-5e7adb66
priority: high
labels:
  - v1
  - recovery
  - decision
fields:
  sequence: 39
  source: INTENT.md
---
## Outcome

Specify crash recovery that preserves unsaved work independently of explicit saves.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Remaining implementation decisions.

**Execution order:** 39 of 54. Phase: recovery.

**Prerequisite:** [wrk-5e7adb66](wrk-5e7adb66.md) — TW-038: Wire macOS File/Edit actions and Cmd+S to the document workflow.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Choose a local recovery location, document identity scheme, debounce/interval policy, and snapshot retention/cleanup rules.
- Specify recovery metadata for untitled/saved documents, newer-than-save detection, and a clear restore/discard interface.
- Define behavior for explicit save, normal quit, deliberate discard, failed snapshot, stale data, and corrupted recovery entries.

## Acceptance criteria

- [x] Recovery files never silently replace or update the last explicitly saved project.
- [x] Policy covers untitled work and documents whose path changes through Save As.
- [x] A restored revision has clearly defined path/dirty behavior and still requires an explicit save to update a project file.
- [x] Cadence and retention are documented implementation choices with bounded disk use and measurable overhead.

## Validation

- Walk through crash before first save, crash after additional unsaved edits, save during snapshot, and normal discard.
- Confirm the restore policy preserves a readable last-save copy and makes conflicting/stale versions understandable.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-040: Write atomic local recovery snapshots without touching project files](wrk-ff878665.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), executed in this Codex session without delegation.
WRK is the sprint record; no separate sprint document or ledger was created.
Prerequisite wrk-5e7adb66 was done before starting. Read AGENTS.md, INTENT.md,
README, ticket-runner, desktop/foundation/editor/history/project-format guidance,
the relevant performance protocol, and TW-040/TW-041/TW-042 scope. Inspected the
current snapshot/history, workspace, project-file and lifecycle boundaries.
Fetched the skill weather report (gpt-6-astra was its coding recommendation);
continued in this session as requested. The index was initially empty; the
pre-existing `.wrk/wrk-58cdb442.md` edit is preserved and excluded.

- [x] Phase 1: establish the policy scope, completed prerequisite, current
  persistence/lifecycle contracts, validation commands and commit conventions.
- [x] Phase 2: document recovery decisions, connect existing guidance, and review
  the required crash/save/discard traces against the current code.
- [x] Phase 3: complete build/test/format checks, verify every acceptance criterion,
  preserve the original ticket body and record actual evidence.

Implementation/decision locations:

- `docs/recovery-policy.md`: complete TW-039 decision record. Defines the native
  application-data location, random lineage identity stable through Save As,
  writer/epoch/sequence metadata, canonical payload and saved-file fingerprints,
  atomic generation publication, controller-bound acknowledgement, lifecycle
  ordering, discovery classification and restore/discard interface.
- Cadence: 2-second trailing debounce, 10-second maximum eligible scheduling
  delay, minimum 5 seconds between capture starts; one active job and coalesced
  pending work. Busy operations, suspension and I/O can extend durable latency;
  failed snapshots retain the last completed copy and visible feedback.
- Retention: two retained generations per lineage, one global pending/rotation
  allowance, at most ten unresolved lineages and a 1 GiB logical-byte cap that
  includes temporary/invalid data. Reserve 64 KiB for state-marker replacement.
  Thirty-day-old entries are labeled for review; the last unresolved valid copy
  is never silently evicted. Full storage pauses recovery visibly.
- Restore: fully validate a selected generation and install fresh dirty history
  with null saved path and no native write handle. Cmd+S prompts for a destination
  with a recovered-name suggestion; the original can change only through an
  explicit save. Restore retains the checkpoint for a second crash before saving.
- `README.md`, `docs/project-format.md`, `docs/command-history.md` and
  `docs/performance.md`: link the policy, clarify dirty/pathless restoration and
  capture ordering, and distinguish production cadence from the existing forced
  5-second benchmark workload.
- `package.json`: add the decision record to both existing formatting scripts.
  No application, codec, native command, dependency or recovery runtime was added.

Actual policy validation:

- Reviewed all thirteen state traces in `docs/recovery-policy.md` against the
  existing implementation contracts. Crash before first save offers only the last
  complete untitled snapshot; crash after additional edits offers the captured
  revision while leaving explicit bytes unchanged. Pending writes never count as
  recoverable snapshots, and uncaptured edits are not claimed as preserved.
- Save during snapshot uses an epoch fence: a delayed candidate cannot publish
  after invalidation, and edits during the explicit save remain dirty. Save As
  retains identity and only updates destination context after success. No recovery
  action obtains an implicit original-file write grant.
- Normal discard records a durable marker before deletion/close, preventing late
  writes or interrupted cleanup from resurrecting discarded data. Failed/canceled
  Open keeps the outgoing map and recovery. The final transition gates edits;
  returning to the saved revision resolves stale recovery, and redo reactivates
  it in a new epoch. Marker failure preserves the live workspace with feedback.
- Fingerprint review distinguishes already-saved duplicates, divergence from the
  last known save, external changes, unavailable originals and uncertain context.
  Corrupt newest entries can expose a validated older fallback, with its actual
  time; invalid/unsupported entries cannot block normal launch or silently load.
- Checked the pinned local Tauri 2.12.7 path implementation: app_data_dir uses the
  application identifier under data_dir; on macOS data_dir is Library/Application
  Support. This confirms the documented root for app.tilewright.desktop.
- A Python documentation check passed all seven policy links and their anchors,
  the four guidance backlinks, and format-script inclusion. Arithmetic confirmed
  three maximum-size generations use 805,502,976 bytes; with ten state files and
  one reserved replacement, 806,223,872 bytes fits below 1,073,741,824. Ten maximal
  lineages do not fit, so the byte ceiling correctly takes precedence.
- Calculated four scheduling examples from the documented formula: first quiet
  change due at 2s; continuous changes due at 10s; a change at 2.1s after a 2s
  capture due at 7s; continuous changes starting at 7.1s due at 17.1s. These are
  policy arithmetic checks, not tests of an implemented recovery scheduler.

Actual regression validation (all passed):

- `npm run build`: strict TypeScript and production Vite build passed.
- Final `npm test`: **373 domain tests and 137 Playwright tests passed**, with no
  failures, skips or cancellations; browser suite completed in **6.9 minutes**.
  Existing tests cover independent save/recovery checkpoints, immutable snapshots,
  full codec fidelity, asynchronous save edits, failed/canceled transitions,
  file/menu/shortcut workflows and renderer/selection regressions.
- `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --locked
  --manifest-path src-tauri/Cargo.toml`: **9 passed**. These existing native tests
  include interrupted explicit writes, real/injected write/sync/rename failures,
  original-byte preservation and readable last-save copies.
- Final `npm run format:check` and `git diff --check`: passed. The policy is
  included in normal Prettier checks; existing Rust formatting also passed.
- Compared `.wrk/wrk-58cdb442.md` byte-for-byte with its starting copy: unchanged.
  Logs are retained locally in ignored `.wrk-runs/wrk-dbdc0004-validation/` as
  `build.log`, `test.log`, `native-test.log`, `format.log` and `policy-review.log`.

Acceptance review:

1. Separate native recovery authority and storage prohibit recovery writes,
   rotation, restore or discard from modifying explicit project files.
2. Identity/metadata rules cover never-saved maps, independent openings of the
   same path, successful/canceled Save As and incomplete save receipts.
3. Restored sessions are explicitly dirty and pathless, have fresh history and
   require a user-selected explicit Save before changing any project file.
4. Cadence, retention, temporary-space accounting, full-store feedback and exact
   measurement boundaries are documented implementation choices with bounded
   managed disk use and a measurable overhead protocol.

Limits and next scope: this is the requested decision ticket, not an implemented
recovery scheduler/store/interface. The walkthroughs are policy validation; the
existing regression suites do not prove future recovery crash behavior. TW-040
implements writing/lifecycle integration, TW-041 discovery/restore/discard, and
TW-042 packaged fault-injection/force-quit evidence. No recovery runtime timing,
peak memory, packaged restore or performance budget pass is claimed. Existing
Vite bundle-size warning and performance refinement remain TW-049/TW-050, with
persistence profiling in TW-051, per AGENTS.md. No other ticket was implemented.
