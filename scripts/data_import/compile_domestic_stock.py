#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from packages.adapters.stock.domestic_artifacts import build_domestic_stock_artifacts


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile ChemicalBook/domestic supplier exports into ASKCOS, Synon, and AiZynthFinder stock artifacts."
    )
    parser.add_argument("--source", action="append", type=Path, required=True, help="CSV/TSV/JSON/JSONL supplier export.")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--default-source", default="operator_supplier_export")
    args = parser.parse_args()

    result = build_domestic_stock_artifacts(
        source_paths=args.source,
        output_dir=args.output_dir,
        default_source=args.default_source,
    )
    print(json.dumps(result.summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
