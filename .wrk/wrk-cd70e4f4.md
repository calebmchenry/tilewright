---
id: wrk-cd70e4f4
title: 'TW-041: Implement startup recovery discovery, restore, and deliberate discard'
status: done
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-ff878665
priority: normal
labels:
  - v1
  - recovery
  - implementation
fields:
  sequence: 41
  source: INTENT.md
---
## Outcome

Let the author recover unsaved work after a crash with clear control over what is restored.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — First-version success criteria.

**Execution order:** 41 of 54. Phase: recovery.

**Prerequisite:** [wrk-ff878665](wrk-ff878665.md) — TW-040: Write atomic local recovery snapshots without touching project files.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Discover and validate recoverable snapshots at startup and present document identity, timestamps, and relevant saved-file context.
- Implement restore/discard actions under the recovery policy, including untitled projects and unavailable original paths.
- Handle invalid/stale entries without preventing normal application launch or silently destroying useful data.

## Acceptance criteria

- [x] Recoverable work is offered clearly after a crash and can be restored into an editable document.
- [x] Restore does not overwrite the original project file; explicit Save remains a separate deliberate action.
- [x] Discard targets the selected recovery data and does not delete the saved project.
- [x] Recovered layers, registry associations, annotations, bounds, and chosen settings match the captured revision.

## Validation

- Force-quit after unsaved changes, relaunch, restore, compare the model, then explicitly save.
- Exercise discard, stale/corrupt recovery, missing original file, and multiple available recovery candidates.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-042: Verify crash recovery and persistence under interruption and failure](wrk-9b478f1c.md).

## Execution record (2026-11-19)

Strategy A (Orchestrated), in this Codex session; WRK replaces the sprint ledger.
Read the requested skill, AGENTS.md, INTENT.md, README, ticket runner, recovery
policy, project-format/lifecycle, desktop, foundation, history and editor guidance.
Prerequisite wrk-ff878665 is done. Fetched the weather report (gpt-6-astra coding
recommendation); executing here as requested. Node 24.22.3 and pinned Rust 1.100.0.
The unrelated modification to .wrk/wrk-58cdb442.md is preserved and excluded.

- [x] Phase 1: native discovery, bounded inspection, lineage claim/discard and
  corruption isolation. 22 Rust tests pass; Clippy with -D warnings passes;
  frontend build and 387 existing domain tests pass.
- [x] Phase 2: restore lifecycle, review UI, source comparison and regression tests.
- [x] Phase 3: full validation, packaged crash/relaunch, acceptance review and commit.

## Completed implementation and decisions

- `src-tauri/src/recovery_discovery.rs`, `recovery.rs`: independent lineage
  discovery under the existing process lock; bounded, no-follow metadata/payload
  reads with identity/shape/size/SHA-256 validation; advisory saved-source reads
  without granting a file handle; fresh-writer claims retaining the selected
  snapshot and sequence; release of uninstalled claims; durable selected-lineage
  discard before deletion. Corrupt entries produce warnings without blocking
  normal launch or other candidates. Unknown layouts/store versions are preserved.
  Native live-lineage checks reject list restore/discard of the open document.
- `src/editor/recovery-discovery.ts`, `src/native/recovery.ts`: sequential complete
  project decoding before enabling Restore; canonical comparison with saved bytes,
  stale-match suppression of urgent prompts, baseline/formatting/conflict/missing
  context, age/clock labels, and conservative unknown relationship when a later
  Save As receipt differs from capture context. No cached collection of decoded maps.
- `src/RecoveryPanel.tsx`, `App.tsx`, `main.tsx`, `styles.css`, `FileControls.tsx`:
  startup review, same-source grouping with distinct identities, captured/source/
  latest-save times and paths, previous-generation choice and corrupt fallback,
  persistent Review recovery entry point, named discard confirmation and current
  map protection. Not now/Escape retains data even while a read-only scan finishes.
- `src/editor/document-lifecycle.ts`, `workspace.ts`, `recovery.ts`: guarded restore
  with checksum recheck, private full construction, final authorized-version check
  and edit gate. Claim precedes outgoing resolution, and a failed outgoing marker
  releases the claim without consuming either checkpoint. Install creates fresh
  dirty history with no saved path, resets transient state, fits the map, restores
  all captured preferences and resumes the selected lineage with a new writer.
- `src/editor/project-files.ts`, `src/native/project-files.ts`,
  `src-tauri/src/project_files.rs`: recovered copies have no native association;
  first Save requests a destination with a sanitized Recovered name suggestion.
  Only deliberate explicit Save writes a project file.
- Native registration/capabilities and five generated permissions grant only the
  specific recovery operations. Decisions and validation boundaries are documented
  in `docs/recovery-policy.md#discovery-and-restoration-implementation-tw-041` and
  linked from README.

## Actual validation evidence

