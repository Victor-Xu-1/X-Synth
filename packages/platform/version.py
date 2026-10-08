from __future__ import annotations

import subprocess
from importlib.metadata import version
from pathlib import Path

from .release_version import advance_version


def product_version() -> str:
    source = Path(__file__).resolve().parents[2] / "VERSION"
    value = (
        source.read_text(encoding="ascii").strip()
        if source.is_file()
        else version("x-synth")
    )
    return advance_version(value, 0)


def source_build(root: Path) -> dict:
    try:
        revision = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        ).stdout.strip()
        changes = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True,
            timeout=2,
        ).stdout
        return {"revision": revision, "dirty": bool(changes)}
    except (OSError, subprocess.SubprocessError):
        return {"revision": "unknown", "dirty": None}
