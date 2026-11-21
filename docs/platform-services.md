# Browser and desktop platform services (TW-055)

The 2026-11-20 delivery decision adds a static GitHub Pages browser target while
preserving the macOS Tauri app and the shared `.tilewright` format. Project bytes
stay local; neither target requires accounts, an application backend or cloud
file storage. TW-055 established the boundary; TW-056 adds browser project
import/download, TW-057 adds browser lifecycle protection, and TW-058 adds agent
export downloads. TW-059 adds IndexedDB recovery and startup review. This is not a live deployment.

## Composition and current availability

`src/platform/select.ts` selects services once using Tauri's runtime marker. Only
Tauri loads `src/platform/tauri.ts` and the native adapters. `main.tsx` passes the
chosen services to `createEditorApplication` in `src/platform/application.ts`.
Both branches construct the same workspace, project/export coordinators,
lifecycle and action router. Map/history/rendering/codec code remains shared.
There is no Rust port or second editor.

`PlatformServices` exposes service availability and optional recovery and native
bindings. Browser project files use File/Blob transport; agent export uses the
same local Blob download helper with the shared whole-map encoder.
Without recovery services there is no coordinator, timer, startup discovery or
recovery panel. Native menu/close listeners are installed only by the Tauri
composition. The shared DOM keyboard/focus/modal binding lives separately in
`src/editor/application-bindings.ts`; the UI receives the native titlebar choice
from composition instead of detecting its own platform.

| Capability                                              | Tauri                                  | Browser after TW-059                             |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| Render, draw, layers, selections, areas, undo/redo, New | Shared editor                          | Shared editor                                    |
| Project Open / Save / Save As                           | Native picker grants and atomic writes | Local picker/drop and editable project downloads |
| Agent export                                            | Native staged write / atomic commit    | Whole-map JSON download; cancelable encoding     |
| Local recovery / startup review                         | Existing native store and ownership    | IndexedDB checkpoints and review                 |
| Native File/Edit and guarded close/Quit                 | Existing native bindings               | No bindings or IPC                               |
| DOM shortcuts and focus routing                         | Shared binding                         | Shared binding; browser reservations may apply   |

Run `npm run dev:frontend` to use the browser editing preview. Open/Download
buttons remain available without shortcuts. New/Open/drop ask before discarding
unsaved work; Download project and stay keeps the outgoing map installed and
requires a fresh action/discard decision to replace it. The [browser lifecycle](browser-lifecycle.md) tracks changes since download requests,
provides best-effort navigation warnings and preserves cached page lifetimes.
Download and check the file regularly; browser recovery can be cleared or evicted. GitHub Pages build/deployment and
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

`ProjectFileBridge` and `AgentExportBridge` describe **native** picker and
atomic-write operations. `BrowserProjectFileBridge` is a separate variant of
`ProjectFileTransport`, carrying local File reads and download requests without
emulating atomic writes or issuing fake native handles. `ProjectFiles` shares
snapshot/codec/workspace logic. `AgentExportTransport` similarly separates the
native `AgentExportBridge` from `BrowserAgentExportBridge`. The latter exposes
only a synchronous download handoff. `AgentExports` shares capture/encoding and
cancellation but reports a browser request, never native write completion.
Both browser file types use `src/platform/browser-download.ts`; temporary links
are removed immediately and object URLs revoked after the bounded handoff delay,
including after application disposal. See [browser agent export](agent-export-format.md#browser-export-workflow-tw-058).

## Three checkpoint meanings

`PersistenceCheckpoint` is a discriminated session-local evidence contract;
its controller-bound token refers to the exact committed snapshot, not later
edits. TW-056 implements the browser-download variant in `ProjectFiles.lastDownload`.

| Evidence                   | Acknowledgement                                                                                         | What it can establish                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `native-save`              | Native complete atomic write; includes path, checkpoint and time                                        | `markSaved` for the written revision, native association and Saved timestamp; concurrent edits stay dirty                            |
| `browser-download-request` | Snapshot bytes handed to the browser download mechanism; includes filename, checkpoint and request time | A request only. No `markSaved`, `markRecovery`, native path, Saved timestamp, source overwrite grant or automatic discard permission |
| `local-recovery`           | Complete separately stored snapshot successfully published                                              | `markRecovery` only; does not clear dirty state or imply an exported/downloaded copy                                                 |

`ProjectFiles.lastSave` now carries only tagged native-save evidence.
`SaveTimestamp` accepts that evidence only. Browser `DownloadTimestamp` separately
labels request time, without claiming a disk receipt. Native Open establishes a clean
baseline but is not a write timestamp. Recovery's `SavedContext` remains a native
explicit-file receipt with path and hashes; a browser filename or requested
download must never fabricate it. Native source-file comparison in recovery
review is meaningful only with that native receipt. Agent export changes none of
these project checkpoints or associations.

## Subsequent transition protection

TW-056 uses one validated, guarded import path for picker/drop and preserves
session/version/preference/checkpoint checks through picker, approval, read and
decode. It captures one committed snapshot for download, releases browser
resources after handoff, preserves later edits, and never replaces a document
just because download was requested. See [browser project files](project-format.md#browser-project-files-tw-056).

TW-057 implements download-relative content/preference status, request timestamps,
and deliberate New/Open/drop continuation. The browser-only warning is attached
while there is work without a known local source copy; a download request cannot
remove that risk. Cacheable pagehide preserves the live application; pageshow
refreshes its input/warning binding. Final pagehide/HMR disposes it once. See
[browser lifecycle](browser-lifecycle.md) for policy, input, tests and restrictions.

TW-059 transactionally publishes validated IndexedDB checkpoints with per-lineage
Web Locks for tab isolation. Downloads retain recovery; deliberate New/Open/restore
resolve only the validated outgoing transition. Timed checkpoints run during
editing, independently of shutdown. See [browser recovery](recovery-policy.md#browser-indexeddb-recovery-tw-059)
for origin/profile ownership, retention, review, failure handling and storage limits.
Browser storage is not a user-owned downloaded project and may be cleared or evicted.

## Verification

`tests/domain/platform-services.test.ts` checks disabled service handling,
guarded New choices, display-only imported identity, complete shared-format
loading, failure preservation, and native handle/receipt semantics.
`tests/browser-platform.spec.ts` uses the shipping entry with no Tauri mocks,
checks WebGL drawing/undo and local downloads, and rejects native-module/IPC
requests. `tests/browser-project-files.spec.ts` exercises actual chooser uploads,
File drops, download events, decoded content/canonical bytes, read/encode races,
activation and resource cleanup. `tests/domain/browser-project-files.test.ts`
covers browser guards, cancellation/failures and request-only checkpoints.
`tests/browser-agent-export.spec.ts` captures real downloads from the shipping
entry, runs their bytes through the independent Python consumer and full semantic
fixtures, and checks editing races, cancellation, observable failures and cleanup.
`tests/domain/browser-agent-export.test.ts` verifies project/history/recovery
isolation and the exact cancellation boundary.
Existing project/lifecycle/menu/recovery UI tests exercise the Tauri
branch with substituted OS IPC; Rust tests exercise actual local persistence.
Browser tests do not establish native dialog/WKWebView behavior or live Pages
availability. Actual run results and native limitations belong in the WRK record.

Performance budget warnings and missing physical-memory/presentation measurements
remain deferred to TW-049/TW-050 under AGENTS.md. This boundary makes no new
performance guarantee and adds no dependency on the deferred release backlog.
