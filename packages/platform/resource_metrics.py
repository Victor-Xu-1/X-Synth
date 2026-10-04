"""Read metrics only for supervised processes, guarding against PID reuse."""

from __future__ import annotations

import json
from pathlib import Path


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
