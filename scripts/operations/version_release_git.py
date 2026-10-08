"""Atomic, fast-forward-only release publication without editing the checkout."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile

from packages.platform.release_version import RELEASE_FILES, SHA_PATTERN


class ReleaseGit:
    def __init__(self, root: Path):
        self.root = root.resolve(strict=True)

    def run(self, *args: str, content: str | None = None, env=None, check=True):
        result = subprocess.run(
            ["git", "--no-optional-locks", "-c", "maintenance.auto=false", "-c", "gc.auto=0", *args],
            cwd=self.root, input=content, capture_output=True, text=True,
            env=env, timeout=120 if args[0] in {"fetch", "push"} else 30,
        )
        if check and result.returncode:
            raise RuntimeError(f"Release Git operation failed: {args[0]}; no force/reset is permitted")
        return result

    def head(self) -> str:
        self.run("fetch", "--no-tags", "origin", "refs/heads/main")
        return self.run("rev-parse", "FETCH_HEAD").stdout.strip()

    def read(self, revision: str, path: str) -> str:
        if not SHA_PATTERN.fullmatch(revision) or path not in RELEASE_FILES:
            raise ValueError("Invalid release object")
        return self.run("show", f"{revision}:{path}").stdout

    def commits(self, baseline: str, head: str) -> list[str]:
        if not all(SHA_PATTERN.fullmatch(value) for value in (baseline, head)):
            raise ValueError("Invalid release ancestry")
        if self.run("merge-base", "--is-ancestor", baseline, head, check=False).returncode:
            raise RuntimeError("Release baseline is not an ancestor of main; history repair requires review")
        return self.run("rev-list", "--reverse", f"{baseline}..{head}").stdout.splitlines()

    def commit(self, head: str, updates: dict[str, str], numbers: list[int]) -> str:
        if not SHA_PATTERN.fullmatch(head) or set(updates) != set(RELEASE_FILES):
            raise ValueError("Release must atomically update exactly the product metadata and receipts")
        with tempfile.TemporaryDirectory(prefix="x-synth-release-") as directory:
            env = os.environ | {
                "GIT_INDEX_FILE": str(Path(directory) / "index"),
                "GIT_AUTHOR_NAME": "github-actions[bot]",
                "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
                "GIT_COMMITTER_NAME": "github-actions[bot]",
                "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
            }
            self.run("read-tree", head, env=env)
            for path, content in updates.items():
                blob = self.run("hash-object", "-w", "--stdin", content=content, env=env).stdout.strip()
                self.run("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env=env)
            tree = self.run("write-tree", env=env).stdout.strip()
            message = (f"chore: release v{updates['VERSION'].strip()}\n\n"
                       + "Counted merged PRs: " + ", ".join(f"#{number}" for number in numbers) + "\n")
            return self.run("commit-tree", tree, "-p", head, content=message, env=env).stdout.strip()

    def push(self, revision: str) -> bool:
        if not SHA_PATTERN.fullmatch(revision):
            raise ValueError("Invalid release commit")
        return self.run("push", "origin", f"{revision}:refs/heads/main", check=False).returncode == 0
