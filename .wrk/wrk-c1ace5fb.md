---
id: wrk-c1ace5fb
title: 'TW-056: Open dropped projects and download editable browser projects'
status: done
created_at: 2026-11-21T00:07:03Z
depends_on:
  - wrk-dac23a64
priority: normal
labels:
  - github-pages
  - implementation
fields:
  sequence: 56
---
## Outcome

Users can open a local .tilewright project by picker or drag/drop, edit it, and
download a compatible project file without sending map bytes to a server.

## Source and scope

Use the platform boundary from TW-055, the shared project encoder/decoder,
ProjectFiles and EditorWorkspace. Read docs/project-format.md and tests covering
project files, project loading and deterministic snapshot encoding.

## Work and acceptance criteria

- [x] Add an accessible Open file action and visible single-file drop affordance.
  Prevent dropped files from navigating the page. Explain unsupported/multiple
  files and leave the current document intact on errors or cancellation.
- [x] Route picker and drop through one validated, guarded load path. Preserve
  dirty-session protection, reject stale asynchronous loads, and do not install
  malformed or unsupported projects. Keep dialogs compatible with browser user
  activation rules, including actions after an unsaved-work prompt.
- [x] Add Download project with a sensible editable .tilewright filename. Encode
  one committed snapshot using the existing format, including hidden layers,
  registry identities, annotations, bounds and persisted preferences.
- [x] Start downloads with browser Blob/object URL APIs and release resources
  after the handoff. Never represent a download request as a confirmed disk write
  or permission to overwrite the originally opened file.
- [x] Preserve later edits during encoding/download and protect replacement of
  the current document; do not silently discard it after requesting a download.
- [x] Desktop and browser files remain mutually compatible without a schema fork.

## Validation

Exercise actual file chooser uploads, synthetic File drops and browser download
events in Playwright, without Tauri IPC mocks. Decode downloaded bytes and compare
full semantic content; cover invalid files, cancel, repeated opens/downloads,
edits during encoding and an unsaved document being replaced. Run shared codec
and existing native file regressions.

## Delivery constraints

User decision, 2026-11-20: ship a browser version on GitHub Pages using the
working editor baseline. Keep this ticket labeled `github-pages`. Preserve the
existing desktop application and shared `.tilewright` format. Project content
stays local to the browser; no application backend, accounts, or cloud file
storage is required. Follow AGENTS.md and docs/ticket-runner.md.

The existing TW-049 through TW-054 backlog remains deferred and unchanged.
Do not add dependencies on those tickets. Performance budget overruns or missing
measurements alone do not block this work; record limitations and retain the
TW-049/TW-050 performance deferrals. Functional correctness and data integrity
are required. Record actual implementation locations and validation evidence
through `wrk update --body-file` before marking done.

## Implementation and validation record — 2026-11-20

Executed sprint-execute Strategy A phase by phase in this Codex session, with WRK
state as the sprint record. Read the skill, AGENTS.md, ticket runner, project format,
platform contract and relevant project/codec/file/lifecycle sources and tests.
Dependency wrk-dac23a64 was done before starting; the skill weather report was
fetched. No worker delegation, separate sprint ledger, new tickets or deferred
backlog changes.

### Completed phases and implementation locations

1. Browser transport and shared file coordinator:
   - src/platform/browser-project-files.ts provides a real single-file input and
     local File reads, plus Blob/object-URL download handoff. Inputs/listeners are
     removed on selection/cancel/disposal; download links are removed immediately
     and URLs are revoked after a one-second handoff grace period, or immediately
     on a thrown click. browser.ts/services.ts compose the distinct browser bridge
     without native handles, filesystem paths or network file transmission.
   - src/editor/project-files.ts shares the existing committed snapshot, encoder
     and workspace decoder. It validates file count/nonempty size and the 256 MiB
     limit before reading; full envelope/schema/capacity validation stays in the
     shared decoder. It generates sanitized editable .tilewright filenames and
     records only browser-download-request evidence in lastDownload. Downloads
     never mark saved/recovered, change savedPath, establish overwrite authority,
     or replace the active session. Later edits survive encoding.
