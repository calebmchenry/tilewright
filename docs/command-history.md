# Document commands and history

Implementation decisions for TW-005, subordinate to [INTENT.md](../INTENT.md),
[foundation decisions](foundation-decisions.md), and the
[sparse model](map-document.md). These APIs are independent of React, PixiJS, DOM,
Node, and Tauri. The editor shell, tools, metadata feature schemas, codecs and
native persistence integrate them in their own tickets.

## Ownership and commands

[CommandHistory](../src/domain/history.ts) is the controller for persistent edits.
Load/create a `MapDocument` first, then attach one history controller. After that,
route all edits through `execute`, gestures, undo and redo. The existing document
primitives remain useful for loading and tests. If something writes around history,
its next state read or operation throws a version mismatch; it cannot silently undo
against divergent data. A newly loaded/replaced document needs a new controller.

```ts
const history = new CommandHistory(document); // A new, never-saved map is dirty.
const gesture = history.beginGesture("Draw stroke");
gesture.append({ kind: "tiles", writes: firstPointerSample });
gesture.append({ kind: "tiles", writes: nextPointerSample });
gesture.commit(); // Exactly one undo step and document event.
history.undo();
history.redo();
```

A gesture copies and freezes each appended command. Until commit it changes no
persistent content, revision, history, or notifications; tools own visual previews.
`cancel()` releases staged data and is idempotent. Commit closes the gesture even
if it fails, and rejects a gesture based on a different current revision. A direct
`execute(label, commands)` is the synchronous equivalent for an already-built
command or group. Labels must be nonblank. Commands apply sequentially, so a group
may create a layer/grow bounds and then paint into it.

[DocumentCommand](../src/domain/commands.ts) is a discriminated union:

- `tiles`: finite array of horizontal writes, including null for erasure.
- `add-layer`, `remove-layer`, `rename-layer`, `reorder-layers`: stable identities,
  bottom-to-top order and name snapshots; at least one layer remains. Removing a
  layer captures its occupied data, including content hidden by other layers.
- `bounds`: safe-integer fixed bounds, preserving world coordinates. This primitive
  can restore/shrink bounds only when no occupied content would be lost. The
  [Grow Canvas operation](canvas-creation.md) enforces the chosen 64-tile increments
  and authoring size guardrail before dispatching this command.
- `registry` and `annotation`: upsert or delete (`value: null`) a record by its
  distinct branded identity. Values are immutable, finite, acyclic JSON objects;
  nested arrays/objects are copied, keys canonicalized, and non-JSON values rejected.

Registry and annotation payloads are deliberately **opaque metadata seams**, not
final feature schemas or project-file formats. Their feature commands must validate
name/color/collision rules, geometry, tiers, references and other domain semantics
before dispatch. Existing registered tile associations remain stable IDs; a record
edit does not repaint or detach those cells. No cascading deletion or annotation
movement is implied. Tile-only gestures leave annotations fixed.

## Atomicity, inverse data and notifications

`MapDocument.applyCommands` copies the complete finite command input under the
mutation lock before applying it. Operations journal primitive before/after data
without notifying observers. If a later command fails, the journal is replayed
backward and the document content and mutation version are restored. No history
entry or notification escapes. A controller acceptance hook can reject a completed
patch before publication, which history uses for capacity checks. Only internal
controller bookkeeping belongs in that synchronous hook; it must not perform I/O
or mutate the document. As with the underlying model, process OOM is not recoverable.

At commit, an endpoint sweep compacts overlapping tile runs to their earliest
`before` and final `after`, omitting cells whose value returned to its original
state. First/last metadata states similarly collapse. Repeated writes, temporary
layers, rename-back and paint-then-erase can therefore be net no-ops. A net no-op
neither increments a revision/version nor deletes the redo branch. A rollback or
no-op can rebalance internal sparse/dense storage due to hysteresis; this is not
persisted content and no allocation-layout identity is promised.

A successful commit sends one frozen `DocumentChange` of `kind: "transaction"`
with `changes: readonly PrimitiveChange[]`. Its `version` advances once for the
whole group; the history state already reflects the commit when listeners run.
Only the **net** changed content appears:

