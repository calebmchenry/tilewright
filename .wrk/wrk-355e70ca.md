---
id: wrk-355e70ca
title: Compact window chrome and status bar
status: done
created_at: 2026-11-20T02:41:17Z
priority: normal
labels: []
---
Implemented requested compact app chrome.

- Replaced redundant branding/file/history toolbar with a 36px draggable document title strip. Native File/Edit menus and shortcuts retain all actions.
- Configured macOS overlay title bar, hidden duplicate title, traffic-light positioning, reserved left inset, and window drag/zoom permissions.
- Moved recovery review to the top-right three-dot popover. Keyboard activation, Escape, dialog dismissal and focus restoration are covered.
- Footer is a fixed 28px single line containing tile coordinates, chunk/local coordinates, and the last successful explicit save time. Failed/canceled saves do not advance it; session replacement clears it.
- Routine feedback remains available to assistive technology without occupying layout. Action errors are dismissible; recovery warnings/retry and export progress/cancellation remain visible above the footer.
- Updated shell documentation and migrated affected UI coverage from removed buttons/readouts to keyboard/native menu actions and model assertions.

Validation:
- 500 domain tests passed.
- 71 distinct affected UI tests passed across focused runs and corrected-test reruns (editor, grid, canvas, layers, annotations, area browsing, fill, complete session, project files/recovery/export and usability).
- Screenshot verified at 640x480; native macOS bundle inspected for compact chrome and recovery popover/dialog focus restoration.
- TypeScript/build, cargo check --locked, changed-file Prettier check and git diff --check passed.
- Debug macOS app bundle built. Native recovery inspection encountered the existing exclusive-store lock from another running Tilewright instance; no recovery data was changed.

Preserved pre-existing unrelated workspace changes. Temporary Playwright reuse-server config removed. No performance gates added or claimed.
