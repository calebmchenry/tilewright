# Browser and desktop platform services (TW-055)

The 2026-11-20 delivery decision adds a static GitHub Pages browser target while
preserving the macOS Tauri app and the shared `.tilewright` format. Project bytes
stay local; neither target requires accounts, an application backend or cloud
file storage. This ticket establishes the boundary, not the complete browser
file workflow or a live deployment.

## Composition and current availability

`src/platform/select.ts` selects services once using Tauri's runtime marker. Only
Tauri loads `src/platform/tauri.ts` and the native adapters. `main.tsx` passes the
chosen services to `createEditorApplication` in `src/platform/application.ts`.
Both branches construct the same workspace, project/export coordinators,
lifecycle and action router. Map/history/rendering/codec code remains shared.
There is no Rust port or second editor.

`PlatformServices` exposes service availability and optional recovery and native
bindings. The browser service set explicitly disables unimplemented file/export
operations; calling a disabled adapter rejects rather than simulating success.
Without recovery services there is no coordinator, timer, startup discovery or
recovery panel. Native menu/close listeners are installed only by the Tauri
composition. The shared DOM keyboard/focus/modal binding lives separately in
`src/editor/application-bindings.ts`; the UI receives the native titlebar choice
from composition instead of detecting its own platform.

| Capability                                              | Tauri                                  | Browser after TW-055                           |
| ------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Render, draw, layers, selections, areas, undo/redo, New | Shared editor                          | Shared editor                                  |
| Project Open / Save / Save As                           | Native picker grants and atomic writes | Unavailable; TW-056                            |
| Agent export                                            | Native staged write / atomic commit    | Unavailable; TW-058                            |
| Local recovery / startup review                         | Existing native store and ownership    | Unavailable; TW-059                            |
| Native File/Edit and guarded close/Quit                 | Existing native bindings               | No bindings or IPC                             |
| DOM shortcuts and focus routing                         | Shared binding                         | Shared binding; browser reservations may apply |

Run `npm run dev:frontend` to use the browser editing preview. File shortcuts
explain that these operations currently require the desktop app. New still asks
before discarding unsaved work, with Save disabled. Until later lifecycle/recovery
tickets land, keep the page open: navigation/close protection and crash recovery
are not provided in the browser. The current pagehide teardown remains; TW-057
must address back/forward cache restoration. GitHub Pages build/deployment and
cross-browser release qualification belong to TW-060 through TW-062.

## Identity is separate from authority

`src/editor/persistence.ts` defines `ProjectSource`:

- `native-file` carries a native path for display/association. A path alone grants
  no I/O: only the native picker's opaque `NativeFileHandle.token` does that.
- `browser-file` carries `name` only. Even a name that looks like a path grants no
  source reread, overwrite permission or durable-save receipt.

`EditorWorkspace.openProject` copies/validates the source before asynchronous
work, installs it atomically with the decoded session, and preserves the previous
source on failure. New clears it; recovery restoration has no source association.
`savedPath` remains a native-only compatibility projection for the existing
native export protection and recovery contracts. Do not assign `File.name` to it.
The older `savedPath` load option still represents a native source; callers cannot
supply it together with `source`. Browser source loads start dirty, with null
saved/recovery checkpoints. Pathless legacy decode callers retain their existing
behavior; browser callers must supply `source: { kind: "browser-file", name }`.
Neither source kind nor handle is serialized into the project payload.

`ProjectFileBridge` and `AgentExportBridge` currently describe **native** picker
and atomic-write operations. The browser's unavailable placeholders are not
implementations of that native contract. TW-056/TW-058 must add browser
import/download transport at the platform seam, sharing snapshot/codec/workspace
logic without emulating atomic writes or issuing fake native handles.

## Three checkpoint meanings

`PersistenceCheckpoint` is a discriminated session-local evidence contract;
its controller-bound token refers to the exact committed snapshot, not later
edits. The browser-download variant is a contract for subsequent tickets, not an
implemented download operation.

| Evidence                   | Acknowledgement                                                                                         | What it can establish                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `native-save`              | Native complete atomic write; includes path, checkpoint and time                                        | `markSaved` for the written revision, native association and Saved timestamp; concurrent edits stay dirty                            |
| `browser-download-request` | Snapshot bytes handed to the browser download mechanism; includes filename, checkpoint and request time | A request only. No `markSaved`, `markRecovery`, native path, Saved timestamp, source overwrite grant or automatic discard permission |
| `local-recovery`           | Complete separately stored snapshot successfully published                                              | `markRecovery` only; does not clear dirty state or imply an exported/downloaded copy                                                 |

`ProjectFiles.lastSave` now carries only tagged native-save evidence.
`SaveTimestamp` accepts that evidence only. Native Open establishes a clean
baseline but is not a write timestamp. Recovery's `SavedContext` remains a native
explicit-file receipt with path and hashes; a browser filename or requested
download must never fabricate it. Native source-file comparison in recovery
review is meaningful only with that native receipt. Agent export changes none of
these project checkpoints or associations.

## Subsequent transition protection

TW-056 must use one validated, guarded import path for picker/drop and preserve
session/version checks during read/decode. It must capture one committed snapshot
for download, release browser resources after handoff, preserve later edits, and
never replace a document just because download was requested.

TW-057 must give browser New/Open/drop an explicit continuation/discard/cancel
choice and a download-first path that returns to deliberate confirmation. It
must track changes since the requested project snapshot separately from native
saved state, and retain the current desktop Save/Discard/Cancel semantics. A
best-effort `beforeunload` warning cannot await asynchronous saves or present the
custom editor dialog; pagehide/pageshow and back/forward cache need their own
lifetime handling. Buttons must remain usable when browser shortcuts are reserved.

TW-059 must transactionally publish validated IndexedDB recovery and isolate
writers/tabs. A download request cannot resolve/delete recovery as a confirmed
native save. New/Open/discard/restore need explicit retention rules, and shutdown
must not be the only checkpoint opportunity. Origin storage may be cleared,
evicted, unavailable or private; local recovery is not a user-owned downloaded
project. These are later ticket requirements, not claims about this preview.

## Verification

`tests/domain/platform-services.test.ts` checks disabled browser services,
guarded New choices, display-only imported identity, complete shared-format
loading, failure preservation, and native handle/receipt semantics.
`tests/browser-platform.spec.ts` uses the shipping entry with no Tauri mocks,
checks WebGL drawing/undo and unavailable actions, and rejects native-module/IPC
requests. Existing project/lifecycle/menu/recovery UI tests exercise the Tauri
branch with substituted OS IPC; Rust tests exercise actual local persistence.
Browser tests do not establish native dialog/WKWebView behavior or live Pages
availability. Actual run results and native limitations belong in the WRK record.

Performance budget warnings and missing physical-memory/presentation measurements
remain deferred to TW-049/TW-050 under AGENTS.md. This boundary makes no new
performance guarantee and adds no dependency on the deferred release backlog.
