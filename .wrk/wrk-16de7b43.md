---
id: wrk-16de7b43
title: 'TW-036: Implement native local file dialogs and atomic project reads/writes'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-4ccae787
priority: high
labels:
  - v1
  - projects
  - implementation
fields:
  sequence: 36
  source: INTENT.md
---
## Outcome

Connect the codecs to conventional macOS local files with reliable failure behavior.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Chosen technology.

**Execution order:** 36 of 54. Phase: projects.

**Prerequisite:** [wrk-4ccae787](wrk-4ccae787.md) — TW-035: Implement validated project decoding and safe load failures.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Add Tauri/Rust file integration for Open, Save, and Save As using native dialogs and the chosen extension.
- Use an atomic replacement strategy appropriate for the destination and preserve the previous file on failed writes.
- Handle cancellation, permissions, unavailable paths, Unicode/spaces, and native error reporting.

## Acceptance criteria

- [ ] The user can select and read/write local project files without a server, account, or network connection.
- [ ] A successful save writes a complete coherent document; an interrupted or failed save does not truncate the last valid saved project.
- [ ] Canceled dialogs have no document/path/dirty side effects; I/O errors are actionable and do not masquerade as success.
- [ ] Save As changes the active path only after successful write; native capabilities are limited to the operations needed.

## Validation

- Test native dialogs and paths with spaces/non-ASCII characters in the desktop app.
- Inject write/rename/read failures and verify that the original file remains readable and document state remains correct.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-037: Implement document lifecycle and unsaved-change protection](wrk-2b769ca2.md).
