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
    return {
        "start_ticks": int(fields[19]),
        "rss_bytes": memory.get("VmRSS", 0) * 1024,
        "threads": memory.get("Threads", 0),
        "cpu_ticks": int(fields[11]) + int(fields[12]),
    }


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
                sample = process_sample(descriptor["pid"])
                if sample.pop("start_ticks") != descriptor["start_ticks"]:
                    raise ValueError("Supervised process identity changed")
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
