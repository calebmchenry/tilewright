#!/usr/bin/env bash
set -euo pipefail

# Always work in this repository, even when launched from another directory.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Append across restarts so monitors can keep following the same file. WRK's
# detailed, timestamped run logs and per-ticket output stay alongside this log.
mkdir -p .wrk-runs
touch .wrk-runs/monitor.log
exec > >(tee -ai .wrk-runs/monitor.log) 2>&1
trap 'status=$?; printf "[%s] Runner stopped (exit %s).\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$status"' EXIT
printf '\n[%s] Runner started (pid %s).\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$"

for tool in wrk codex python3; do
  command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 1; }
done

skill="${SPRINT_EXECUTE_SKILL:-${CODEX_HOME:-$HOME/.codex}/skills/sprint-execute/SKILL.md}"
if [[ ! -r "$skill" ]]; then
  echo "Cannot read sprint-execute skill: $skill" >&2
  echo "Set SPRINT_EXECUTE_SKILL to its SKILL.md path." >&2
  exit 1
fi

prompt=$(cat <<EOF
Use the \$sprint-execute skill. Read its instructions at: $skill

Execute WRK ticket {id} in this repository. Read it with 'wrk show {id}',
and treat its full body, acceptance criteria, and validation requirements as
the sprint document. Read AGENTS.md and any referenced project documents.

Strategy A (Orchestrated) is already selected for this unattended run. Execute
the work yourself, phase by phase, in this Codex session. Use WRK ticket state
instead of the sprint ledger; no separate SPRINT document is required.

Use 'wrk update {id} --status in-progress' when starting. Complete the ticket,
run the relevant validation, and fix failures. Preserve the ticket body and
record the implementation locations and actual validation evidence using
'wrk update {id} --body-file ...'. Only after all acceptance criteria are met,
mark it done with 'wrk update {id} --status done'.

After completing the ticket, create a Git commit containing its implementation
and WRK ticket updates, with {id} in the commit message. Commit only this ticket's
changes and preserve unrelated staged and unstaged work. Do not report success
until the commit has been created.

If you cannot complete the ticket, record the blocker through wrk, mark it
blocked, and stop with an explanation. Never mark incomplete work done.
Work only on this ticket; the outer runner will select the next one.
EOF
)

# WRK re-queries ready tickets after each success, so completing a dependency
# unlocks its successor. A failed command or a ticket left unfinished stops it.
wrk run --ready --expect-status done \
  --heartbeat-interval "${WRK_HEARTBEAT_INTERVAL:-30s}" -- \
  codex exec --dangerously-bypass-approvals-and-sandbox "$prompt"

# No ready tickets can also mean that unfinished work is blocked or in progress.
wrk list --json | python3 -c '
import json
import sys

remaining = json.load(sys.stdin)["result"]["tickets"]
if remaining:
    print("Stopped: no ready tickets remain, but unfinished work exists:", file=sys.stderr)
    for ticket in remaining:
        print("  {id} [{status}] {title}".format(**ticket), file=sys.stderr)
    sys.exit(1)
print("No unfinished tickets remain.")
'
