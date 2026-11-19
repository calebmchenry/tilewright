# Local crash recovery policy

Decision record for [TW-039](../.wrk/wrk-dbdc0004.md), subordinate to
[INTENT.md](../INTENT.md#local-operation). The values and interactions below are
implementation choices, not additional confirmed product requirements. This is
a policy with [TW-040 writing and lifecycle integration](#writer-implementation-tw-040)
now implemented. [TW-041 implements discovery/restore/discard](#discovery-and-restoration-implementation-tw-041); TW-042 proves
interruption behavior in the packaged app.

## Safety boundary and ownership

Explicit Save alone updates a user-selected `.tilewright` file. Recovery writes,
rotation, cleanup, discovery, restore and discard operate only in the recovery
store. They never write, rename or delete an original project, even when it is
missing, stale or corrupt. The last successful explicit save remains independently
readable through Open. Recovery is a recent committed checkpoint, not a backup of
every edit or a guarantee against disk loss.

Reuse the [project snapshot and codec](project-format.md), including all layers,
raw/registered paint identities, registry, named areas, bounds and active/hidden
layer preferences. Capture only committed content. Draft text, pointer previews,
in-progress fills/gestures, clipboard, camera and undo/redo are excluded. A crash
can lose work since the last completed checkpoint; report its capture time, never
claim the crash-time document was preserved.

TypeScript owns scheduling, coherent capture and project validation. Rust owns the
fixed local directory, entry identifiers, bounded reads/writes, locking, atomic
publication and cleanup. Add narrow recovery commands; do not grant JavaScript
arbitrary filesystem access or serialize native project handles. Existing
[`markRecovery`](../src/domain/history.ts) acknowledges only the captured token
after successful publication in its still-current controller. It never calls
`markSaved`, changes dirty state or creates an undo entry.

## Location, identity and metadata

Use the Tauri application-data directory for `app.tilewright.desktop`, with a
`recovery/v1` child. On macOS this is
`~/Library/Application Support/app.tilewright.desktop/recovery/v1/`. Resolve it
natively rather than hard-coding a username, using the project directory, a cache
directory subject to eviction, or placing files beside explicit projects. Keep
directories owner-only and files owner-readable/writable. Never follow substituted
symlinks or use a metadata path as a recovery write/delete destination.

Allocate a random UUID `documentId` on New and each successful explicit Open.
It identifies a recovery lineage, not a filename or a project-format field.
Two openings of the same path and two untitled maps have distinct identities;
they cannot overwrite one another's unresolved recovery. Save and Save As retain
this identity. Restore resumes the selected lineage with a fresh writer/session
UUID and new controller, so merely restoring does not consume another retention
slot. Never reuse old history tokens. A fresh launch's blank map is a new lineage.

Rust holds an exclusive nonblocking OS lock on the recovery root for its process
lifetime. A second live instance may edit/save projects but must report recovery
unavailable and cannot discover, restore, discard or prune the owner's entries.
Process death releases the lock; do not infer ownership solely from a stale PID
or wall-clock lease. All store operations within the owner are serialized. The
lock also makes the global byte reservation and cleanup rules enforceable.
An instance that never acquired recovery ownership has no entries to resolve;
recovery unavailability alone does not prevent its normal guarded close.

Use immutable generation directories:

```text
recovery/v1/<documentId>/state.json
recovery/v1/<documentId>/<sequence>/metadata.json
recovery/v1/<documentId>/<sequence>/project.tilewright
recovery/v1/<documentId>/.pending-<uuid>/...   (never discoverable as a snapshot)
```

The following is the required metadata contract; wire definitions belong to
TW-040. All records carry `format: "tilewright-recovery"` and `version: 1`.
Validate closed shapes, UUIDs, safe integers, byte ceilings and duplicate keys;
an unknown version is unsupported, never silently migrated or partially loaded.

| Record                   | Required information and meaning                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation identity      | `documentId`, writer/session UUID, positive increasing `sequence`, and lifecycle `epoch`. Sequence orders captures in this lineage, including after undo and restore; epoch fences invalidated jobs. Neither is a history revision.                                                                         |
| Captured state           | Capture UTC time, `historyRevision`, `documentVersion`, nullable saved revision at capture, and whether the captured content was dirty. These revision numbers are diagnostic within that writer only.                                                                                                      |
| Project integrity        | Project format/version, exact payload byte length, SHA-256 of the complete canonical project bytes, and completion time. Validate the hash and decode the entire project before offering Restore. Metadata is bounded to 64 KiB per generation.                                                             |
| Saved context at capture | Display name; nullable source absolute path, last successful explicit Open/Save time, exact saved-file byte hash, and canonical saved-project hash. All saved-context values are null for never-saved work. File size/mtime may be recorded for display and cheap change hints, never as proof of equality. |
| Mutable lineage state    | `documentId`, current writer/epoch, next sequence, active/resolved/discarded status, and latest successful explicit path/time/byte and canonical hashes (or null). Include a nullable resolved-through sequence and nullable restored-from sequence. Bound this file to 64 KiB.                             |

The saved-file hashes come from the bytes actually read or successfully written,
not a later reread of an externally changed file. The canonical hash accounts for
valid noncanonical project whitespace/order when comparing content. Captured
metadata is immutable; Save As updates the lineage state only after its explicit
write succeeds. A canceled/failed Save As keeps the old path/context. Display both
the source at capture and latest saved destination if they differ. A crash between
an explicit write and its recovery-state receipt may leave older source context;
that is an uncertainty to show, never permission to overwrite either path.

## Cadence and coherent publication

Use a **2-second trailing debounce**, a **10-second maximum scheduling delay**
from the first uncheckpointed committed change, and **at least 5 seconds between
capture starts**. The first dirty state, including creation of an empty untitled
map or restoration, arms the timer. After successful capture of that state, idle
documents do no repeated work. A later effective edit, undo or redo rearms it;
no-op commands do not. Preference-only changes do not schedule recovery, following
the [project preference policy](project-format.md#persisted-preferences-and-session-reset),
but current preferences ride with the next actual capture.

With monotonic times `firstPending`, `lastChange`, and `lastStart`, the next due
time is `max(lastStart + 5s, min(lastChange + 2s, firstPending + 10s))`; omit the
first term when there has been no start. Clearing pending work requires a
successful checkpoint of that state or an explicit lifecycle resolution. Edits
after capture remain pending with their own first/last times. A history revision
can go backwards on Undo: compare identity/equality, never numeric greater-than.

Returning to the current controller's saved checkpoint by undo/redo cancels pending
captures and resolves that lineage's older recovery without changing `savedRevision`.
Redo/edit away from it reactivates recovery in a new epoch. Serialize/recheck this
resolution against further edits; failure retains the previous checkpoint and
shows the bookkeeping warning. Do not let an old dirty snapshot become the
authoritative latest state after a successfully recorded return to clean content.

One recovery capture/encode/write job may be active; coalesce newer work into one
pending request, never a queue of full snapshots. Timers cannot interrupt a domain
transaction. Capture a detached snapshot at the next committed boundary and yield
between encoding batches. When busy, sleeping or blocked on native I/O, retry once
eligible without catch-up bursts. Ten seconds bounds scheduling under an idle
scheduler, not durable completion or loss under a suspended process. Show the
last completed capture time and a pending/error state separately from **Saved**.

Pause new recovery jobs while a file/lifecycle action is pending. Entering Save,
Save As, New, Open, close or restore fences/cancels uncommitted recovery jobs before
their publication; retain the last completed snapshot. In particular, an old
`markRecovery` must not supersede an in-flight Open through the current workspace's
checkpoint guard. Resume pending dirty work promptly when the action finishes or
is canceled. Long pickers may therefore extend the recovery gap; show pending
status, and measure that gap rather than claiming an unconditional deadline.

For each job:

1. Bind capture to the current session, workspace generation, lineage, writer,
   epoch, sequence and checkpoint before asynchronous encoding. Persist sequence
   reservation before publication; gaps after failure are harmless. A reboot must
   not reuse an extant sequence even if the state file was interrupted.
2. Reserve storage under the native lock. Write complete payload and metadata into
   a private pending directory, sync both files and that directory, then recheck
   writer/epoch/status and publish by one same-parent directory rename. Sync the
   parent. This commits the pair together; two independent sidecar renames do not.
3. Discover only complete published directories with matching IDs, lengths,
   hashes and valid project data. A directory scan can find the newest committed
   sequence even if a subsequent index/state update was interrupted. Temporary
   files are never candidates. Keep the previous valid generation until the new
   one is published; rotate afterward.
4. Acknowledge only that job's still-valid controller token. Late responses after
   replacement or an epoch change cannot mark another document recovered. A
   stale commit request fails before rename; an already committed earlier entry
   remains subject to the ordered lifecycle resolution below.

Write/encode/flush/rename failures leave the last complete generation and explicit
file unchanged. A parent-sync failure after rename is a committed checkpoint with
a durability warning, matching the [native save boundary](project-format.md#atomic-replacement-and-limits-of-the-guarantee).
Do not claim the destination stayed unchanged or retry the same sequence as though
nothing committed. Physical power-loss guarantees across all hardware are outside
this policy.

## Save, document transitions and deliberate discard

| Event                                                                                 | Recovery and document result                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful explicit Save/Save As, current content equals the captured save checkpoint | Mark only that captured revision saved. Record successful destination/hashes, fence old jobs, atomically mark the lineage resolved, then remove its generations. Preference-only differences retain the existing non-dirty policy. The next content edit reactivates the lineage in a new epoch.                  |
| Successful save with intervening edits/undo/redo                                      | Saved checkpoint/path reflect exactly the file written; the current content stays dirty. Update saved context but retain the last completed recovery until a replacement succeeds. Schedule current content; never delete all recovery merely because a save returned success.                                    |
| Failed/canceled Save or Save As                                                       | No saved acknowledgement, path reassignment or recovery resolution. Keep completed recovery, resume pending work and show the file failure/cancellation through the existing workflow.                                                                                                                            |
| New/Open/restore succeeds after Discard changes                                       | Retire only the departing session/version authorized by the choice, after the incoming candidate has fully validated and replacement can commit. Persist a discarded marker and fence writers before deleting old generations. Install the incoming session with its own identity (or selected restored lineage). |
| New/Open/restore fails, is canceled or superseded                                     | Keep the outgoing workspace and its recovery even if the author had chosen Discard changes. Resume its scheduler. A Save that already succeeded remains a legitimate saved checkpoint.                                                                                                                            |
| Normal window close/Quit, clean or Save and continue                                  | Use the existing lifecycle guard; after a successful save, recheck that no edits remain. Durably resolve recovery and fence jobs before final close. No recovery prompt on the next launch for this resolved lineage.                                                                                             |
| Normal close/Quit, Discard changes                                                    | Recheck the authorized session/version, durably mark discarded and fence pending jobs before final close. Delete only this lineage's recovery. Never change the explicit file. Cancel leaves both live work and recovery intact.                                                                                  |
| Abrupt termination, OS shutdown without the guard, crash                              | No final synchronous save or guaranteed last snapshot. On next launch inspect the last complete unresolved generation; ignore pending directories. Absence of a clean-exit flag is not permission to replace a project.                                                                                           |

For the final destructive resolution/install/close step, recheck the authorized
session/version and briefly gate committed edits until the marker and transition
finish. Keep that gate out of pickers, decoding and ordinary save encoding; those
continue to allow edits and retain their existing supersession checks. This closes
the gap between the final version check and asynchronous marker publication.

Lifecycle resolution is an atomic state-file replacement under the same native
lock, ordered against publications. A resolved/discarded marker suppresses its
covered generations even if deletion fails or the process dies during cleanup;
never delete the marker first. Reactivation advances the epoch and does not revive
covered sequences. Remove the lineage directory only after all covered data is
gone and no writer can publish into it. Never use `sequence <= savedRevision` as
a cleanup rule: history IDs do not order undo states or different controllers.

If resolution cannot be durably recorded, **do not finish a destructive transition
or quit**; retain the current workspace/recovery and report Retry/Cancel plus the
storage error. Prepare incoming sessions privately so this failure cannot dispose
the outgoing one. An explicit save already committed is still a successful save;
failure to update recovery bookkeeping must not roll back its saved path/checkpoint
or report a false project-write failure. Show the recovery warning and retain its
old candidates conservatively. A failed native close after resolution leaves the
workspace alive; reactivate recovery if it is dirty. Failed payload deletion after
a successful resolution is a cleanup warning, not a failed discard or a restored
candidate on next launch.

## Retention, failures and bounded disk use

These are initial storage choices, separate from the existing 256 MiB project
codec ceiling:

| Resource            | Policy                                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per lineage         | Newest **two complete generations**; at most one additional pending generation globally. Keep an older valid fallback if the newest is corrupt.                                                                                                                                   |
| Unresolved lineages | At most **10**, including the active lineage when its first snapshot is reserved. Restoring one reuses its slot.                                                                                                                                                                  |
| Global store        | **1 GiB (1,073,741,824 bytes)** logical file bytes, including payloads, metadata, state, pending files and invalid entries; account/reserve before writing. Bounded record/directory counts also constrain filesystem overhead, whose physical allocation is measured separately. |
| Age                 | After **30 days** since capture, label unresolved work **Older recovery — review before restoring**. Age alone never deletes its last valid copy. Wall-clock rollback or future dates produce unknown-age context, not expiry.                                                    |
| Cleanup             | After commit and at startup: prune surplus older generations, remove abandoned pending directories, and finish deletion of durably resolved/discarded lineages. Never remove another live owner's files.                                                                          |

The two-generation limit is the retained result after rotation. During publication
there may be one additional generation globally, pending or awaiting rotation.
If post-publication cleanup fails, do not admit another candidate until that
surplus is removed; failures cannot accumulate extra generations.

Before accepting a write, count the previous generations plus the complete incoming
payload/metadata/state replacement, not just the final retained result. At the
largest supported payload, three generations need
`3 × (268,435,456 + 65,536) = 805,502,976` bytes, plus lineage-state files and their
temporary replacements; all must fit the global cap. Ten maximum-sized lineages
cannot fit and are not promised. The byte limit takes precedence over the count.
Use exact byte lengths and cap streaming writes as well as preflight estimates.

Automatic cleanup may free redundant generations and resolved/temp debris; it
must preserve the last valid unresolved copy and the latest committed snapshot
while a replacement is being written. If no reservation fits, or ten unresolved
lineages remain, pause new recovery with **Recovery storage is full** and actions
to review/discard specific entries or explicitly save the current map. Do not
silently evict unresolved work to make room. Cleanup itself must work at capacity
(reserve 64 KiB within the global cap for one serialized state-marker replacement
before admitting payload writes). Repeated failed
temporary cleanup cannot permit new writes beyond the cap.

Malformed, checksum-failing and unsupported entries remain visible as unavailable
with a reason and Discard action; do not repeatedly copy them into an unbounded
quarantine. If a valid fallback exists, offer it with its actual capture time and
explain that the newer entry could not be read. Unrecognized/future store versions
are left untouched and reported; never recursively delete an unknown layout.
Unexpected externally added/oversized files may put storage over budget: stop
writes, report the condition, and do not claim a cap against other programs' writes.

On recoverable I/O/capacity/encoding errors, keep the document dirty and the previous
valid checkpoint. Show persistent, nonmodal **Recovery unavailable** feedback with
last successful capture time, reason and Retry. Automatically retry transient I/O
failures after 5, 15, 30, then 60 seconds (cap at 60); reset on success. Capacity or
unsupported-data errors wait for a relevant storage/content change or explicit
Retry. Never spin, block editing, pretend explicit Save failed, or silently call
`markRecovery` on failure. Explicit saving remains available.

## Discovery, conflicts and restore interface

After acquiring the root lock at startup, scan without loading anything into the
workspace. Display **Recover unsaved work** with one row per unresolved lineage,
newest capture first (sequence within a lineage; timestamps only for display/list
ordering across lineages). Show Untitled or source basename, full source path when
known, capture time/age, latest known explicit save time, and comparison status.
Group same-path lineages visibly but keep them distinct. Expand a row to choose
the previous complete generation; never merge maps or guess which lineage wins.
An invalid row cannot block normal launch or other valid candidates.

For saved context, read the referenced original as a regular file with the existing
size/validation limits through native recovery-scoped inspection. Metadata is not
a write grant. Compare bytes/content, not just mtimes or numerical revisions:

| Evidence                                                                                   | Label and handling                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No known explicit path                                                                     | **Untitled unsaved work**; eligible to restore.                                                                                                                                           |
| Current file's canonical hash equals the recovery payload hash                             | **Already matches saved file**; stale duplicate, no urgent crash prompt. Keep it reviewable until explicit discard or a durable resolution; do not infer a safe deletion from timestamps. |
| Current exact file hash equals the recorded saved baseline, recovery differs               | **Unsaved changes since last known save**. This includes undoing back to an older history revision. It is content divergence, not a claim that its revision number is larger.             |
| Current file differs from both baseline and recovery                                       | **Saved file changed — recovery may conflict**; show both times, permit Restore as separate copy, never overwrite or silently choose the newer timestamp.                                 |
| Only byte formatting changed but canonical content matches baseline                        | Treat as the same saved content, explain the byte change if showing details.                                                                                                              |
| Missing, inaccessible, invalid, oversized file, incomplete save receipt or untrusted clock | **Saved file unavailable / relationship unknown**, with specific reason. A valid recovery remains independently restorable.                                                               |

Order equality with recovery before equality with the saved baseline. When latest
saved context differs from capture context (for example Save As), compare against
the latest recorded destination and identify the older capture source separately;
if receipts/context cannot establish the relationship, use unknown/conflict, never
a false "newer than save" claim. No automatic project search by basename or move
tracking is required. Source checks are advisory and may become stale immediately;
they confer no write authority.

Actions are **Restore as unsaved copy**, **Discard recovery…**, and **Not now**.
Not now retains entries and opens the normal workspace; provide a persistent
**Review recovery…** entry point to return to the list. Escape acts as Not now.
Discard asks confirmation naming the selected lineage and its capture times,
explaining that only its recovery generations are removed. It uses the durable
discard marker and never deletes another row or an original project. Opening the
explicit project through Open does not implicitly discard an unresolved row.
If a lineage is currently open in this process, label it **Currently open** and
disable its list Restore/Discard actions; use the normal document Save/Discard
guard to resolve its live work. Other unresolved rows remain actionable.

Restore fully validates the chosen metadata/hash/project, prepares a fresh session,
and uses the normal unsaved-change guard before replacing any current dirty map.
Install complete decoded content/preferences atomically, fit the camera, and reset
tools, clipboard, drafts and history as for Open, but with **savedPath = null**, no
native file handle, `savedRevision = null`, and **dirty = true**. Display
**Recovered — <source name or Untitled>** and the capture time. Never call the
explicit Open installation path unchanged: it currently sets `initiallySaved: true`.

Restore retains the chosen durable snapshot until a new recovery checkpoint,
successful explicit save with no intervening edits, or deliberate discard resolves
it. Cmd+S always opens a destination picker for a recovered copy; suggest
`<name> (Recovered).tilewright`, never associate the old source automatically.
The author can deliberately select the original through the normal overwrite
confirmation, at which point only explicit Save updates it. Cancel/failure retains
the dirty recovered document and candidates. Edits during that save stay dirty and
keep recovery. A second crash before saving can restore the retained checkpoint.

## Measurable overhead and implementation validation

Full coherent project snapshots are the initial mechanism; no incremental journal
or performance pass is implied. Existing capture is synchronous and known to take
hundreds of milliseconds on populated fixtures. Coalescing and retention bound
queued work/disk, not transient memory or foreground latency.

Instrument monotonic timestamps for change, due time, capture start/end, encoding,
IPC, write/sync/rename, acknowledgement and cleanup. Record bytes, live/pending
generations, retries/coalesced jobs, scheduling lateness, capture-to-durable lag and
peak extra memory. Measure initial checkpoint separately. Compare identical 60-second
navigation/edit traces with recovery on/off on both frontier/heartland fixtures;
record all samples and longest main-thread task. Include continuous edits, idle,
sleep/wake, long pickers, slow disk and save races. The existing
[performance protocol](performance.md#provisional-budgets-and-future-measurement-protocol)
keeps its 5-second forced-checkpoint stress workload; production uses the cadence
above. Report both, without silently substituting one for the other.

Future targets remain checkpoint p95 ≤ 250 ms, foreground-frame p95 increase ≤ 2 ms,
main-thread task ≤ 50 ms, extra peak memory ≤ 256 MiB, initial checkpoint/restore
≤ 5 s. No measurements of a recovery implementation exist in TW-039. Per AGENTS.md,
performance misses alone do not block features: rendering/presentation refinement
belongs to TW-049, large-edit/history/memory to TW-050, and persistence profiling
to TW-051. Correct snapshots, no project-file mutation, failure preservation and
bounded storage remain required correctness checks.

## Policy validation walkthrough (TW-039)

Reviewed against the current snapshot, history, file and lifecycle code. These
are decision-level state traces, not executed recovery I/O or packaged crash tests.
`S` means bytes at the explicit project path; `R(n)` is one complete recovery
sequence. Neither a partial directory nor an uncommitted edit is `R(n)`.

| Scenario traced                                                                                    | Result required by this policy                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crash before first save: create U, edit, complete R(1), start R(2), terminate mid-write            | No S exists. Ignore pending R(2); offer R(1) as Untitled at its capture time. Restore is dirty/pathless; canceling its first Save keeps it and R(1). A crash before R(1) completes has no recoverable snapshot and must not claim otherwise.                                                     |
| Crash after unsaved edits: S=A, then edit B and complete R(3), edit C and crash                    | Original S remains byte-for-byte A and can Open normally. Baseline hash matches A; offer B as unsaved changes, disclose capture time and that C was never captured. Full overlapping layers, recolored registry references and independent named areas come from B's complete payload.           |
| Save during snapshot: S=A, R(4) captures B, Save begins and fences its job, edit C, Save commits B | Delayed R(4) cannot publish after its epoch is invalidated; a publication ordered before the fence is retained. Saved checkpoint becomes B and C stays dirty. Do not resolve the lineage; next recovery captures C with B's saved context. If Save fails, S=A and the previous R remain.         |
| Save As during edits: source A, save B at a new path, then crash with dirty C                      | Identity stays stable. Old path A remains unchanged; new path contains B only after explicit success. A completed C snapshot cites B; an older snapshot retains capture context with the latest receipt when available. Restore is always pathless. Canceled Save As leaves the old association. |
| Normal discard: S=A, dirty B, R(5) and a delayed job, choose Discard on close                      | Durable discarded marker/fence precedes close and deletion. The job cannot resurrect R; a crash during cleanup still suppresses R(5). S=A stays readable. Marker failure leaves the window and B open with an error.                                                                             |
| Discard then canceled/invalid Open; ordinary clean Quit; canceled Quit                             | Failed Open keeps old dirty map and R; no premature resolution. Clean Quit resolves only its own lineage. Cancel leaves live state and R untouched.                                                                                                                                              |
| Save commits while clean, but recovery-state update fails or process dies                          | Saved bytes remain valid; old recovery may be offered as already matching or unknown, never silently restored. Successful project write is not reclassified as failure. Retry bookkeeping before a later destructive transition.                                                                 |
| Undo from saved revision 8 to revision 3 and capture sequence 12                                   | It is unsaved work despite 3 < 8. Sequence 12 orders recovery; restoring never imports either history token.                                                                                                                                                                                     |
| Undo returns exactly to saved content, then redo makes it dirty again                              | Fence old work and resolve its sequences without changing the saved checkpoint. Redo reactivates in a new epoch; delayed acknowledgements from before the clean state cannot revive resolved data.                                                                                               |
| Original changed externally/deleted; two crashed openings share a path                             | Show conflict/unavailable and distinct rows. Restore either into a dirty copy; S is unchanged by all recovery actions.                                                                                                                                                                           |
| Newest entry corrupt, previous valid; both invalid; unsupported version                            | Offer valid fallback with older time and corruption warning. Disable Restore for invalid/unsupported data, retain review/discard, and allow normal launch. Never salvage partial map content.                                                                                                    |
| Store at byte/count cap; old unresolved entry; repeated failed cleanup                             | Remove only eligible redundant/resolved/temp data. Otherwise pause with visible feedback; do not exceed reserved budget or delete the only unresolved copy. Age labels do not authorize deletion.                                                                                                |
| Restore, then crash without further edits or save                                                  | Retained original checkpoint remains discoverable; restored history was dirty and had no original write handle.                                                                                                                                                                                  |

TW-040 should encode these ordering/cadence/retention cases using controlled clocks
and injected failures; TW-041 exercises the interface and complete decoded state;
TW-042 force-quits/relaunches the packaged app and compares actual project/recovery
bytes. These are the next tickets' validation obligations, not completed tests here.

## Writer implementation (TW-040)

`src/editor/recovery.ts` owns one coordinator outside React for the workspace.
It implements the production 2s debounce / 10s maximum scheduling delay / 5s
minimum start spacing with an injectable monotonic clock. UTC timestamps are
metadata only. Revision equality drives pending work, including undo/redo;
preference-only changes, no-ops and acknowledgements do not rearm the timer.
An empty untitled map also receives its initial checkpoint. One detached snapshot
is captured synchronously using `captureProjectSnapshot`, then encoded with the
existing yielding `encodeProjectSnapshot`. Later edits coalesce into one pending
request without retaining another full snapshot. Recovery acknowledges only the
captured controller token after publication and never saves or changes history.

`src/native/recovery.ts` exposes binary payload IPC plus ASCII-escaped JSON capture
metadata. `src-tauri/src/recovery.rs` resolves the fixed application-data directory,
validates identities and bounds, takes a process-lifetime `flock`, serializes native
operations on blocking workers, reserves sequence numbers and disk bytes, and
publishes payload/metadata together with a same-parent directory rename. Both
explicit project saves and recovery use `src-tauri/src/atomic_io.rs` for partial
write and sync handling. The five recovery commands are explicitly granted in
`build.rs` and the local main-window capability; no general filesystem authority
is added. Generation payloads use the existing v1 project format.

All native descendants use directory-relative, no-follow file descriptors, private
creation modes and bounded reads. Recovery never uses a source path as a write or
delete destination. The two-generation retention, one global pending/rotation
allowance, ten-lineage limit, 1 GiB logical-byte cap, 64 KiB state-replacement reserve
and bounded directory entry counts are enforced before writes. After an interrupted
prepare, startup removes private pending data while retaining completed copies.
After a discarded/resolved marker commits, cleanup may be retried independently.
A process-local retired-state map preserves epoch/sequence fences after an empty
resolved lineage is removed from disk; it holds metadata only. A new process uses
new writer identities, and existing on-disk generations also advance a stale
sequence receipt before any new reservation.

`ProjectFiles` and `DocumentLifecycle` pause/fence recovery before pickers or other
asynchronous file work, including the unsaved-choice dialog. A late result cannot
acknowledge through an Open checkpoint guard. The file coordinator records SHA-256
of actual read/written bytes and canonical opened content; Save As keeps lineage
identity. An explicit write remains successful if its recovery receipt fails.
The file-action gate stays busy until that receipt finishes; a new visible path
alone does not mean the next file action is enabled yet.

New prepares its session privately; Open completely validates/constructs its
candidate before resolving the outgoing lineage. `MapDocument.holdEdits()` briefly
rejects committed mutations during final marker/install/close operations. It does
not span pickers, decoding or ordinary save encoding; navigation and detached
reads remain available. A failed marker keeps the current session and blocks the
transition with Retry/Cancel guidance. Failed native close releases the gate and
rearms dirty recovery. Returning to clean content by undo uses the same ordered
marker and edit gate; redo activates a newer epoch. Normal New/Open/close discard
only the departing lineage after validation. Abrupt termination does no final save.

`RecoveryFeedback` shows pending work, the last completed capture, durability or
cleanup warnings, persistent failure reasons and **Retry recovery**, separately
from Saved/Unsaved. Transient errors use 5/15/30/60s retry backoff; capacity/invalid
store errors wait for Retry or a content change. A second instance that cannot
acquire ownership can still edit, explicitly save and close. Unrecognized or corrupt
storage is preserved and recovery writing pauses conservatively; review/restore/
discard controls for existing entries remain TW-041. Native checksum validation
protects retention; full project decoding at restore is also TW-041. No restore
interface or automatic overwrite of an explicit file is added here.

Validation locations:

- `tests/domain/recovery.test.ts`: controlled-clock cadence, idle work, coalescing,
  detached revisions, saved/untitled fidelity, exact original-byte comparisons,
  saved hashes, Save As and Open races, undo/redo, cancellation, transient/capacity
  retry, ownership failure, disposal, failed markers and the final edit gate.
- `tests/project-files.spec.ts`: shipping UI and binary/Unicode IPC adapter using
  substituted native commands, checkpoint feedback, unchanged explicit-save
  requests and Retry with Save still available, including a 640px viewport.
- Native recovery tests: actual local changed project bytes and metadata, partial
  payload/state writes, sync/rename failures, stale writer/epoch/sequence tickets,
  canceled writes, two-generation rotation, ten-lineage and byte limits, exclusive
  ownership, no-follow symlinks, conservative corrupt fallback preservation,
  post-rename warnings and marker-before-cleanup. A subprocess exits mid-payload;
  reopening verifies the prior complete pair and cleans the incomplete directory.

Actual command outcomes are recorded in [TW-040](../.wrk/wrk-ff878665.md). This
baseline still captures/encodes full sparse projects and transfers complete byte
buffers; snapshot capture and some hashing/IPC allocation remain synchronous or
whole-buffer operations. Neither small deterministic timing tests nor native
fault tests establish foreground-frame, p95 latency or physical-memory budgets.
Those measurements and refinement remain TW-049/TW-050 (persistence profiling in
TW-051), as directed by AGENTS.md. Packaged force-quit/restore validation remains
TW-042; full discovery and restoration remain TW-041.

## Discovery and restoration implementation (TW-041)

`src-tauri/src/recovery_discovery.rs` adds five narrow native commands: discover,
read checkpoint/source, claim a lineage, release an uninstalled claim, and discard.
The existing process lock and blocking-worker serialization cover every operation.
Discovery lists unresolved lineages independently and orders their generations by
sequence. Cleanup failures become review warnings; corrupt entries do not prevent
other maps from being offered or the editor from launching. Unknown store versions
and unknown layouts remain untouched. A malformed v1 state can be deliberately
discarded using a new durable marker; an explicitly unsupported state version cannot.

Native reads validate closed metadata, required nullable fields, IDs, safe counters,
payload size and SHA-256. The saved-source read follows only the latest known path
from that lineage's state, checks every directory and final regular file without
following symlinks, is bounded to the project ceiling, and grants no project handle.
`src/editor/recovery-discovery.ts` sequentially reads and fully decodes each valid
checkpoint before enabling Restore. It canonicalizes validated source content to
identify matching saved files, unchanged baselines despite formatting differences,
conflicts and unavailable/unknown relationships. Only summaries remain in the list;
it does not retain multiple decoded maps. Checks are advisory, not write authority.

`src/RecoveryPanel.tsx` shows capture/save times, full source and latest destination,
lineage IDs, old/unknown age, unavailable reasons and a checkpoint selector. It
selects the newest valid fallback when a newer checkpoint is invalid. Rows sharing
a source are grouped but never merged. A matching newest checkpoint stays reviewable
without an urgent startup prompt. **Not now** and Escape keep the entries, including
while a read-only scan finishes; **Review recovery…** remains available in the footer.
Discard confirmation identifies the map, its lineage and captures. Native discard
records its marker before deleting only covered recovery generations. The live map's
Restore/Discard list actions are disabled in both the UI and native store.

`DocumentLifecycle.restore` rechecks the payload checksum, uses the existing
Save/Discard/Cancel guard, and privately constructs a completely decoded session.
Only after the final authorized-version check does it hold outgoing edits, claim the
incoming lineage with a new writer, resolve outgoing recovery, and install. If the
outgoing marker fails, the claim is released and both checkpoints remain; the
incoming durable bytes are never consumed by claim. Claims resume the existing
sequence/retention slot and record `restoredFrom`; old writer tokens are fenced.

`EditorWorkspace.openProject` has an explicit recovered-install option that forces
`initiallySaved: false` and `savedPath: null`; it restores the captured active/hidden
layers and resets transient state/history/camera as for Open. The coordinator binds
to the selected lineage with fresh history, retains its saved-file context for
advisory comparison, and schedules a new checkpoint. The header identifies the
recovered source and capture time. `ProjectFiles` has no file association for this
session. Its first Save uses the native picker with a sanitized
`<name> (Recovered).tilewright` suggestion. Only that deliberate write can update
any selected project path. Canceled saves leave the recovered copy dirty.

Validation locations:

- Native discovery tests cover relaunch, claim and a second crash, selected discard,
  marker/cleanup failures, original-byte preservation, independent candidates,
  checksum fallback, malformed state, missing/symlink sources and unknown versions.
- `tests/domain/recovery-discovery.test.ts` covers complete model/preference equality,
  fresh history, lineage reuse, saved-file content comparisons, semantic corruption,
  valid fallback, age labels, unsaved guard races, canceled saves and failed markers.
- `tests/project-files.spec.ts` exercises the shipping review/restore/discard UI and
  native adapter with substituted IPC, including startup offers, same-path grouping,
  named confirmation, unavailable sources, stale matches, Escape at 640 × 480,
  current-lineage action protection and exact content through explicit Save.
- The TW-041 ticket records actual release WKWebView SIGKILL/relaunch, pre-save
  recovered-model comparison, picker behavior, explicit saving and original-file
  preservation. TW-042 remains the broader interruption/failure campaign.

Discovery re-reads/decodes complete checkpoints, and canonical source comparison
adds another decode/encode. It is bounded and sequential but is not a measured
latency or peak-memory pass. Background WKWebView timers may defer validation until
the window is activated. Performance work remains deferred to TW-049/TW-050 and
persistence profiling to TW-051 under the project's delivery priority.

## Interruption and failure verification (TW-042)

The deterministic campaign extends the existing tests without changing the save
or recovery policy. `ProjectFiles` accepts an optional encoder, matching the
recovery coordinator's existing injection seam; shipping callers use the normal
encoder. Native fault callbacks now include the pending-directory flush and the
explicit save's post-rename parent flush. Production callbacks remain no-ops.

Run `npm test`, `npm run build`, `npm run format:check`, and the locked Cargo test
and Clippy commands in [desktop development](desktop-development.md). Focused
checks are `node --test tests/domain/recovery.test.ts` and
`cargo test --locked --manifest-path src-tauri/Cargo.toml`.

| Boundary                                                                                                                         | Executed assertion                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit encode, write and replace failure; first/repeated Save and Save As                                                      | Complete workspace bytes, session/path, dirty/history state, prior recovery bytes and explicit files stay unchanged. Encoding errors never reach the write bridge.                                                                                                                                      |
| Recovery encode failure after a yield                                                                                            | Previous capture bytes/time and acknowledgement stay intact; uncaptured edits remain dirty and pending; retry captures their complete state.                                                                                                                                                            |
| Recovery state reservation, payload and metadata partial writes/flushes; state replacement/parent flush; pending-directory flush | Nine injected failure points preserve the complete previous generation and saved file before and after reopening; successful retry advances sequence and retains two complete generations.                                                                                                              |
| SIGKILL during first and repeated explicit Save                                                                                  | Eight subprocess cases cover partial write, file flush, before rename and after rename. The selected path is absent/old before publication and complete new bytes afterward; safe retry works despite orphan temporary siblings.                                                                        |
| SIGKILL during recovery and resolution                                                                                           | Seven subprocess cases cover partial state/payload/metadata, pending-directory flush, before/after publication and after a discard marker before cleanup. Restart ignores incomplete work, releases the process lock, discovers the latest complete pair and does not resurrect durably discarded data. |
| Explicit parent flush failure after rename                                                                                       | First and repeated saves report committed success with a durability warning and expose the complete new bytes.                                                                                                                                                                                          |
| Completed recovery publication with delayed acknowledgement, concurrent Save As and later edits                                  | Late acknowledgement cannot clean the document; Save As writes only its captured revision, keeps original bytes and older completed recovery, then captures the later edit with the actual saved-byte hash.                                                                                             |
| Native close fails after successful discard marker                                                                               | The live dirty document remains and recovery recaptures it without requiring another edit.                                                                                                                                                                                                              |

Native campaign code is in `src-tauri/src/persistence_fault_tests.rs` and
`src-tauri/src/project_files.rs`. It uses real local files and SIGKILL child
processes; each child is selected with the exact test name and an isolated
temporary root. Recovery discovery rechecks length/hash and reads the explicit
source after every checkpoint. Comparisons include every project field. The
fixture contains overlapping layers, stable recolored registry references,
independent named areas, negative/grown bounds and active/hidden preferences.
TypeScript integration assertions live in `tests/domain/recovery.test.ts` and
complement the existing restore, failed Open, cancellation and semantic decoder
tests. Substituted native bridges prove coordinator ordering; they do not claim
to exercise macOS dialogs.

For desktop reproduction, build an isolated-identifier release package from the
same source and use a fresh temporary project directory. Exercise initial and
repeated Save, canceled/successful Save As, invalid Open after Discard, and
Cancel/Save/Discard on close. Keep copies of the actual bytes at each checkpoint.
After an unsaved recolor and layer edit, wait for a complete recovery generation,
force-kill that package's process and relaunch. Restore as an unsaved copy, compare
the newly emitted recovery payload with the pre-crash checkpoint before saving,
then compare the explicit saved copy too. Repeat for a never-saved map. Normal
discard must remove only that map's recovery and leave all explicit saves intact.

Actual command results, packaged steps, byte hashes and limitations are recorded
in [TW-042](../.wrk/wrk-9b478f1c.md). These are process-interruption and local-I/O
checks, not physical power-loss or performance guarantees. Abrupt exit can lose
edits after the last complete capture. TW-049/TW-050/TW-051 retain the existing
performance refinement and profiling scope.
