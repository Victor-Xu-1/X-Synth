"""Read metrics only for supervised processes, guarding against PID reuse."""

from __future__ import annotations

import json
from pathlib import Path


IDENTITY_FIELDS = ("pid", "start_ticks", "pgid", "session_id", "uid")


def process_identity(pid: int) -> dict:
    if type(pid) is not int or pid <= 0:
        raise ValueError("Invalid process identifier")
    root = Path("/proc") / str(pid)
    fields = (root / "stat").read_text().rsplit(")", 1)[1].split()
    uid = root.stat().st_uid
    verified = (root / "stat").read_text().rsplit(")", 1)[1].split()
    if any(fields[index] != verified[index] for index in (1, 2, 3, 19)):
        raise ValueError("Process identity changed during sampling")
    return {
        "pid": pid, "start_ticks": int(fields[19]),
        "parent_pid": int(fields[1]), "pgid": int(fields[2]),
        "session_id": int(fields[3]), "uid": uid, "state": fields[0],
    }


def matching_process(identity: dict) -> dict | None:
    try:
        sample = process_identity(identity["pid"])
        if all(sample[key] == identity[key] for key in IDENTITY_FIELDS):
            return sample
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        pass
    return None


def owned_process_members(members: list[dict]) -> list[dict]:
    """Discover descendants only while a recorded PID/start identity anchors them."""
    verified = {member["pid"]: sample for member in members if (sample := matching_process(member))}
    if not verified:
        return []
    snapshot = {}
    for root in Path("/proc").iterdir():
        if not root.name.isdecimal():
            continue
        try:
            sample = process_identity(int(root.name))
            snapshot[sample["pid"]] = sample
        except (OSError, ValueError, IndexError):
            continue
    # A surviving (or unreaped zombie) member pins the original session identity.
    anchors = [sample for sample in verified.values() if matching_process(sample)]
    sessions = {(sample["session_id"], sample["uid"]) for sample in anchors}
    starts = {
        session: min(member["start_ticks"] for member in members
                     if (member["session_id"], member["uid"]) == session)
        for session in sessions
    }
    result = dict(verified)
    for sample in snapshot.values():
        session = (sample["session_id"], sample["uid"])
        if session in sessions and sample["start_ticks"] >= starts[session]:
            result[sample["pid"]] = sample
    for _ in range(256):
        added = False
        for sample in snapshot.values():
            parent = result.get(sample["parent_pid"])
            if (sample["pid"] not in result and parent
                    and sample["uid"] == parent["uid"]
                    and sample["start_ticks"] >= parent["start_ticks"]
                    and matching_process(parent)):
                result[sample["pid"]] = sample
                added = True
        if len(result) > 256:
            raise ValueError("Owned process tree exceeds the sampling budget")
        if not added:
            break
    # Do not adopt an unrecorded session member after the last anchor disappears.
    live_sessions = {(sample["session_id"], sample["uid"]) for sample in anchors if matching_process(sample)}
    recorded = {member["pid"] for member in members}
    return [sample for sample in result.values()
            if sample["pid"] in recorded or (sample["session_id"], sample["uid"]) in live_sessions
            or sample["parent_pid"] in result and matching_process(result[sample["parent_pid"]])]


def process_sample(pid: int) -> dict:
    if not isinstance(pid, int) or pid <= 0:
        raise ValueError("Invalid process identifier")
    root = Path("/proc") / str(pid)
    # A comm field may contain spaces or parentheses.
    fields = (root / "stat").read_text().rsplit(")", 1)[1].split()
    memory = {}
    for line in (root / "status").read_text().splitlines():
        key, _, value = line.partition(":")
        if key in {"VmRSS", "Threads"}:
            memory[key] = int(value.split()[0])
    verified = (root / "stat").read_text().rsplit(")", 1)[1].split()
    if verified[19] != fields[19] or verified[1] != fields[1]:
        raise ValueError("Process identity changed during sampling")
    return {
        "parent_pid": int(fields[1]),
        "start_ticks": int(fields[19]),
        "rss_bytes": memory.get("VmRSS", 0) * 1024,
        "threads": memory.get("Threads", 0),
        "cpu_ticks": int(fields[11]) + int(fields[12]),
    }


def process_tree_sample(pid: int, start_ticks: int) -> dict:
    root = process_sample(pid)
    if root["start_ticks"] != start_ticks:
        raise ValueError("Supervised process identity changed")
    samples = {pid: root}
    queue = [pid]
    for parent in queue:
        try:
            tasks = list((Path("/proc") / str(parent) / "task").iterdir())
        except OSError:
            if parent == pid:
                raise
            continue
        if len(tasks) > 256:
            raise ValueError("Supervised thread tree exceeds the sampling budget")
        children = set()
        for task in tasks:
            try:
                children.update(
                    int(value) for value in (task / "children").read_text().split()
                )
            except (OSError, ValueError):
                continue
        for child in children - samples.keys():
            if len(samples) >= 256:
                raise ValueError("Supervised process tree exceeds the sampling budget")
            try:
                sample = process_sample(child)
            except (OSError, ValueError, IndexError):
                continue
            if sample["parent_pid"] == parent:
                samples[child] = sample
                queue.append(child)
    if process_sample(pid)["start_ticks"] != start_ticks:
        raise ValueError("Supervised process identity changed during sampling")
    return {
        key: sum(sample[key] for sample in samples.values())
        for key in ("rss_bytes", "threads", "cpu_ticks")
    } | {"child_processes": len(samples) - 1}


def runtime_resources(manifest: Path) -> dict:
    if (
        not manifest.is_file()
        or manifest.is_symlink()
        or manifest.stat().st_size > 65536
    ):
        return {"status": "unavailable", "services": {}, "rss_bytes": 0}
    try:
        document = json.loads(manifest.read_text())
        services = {}
        for name, descriptor in document["services"].items():
            try:
                sample = process_tree_sample(
                    descriptor["pid"], descriptor["start_ticks"]
                )
                services[name] = {"status": "running", **sample}
            except (OSError, ValueError, KeyError, IndexError):
                services[name] = {"status": "stopped"}
        return {
            "status": "ready"
            if all(x["status"] == "running" for x in services.values())
            else "degraded",
            "services": services,
            "rss_bytes": sum(x.get("rss_bytes", 0) for x in services.values()),
        }
    except (OSError, ValueError, KeyError, TypeError):
        return {"status": "unavailable", "services": {}, "rss_bytes": 0}
