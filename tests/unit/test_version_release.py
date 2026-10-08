"""Real temporary Git repositories exercise atomic publication and retry behavior."""

import json
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from packages.platform.release_version import RELEASE_FILES, STATE_FILE
from scripts.operations.version_release import event_merge, merged_prs, reconcile
from scripts.operations.version_release_git import ReleaseGit
from tests.unit.test_release_version import release_files


class GitReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="x-synth-version-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote, self.source = self.root / "remote.git", self.root / "source"
        self.command(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.command(self.root, "clone", str(self.remote), str(self.source))
        self.command(self.source, "config", "user.name", "Version Test")
        self.command(self.source, "config", "user.email", "version@example.invalid")
        (self.source / "README.md").write_text("Version test baseline\n", encoding="ascii")
        self.command(self.source, "add", "README.md")
        self.command(self.source, "commit", "-m", "baseline")
        baseline = self.command(self.source, "rev-parse", "HEAD").strip()
        files = release_files()
        state = json.loads(files[STATE_FILE])
        state["baseline"]["revision"] = baseline
        files[STATE_FILE] = json.dumps(state)
        for name, content in files.items():
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        self.command(self.source, "add", ".")
        self.command(self.source, "commit", "-m", "merged version-policy PR")
        self.merge = self.command(self.source, "rev-parse", "HEAD").strip()
        self.command(self.source, "push", "origin", "main")
        self.candidates = [{"number": 55, "merge_commit_sha": self.merge}]
        self.git = ReleaseGit(self.source)

    @staticmethod
    def command(root, *args):
        return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True,
                              text=True, timeout=30).stdout

    def test_atomic_publish_replay_and_dirty_checkout_preservation(self):
        (self.source / "VERSION").write_text("local user draft\n", encoding="ascii")
        status = self.command(self.source, "status", "--porcelain")
        original_head = self.command(self.source, "rev-parse", "HEAD")
        preview = reconcile(self.git, lambda: self.candidates)
        self.assertFalse(preview["published"])
        self.assertEqual(preview["version"], "0.1.1")
        first = reconcile(self.git, lambda: self.candidates, publish=True)
        self.assertTrue(first["published"])
        self.assertEqual(self.git.read(first["revision"], "VERSION"), "0.1.1\n")
        changed = self.command(self.source, "diff-tree", "--no-commit-id", "--name-only", "-r", first["revision"])
        self.assertEqual(set(changed.splitlines()), set(RELEASE_FILES))
        again = reconcile(self.git, lambda: self.candidates, publish=True)
        self.assertFalse(again["published"])
        self.assertEqual(again["revision"], first["revision"])
        self.assertEqual(self.command(self.source, "status", "--porcelain"), status)
        self.assertEqual(self.command(self.source, "rev-parse", "HEAD"), original_head)

    def test_actual_non_fast_forward_race_reconciles_both_prs(self):
        competing = self.root / "competing"
        self.command(self.root, "clone", str(self.remote), str(competing))
        self.command(competing, "config", "user.name", "Second Merge")
        self.command(competing, "config", "user.email", "second@example.invalid")
        parent = self

        class RacingGit(ReleaseGit):
            raced = False

            def push(self, revision):
                if not self.raced:
                    self.raced = True
                    (competing / "second.txt").write_text("Second merged PR\n", encoding="ascii")
                    parent.command(competing, "add", "second.txt")
                    parent.command(competing, "commit", "-m", "second merged PR")
                    second = parent.command(competing, "rev-parse", "HEAD").strip()
                    parent.command(competing, "push", "origin", "main")
                    parent.candidates.append({"number": 56, "merge_commit_sha": second})
                return super().push(revision)

        result = reconcile(RacingGit(self.source), lambda: self.candidates, publish=True)
        self.assertEqual(result["counted_prs"], [55, 56])
        self.assertEqual(result["version"], "0.1.2")
        self.assertEqual(self.command(self.source, "show", f"{result['revision']}:second.txt"), "Second merged PR\n")

    def test_interrupted_response_after_successful_push_does_not_double_count(self):
        class InterruptedGit(ReleaseGit):
            def push(self, revision):
                result = super().push(revision)
                if result:
                    raise subprocess.TimeoutExpired("git push", 120)
                return result

        with self.assertRaises(subprocess.TimeoutExpired):
            reconcile(InterruptedGit(self.source), lambda: self.candidates, publish=True)
        recovered = reconcile(self.git, lambda: self.candidates, publish=True)
        self.assertEqual(recovered["version"], "0.1.1")
        self.assertEqual(recovered["counted_prs"], [])

    def test_remote_denial_and_unreachable_event_fail_without_force(self):
        hook = self.remote / "hooks/pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n", encoding="ascii")
        hook.chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, "publication denied"):
            reconcile(self.git, lambda: self.candidates, publish=True)
        self.assertEqual(self.git.head(), self.merge)
        with self.assertRaisesRegex(ValueError, "not reachable"):
            reconcile(self.git, lambda: self.candidates, required=[{
                "number": 56, "merge_commit_sha": "f" * 40,
            }], publish=True)

    def test_direct_commits_and_pre_baseline_merges_do_not_increment(self):
        state = json.loads(self.git.read(self.merge, STATE_FILE))
        previous = {"number": 54, "merge_commit_sha": state["baseline"]["revision"]}
        result = reconcile(self.git, lambda: [previous], publish=True)
        self.assertEqual(result["version"], "0.1.0")
        self.assertFalse(result["published"])
        self.assertEqual(self.git.head(), self.merge)

    def test_continuous_main_changes_stop_at_the_retry_budget(self):
        class MovingGit(ReleaseGit):
            pushes = 0

            def push(self, revision):
                self.pushes += 1
                return False

        git = MovingGit(self.source)
        # Only the remote movement signal is injected; publication candidates
        # still use actual temporary Git objects and release consistency checks.
        with patch.object(git, "head", side_effect=[self.merge, "f" * 40] * 4):
            with self.assertRaisesRegex(RuntimeError, "Main kept changing"):
                reconcile(git, lambda: self.candidates, publish=True)
        self.assertEqual(git.pushes, 4)
        self.assertEqual(self.git.head(), self.merge)