- Tile changes carry affected layer IDs, horizontal world spans and before/after
  values. Each net changed cell appears once, including overwritten destinations
  and underlying layers. Renderers invalidate these spans and overview caches.
- Layer changes carry complete before/after ordered metadata, identifying additions,
  deletions, renames and compositing-order changes.
- Bounds changes carry before/after rectangles.
- Registry changes carry the affected entry ID and before/after record. A renderer
  must invalidate every use of that ID on every layer (an index or a conservative
  all-tile-cache invalidation), even if there are no tile deltas.
- Annotation changes carry the affected annotation ID and before/after record so
  labels/area caches can invalidate old and new content.

The change list is a patch, not a sequential replay recipe. History uses
`replayCommands` to recreate missing layers, restore changed cells, remove obsolete
layers and restore metadata/order. For bounds replacement it clears changing cells
inside the old bounds before installing the target bounds and restoring values.
This avoids constructing an overflowing union of distant safe-integer rectangles.
Undo and redo pass through the same atomic commit/notification path. Their events
carry inverse/forward net deltas; they do not allocate new history revisions.

Observers see completed content. Document and history listeners isolate errors and
continue notifying others. `execute`, gesture commit, undo and redo return
`MutationResult.observerErrors`; save/recovery acknowledgements return their listener
errors. Callers should report those failures without retrying an already committed
edit. Reentrant command/history operations from listeners or input producers are
rejected. `subscribe` returns an idempotent unsubscribe function. Returned states,
metadata, commands and notifications are immutable.

## Revisions, explicit saves and recovery

A history revision identifies a committed content state within one controller.
The initial revision is zero; effective edits get monotonically unique IDs. Undo
restores the entry's previous revision, redo its next revision. Editing after undo
removes the redo branch and gets a fresh ID; an abandoned saved branch cannot become
clean accidentally through ID reuse. `MapDocument.version` is a separate monotonic
notification/iterator counter and advances even for undo/redo.

Dirty means `state.revision !== state.savedRevision`. New documents default to a
null saved checkpoint. Use `{ initiallySaved: true }` only for a document loaded
from a successfully read native explicit project file. Checkpoints survive history
pruning: reaching a saved state by undo still becomes clean; if that state is no
longer reachable, dirty stays true until the next explicit successful save.

```ts
const checkpoint = history.captureCheckpoint();
// Capture/encode exactly this revision synchronously or via a future stable codec
// snapshot; the token itself is NOT a content snapshot. Do not retain live iterators.
await writeExplicitProject(bytes);
history.markSaved(checkpoint); // Only after successful write acknowledgement.
```

Edits made while I/O runs remain dirty when an older captured revision is marked
saved. A failed/canceled write must not call `markSaved`. Tokens are immutable and
validated by controller identity through a WeakSet, so forged tokens or tokens
from another document are rejected without retaining every historical revision.
The future save coordinator must serialize writes to a project destination or
otherwise acknowledge their actual durable order; this layer does not order I/O.

Recovery can capture its own token and call `markRecovery` on successful recovery
write. This updates only `recoveryRevision`, never the explicit save checkpoint or
dirty flag. These acknowledgements do not add undo steps or mutate the document.
Browser imports remain unsaved in this native checkpoint model. A browser
`browser-download-request` checkpoint tracks a handoff separately and never calls
`markSaved` or `markRecovery`; it cannot authorize discarding the live document.
See the [platform contract](platform-services.md) for subsequent browser work.
No recovery scheduler, filesystem operation, or file format is implemented here.
The [TW-039 recovery policy](recovery-policy.md) defines independent capture
sequences and lifecycle epochs for scheduling/publication; history revision
numbers cannot order recovery captures across undo, branching or controllers.

## History limits and memory

Defaults are **100 entries and 64 MiB of accounted history**, shared by undo and
redo. `limits: { maxEntries, maxBytes }` accepts positive safe integers. A new edit
first drops the redo branch, then evicts the oldest whole steps until both limits
hold. No partial gesture is retained. Revision and save tokens need no retained
entry to remain meaningful.

