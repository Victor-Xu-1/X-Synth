"""Read the product's own cgroup, not another project's or the whole host."""

import re
from pathlib import Path


def limit_value(text: str) -> int | None:
    value = text.strip()
    if value == "max":
        return None
    if not value.isdecimal():
        raise ValueError("Invalid cgroup memory value")
    return int(value)


def product_cgroup_memory(
    membership: Path = Path("/proc/self/cgroup"),
    hierarchy: Path = Path("/sys/fs/cgroup"),
) -> dict:
    try:
        entries = membership.read_text().splitlines()
        relative = next(line.removeprefix("0::") for line in entries if line.startswith("0::"))
        root = hierarchy.resolve()
        directory = (root / relative.lstrip("/")).resolve()
        if not directory.is_relative_to(root) or not re.fullmatch(r"x-synth@[A-Za-z0-9_.-]+\.service", directory.name):
            return {"status": "unavailable", "reason": "not_product_cgroup"}
        result = {"status": "ready"}
        for key in ("current", "peak", "high", "max"):
            path = directory / ("memory." + key)
            result["memory_" + key + "_bytes"] = limit_value(path.read_text()) if path.is_file() else None
        result["events"] = {
            key: int(value)
            for key, value in (line.split() for line in (directory / "memory.events").read_text().splitlines())
        }
        return result
    except (OSError, ValueError, StopIteration):
        return {"status": "unavailable", "reason": "cgroup_memory_unavailable"}


def memory_pressure_warning(resources: dict, rss_warning_bytes: int) -> bool:
    if resources["rss_bytes"] > rss_warning_bytes:
        return True
    cgroup = resources.get("cgroup", {})
    current, limit = cgroup.get("memory_current_bytes"), cgroup.get("memory_max_bytes")
    return (
        cgroup.get("status") == "ready"
        and isinstance(current, int)
        and isinstance(limit, int)
        and limit > 0
        and current >= limit * 0.9
    )