class GitHubMergeTests(unittest.TestCase):
    @staticmethod
    def entry(number=55, **fields):
        return {"number": number, "merged_at": "2026-10-08T00:00:00Z", "merged": True,
                "merge_commit_sha": "a" * 40,
                "base": {"ref": "main", "repo": {"full_name": "owner/project"}}, **fields}

    def test_paginated_catalog_only_counts_merged_main_prs(self):
        response = [[self.entry(), self.entry(56, merged_at=None)],
                    [self.entry(57, base={"ref": "other"}), self.entry(58)]]
        with patch("scripts.operations.version_release.subprocess.run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(response))) as call:
            entries = merged_prs("owner/project")
        self.assertEqual([entry["number"] for entry in entries], [55, 58])
        self.assertIn("--paginate", call.call_args.args[0])
        self.assertIn("--slurp", call.call_args.args[0])

    def test_event_receipt_handles_catalog_delay_and_rejects_unmerged_pr(self):
        event = {"action": "closed", "pull_request": self.entry()}
        self.assertEqual(event_merge("owner/project", event)[0]["number"], 55)
        event["pull_request"]["merged"] = False
        with self.assertRaises(ValueError):
            event_merge("owner/project", event)
        self.assertEqual(event_merge("owner/project", {"ref": "refs/heads/main"}), [])

    def test_bad_repository_and_catalog_errors_fail_closed(self):
        for repository in ("--exec=command", "../project", "https://github.com/o/r", "o/r?query"):
            with self.subTest(repository=repository), self.assertRaises(ValueError):
                merged_prs(repository)
        with patch("scripts.operations.version_release.subprocess.run", return_value=SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(RuntimeError, "retrieve GitHub"):
                merged_prs("owner/project")


if __name__ == "__main__":
    unittest.main()
