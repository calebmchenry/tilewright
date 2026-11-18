---
id: wrk-e6e71f48
title: Rename the product to Tilewright
status: done
created_at: 2026-11-18T20:51:56Z
priority: normal
labels:
  - maintenance
---
## Outcome

Renamed the product to Tilewright throughout the app, package metadata, desktop identity, documentation, and current backlog requirements.

## Acceptance criteria

- [x] UI strings, npm/Cargo package names and locks, and Tauri identity use the new name.
- [x] Current documentation and backlog requirements agree with the new name.
- [x] Existing build and relevant browser checks pass.

Kept the domain type `TileWrite`, which describes a tile write operation. Preserved historical build paths and validation evidence in prior tickets.

## Validation

- Used the repository-pinned Node 24.22.3.
- `npm run build:desktop` passed, including TypeScript checks, the Vite production build, and the locked Cargo release build. Produced `src-tauri/target/release/bundle/macos/Tilewright.app` (10.60 MiB).
- Inspected the generated bundle: `CFBundleName` is `Tilewright`, `CFBundleIdentifier` is `app.tilewright.desktop`, and `CFBundleExecutable` is `tilewright`; the executable exists.
- `npm run test:ui -- tests/renderer.spec.ts`: all 3 tests passed, including the renamed page title and WebGL failure message.
- `git diff --check` and `wrk validate` passed.
- Remaining old product-name references are historical records in prior tickets. No old branding remains in source, configuration, tests, or current docs.

The production build emitted a non-failing Vite chunk-size warning.
