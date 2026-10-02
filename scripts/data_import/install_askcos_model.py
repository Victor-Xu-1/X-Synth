from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile


def install_archive(archive: Path, *, output: Path, expected_sha256: str, source_url: str,
                    members: tuple[str, ...] = ("templates.jsonl", "model_latest.pt")) -> dict:
    with archive.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != expected_sha256.lower():
        raise ValueError("Model archive checksum does not match its provenance")
    if not members or any(Path(name).name != name or name in {".", ".."} for name in members):
        raise ValueError("Asset members must be explicit filenames without directory traversal")
    if output.exists():
        raise FileExistsError("Model asset snapshots are immutable")
    staging = output.with_name(output.name + ".staging")
    staging.mkdir(parents=True, exist_ok=False)
    files = {}
    try:
        with ZipFile(archive) as package:
            for name in members:
                info = package.getinfo(name)
                if info.file_size > 4 * 1024**3:
                    raise ValueError("Model asset exceeds the extraction budget")
                target = staging / name
                with package.open(info) as incoming, target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                with target.open("rb") as handle:
                    files[name] = hashlib.file_digest(handle, "sha256").hexdigest()
        metadata = {"schema_version": 1, "archive_sha256": digest, "source_url": source_url, "files": files}
        (staging / "asset.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        staging.rename(output)
        return metadata
    except BaseException:
        # Only this newly-created extraction directory is cleaned up.
        shutil.rmtree(staging)
        raise


def main():
    parser = argparse.ArgumentParser(description="Install model weights and their matching template index, never archive code")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--members", nargs="+", default=["templates.jsonl", "model_latest.pt"])
    args = parser.parse_args()
    print(json.dumps(install_archive(args.archive, output=args.output, expected_sha256=args.sha256,
                                    source_url=args.source_url, members=tuple(args.members))))


if __name__ == "__main__":
    main()