Final source remained unchanged throughout the complete test run. Logs, captured
bytes, comparison receipts, source hashes and the 28-file commit manifest are
retained locally under `.wrk-runs/wrk-cd70e4f4-validation/` (ignored artifacts).
Machine: MacBookPro18,3, arm64, 16 GiB RAM, macOS 15.8.1 (24H32); about 29 GiB
free after builds. Node 24.22.3; pinned Rust toolchain.

- `npm test`: **394 domain tests and 142 Playwright tests passed**, zero failures,
  skips or cancellations. Final browser suite: **7.2 minutes**.
- `npm run build`: strict TypeScript and Vite production build passed.
- `npm run format:check`: Prettier and rustfmt passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: **22 passed**.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`:
  passed with no warnings.
- `npm run build:desktop`: final production `Tilewright.app` release build passed.
- `wrk validate` and `git diff --check`: passed. The unrelated modification to
  `.wrk/wrk-58cdb442.md` is byte-identical to the start of this ticket and excluded.

The seven new domain tests verify complete captured model and active/hidden-layer
preferences, fresh dirty history, lineage reuse, canceled first Save, saved-source
byte preservation, source equality/conflict/formatting-only changes, later Save As
uncertainty, old/future clocks, checksum and semantic corruption, valid fallback,
unsaved-choice races, failed claim and failed outgoing marker. The three new UI
tests verify startup offers, missing originals and fallback, Cancel/Restore/Save,
exact saved project equality, picker suggestion/no old handle, current-lineage
protection, matching stale work without an urgent prompt, Escape at 640 x 480,
multiple same-path candidates, named confirmation and selected corrupt discard.
Native tests exercise malformed state, unsupported versions, no-follow sources,
missing originals, two independent candidates, retained snapshots across a second
restart, marker/cleanup failure ordering, and original-file byte preservation.

### Packaged macOS force-quit/relaunch

Built a release QA package with the same implementation and isolated identifier
`app.tilewright.tw041check` / product name `Tilewright TW041`; no existing user
recovery store was touched. Through the actual WKWebView and native dialogs:

1. Opened a copy of the reviewed project fixture at
   `/private/tmp/tw041-native-validation/source.tilewright`: 6400 x 6400 bounds,
   three layers, three registry entries, three named areas, Buildings active/hidden.
2. Renamed the hidden Buildings layer to `Recovered buildings TW041` without
   saving. Inspected the completed native checkpoint and verified its hash and
   complete model. The explicit source remained byte-for-byte unchanged.
3. Sent SIGKILL to that QA process, then relaunched. Startup offered the named
   source, capture/save times, full path and Unsaved changes since last known save.
   Chose Restore as unsaved copy and the existing outgoing-map guard. The header
   showed Recovered/Unsaved, history was empty, all content/preferences returned,
   and the camera fit the map. The retained lineage was reused (`restoredFrom: 1`).
4. Before explicit Save, compared the restored session's newly emitted checkpoint
   (sequence 2) with sequence 1: **byte-identical, 1,437 bytes**, SHA-256
   `9e2d4c7c7eec23ae49301eade667708ea90ffd59ba7a0df6e3de94078891b003`.
   Independent parsed comparison matched the source fixture with only the intended
   layer rename, including all runs, paint associations, metadata and preferences.
5. Explicit Save opened the actual native destination picker with
   `source (Recovered).tilewright`. Saved that separate file; its bytes exactly
   matched the captured/restored snapshot. The original source hash remained
   `9ee9729d45758949e56fa04bf5ac6cdb08af4b88456cec082b7e4c1f4998fb75`.
   Review then showed No unresolved recovery work. Normal Quit left only the lock
   file in the isolated recovery root.

The native crash walkthrough preceded the final Escape/source-context polish;
final browser/domain tests cover those changes and final Rust tests cover refreshed
cleanup warnings. Native WebKit deferred background scan timers until activation;
activation completed discovery. Network was not disabled, and a separate browser
validation server ran during part of the native walkthrough; the packaged window
used `tauri://localhost` and bundled assets, not that development server.

### Failures resolved and limitations

An early full UI run was invalidated by Vite reloads while source files were being
edited (three navigation/context failures); the final unchanged-source run passed
all those cases. New domain fixtures initially used an invalid shrunken bound and
omitted a tile-write length; both fixtures were corrected. Passing fixture JSON
as a string fixed a Playwright TypeScript deep-instantiation error. The focused UI
check exposed Escape being ignored during scanning; dismissal now works during
read-only scans and its regression passes. Review also added the later-Save-As
uncertainty regression rather than claiming an old capture follows a newer save.

All four acceptance criteria and both requested validation workflows are satisfied.
No performance pass is claimed: complete decode/canonicalization cost, restoration
latency, foreground overhead and peak memory remain unmeasured. Existing bundle-size
warnings remain. Follow the accepted delivery priority: rendering/presentation
refinement belongs to TW-049, large-map/history/memory to TW-050, persistence profiling
to TW-051. Broader interruption/failure campaigns remain the already-planned TW-042.
No additional tickets or separate sprint document were created.