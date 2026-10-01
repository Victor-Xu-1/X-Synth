#!/usr/bin/env python3
"""Copy an auditable code-only snapshot into a separate publication worktree."""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT_FILES = {".gitignore", ".env.example", "README.md", "LICENSE", "NOTICE", "pyproject.toml"}
SOURCE_DIRS = {"apps", "configs", "engines", "packages", "requirements", "scripts", "tests", "docs", ".github"}
PRIVATE_PARTS = {
    ".git", ".venv", "__pycache__", ".pytest_cache", "node_modules", "dist", "build",
    "coverage", "checkpoints", "trained_models", "mars", "data", "outputs",
    "real-cases", "test-results", "plans", "logs", "output",
}
PRIVATE_PATTERNS = (
    "*.onnx", "*.mar", "*.hdf5", "*.h5", "*.pt", "*.pth", "*.ckpt", "*.ckpt-*", "*.csv.gz",
    "*.log", "*.tmp", "*.pyc", "*.tar", "*.tar.gz", "*.zip", "*.dump", "*.pem",
    "*.key", "*.cert", "*.egg-info", "junit.xml", "RECOVERY-*.json",
    ".runtime-*",
    "*.pkl", "*.pkl.gz", "*.pickle", "*.joblib", "*.npy", "*.npz",
)


def is_public_source(path: str) -> bool:
    relative = Path(path)
    if relative.is_absolute() or ".." in relative.parts:
        return False
    if len(relative.parts) == 1:
        return path in ROOT_FILES
    if relative.parts[0] not in SOURCE_DIRS or PRIVATE_PARTS.intersection(relative.parts):
        return False
    if relative.name.startswith(".env"):
        return relative.name == ".env.example"
    return not any(fnmatch.fnmatch(relative.name, pattern) for pattern in PRIVATE_PATTERNS)


def export_source(source: Path, destination: Path, *, update: bool = False) -> dict:
    source = source.resolve(strict=True)
    destination = destination.resolve(strict=True)
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Publication must use an independent worktree outside the source checkout")
    if not (destination / ".git").is_file():
        raise ValueError("Destination must be an existing Git worktree")
    existing = {path.name for path in destination.iterdir()}
    if not update and existing - {".git", "LICENSE"}:
        raise ValueError("Publication destination is not empty; refusing to overwrite existing files")
    result = subprocess.run(
        ["git", "-C", str(source), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True, capture_output=True, timeout=60,
    )
    names = sorted(set(result.stdout.decode("utf-8").split("\0")) - {""})
    digest = hashlib.sha256()
    count = size = excluded = 0
    for name in names:
        if not is_public_source(name):
            excluded += 1
            continue
        original = source / name
        if not original.is_file() or original.is_symlink():
            raise ValueError(f"Unsupported or missing publication source: {name}")
        target = destination / name
        if target.is_symlink() or not target.resolve().is_relative_to(destination):
            raise ValueError(f"Publication target escapes destination or is a symlink: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, target)
        content_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        if content_hash != hashlib.sha256(original.read_bytes()).hexdigest():
            raise ValueError(f"Source changed during export: {name}")
        digest.update(f"{name}\0{content_hash}\n".encode("utf-8"))
        count += 1
        size += target.stat().st_size
    return {"files": count, "bytes": size, "excluded": excluded, "snapshot_sha256": digest.hexdigest()}


def audit_public_source(destination: Path) -> dict:
    """Reject stale/private files as well as excluded files from the current export."""
    result = subprocess.run(
        ["git", "-C", str(destination), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True, capture_output=True, timeout=60,
    )
    names = set(result.stdout.decode("utf-8").split("\0")) - {""}
    rejected = sorted(name for name in names if not is_public_source(name))
    if rejected:
        raise ValueError(f"Non-public files remain in publication: {rejected}")
    return {"audited_files": len(names), "non_public_files": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--update", action="store_true", help="Refresh only allowlisted source files in the existing publication worktree")
    parser.add_argument("--audit", action="store_true", help="Check destination files without copying or deleting anything")
    args = parser.parse_args()
    result = audit_public_source(args.destination) if args.audit else export_source(args.source, args.destination, update=args.update)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()

