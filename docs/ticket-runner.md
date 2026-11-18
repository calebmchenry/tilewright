# Ticket runner

The [ticket script](../scripts/run-tickets.sh) processes ready WRK tickets one at
a time using the `sprint-execute` skill in Codex.

## Requirements

Install `wrk` with `run` support, an authenticated `codex` CLI, Python 3, and
the `sprint-execute` skill at
`${CODEX_HOME:-$HOME/.codex}/skills/sprint-execute/SKILL.md`. Set
`SPRINT_EXECUTE_SKILL` to use a different skill path.

## Run the ticket queue

From the repository root:

```sh
./scripts/run-tickets.sh
```

The script uses `wrk run` to pick one ready ticket at a time, respecting
dependencies. Each ticket gets a fresh Codex session with sandboxing and approval
prompts disabled and your configured model. Codex runs the skill, validates the
work, records evidence in the ticket, and marks it done through `wrk`. It then
commits the ticket's implementation and WRK updates with the ticket ID in the
commit message, preserving unrelated staged and unstaged work.

The loop stops on a failed Codex call or a ticket that was not marked done. It
also exits with an error if no tickets are ready but unfinished tickets remain.
Canceled tickets are treated as closed. Done tickets are skipped.

## Monitor progress

Progress appears in the terminal and is appended to `.wrk-runs/monitor.log`.
From another terminal in the repository root:

```sh
tail -F .wrk-runs/monitor.log
```

The log includes runner start/stop timestamps, ticket IDs and titles at `START`,
`RUNNING` heartbeats every 30 seconds (elapsed time and time since last output),
`OK` when a ticket finishes, errors, and the final queue result. Heartbeats show
that the process is still running; they do not prove it is making progress.
The runner's final exit status is logged, and the file is preserved across runs.

To change the heartbeat interval:

```sh
WRK_HEARTBEAT_INTERVAL=10s ./scripts/run-tickets.sh
```

Full Codex output stays in `.wrk-runs/<run>/0001-<ticket>.stdout.log` and
`.stderr.log`; the numeric prefix increases with each ticket. Structured events
with timestamps are in that run's `run.jsonl`. The monitor log prints the run log
path at startup.

## Stop and restart

Press Ctrl-C to stop the active run. Partial edits and ticket state remain for
inspection.

After inspecting and resolving a blocked or interrupted ticket, make it eligible
again and restart the runner:

```sh
wrk update <id> --status todo
./scripts/run-tickets.sh
```

Replace `<id>` with the ticket's WRK ID. Its dependencies must be done before it
becomes ready. Tickets already marked done will not run again.
