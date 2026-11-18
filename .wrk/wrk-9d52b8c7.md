---
id: wrk-9d52b8c7
title: 'TW-052: Produce and verify a self-contained offline macOS release build'
status: todo
created_at: 2026-11-18T16:50:31Z
depends_on:
  - wrk-7eef1f66
priority: high
labels:
  - v1
  - release
  - implementation
fields:
  sequence: 52
  source: INTENT.md
---
## Outcome

Deliver a desktop artifact that launches and works without development services.

## Source and scope

**Source:** INTENT.md — Local operation; INTENT.md — Chosen technology; INTENT.md — Deferred scope; INTENT.md — First-version success criteria.

**Execution order:** 52 of 54. Phase: release.

**Prerequisite:** [wrk-7eef1f66](wrk-7eef1f66.md) — TW-051: Meet large-project save, load, recovery, and export budgets.

This is an intentionally sequential delivery backlog. The dependency includes earlier prerequisites transitively; complete it before starting this ticket.

Implementation details left open by INTENT.md are decisions to document, not additional confirmed user requirements.

## Work

- Finalize production Tauri packaging, Tilewright app identity, bundled assets, and documented supported macOS architecture/version choices.
- Build and retain a reproducible local release artifact and document launch/distribution prerequisites as applicable.
- Exercise normal use with networking disabled and all development servers stopped.

## Acceptance criteria

- [ ] The packaged app launches directly from macOS and renders its canvas without Vite, an application server, or remotely fetched assets.
- [ ] Create/edit/save/open/recover/export work offline through native local files.
- [ ] The artifact includes necessary frontend/rendering assets and no developer-machine absolute-path dependencies.
- [ ] Any signing/notarization/distribution limitation is stated accurately; this task does not expand scope to public publishing or non-macOS releases.

## Validation

- Run the built app outside the development launch path with network unavailable and development processes stopped.
- Perform a fresh local project workflow and inspect runtime errors/missing resources.

Record the implementation/decision location and actual validation evidence in this ticket before marking it done.

## Next step

Completing this ticket unlocks [TW-053: Document editing workflows, file formats, recovery, and maintenance commands](wrk-c8f24c53.md).
