---
id: wrk-dbdcad7c
title: 'TW-057: Adapt browser unsaved-work protection and application actions'
status: done
created_at: 2026-11-21T00:07:03Z
depends_on:
  - wrk-c1ace5fb
priority: normal
labels:
  - github-pages
  - implementation
fields:
  sequence: 57
---
## Outcome

Browser users get accurate document status and safe New/Open/navigation behavior,
with usable buttons and shortcuts for the browser file workflow.

## Source and scope

Build on TW-055/TW-056. Read src/editor/document-lifecycle.ts,
src/editor/application-actions.ts, src/native/application-menu.ts,
src/FileControls.tsx, src/main.tsx and docs/command-history.md.

## Work and acceptance criteria

- [x] Use explicit browser action labels (Open, Download project) and appropriate
  filename/status feedback. Distinguish changes since a download request from
  native durable-save status; update prompts/timestamps consistently.
- [x] Preserve Save/Discard/Cancel behavior on desktop. Browser New/Open/drop
  must offer deliberate continuation/discard/cancel and a way to download first;
  merely requesting a download must not silently authorize document replacement.
- [x] Track the exact snapshot/checkpoint handed to download. Edits made during
  asynchronous work remain unexported, and agent export never clears project state.
- [x] Install beforeunload only when needed for work at risk. Use the browser's
  generic warning and do not depend on awaiting saves or showing a custom dialog
  during tab close. Document that this warning is best effort, not recovery.
- [x] Audit pagehide/pageshow, including back/forward cache restoration, so a
  returning page does not reuse a disposed editor. Clean up handlers safely.
- [x] Support Cmd/Ctrl actions where browser behavior permits; keep buttons
  accessible when browsers reserve shortcuts. Preserve focused text input,
  clipboard, undo/redo, modal behavior and editing tools.

## Validation

Test unsaved New/Open/drop decisions, canceled downloads where observable,
edits during downloads, keyboard/text focus, browser warning registration and
reload/back/forward behavior. Run desktop lifecycle/menu regressions. Record
browser-specific restrictions without claiming native close guarantees.

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

Executed sprint-execute Strategy A directly, phase by phase in this Codex session,
using WRK state instead of a sprint ledger. Read the skill, AGENTS.md, README/INTENT,
ticket runner, platform services, project format, command history, editor shell,
desktop development and the specified implementation sources. Dependency
wrk-c1ace5fb was done before starting. The skill weather report fetched successfully;
its coding recommendations were reviewed without switching this orchestrated run.
No worker delegation, new tickets or deferred backlog changes.

### Completed phases and implementation locations

1. Download status and deliberate replacement:
   - src/editor/project-files.ts retains the exact session/history checkpoint AND
     active/hidden layer preferences from the snapshot actually handed to download.
     Browser status compares content revision and preference values, including
     undo/redo/branching, without retaining another whole-map copy. Failed handoffs
     keep the previous request evidence; later edits/preferences stay unexported.
     Native saved/recovery checkpoints and source-file authority are unchanged.
   - src/FileControls.tsx and src/App.tsx show explicit Open/Download labels,
     download-relative status and a separate request timestamp/filename tooltip.
     Native Saved status/timestamps remain native-only. Browser New/Open/drop offer
     Cancel, Download project and stay, and deliberate Discard changes (or Continue
     without another download when the current state matches the request). Download
     ends that replacement attempt with the outgoing map installed. Retrying and
     explicitly choosing continuation is still required; a request is never an
     automatic discard approval. The picker remains on its original user gesture.
   - src/editor/document-lifecycle.ts also guards persisted preferences against
     changes behind a replacement prompt or asynchronous transition. Existing
     native Save/Discard/Cancel and file/menu operation gates are preserved.
2. Browser navigation and accessible actions:
   - src/platform/browser-navigation.ts installs beforeunload only while browser
     work has no known local source copy: new maps or content/preferences differing
     from the imported file. Returning to the imported revision/preferences removes
     it. A requested download never proves disk persistence or removes this risk.
     The synchronous handler only requests the browser's generic warning, with no
     awaited save, custom close dialog or shutdown-only recovery scheme.
   - src/main.tsx preserves the live editor/root/canvas on persisted pagehide;
     pageshow refreshes input context and warning registration. Non-persisted
     pagehide/HMR disposes handlers, root and application once. Pending startup
     cannot construct an application after disposal.
   - BrowserFileControls exposes a New map button as well as Open and Download,
     using the existing ApplicationActions New dialog. Shared Cmd/Ctrl routing,
     native menus, focused text editing/clipboard/undo and modal/tool isolation
     were audited and regression-tested. src/styles.css gives browser document
     identity/status enough width to wrap above controls at compact sizes.
