"""Version arithmetic and immutable merged-PR receipt reconciliation."""

from __future__ import annotations

import copy
import json
import re

STATE_FILE = ".github/version-state.json"
RELEASE_FILES = ("VERSION", "apps/web/package.json", "apps/web/package-lock.json", STATE_FILE)
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")


def advance_version(value: str, count: int = 1) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.[0-9]\.(0|[1-9][0-9]?)", value):
        raise ValueError("Product version requires MAJOR.MINOR.PATCH with minor 0-9 and patch 0-99")
    if type(count) is not int or count < 0:
        raise ValueError("Merged-PR count must be a nonnegative integer")
    major, minor, patch = map(int, value.split("."))
    major, remainder = divmod(major * 1000 + minor * 100 + patch + count, 1000)
    minor, patch = divmod(remainder, 100)
    return f"{major}.{minor}.{patch}"


def receipt(value: dict) -> dict:
    if (not isinstance(value, dict) or set(value) != {"number", "merge_commit_sha"}
            or type(value["number"]) is not int or value["number"] <= 0
            or not isinstance(value["merge_commit_sha"], str)
            or not SHA_PATTERN.fullmatch(value["merge_commit_sha"])):
        raise ValueError("Invalid merged-PR receipt")
    return {"number": value["number"], "merge_commit_sha": value["merge_commit_sha"]}


def validate_metadata(files: dict[str, str]) -> dict:
    state = json.loads(files[STATE_FILE])
    if (not isinstance(state, dict) or set(state) != {"schema_version", "baseline", "merged_prs"}
            or type(state["schema_version"]) is not int or state["schema_version"] != 1):
        raise ValueError("Unsupported release receipt schema")
    baseline = state["baseline"]
    if (not isinstance(baseline, dict) or set(baseline) != {"revision", "version"}
            or not isinstance(baseline["revision"], str)
            or not SHA_PATTERN.fullmatch(baseline["revision"])
            or not isinstance(state["merged_prs"], list)):
        raise ValueError("Invalid release baseline")
    entries = [receipt(entry) for entry in state["merged_prs"]]
    if len({entry["number"] for entry in entries}) != len(entries):
        raise ValueError("Duplicate merged-PR receipts")
    expected = advance_version(baseline["version"], len(entries))
    actual = files["VERSION"].strip()
    if actual != expected:
        raise ValueError("VERSION does not match the counted merged PRs; do not bump it manually")
    frontend = json.loads(files["apps/web/package.json"])
    lock = json.loads(files["apps/web/package-lock.json"])
    if (frontend.get("version") != actual or lock.get("version") != actual
            or lock.get("packages", {}).get("", {}).get("version") != actual):
        raise ValueError("Frontend metadata does not match VERSION")
    return state


def prepare_release(files: dict[str, str], candidates: list[dict]) -> tuple[dict[str, str], list[int]]:
    state = copy.deepcopy(validate_metadata(files))
    known = {entry["number"]: entry for entry in state["merged_prs"]}
    added = []
    for candidate in candidates:
        entry = receipt(candidate)
        previous = known.get(entry["number"])
        if previous is not None:
            if previous != entry:
                raise ValueError(f"Conflicting merge identity for PR #{entry['number']}")
            continue
        known[entry["number"]] = entry
        state["merged_prs"].append(entry)
        added.append(entry["number"])
    if not added:
        return {}, []
    value = advance_version(files["VERSION"].strip(), len(added))
    frontend = json.loads(files["apps/web/package.json"])
    lock = json.loads(files["apps/web/package-lock.json"])
    frontend["version"] = lock["version"] = lock["packages"][""]["version"] = value
    updates = {"VERSION": value + "\n", STATE_FILE: json.dumps(state, indent=2) + "\n",
               "apps/web/package.json": json.dumps(frontend, indent=2) + "\n",
               "apps/web/package-lock.json": json.dumps(lock, indent=2) + "\n"}
    validate_metadata(updates)
    return updates, added
