"""Fail-closed workspace CI profile; extend its mappings before other changes.

PRs compare merge-base to head; main pushes compare before to after. Selection
never invokes a directory-wide test command. Build, audit and pip check remain
independent workflow gates. --worktree is a read-only local selection preview.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Keep direct script and module invocation on the same package implementation.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.diagnostics import ci_scope_profile as profile
from scripts.diagnostics.ci_scope_dependencies import ScopeError


def command(root: Path, *args: str) -> str:
    result = subprocess.run(args, cwd=root, capture_output=True, text=True, check=True)
    return result.stdout


def git(root: Path, *args: str) -> str:
    return command(root, "git", *args)


def revision(root: Path, ref: str) -> str:
    if not ref or set(ref) == {"0"}:
        raise ScopeError(
            "No diff base: initial/zero-SHA events require an explicit scope mapping."
        )
    return git(root, "rev-parse", "--verify", ref + "^{commit}").strip()


def event_revisions(root: Path, event: dict) -> tuple[str, str]:
    if "pull_request" in event:
        pull = event["pull_request"]
        base = revision(root, pull["base"]["sha"])
        head = revision(root, pull["head"]["sha"])
        return git(root, "merge-base", base, head).strip(), head
    if "before" in event and "after" in event:
        return revision(root, event["before"]), revision(root, event["after"])
    raise ScopeError(
        "Unsupported event: expected pull_request or main push before/after."
    )


def changed_paths(root: Path, base: str, head: str | None) -> set[str]:
    args = ["diff", "--name-only", "--no-renames", "-z", base]
    if head is not None:
        args.append(head)
    paths = set(filter(None, git(root, *args).split("\0")))
    if head is None:
        paths.update(
            filter(
                None,
                git(root, "ls-files", "--others", "--exclude-standard", "-z").split(
                    "\0"
                ),
            )
        )
    return paths


class Snapshot:
    def __init__(self, root: Path, ref: str | None):
        self.root, self.ref = root, ref
        args = (
            ("ls-tree", "-r", "--name-only", "-z", ref)
            if ref
            else ("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        )
        self.files = set(filter(None, git(root, *args).split("\0")))
        if ref is None:
            self.files = {path for path in self.files if (root / path).is_file()}

    def text(self, path: str) -> str:
        if path not in self.files:
            raise ScopeError(f"Required scope input is absent: {path}")
        if self.ref:
            return git(self.root, "show", f"{self.ref}:{path}")
        return (self.root / path).read_text(encoding="utf-8")


def test_command(suite: str, tests: list[str]) -> list[str]:
    if not tests:
        return []
    if suite == "python":
        return [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *tests]
    return [
        "npm",
        "test",
        "--",
        "--runInBand",
        "--runTestsByPath",
        "--coverage=false",
        *[path.removeprefix(profile.WEB) for path in tests],
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-event", type=Path)
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--worktree", action="store_true")
    parser.add_argument("--suite", choices=("python", "frontend"), required=True)
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        if args.github_event:
            if args.worktree or args.base:
                raise ScopeError(
                    "Event revisions cannot be combined with local diff arguments."
                )
            base, head = event_revisions(
                root, json.loads(args.github_event.read_text(encoding="utf-8"))
            )
            if revision(root, "HEAD") != head:
                raise ScopeError("CI checkout must equal the event head SHA.")
        else:
            if not args.base:
                raise ScopeError("Provide --github-event or an explicit --base.")
            base = revision(root, args.base)
            head = None if args.worktree else revision(root, args.head)
        if args.run and head is not None and revision(root, "HEAD") != head:
            raise ScopeError(
                "Cannot run tests against a snapshot other than the current checkout."
            )
        paths = changed_paths(root, base, head)
        profile.guard_paths(paths)
        before, after = Snapshot(root, base), Snapshot(root, head)
        profile.python_dependency_roots(before, after, paths)
        profile.npm_dependency_changes(before, after, paths)
        if args.suite == "python":
            tests, importers = profile.python_tests(before, after, paths), {}
        else:
            tests, importers = profile.frontend_tests(before, after, paths)
        invocation = test_command(args.suite, tests)
        if args.run:
            print(json.dumps(tests, indent=2), flush=True)
        else:
            print(
                json.dumps(
                    {
                        "profile": "workspace",
                        "base": base,
                        "head": head or "worktree",
                        "changed_paths": sorted(paths),
                        "suite": args.suite,
                        "tests": tests,
                        "npm_production_importers": importers,
                        "command": invocation,
                        "empty_scope": "No related unit tests; mandatory build/audit/pip-check gates still apply."
                        if not tests
                        else None,
                    },
                    indent=2,
                ),
                flush=True,
            )
        if args.run and invocation:
            return subprocess.run(
                invocation,
                cwd=root / "apps/web" if args.suite == "frontend" else root,
                check=False,
                env={**os.environ, "X_SYNTH_TEST_PYTHON": sys.executable},
            ).returncode
        return 0
    except (
        ValueError,
        OSError,
        SyntaxError,
        KeyError,
        subprocess.SubprocessError,
    ) as exc:
        print(f"CI scope failed: {exc}", file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError) and exc.stderr:
            print(exc.stderr, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
