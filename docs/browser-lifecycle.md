# Browser document status and navigation (TW-057)

The browser opens local `.tilewright` files and requests downloads of editable
copies. The header exposes **New map**, **Open…**, and **Download project** so
browser-reserved shortcuts do not make an action inaccessible. No map bytes are
sent to a server. Desktop File/Edit menus, Save/Save As, and native guarded
Close/Quit retain their existing behavior.

## Download status and deliberate replacement

`ProjectFiles.lastDownload` records the exact session, committed history checkpoint,
persisted active/hidden layer preferences, suggested filename and request time
handed to the browser. Status compares the current revision and preferences with
that evidence. Undo to the captured revision becomes unchanged; redo or a different
history branch becomes changed. Preference changes also count, even though they
are outside map content history. Camera, tool and selection changes do not count.
Later edits during asynchronous encoding are never included in the earlier request.
No additional full-map snapshot is retained for status comparison.

The header says **Not downloaded**, **Opened file · no changes**, **Changes since
download request**, or **No changes since download request**. The footer records
**Download requested** with its time; its tooltip identifies the filename and
explains that saving to disk is unconfirmed. Native **Saved** status and timestamps
are not used for browser requests. Download failures before handoff retain the
previous request evidence. A browser may cancel or block a download after handoff
without notifying the page. Check the browser's downloads and the actual file.
Agent exports never acknowledge project content, preferences, or recovery.

New/Open/drop retain a deliberate replacement prompt, including after a download.
**Cancel** (also Escape) keeps the map. **Download project and stay** requests the
current snapshot and ends the replacement attempt with the map still installed.
After checking the download, retry the action; **Continue without another download**
is offered if the current state matches the request, otherwise **Discard changes**.
Both explicitly authorize replacement and loss of the outgoing undo history; no
request alone grants that permission. Failures and edits behind the prompt abort
replacement. The picker opens before prompting, on the original user activation;
no file picker must be opened after awaiting a download.

## Navigation warning and page lifetime

The browser-only `beforeunload` binding is present while work is at risk: a new
map, or content/persisted preferences differing from the imported local source.
An unchanged imported file has a local source copy, so needs no warning. Undoing
all edits and restoring its preferences removes the handler. A download request
alone does not remove it: the page cannot verify that a file reached disk. Native
history remains separate; browser imports are never assigned a native saved
checkpoint. The initial new map also has no local source copy.

The handler synchronously calls `preventDefault` and supplies the legacy
`returnValue` signal. It does not await writes, start downloads, or show the custom
replacement dialog. The browser chooses the generic warning text and may suppress
it without prior user interaction. Navigation warnings are best effort, **not
recovery**; crashes, process termination and some mobile/tab-close paths may not
fire them. Browser recovery remains TW-059. See the platform documentation for
[`beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

`pagehide` with `persisted: true` leaves the application, history, subscriptions
and canvas alive for the browser's back/forward cache. `pageshow` refreshes input
context and warning registration without constructing another editor. A
non-persisted pagehide or Vite disposal releases the root, listeners and application
once, including startup that is still awaiting platform selection. Non-cached
navigation creates a fresh editor on return; there is no automatic restoration
without recovery. Cache admission/eviction is controlled by the browser. See
[`pagehide`](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
and [`pageshow`](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event).

## Input and validation

Where delivered to the page, Cmd/Ctrl+N opens New, Cmd/Ctrl+O opens the picker,
and Cmd/Ctrl+S or Cmd/Ctrl+Shift+S requests a project download. Browsers may reserve
these combinations (especially New window/Open/Save); the buttons are the reliable
fallback. Map undo/redo and tile clipboard use the shared application router;
focused text fields retain native text undo/redo and system clipboard. Modal,
composition and editing-tool isolation remain in the shared input binding.

Domain tests cover checkpoint/preference races, undo/redo/branching, observable
failures, replacement decisions, export independence and desktop lifecycle/menu
regressions. Shipping-entry Playwright tests exercise file controls, text focus,
download events, navigation warnings, teardown and cache lifetime. Actual results,
cache observations and browser qualification limits are recorded in WRK. Browser
automation does not establish native AppKit/WKWebView close guarantees. Large-map
memory, download latency and presentation budgets remain TW-049/TW-050 deferrals.
