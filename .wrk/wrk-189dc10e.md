---
id: wrk-189dc10e
title: 'TW-058: Download whole-map agent exports in the browser'
status: done
created_at: 2026-11-21T00:07:03Z
depends_on:
  - wrk-dbdcad7c
priority: normal
labels:
  - github-pages
  - implementation
fields:
  sequence: 58
---
## Outcome

Export for Agent downloads the same complete JSON format from the browser as
from the desktop editor, independently of editable-project saving and recovery.

## Source and scope

Read src/editor/agent-export.ts, src/native/agent-export.ts,
src/domain/agent-export.ts, docs/agent-export-format.md and the independent
Python consumer fixtures. Reuse the browser download machinery and platform
capabilities from previous tickets.

## Work and acceptance criteria

- [x] Enable Export for Agent in browser mode with a suggested .agent-map.json
  filename and browser-appropriate progress/cancellation feedback.
- [x] Encode one committed snapshot of all layers and named areas, including
  hidden/offscreen content, regardless of selection or zoom.
- [x] Support cancellation during encoding before download handoff; explain the
  cancellation boundary accurately once the browser owns the download.
- [x] Do not change the project filename, project download/save checkpoint,
  unsaved status, history or recovery state. Repeated exports release resources.
- [x] Retain the desktop temporary-write/atomic-commit behavior and error handling.

## Validation

Capture real browser downloads and pass their bytes through the existing
independent Python consumer and semantic fixtures. Verify hidden layers, registered
and raw colors, named areas, edits during encoding and cancellation; rerun native
agent-export regressions.

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

Executed sprint-execute Strategy A directly in this Codex session, using WRK
state instead of a sprint ledger. Read the skill, AGENTS.md, ticket runner,
README/INTENT, foundation/platform/browser-lifecycle documentation, the complete
agent-format specification, native/shared export sources, and independent Python
consumer/fixtures. Dependency wrk-dbdcad7c was done before starting. The skill's
weather report fetched successfully; its coding recommendations were reviewed
without delegating or switching this orchestrated run.

### Implementation phases

1. Shared export coordinator and browser transport:
   - src/editor/agent-export.ts adds BrowserAgentExportBridge and the
     AgentExportTransport union. The browser branch uses the existing detached,
     committed whole-map snapshot and unchanged canonical encoder. All layers,
     hidden/covered/offscreen cells, raw/registered colors and areas survive.
     Selection, zoom and edits made after capture do not change that export.
   - Suggested names reuse project filename sanitization and Unicode handling,
     ending in .agent-map.json. Encoding exposes byte progress and cancellation;
     canceled/disposed/replaced sessions never hand bytes to the browser.
     Cancellation closes immediately before synchronous download handoff. Later
     feedback directs cancellation to the browser and never claims disk persistence.
   - Native choose/prepare/commit/cancel remains a separate branch with protected
     paths, temporary writes, atomic publication, cleanup and durability warnings.
     src/native/agent-export.ts and Rust native persistence were unchanged.
2. Browser capabilities, UI and resource lifetime:
   - src/platform/services.ts and src/platform/browser.ts enable the browser
     export capability. src/platform/browser-download.ts extracts the existing
     project Blob/anchor machinery; src/platform/browser-project-files.ts reuses
     it. No native grants, filesystem authority, server or network upload is added.
   - Temporary links are removed immediately; object URLs are revoked after the
     existing one-second handoff delay, immediately on observable failure, and
     still cleaned up after editor disposal. Repeated requests release resources.
   - src/FileControls.tsx adds Export for Agent with the existing shortcut hint
     and document-action gate. Browser completion/cancel/error notices remain
     visible with an explicit dismiss control. The availability copy is short
     enough to preserve the minimum-height canvas interaction regression.
   - Export changes no source filename, project request/timestamp/checkpoint,
     saved/recovery revision, dirty state, history or recovery lineage. Editing
     and independent recovery scheduling continue while file actions are gated.
3. Independent verification and documentation:
   - tests/domain/browser-agent-export.test.ts covers project/history/recovery
     isolation, exact snapshots, cancellation at the final progress callback,
     disposal/replacement, noncancelable handoff, errors/retries and filenames.
   - tests/browser-agent-export.spec.ts uses the shipping browser entry, real
     chooser imports, real downloads and the production encoder. It checks hidden
     layers, selection/zoom, all raw/registered semantics and areas, edits during
     real encoding yields, button/Escape cancellation, observable handoff failure,
     undo/redo, unchanged project download evidence and resource cleanup.
   - tests/fixtures/agent-consumer-oracle.ts extracts the existing source-model
     oracle from tests/domain/agent-consumer.test.ts without changing its checks,
     so both suites compare against source runs/metadata independently of the
     export capture. Downloaded bytes run through scripts/consume-agent-map.py
     and both complete semantic fixture hashes through inspectFixture.
   - README.md, docs/agent-export-format.md, docs/platform-services.md and
     docs/browser-lifecycle.md document availability, format equality, suggested
     names, progress/cancellation boundaries, state isolation and limitations.

