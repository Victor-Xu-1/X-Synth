"""Reconcile every uncounted merged main PR, then publish one atomic version commit."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from packages.platform.release_version import RELEASE_FILES, prepare_release, receipt, validate_metadata
from scripts.operations.version_release_git import ReleaseGit


def merged_prs(repository: str) -> list[dict]:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", repository):
        raise ValueError("Invalid GitHub repository identity")
    result = subprocess.run(
        ["gh", "api", "--hostname", "github.com", "--paginate", "--slurp",
         f"repos/{repository}/pulls?state=closed&base=main&per_page=100"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode:
        raise RuntimeError("Cannot retrieve GitHub merge identities; rerun after restoring access")
    pages = json.loads(result.stdout)
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise ValueError("Invalid GitHub pull-request response")
    candidates = []
    for page in pages:
        for entry in page:
            if (entry.get("merged_at") and entry.get("base", {}).get("ref") == "main"
                    and entry["base"].get("repo", {}).get("full_name") == repository):
                candidates.append(receipt({"number": entry["number"],
                                           "merge_commit_sha": entry["merge_commit_sha"]}))
    return candidates


def event_merge(repository: str, event: dict | None) -> list[dict]:
    if not event or "pull_request" not in event:
        return []
    entry = event["pull_request"]
    if (event.get("action") != "closed" or not entry.get("merged")
            or entry.get("base", {}).get("ref") != "main"
            or entry["base"].get("repo", {}).get("full_name") != repository):
        raise ValueError("Release event must be a merged PR into this repository's main")
    return [receipt({"number": entry["number"], "merge_commit_sha": entry["merge_commit_sha"]})]


def reconcile(git: ReleaseGit, load_candidates, *, required=(), publish=False, attempts=4) -> dict:
    for attempt in range(attempts):
        head = git.head()
        files = {path: git.read(head, path) for path in RELEASE_FILES}
        state = validate_metadata(files)
        ordered = git.commits(state["baseline"]["revision"], head)
        order = {revision: index for index, revision in enumerate(ordered)}
        if any(entry["merge_commit_sha"] not in order for entry in state["merged_prs"]):
            raise ValueError("Counted merge is no longer reachable from main")
        if any(entry["merge_commit_sha"] not in order for entry in required):
            raise ValueError("Event merge is not reachable from main")
        candidates = list(load_candidates()) + list(required)
        candidates = sorted((entry for entry in candidates if entry["merge_commit_sha"] in order),
                            key=lambda entry: (order[entry["merge_commit_sha"]], entry["number"]))
        updates, counted = prepare_release(files, candidates)
        report = {"version": updates.get("VERSION", files["VERSION"]).strip(),
                  "counted_prs": counted, "revision": head, "published": False}
        if not updates or not publish:
            return report
        revision = git.commit(head, updates, counted)
        if git.push(revision):
            return report | {"revision": revision, "published": True}
        if git.head() == head:
            raise RuntimeError("Version publication denied; check repository permissions/protection before rerunning")
    raise RuntimeError("Main kept changing during version publication; rerun to reconcile pending merges")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--publish", action="store_true", help="Push a fast-forward-only release commit")
    args = parser.parse_args()
    if not args.repository:
        parser.error("--repository or GITHUB_REPOSITORY is required")
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    event = json.loads(Path(event_path).read_text(encoding="utf-8")) if event_path else None
    result = reconcile(ReleaseGit(Path.cwd()), lambda: merged_prs(args.repository),
                       required=event_merge(args.repository, event), publish=args.publish)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
