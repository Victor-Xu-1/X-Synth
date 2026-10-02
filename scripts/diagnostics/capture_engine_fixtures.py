"""Capture real evaluation outputs for parser regressions, removing host-specific metadata."""
import argparse
import hashlib
import json
from pathlib import Path

from packages.platform.atomic_file import write_json


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()
                if key not in {"config", "effective_config", "path", "user", "username", "public", "shared_with"}
                and not key.endswith("_path") and not key.endswith("_dir")}
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--engine", choices=["askcos", "aizynthfinder"], required=True)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    data = json.loads(raw)
    if args.engine == "askcos":
        data = data["payload"]
        data["task_id"] = "public-benchmark-capture"
    payload = clean(data)
    payload["fixture_provenance"] = {"engine": args.engine, "capture_type": "actual_software_execution",
                                   "source_sha256": hashlib.sha256(raw).hexdigest()}
    write_json(args.output, payload)
    print({"engine": args.engine, "captured": args.output.name, "source_sha256": hashlib.sha256(raw).hexdigest()})


if __name__ == "__main__":
    main()