3. Documentation and verification:
   - docs/browser-lifecycle.md documents status, exact snapshot/preferences,
     deliberate continuation, source-relative risk, generic warning limitations,
     cache lifetime and reserved shortcuts. README.md, docs/platform-services.md,
     docs/project-format.md, docs/command-history.md, docs/editor-shell.md and
     docs/desktop-development.md link/update the implemented contract.
   - tests/domain/browser-project-files.test.ts covers status across history and
     preferences, edits during asynchronous downloads, failed handoffs, explicit
     New/Open/drop decisions and agent export independence. Existing native
     lifecycle/file/menu tests continue to cover desktop save outcomes.
   - tests/browser-lifecycle.spec.ts uses the shipping entry and real browser
     events for conditional warning registration/removal, generic reload cancel
     and accept, New decisions, focused text/keyboard/modal behavior, repeated
     persisted page events, handler cleanup and real back/forward navigation.
     The latter launches full Chromium with BFCache enabled and waits for commit,
     since cache restoration does not produce a new load event. The small
     tests/navigation-away.html fixture provides the navigation destination.
   - tests/browser-project-files.spec.ts adds observable blocked-download failure
     evidence, exact older-snapshot status and compact-header non-overlap checks;
     tests/editor.spec.ts now expects browser download-relative status. Existing
     chooser/drop/codec/activation/resource-cleanup cases still pass.

### Actual validation evidence

Host: macOS 15.8.1 arm64, Node 24.22.3, npm 11.19.1, Playwright 1.65.1,
Chromium 159.0.8154.6 (headless shell plus full Chromium for actual BFCache).

- npm run build: passed strict frontend/test/domain TypeScript and Vite production
  build after the final code/layout changes.
- Phase 1: 56 focused browser/native file/lifecycle/action/export domain tests and
  39 browser file/native lifecycle/menu UI tests passed.
- Phase 2: 518/518 domain tests and 9/9 browser navigation/renderer tests passed.
  Initial test failures were harness issues: Vite registers a development-only
  beforeunload handler, and an explicitly canceled reload does not complete a
  navigation promise. The probes now count app handlers and trigger cancellation
  without awaiting nonexistent navigation completion.
- Final full suite: npm run test:domain passed 518/518; npm run test:ui --
  --reporter=line,json passed 175/175, with no skipped or flaky tests. UI duration:
  499.7 seconds. This includes complete-session drawing/selection/annotation/codec,
  browser files/navigation, native menu/lifecycle and recovery regressions.
- Final targeted browser file/lifecycle checks: 12/12 passed after the header fix.
  Visual inspection caught status/control overlap at 640 px; the corrected
  screenshot shows filename/status above fully accessible controls, and the
  bounding-box regression now checks non-overlap. Desktop-width production UI
  was also visually inspected.
- Production browser qualification: final dist copied outside the repository and
  served as static files on 127.0.0.1:4173, with an external Playwright config;
  browser-lifecycle.spec.ts and browser-platform.spec.ts passed 7/7. No Tauri
  globals/IPC mocks or native-module requests. The recorded BFCache observation
  is persisted=true with pageshow flags [false, true, true]. Edited content and
  a usable editor survive repeated real back/forward navigation.
- Additional static-build/full-Chromium probe confirmed the edited layer survives
  actual BFCache restoration, history undo works after another edit, a real project
  download completes, and a second return retains the layer. The headless shell
  separately exercised fresh-page navigation; CDP reported its cache delegate
  disabled, not an application disposal. Cached behavior is also deterministically
  covered by three persisted-event cycles and final teardown assertions.
- npm run build:desktop: passed after the final CSS change; produced the local
  release Tilewright.app (12.41 MiB). cargo test --locked --manifest-path
  src-tauri/Cargo.toml -- --test-threads=1 passed 31/31, including actual atomic
  native file/recovery persistence tests.
- npm run format:check, explicit Prettier checks for docs/browser-lifecycle.md and
  docs/platform-services.md, wrk validate (72 tickets), and working/staged
  git diff --check passed.

### Scope, restrictions and preservation

All six acceptance criteria are met. Browser status intentionally distinguishes
request-relative changes from native durable saves. An unchanged import has a
local source copy; new/edited work remains at risk even after a download request.
That conservative warning policy is documented. Download-and-stay plus a fresh
explicit continuation avoids asynchronous picker activation problems and never
silently replaces the map. Agent export changes no project/recovery evidence.

Beforeunload is best effort, needs browser user activation, may be suppressed and
cannot cover crashes/process termination; it is not recovery or a native-close
guarantee. Browser downloads may be blocked/canceled after handoff without a page
receipt. Observable handoff failures are tested; the app reports only requests.
OS picker cancellation is represented by the input's standard cancel event,
since Playwright cannot dismiss that OS dialog. Browser-reserved shortcuts are
not guaranteed; the buttons remain accessible. Firefox/WebKit/Safari and live
GitHub Pages/subpath deployment were not qualified by this ticket.

Native UI regressions substitute OS IPC. The packaged app was built, but a real
native dialog/WKWebView session was not driven interactively here. There is no
project-format fork, application backend, new recovery service or cloud storage.
The existing Vite >500 kB chunk warning and target-scale browser latency/memory
measurements remain TW-049/TW-050 performance deferrals, not new dependencies.
TW-049 through TW-054 remain unchanged and outside the Pages queue.

Only this ticket's implementation/tests/docs and WRK record are staged for its
commit. App.tsx and styles.css were staged through ticket-only patches. Baseline
comparison verified all 35 pre-existing modified files and 9 unrelated untracked
files remain intact; no unrelated work is included. The initial index was empty.
