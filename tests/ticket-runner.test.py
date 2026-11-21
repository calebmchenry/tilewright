"""Run the actual shell runner against isolated WRK projects, never this backlog."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run-tickets.sh"
WRK = shutil.which("wrk")
FAKE_CODEX = """#!/usr/bin/env python3
import os
from pathlib import Path
import re
import subprocess
import sys

ticket = re.search(r"Execute WRK ticket (wrk-[a-z0-9]+) in", sys.argv[-1]).group(1)
with Path("calls").open("a") as calls:
    calls.write(ticket + "\\n")
mode = os.environ.get("FAKE_CODEX_MODE", "done")
if mode == "fail":
    sys.exit(7)
status = "in-progress" if mode == "unfinished" else "done"
subprocess.run(["wrk", "update", ticket, "--status", status], check=True)
"""


@unittest.skipUnless(WRK, "Install wrk with run support to test the runner")
class TicketRunnerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="tilewright-runner-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        subprocess.run([WRK, "init", str(self.root)], check=True, capture_output=True)
        scripts = self.root / "scripts"
        scripts.mkdir()
        self.runner = scripts / "run-tickets.sh"
        shutil.copy2(RUNNER, self.runner)
        binary = self.root / "bin"
        binary.mkdir()
        codex = binary / "codex"
        codex.write_text(FAKE_CODEX)
        codex.chmod(0o755)
        skill = self.root / "SKILL.md"
        skill.write_text("Test fixture; no real Codex session is launched.\n")
        self.env = dict(os.environ)
        self.env.pop("WRK_LABEL", None)
        self.env.pop("FAKE_CODEX_MODE", None)
        self.env.update(
            PATH=str(binary) + os.pathsep + str(Path(WRK).parent)
            + os.pathsep + self.env["PATH"],
            SPRINT_EXECUTE_SKILL=str(skill),
            WRK_HEARTBEAT_INTERVAL="1s",
        )

    def wrk(self, *arguments):
        result = subprocess.run(
            [WRK, "--project", str(self.root), *arguments, "--json"],
            capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)["result"]

    def ticket(self, title, label=None, depends_on=None, status="todo"):
        args = ["new", title]
        if label is not None:
            args.extend(["--label", label])
        if depends_on:
            args.extend(["--depends-on", depends_on])
        ticket = self.wrk(*args)["ticket"]["id"]
        if status != "todo":
            self.wrk("update", ticket, "--status", status)
        return ticket

    def run_queue(self, **environment):
        return subprocess.run(
            ["bash", str(self.runner)],
            cwd=self.root.parent,  # The runner must find its own repository.
            env={**self.env, **environment},
            capture_output=True, text=True, timeout=20,
        )

    def calls(self):
        path = self.root / "calls"
        return path.read_text().splitlines() if path.exists() else []

    def unchanged_snapshot(self, *tickets):
        return {ticket: (self.root / ".wrk" / (ticket + ".md")).read_bytes()
                for ticket in tickets}

    def test_default_queue_respects_dependencies_and_excludes_existing_backlog(self):
        deferred = self.ticket("Unlabeled ready work")
        other = self.ticket("Other labeled work", "release")
        blocked = self.ticket("Deferred blocked work", "release", status="blocked")
        finished = self.ticket("Already finished", "github-pages", status="done")
        canceled = self.ticket("Canceled", "github-pages", status="canceled")
        untouched = self.unchanged_snapshot(deferred, other, blocked, finished, canceled)
        first = self.ticket("Browser foundation", "github-pages")
        second = self.ticket("Browser files", "github-pages", depends_on=first)
        result = self.run_queue()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [first, second])
        self.assertEqual(self.unchanged_snapshot(*untouched), untouched)
        self.assertIn("No unfinished tickets remain for label 'github-pages'", result.stdout)
        self.assertIn("Ticket label: github-pages", (self.root / ".wrk-runs/monitor.log").read_text())

    def test_empty_matching_queue_succeeds_with_unrelated_work_remaining(self):
        deferred = self.ticket("Deferred release", "release")
        before = self.unchanged_snapshot(deferred)
        result = self.run_queue()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.unchanged_snapshot(deferred), before)

    def test_blocked_in_progress_and_external_dependencies_fail_without_running_them(self):
        external = self.ticket("Unlabeled dependency")
        self.ticket("Waiting on other queue", "github-pages", depends_on=external)
        self.ticket("Blocked Pages work", "github-pages", status="blocked")
        self.ticket("Interrupted Pages work", "github-pages", status="in-progress")
        result = self.run_queue()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])
        self.assertIn("unfinished work exists", result.stderr + result.stdout)
        self.assertIn("Waiting on other queue", result.stderr + result.stdout)

    def test_override_scopes_both_execution_and_completion(self):
        pages = self.ticket("Pages remains todo", "github-pages")
        before = self.unchanged_snapshot(pages)
        selected = self.ticket("Explicitly selected work", "other queue")
        result = self.run_queue(WRK_LABEL="other queue")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [selected])
        self.assertEqual(self.unchanged_snapshot(pages), before)
        self.assertIn("No unfinished tickets remain for label 'other queue'", result.stdout)

    def test_blank_label_is_rejected_before_any_work(self):
        self.ticket("Ready Pages work", "github-pages")
        self.ticket("Ready unlabeled work")
        for label in ("", " \t "):
            with self.subTest(label=label):
                result = self.run_queue(WRK_LABEL=label)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("WRK_LABEL must be nonblank", result.stderr)
                self.assertEqual(self.calls(), [])

    def test_child_failure_and_unfinished_status_still_stop_the_queue(self):
        first = self.ticket("First Pages task", "github-pages")
        self.ticket("Dependent Pages task", "github-pages", depends_on=first)
        for mode in ("fail", "unfinished"):
            with self.subTest(mode=mode):
                (self.root / "calls").unlink(missing_ok=True)
                result = self.run_queue(FAKE_CODEX_MODE=mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [first])


if __name__ == "__main__":
    unittest.main(verbosity=2)
