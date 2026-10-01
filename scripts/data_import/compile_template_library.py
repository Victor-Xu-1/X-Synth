#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from packages.knowledge_base.template_library import (
    build_template_library_database,
    discover_standard_template_source_paths,
    discover_template_source_paths,
    export_template_runtime_assets,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a canonical template-library SQLite database from ASKCOS template sources."
    )
    parser.add_argument("--source", action="append", type=Path, default=[], help="Template JSON/JSONL, optionally gzip.")
    parser.add_argument("--source-dir", action="append", type=Path, default=[], help="Directory containing template files.")
    parser.add_argument(
        "--include-standard-local-sources",
        action="store_true",
        help="Also include standard local USPTO/ORD template sources from this project when present.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path("."),
        help="Project root used with --include-standard-local-sources.",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument(
        "--export-runtime-assets",
        action="store_true",
        help="Export ASKCOS-compatible runtime template files from the compiled database.",
    )
    args = parser.parse_args()

    source_paths = list(args.source)
    for source_dir in args.source_dir:
        source_paths.extend(discover_template_source_paths(source_dir))
    if args.include_standard_local_sources:
        source_paths.extend(discover_standard_template_source_paths(args.project_root))
    source_paths = sorted(set(source_paths))
    if not source_paths:
        parser.error("at least one --source or --source-dir is required")

    manifest = build_template_library_database(
        source_paths=source_paths,
        output_dir=args.output_dir,
        version=args.version,
    )
    if args.export_runtime_assets:
        manifest["runtime_assets"] = export_template_runtime_assets(
            database_path=manifest["database"]["path"],
            output_dir=args.output_dir / "runtime_assets",
        )
        (args.output_dir / "template_library_manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
