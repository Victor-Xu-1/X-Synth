from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
from pathlib import Path
from zipfile import ZipFile


def install_archive(archive: Path, *, output: Path, expected_sha256: str, source_url: str,
                    members: tuple[str, ...] = ("templates.jsonl", "model_latest.pt"),
                    archive_format: str = "zip", member_prefix: str = "") -> dict:
    with archive.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != expected_sha256.lower():
        raise ValueError("Model archive checksum does not match its provenance")
    if not members or len(set(members)) != len(members) or any(
        Path(name).name != name or name in {".", "..", "asset.json"} or "\\" in name
        for name in members
    ):
        raise ValueError("Asset members must be explicit filenames without directory traversal")
    if archive_format not in {"zip", "tar"}:
        raise ValueError("Unsupported model archive format")
    if member_prefix and (
        member_prefix.startswith("/") or "\\" in member_prefix
        or any(part in {"", ".", ".."} for part in member_prefix.split("/"))
    ):
        raise ValueError("Invalid archive member prefix")
    if output.exists() or output.is_symlink():
        raise FileExistsError("Model asset snapshots are immutable")
    staging = output.with_name(output.name + ".staging")
    staging.mkdir(parents=True, exist_ok=False)
    files = {}
    try:
        opener = ZipFile if archive_format == "zip" else tarfile.open
        with opener(archive) as package:
            for name in members:
                member = f"{member_prefix}/{name}" if member_prefix else name
                if archive_format == "zip":
                    info = package.getinfo(member)
                    size = info.file_size
                    incoming = package.open(info)
                else:
                    info = package.getmember(member)
                    if not info.isfile():
                        raise ValueError("Only regular model asset files may be installed")
                    size = info.size
                    incoming = package.extractfile(info)
                if size > 4 * 1024**3:
                    incoming.close()
                    raise ValueError("Model asset exceeds the extraction budget")
                target = staging / name
                with incoming, target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                with target.open("rb") as handle:
                    files[name] = hashlib.file_digest(handle, "sha256").hexdigest()
        metadata = {"schema_version": 1, "archive_sha256": digest, "source_url": source_url,
                    "archive_format": archive_format, "member_prefix": member_prefix, "files": files}
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
    parser.add_argument("--archive-format", choices=["zip", "tar"], default="zip")
    parser.add_argument("--member-prefix", default="")
    args = parser.parse_args()
    print(json.dumps(install_archive(args.archive, output=args.output, expected_sha256=args.sha256,
                                    source_url=args.source_url, members=tuple(args.members),
                                    archive_format=args.archive_format, member_prefix=args.member_prefix)))


if __name__ == "__main__":
    main()
