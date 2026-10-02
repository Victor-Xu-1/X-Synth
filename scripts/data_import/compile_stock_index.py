#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from packages.adapters.stock.stock_index import compile_stock_index


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile an exact ASKCOS supplier catalog into immutable indexed stock")
    parser.add_argument("--source", type=Path, required=True, help="JSONL or JSONL.GZ export; not a JSON array")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with args.source.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    opener = gzip.open if args.source.suffix == ".gz" else open
    with opener(args.source, "rt", encoding="utf-8") as handle:
        rows = (json.loads(line) for line in handle if line.strip())
        summary = compile_stock_index(rows, output=args.output, source_id=args.source_id, source_sha256=digest)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