An individual transaction larger than `maxBytes` is rejected and rolled back,
preserving all prior history/redo and saved state. It is never silently made
irreversible. Tools should report this result and let the user choose a smaller
operation or a larger history setting; automatically splitting a gesture would
change its undo semantics.

`state.retainedBytes` is deterministic **accounting**, not V8 heap size: per entry,
256 bytes plus twice the JSON payload/label character count, plus 128 bytes per
net tile run or metadata change. It deliberately overcharges some shared immutable
values. Actual object/string overhead is engine dependent. Eviction and branch
replacement release the controller's references; a subscriber retaining changes
or a caller retaining gesture data can independently keep that data alive.

The controller retains compact changed runs and affected metadata, never a clone
of all document tiles. A layer removal necessarily retains that layer's occupied
content. Layer order snapshots cost O(number of layers); metadata replacement costs
O(size of affected records). Tile storage execution visits written cells; net
compaction uses O(r) endpoints/storage and O(r log r) sorting/heaps per affected
row, where r is the number of primitive delta runs. Highly varied paint can require
one delta per changed cell. Undo/redo reuse the retained entry but temporarily
construct replay commands and another journal/event.

Limits bound **retained history only**. Active finite gesture commands, the
transaction journal, endpoint compaction, serialization used for accounting, and
notification payloads can temporarily exceed that limit. No whole-document copy
is needed for a sparse edit, but there is no hard transient-memory or main-thread
latency cap. Work chunking/cancelable long-running tool computation and editor
performance budgets remain integration work; commit itself is synchronous.

## Validation and measurement

[history.test.ts](../tests/domain/history.test.ts) covers grouped gestures,
cancellation, net no-ops, late failure and rollback, removed/replaced layers,
metadata/bounds round trips, a cross-chunk 8 × 8 multilayer move by three tiles,
overwritten destinations, immutable inputs/events, renderer invalidation content,
observer failures, stale gestures, revision branching, save/recovery checkpoints,
count/byte eviction and oversize rejection. Eighty seeded transactions with
30 overlapping spans each are checked against an independent per-cell oracle and
complete undo/redo snapshots. Existing complete model fixture tests still run.

```sh
npm run build
npm test
npm run format:check
npm run perf:history
npm run perf:history -- --output docs/history-baseline.json
```

[history-baseline.ts](../scripts/history-baseline.ts) measures **318,400 changed
cells across two edit layers**, with 160,000 overwritten cells, spread throughout
a 6,400 × 6,400 canvas in 40,000 runs. Spans cross 32/64-tile boundaries; the last
span is explicitly clipped by fixture construction. Both an empty background and
the full **24,025,200-cell heartland** background run twice in fresh Node processes.
The report verifies every notification span/inverse value, all edited-layer runs,
and the unchanged content hash and storage counters of every background layer.

[history-baseline.json](history-baseline.json) records actual timings, raw memory
snapshots, source fingerprints, history accounting, eviction release and machine
metadata. GC is outside timers. Post-GC `heapUsed + arrayBuffers` differences
approximate retained model/history/runtime memory. `external` already includes
ArrayBuffers and is not added again. RSS is process-wide; snapshots are not a
transient heap profiler. The measured notification consumer validates invalidation
content; it does not present a frame. Two runs do not establish percentile editor
budgets, app physical memory, native I/O or recovery performance.

## Prepared tile edits (TW-022)

Flood fill uses `MapDocument.prepareTiles` to stage a cancelable copy-on-write
edit without changing live content or locking navigation. It returns an opaque,
single-use plan. `CommandHistory.executePrepared(label, plan)` validates its
source version and applies the same history accounting/limits and one-event
contract as `execute`. Capacity failure occurs before storage publication, so no
rollback writes are required. A dropped plan is collectible. Other edits may run
while preparing, but invalidate that plan; no stale storage is published.
See [flood fill](drawing-gestures.md#flood-fill-tw-022) for scheduling and limits.