### Actual validation evidence

Host: macOS 15.8.1 arm64, Node 24.22.3, npm 11.19.1, Python 3.13.3,
Playwright 1.65.1 and Chromium 159.0.8154.6.

- npm run build passed strict frontend/test/domain TypeScript and Vite production
  build. npm run build:desktop passed again after the final compact-copy fix,
  producing the local release Tilewright.app (12.41 MiB).
- Initial coordinator checks passed 16/16; the complete domain suite passed
  524/524. The browser export suite passed 5/5 after correcting test-only click
  coordinates and allowing complete large-project import time. These corrections
  did not change the production codec or weaken semantic assertions.
- Visual QA found completed export feedback hidden by the inherited status CSS;
  the browser dismiss control keeps it visible, with a clip:auto regression.
  The first full npm test run then passed 178 UI cases but failed both minimum-
  height coordinate tests: the expanded availability banner intercepted pointer
  movement at 640 x 452. A real elementFromPoint probe identified the banner.
  Shorter copy restores the canvas hit and Tile 3, 4 readout without changing
  those existing tests. After the fix, tests/editor.spec.ts plus
  tests/browser-agent-export.spec.ts passed 10/10 (55.7 seconds), no skips/flakes.
- Final npm test after the compact-copy fix passed 524/524 domain tests and
  180/180 UI tests (9.1 minutes for UI), with zero failures or skipped tests.
  This includes all five browser-export checks, the original minimum-height
  coordinate regressions at both DPRs, complete editing sessions, native
  lifecycle/menu/export/recovery regressions and full renderer/tool coverage.
- Static production qualification was rerun after the final fix: dist copied
  outside the repository, served as static files on 127.0.0.1:4173, and tested with
  an external Playwright config. Golden export, both populated exports and browser
  startup passed 4/4 (45.8 seconds), with no skips/flakes or native-module/IPC
  requests. No editor probe or Tauri mock is used in these export tests.
- Real download results, independently consumed and compared against source data:

  | Map | Bytes | Occupied layer cells | Runs | Areas |
  | --- | ---: | ---: | ---: | ---: |
  | consumer golden | 1,520 | 28 | 13 | 3 |
  | frontier-v1 | 2,306,718 | 6,620,700 | 123,870 | 1,089 |
  | heartland-v1 | 8,080,454 | 24,025,200 | 470,490 | 1,089 |

  SHA-256 of actual downloaded bytes:
  - golden: 95ad511e2a18b0c467fbe50f4541eb95d686f394b26533b1f76a28edf5e49d7b
  - frontier: f4f9eb51ca403b01e5ea388378e28338105225eceda2f7c40d3e0f08fdb95b83
  - heartland: 8748be7e27d236d74c795647a565ed37cba40694551c918cd5d763ee02e57e89

  The Python consumer reconstructs all 28 golden cells and every populated-map
  layer's resolved-run digest; all bounds, colors/meanings and named-area records
  match the source. The separate semantic fixture inspector reproduces the full
  existing fixture hashes. Hidden layers are imported from real project bytes;
  detail zoom leaves nearly all populated content offscreen.
- cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
  passed 31/31, including all five agent_export tests for active-project aliases,
  destination substitution, cancellation, write/sync/rename failure preservation,
  read-only/nonregular paths, atomic replacement, modes and single-use grants.
  Native export/lifecycle/menu/recovery UI regressions also passed, with OS IPC
  substituted only in those native UI tests.
- npm run format:check, explicit Prettier checks for platform-services.md and
  browser-lifecycle.md, the final FileControls.tsx formatting check, wrk validate
  (72 tickets), and working/staged git diff --check passed.
- Visually inspected compact production export feedback at 640 x 720 and the
  corrected shipping minimum-height UI at 640 x 452. Controls, explicit handoff
  message and coordinate readout are visible; no header/control overlap.

### Scope and limitations

Browser completion is a request, not a durable save receipt. The browser controls
actual filenames/destinations and may block/cancel after handoff without a page
notification; check its downloads. Encoder capture/final assembly and Blob copying
retain synchronous portions and transient memory. No latency percentile or peak-
memory claim is made. The existing Vite >500 kB chunk warning and performance-only
refinement remain TW-049/TW-050 deferrals, not dependencies or blockers.

The native app was built and native regressions rerun; a real packaged AppKit
picker/WKWebView session was not driven here. Firefox/WebKit/Safari and live
GitHub Pages/subpath deployment remain unqualified by this ticket. There is no
new recovery service, format fork, backend, account or cloud storage. TW-049
through TW-054 and all other ticket bodies remain unchanged.

The initial index was empty. All 43 unrelated pre-existing dirty/untracked files
were compared byte for byte with the starting snapshot and preserved. Only this
ticket's 14 implementation/test/documentation files plus its WRK record are in
commit scope. No separate sprint document, worker delegation or next-ticket work.

All five acceptance criteria are satisfied. Validation is complete; this ticket
is ready for its implementation-and-WRK commit with wrk-189dc10e in the message.