2. Guarded Open/drop and browser controls:
   - src/editor/document-lifecycle.ts routes picker and drop through the same
     approval/import path. The picker launches synchronously from the original
     user gesture, before the unsaved prompt. Guards cover session, document,
     preferences and checkpoints across selection, approval, read and decode.
     Invalid, canceled and superseded loads preserve the current document.
   - src/FileControls.tsx and src/App.tsx expose accessible Open file and Download
     project actions and a visible drop affordance. Window-level file handlers
     prevent navigation even over panels/dialogs; busy/modal drops ask for retry.
     Browser prompts offer Download project and stay, Discard changes and Cancel.
     Download ends the pending replacement request with the current map intact;
     replacement requires a new deliberate action/discard decision. Feedback says
     Download requested, is visible/dismissible, and never claims a disk receipt.
     src/styles.css handles the browser header at compact sizes;
     src/editor/application-actions.ts labels browser Save shortcuts as downloads.
     Native save/association/recovery semantics and the v1 schema remain intact.
3. Documentation and regressions:
   - README.md, docs/platform-services.md and docs/project-format.md document
     availability, activation, guards, downloads, resource cleanup and limits.
   - tests/domain/browser-project-files.test.ts covers the browser guard and
     request-checkpoint matrix, repeated operations, full content, size limits,
     cancellation, failures, filenames and edits during encoding. The platform
     composition test keeps unavailable-service coverage without DOM dependencies.
   - tests/browser-project-files.spec.ts uses the shipping entry, real chooser
     uploads, synthetic File drops and actual download events, with no Tauri IPC
     mocks. It decodes downloaded bytes and compares all semantics and canonical
     desktop fixture bytes, including hidden layers, registry identities, areas,
     bounds and preferences. It covers repeated opens/downloads, malformed and
     unsupported files, cancellation, activation, URL/input/link cleanup, compact
     controls, edits during real encoder yields, stale File reads and explicit
     replacement after an unsaved-work prompt. Browser smoke/editor shortcut
     expectations were updated for the implemented download behavior.

### Actual validation evidence

Host: macOS 15.8.1 arm64, Node 24.22.3, npm 11.19.1, Playwright 1.65.1,
Chromium 159.0.8154.6.

- npm run build: passed strict frontend/test/domain TypeScript and Vite production
  output. Phase-one focused browser/native file/lifecycle tests passed 42/42;
  focused shipping browser/native UI regressions passed 39/39.
- npm test, final complete run: 512/512 domain tests and 168/168 Chromium UI tests
  passed (UI run 8.3 minutes). This includes all shared snapshot/encoding/decoding/
  loading regressions and existing native file/menu/lifecycle/recovery tests.
- The first complete UI run passed 167/168: tests/editor.spec.ts still expected
  browser Save to report desktop-only availability. Updated that stale assertion
  to require an actual Untitled.tilewright download, request feedback, empty native
  save timestamp and retained unsaved status. The subsequent full run passed.
- Production browser smoke: built dist served by Vite preview on 127.0.0.1:4173,
  tests/browser-platform.spec.ts via a temporary external Playwright config:
  1/1 passed. Real WebGL editing/undo and a real Blob download worked without
  Tauri globals, IPC mocks or native-module requests.
- npm run build:desktop: passed; produced the local release Tilewright.app
  (12.41 MiB) with the shared production assets.
- cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1:
  31/31 passed, including actual native atomic file/recovery persistence tests.
- npm run format:check, explicit Prettier check for docs/platform-services.md,
  wrk validate (72 tickets), git diff --check and staged whitespace checks passed.
- Visually inspected the generated 640 × 720 browser screenshot. Open, Download,
  the drop affordance and request-only feedback are visible. The review caught
  the existing styling hiding informational file messages; browser file feedback
  now has an accessible dismiss button and remains visible.

### Scope, limitations and preservation

No project-format fork or backend was introduced. All six acceptance criteria
are met. This ticket's safe Download project and stay behavior deliberately ends
that replacement attempt; broader continuation UX/change tracking, navigation
warnings/BFCache and browser recovery remain TW-057/TW-059 work. Agent export and
Pages deployment remain their existing tickets, without new dependencies.

Native UI regressions substitute OS IPC; the packaged app was built but no real
native dialog/WKWebView session was driven interactively here. Playwright chooser
uploads are real; OS chooser cancellation cannot be controlled through that API,
so cancellation uses the input's standard cancel event plus domain cancellation
coverage. Browser qualification here is Chromium, with local root-path production
assets, not Firefox/WebKit/Safari or a live/subpath GitHub Pages deployment.

The browser fixture verifies complete semantics, not target-scale browser heap or
download latency. Those measurements and the existing Vite >500 kB chunk warning
remain performance limitations under TW-049/TW-050. The deferred TW-049 through
TW-054 backlog is unchanged.

Only this ticket's implementation, tests/docs and WRK record are staged for its
commit. App.tsx/styles.css were staged through ticket-only patches; comparison
against the starting diff confirmed all pre-existing tracked work remains
unchanged and unstaged. Unrelated untracked tickets/tests are preserved.
