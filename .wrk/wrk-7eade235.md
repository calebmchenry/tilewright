---
id: wrk-7eade235
title: Scope the ticket runner and backlog to GitHub Pages delivery
status: done
created_at: 2026-11-21T00:07:03Z
priority: normal
labels:
  - github-pages
  - tooling
---
## Outcome

Make the unattended runner select only the intended GitHub Pages delivery queue,
leaving all existing tickets and deferred release work unchanged.

## Work and acceptance criteria

- [x] Use the `github-pages` label by default for both `wrk run --ready` and the
  final unfinished-ticket query; retain dependencies, stop-on-failure and required
  done status.
- [x] Permit an explicit nonblank WRK_LABEL override without an unfiltered fallback;
  show the selected label in monitoring output.
- [x] Document queue preview, label selection and restart behavior in
  docs/ticket-runner.md and record the current delivery queue in AGENTS.md.
- [x] Validate with isolated real WRK projects and a fake Codex command: default
  selection, dependency sequencing, unrelated ready/blocked work, done/canceled
  work, selected blockers, explicit override, blank rejection, child failure and
  unfinished child status.
- [x] Create a dependency-ordered `github-pages` backlog through live deployment
  verification, using WRK, without changing the existing tickets or starting the
  actual runner.

## Validation

Run bash -n scripts/run-tickets.sh, python3 tests/ticket-runner.test.py,
wrk validate, and git diff --check. Compare all pre-existing .wrk files to the
pre-change snapshot. Inspect the default ready queue without executing it.

## Implementation and validation record — 2026-11-20

- scripts/run-tickets.sh defaults WRK_LABEL to github-pages, rejects blank values,
  logs the selected label, and filters both execution and completion queries.
  Dependency and failure/expected-status behavior is retained.
- docs/ticket-runner.md documents the default, explicit override, preview and
  isolated test command. AGENTS.md records the user-selected delivery queue.
- tests/ticket-runner.test.py exercises the actual shell script against real WRK
  projects in temporary directories with a fake Codex executable. All six tests
  passed, including dependency sequencing, excluded ready/blocked/done/canceled
  tickets, empty selected queue, selected blocked/in-progress work, external
  dependency isolation, override, empty/whitespace rejection, child failure and
  successful child exit without the required done status.
- bash -n scripts/run-tickets.sh passed. wrk validate passed (72 tickets).
  git diff --check and Prettier checks for both edited Markdown files passed.
- Hash comparison verified all 65 pre-existing .wrk files unchanged (including
  config/relationship data). Existing user source/docs/tests edits were preserved.
- Created eight sequential todo tickets TW-055 through TW-062 through WRK, all
  carrying github-pages. The first depends on this completed setup ticket and
  later tickets depend on their predecessor; none depends on deferred TW-049
  through TW-054. The final ticket requires verified live Pages publication.
- No real Codex runner, feature implementation or deployment was started. This
  setup was performed directly in the user session; no Git commit was requested
  or created. The runner's future per-ticket commit requirement is unchanged.

## Created delivery tickets

- [TW-055: Separate browser and desktop platform services](wrk-dac23a64.md)

- [TW-056: Open dropped projects and download editable browser projects](wrk-c1ace5fb.md)

- [TW-057: Adapt browser unsaved-work protection and application actions](wrk-dbdcad7c.md)

- [TW-058: Download whole-map agent exports in the browser](wrk-189dc10e.md)

- [TW-059: Recover browser editing sessions with IndexedDB checkpoints](wrk-0c94087a.md)

- [TW-060: Build the browser app for GitHub Pages and add deployment CI](wrk-3b998b07.md)

- [TW-061: Validate and document the browser release from production assets](wrk-44288777.md)

- [TW-062: Publish Tilewright on GitHub Pages and verify the live editor](wrk-0d205b97.md)

## Follow-through after the requested monitored run

The user subsequently requested execution and monitoring of this queue. The
runner completed TW-055 through TW-061 and committed their dependent ticket
records. The setup changes and this completed dependency are now being committed
as well, so a fresh checkout has the labeled runner and a complete WRK graph.
The earlier six integration-test results remain applicable; no runner code has
changed since that validation. `wrk validate` passes with all 72 tickets.
All pre-existing ticket/config/relationship files remain byte-for-byte unchanged.