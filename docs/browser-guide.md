# Tilewright in a desktop browser

[Open Tilewright](https://calebmchenry.github.io/tilewright/) to edit maps locally
in your browser. The site supplies the application
assets; it has no project backend, accounts or cloud file storage. Use a desktop
mouse/trackpad and keyboard. Mobile/touch layout and interaction are outside this
release. For local development and Pages publication, see the
[build and deployment guide](github-pages.md). The
[acceptance record](browser-validation.md) describes the verified release scope.

## Start, import and keep an editable copy

Choose **New map** to set fixed tile dimensions. Use **Grow canvas** to add space
explicitly, and **Fit map** or the Zoom selector to move between overview and tile
detail. Tools, layers, named colors, tile selections and named areas share the
same model as the desktop app. The [complete-session guide](complete-session.md)
describes the drawing/rearrangement workflow and annotation independence.

The published baseline allows Pencil and Eraser at every zoom. Precise tools
such as Line, Rectangle, Fill, Eyedropper and Select require at least 8 CSS pixels
per tile; zoom in when the overview notice appears. Drawing area bounds has the
same threshold, while numeric area bounds remain available.

Choose **Open…** and select one local `.tilewright` file, or drop one file onto
the page. Opening reads that file locally; it never uploads map content or grants
permission to overwrite the original. The browser and desktop use the same
[version-1 project format](project-format.md). Validation examines the entire
file before replacement. Malformed files, unsupported versions and agent exports
leave the current map and undo history intact. If you edit while a file is being
read, that import is superseded; retry Open when ready.

Use **Download project** regularly. It captures the committed map, including all
layers (hidden, covered and offscreen), raw and named paint identities, areas and
full descriptions, map bounds, and active/hidden layer preferences. A fresh file
is suggested as `Untitled.tilewright`; an imported project's name is reused.
Your browser chooses the destination and may add a suffix to repeated downloads.
It does not overwrite the source through an editor file handle. Check the browser's
download list and open the actual file to confirm it exists. Reopening resets
undo/redo, tools, selections and camera; those transient states are not saved.

**Download requested** means the browser received the bytes, not that a disk save
was confirmed. **No changes since download request** compares against precisely
that snapshot. Edits made during or after encoding remain newer work. A browser
can block or cancel a download without telling the page. Allow downloads for the
site if prompted, then retry when necessary. Do not close the tab while relying
on an unchecked download.

New/Open/drop provide **Cancel**, **Download project and stay**, and **Discard
changes** (or **Continue without another download** when the request matches the
current map). Download-and-stay ends the replacement attempt: check your file,
then retry and deliberately continue. Continuing clears the outgoing undo history.
Reload/close may show the browser's generic warning after user interaction. That
warning can be suppressed and is not a guaranteed shutdown save. Header buttons
remain available when the browser reserves Cmd/Ctrl shortcuts.

## Editable project versus agent export

| Action           | File              | Purpose                                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Download project | `.tilewright`     | Reopen and continue editing in Tilewright, including layer preferences and area label settings.      |
| Export for Agent | `.agent-map.json` | Give an independent consumer the whole map's layers, tiles, resolved color meanings and named areas. |

Agent export includes hidden layers and all areas regardless of viewport or
selection. Unnamed colors retain their exact RGBA and a null meaning. It cannot
be opened as an editable project. Exporting never acknowledges a project save,
changes its download checkpoint or removes its recovery. **Cancel export** works
before download handoff; after handoff manage cancellation in the browser.
The [agent schema and Python consumer](agent-export-format.md) document independent
interpretation without Tilewright.

## Recover recent local work

Committed edits receive automatic IndexedDB checkpoints while the page is open:
a two-second trailing delay, ten-second maximum scheduling delay and at least
five seconds between captures. Encoding and storage add time, particularly on
large maps. Unfinished strokes, selection previews and unsubmitted form drafts
are excluded. Look for **Recovery checkpoint ready** and its capture time.
Changes after that capture may be lost. There is no promised final write on close.

After reload or a crash, the recovery dialog offers validated checkpoints. You
can also choose **More options → Review recovery…**. Select **Restore as unsaved
copy**, approve replacement of the current map, inspect the restored content,
and download a new editable project. Restoration never modifies a downloaded or
desktop project file. A corrupt newest generation may offer an older valid
fallback. Invalid generations cannot be restored. **Discard recovery…** requires
confirmation for that selected map; keep it until you have checked a durable copy.

Separate tabs have independent writer identities. An actively owned checkpoint
cannot be restored or discarded by another tab. Close its editing tab and refresh
review to release it. Downloads retain recovery. Deliberate successful New/Open
or restore resolves only the outgoing map after validation; a failed/canceled
transition keeps it.

Recovery belongs to the exact origin (scheme, hostname and port) and browser
profile. Paths on the same origin share the store; localhost, a Pages origin and
a custom domain do not. Changing the deployment domain does not move recovery.
Other devices/profiles cannot see it. Site-data clearing, eviction, private-mode
cleanup or profile loss can remove it. Keep checked `.tilewright` downloads as
your own durable copies; recovery is neither a backup service nor cloud storage.

The store retains two generations per map, up to ten unresolved maps and a 1 GiB
logical byte ceiling including a 64 KiB bookkeeping allowance. Browser quota may be
smaller; implementation/transaction overhead uses additional space. Other maps
are not automatically evicted to make room. If storage is full, download and
verify your maps, then discard only the recovery entries you no longer need.
**Recovery unavailable** means no new checkpoint was acknowledged. Editing,
project downloads and agent export remain available. **Retry recovery** retries
storage after the cause is resolved. Close other site tabs for a blocked database
upgrade. Do not clear site data as the first troubleshooting step.

Project and agent codecs each cap one file at 256 MiB, with additional run, cell
and metadata limits in their format specifications. These are defensive limits,
not promises that a browser has enough memory for every permitted file.

## Browser support and release evidence

The desktop browser targets are Chromium, Firefox and Safari with WebGL 2.
Recovery additionally needs IndexedDB, Web Locks and a secure origin (HTTPS or
loopback development). If the canvas cannot initialize, check browser/GPU settings
and the visible error, then use **Retry canvas**. There is no Canvas2D fallback.
An initial site load requires its assets to be available; no service worker or
guaranteed offline reload is provided.

The [browser acceptance record](browser-validation.md) lists the exact tested
engine/OS versions, production subpath results, real Safari smoke and native
regressions. Playwright WebKit is not Safari; automated engine coverage does not
establish every browser version, OS, extension, download preference or private
mode. This release makes no mobile/touch or untested browser/OS guarantee.

Populated 6,400 × 6,400 maps are checked for full project/export integrity,
including 6.62 million and 24.03 million occupied layer cells. Large imports,
exports, recovery captures and overview rebuilding can pause the UI and use
substantial memory. Whole-buffer capture, validation, hashing and Blob copies
remain. Measurements are correctness-run observations, not p95 or memory budgets.
Rendering/presentation refinement stays with TW-049 and large edit/history/memory
refinement with TW-050; those deferred gates are not reinstated for this release.
