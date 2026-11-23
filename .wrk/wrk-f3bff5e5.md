---
id: wrk-f3bff5e5
title: Replace named-color action buttons with a three-dot menu
status: done
created_at: 2026-11-23T18:35:55Z
priority: normal
labels:
  - github-pages
---
Replaced the three buttons beneath each named color with a compact three-dot menu beside its swatch and name.

- Edit, Adopt raw tiles, and Remove retain their existing dialogs and document/history behavior.
- Native popovers appear above the scrolling sidebar, stay within the viewport, and dismiss on outside click, Escape, Tab, scroll, or resize.
- Supports Enter/Space, arrow keys, Home/End, accessible menu labels, and focus return to the trigger or Register color after removal.
- Verified and fixed repeat-click toggling in WebKit, where clicking a button may blur the menu without a related focus target.
- Updated existing UI workflows and the registry documentation. Preserved unrelated workspace edits.

Validation (Node 24.22.3):
- 21 affected Playwright tests passed: registry, clipboard, eraser/sampling, and complete session.
- All 8 registry tests passed again after the final dismissal fix.
- Production session workflow passed in Chromium, Firefox, and WebKit.
- Manual browser automation verified menu keyboard navigation, shortcut isolation, focus restoration, click toggling, Enter/Space, Escape, Tab, outside click, and small-window placement across all three engines; final toggle/dismissal checks passed after the WebKit fix.
- Inspected screenshots at 1200x800 and 640x452.
- Final TILEWRIGHT_WEB_BASE=/tilewright/ npm run build:web passed, including TypeScript checks.
- Changed-file Prettier check, git diff --check, and wrk validate passed.

Existing bundle-size warning remains; no performance budget pass is claimed. Rendering/presentation and large-edit performance deferrals remain unchanged.

Pages deployment follow-up (2026-11-23):
- Committed and pushed the scoped feature as 9d6c3af; a clean checkout passed all 21 affected UI tests, browser formatting, and build checks.
- Workflow 45241735643 passed all domain tests and 195 development UI tests, but two recovery tests used substring matching for the application More options button and also matched the new color menus. Publication was correctly blocked.
- Made application overflow selectors exact in browser-platform, browser-recovery, and project-files tests. All 28 focused platform/recovery workflows pass from the clean release checkout, including both CI failures. No application behavior or deployment gates were changed.

### Color-menu release — 2026-11-23

Published revision 52b976ea24a9a8138bbe5bb2caa779a632078e31 from main at
https://calebmchenry.github.io/tilewright/ through successful gated workflow
https://github.com/calebmchenry/tilewright/actions/runs/45245506152.
Deployment completed at 2026-11-23T20:09:40Z with base /tilewright/.

Hosted validation passed: 523 domain tests, 197 development UI tests, the two-case
Linux Firefox smoke, and all 39 production browser tests at each of /pages-smoke/
and /tilewright/. No deployment gates, retries, or browser coverage were changed.

A clean checkout of the deployed revision passed all 9 focused live tests in
Chromium, Firefox, and WebKit (37.4 seconds): production asset bytes/MIME and lazy
chunks, source/harness exclusion, startup/reload, project open/edit/undo/download,
agent export, and the complete author/move/transform/recolor/reopen/recover session.
The latter uses the new color menu. This is focused hosted verification; the full
39-case live suite from the original release was not repeated. All 39 cases did
pass against production artifacts at both paths in CI.

Live reports are retained locally at /tmp/tilewright-color-menu-release-evidence/.
Hosted success log: /tmp/tilewright-pages-45245506152.log.
The initial run 45241735643 was blocked by ambiguous application overflow test
selectors; the exact-selector correction passed 28 focused recovery/platform
checks before the successful complete hosted rerun. Unrelated uncommitted
zoom-tool work remains excluded. Existing performance deferrals remain unchanged.
