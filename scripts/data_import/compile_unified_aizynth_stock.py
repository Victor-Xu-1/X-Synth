#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from packages.adapters.stock.unified_aizynth_stock import (
    build_unified_aizynth_stock,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile all accepted Synon commercial stock sources into one AiZynthFinder terminal set."
    )
    parser.add_argument("--source", action="append", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--stock-name", default="unified")
    args = parser.parse_args()

    artifacts = build_unified_aizynth_stock(
        source_paths=args.source,
        output_dir=args.output_dir,
        stock_name=args.stock_name,
    )
    print(json.dumps(artifacts.summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
