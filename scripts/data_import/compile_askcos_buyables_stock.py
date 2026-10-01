#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from packages.adapters.stock.askcos_buyables import build_askcos_buyables_stock


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile ASKCOS commercial buyables into the shared Synon stock format."
    )
    parser.add_argument("--source", action="append", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    result = build_askcos_buyables_stock(source_paths=args.source, output_dir=args.output_dir)
    print(json.dumps(result.summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
