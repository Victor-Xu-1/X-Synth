#!/usr/bin/env python3
"""Compile checksummed public ORD Parquet with the shared immutable index API.

Run with the isolated requirements/reaction-data-linux-py312.lock environment.
No download, production install, or inference is performed by this CLI.
Manifest revision pins the official Hugging Face mirror, not a GitHub ref.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from packages.knowledge_base.ord_import import extraction_totals, iter_import_records
from packages.knowledge_base.ord_reader import OrdSourceError, verify_ord_sources


def _arguments(argv: list[str] | None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-dir", type=Path, help="Flat download or repository-layout directory; defaults to manifest parent.")
    parser.add_argument("--output", required=True, type=Path, help="New immutable SQLite asset; existing outputs are refused.")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--source", action="append", default=[], help="Explicit manifest path(s) to import, after verifying every file.")
    selection.add_argument("--exclude-source", action="append", default=[], help="Explicit manifest path(s) excluded from ORD coverage, e.g. an already served native corpus.")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=1, help="1 streams directly; 2-4 spool bounded-memory Parquet row-group workers into one compiler.")
    parser.add_argument("--allow-rejected", action="store_true", help="Explicitly publish valid records despite counted structural/contract rejections.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _arguments(argv)
    reports = []
    result = {"success": False, "output": str(args.output.absolute()), "workers": args.workers,
              "allow_rejected": args.allow_rejected}
    try:
        root = (args.source_dir or args.manifest.parent).resolve(strict=True)
        output = args.output.resolve()
        if output.exists():
            raise FileExistsError("Reaction libraries are immutable; select a new output")
        if output.is_relative_to(root):
            raise ValueError("Output must be outside the read-only ORD source directory")
        all_sources = verify_ord_sources(args.manifest, root)
        known = {source.path for source in all_sources}
        requested = set(args.source or args.exclude_source)
        if not requested <= known:
            raise ValueError("Selected paths are absent from the source manifest: " + str(sorted(requested - known)))
        sources = [source for source in all_sources if
                   (not args.source or source.path in requested) and source.path not in set(args.exclude_source)]
        if not sources:
            raise ValueError("No ORD files selected for extraction")
        result.update(files_verified=len(all_sources), files_selected=len(sources),
                      excluded_sources=[source.as_source() for source in all_sources if source not in sources])
        # This is the only index implementation. Owned and supplied by the main agent.
        from packages.knowledge_base.reaction_library import compile_reaction_library

        output.parent.mkdir(parents=True, exist_ok=True)
        records = iter_import_records(
            sources, reports=reports, workers=args.workers, staging_root=output.parent,
            allow_rejected=args.allow_rejected,
        )
        compiler_sources = [
            {**source.as_source(), "rejection_policy": "allow" if args.allow_rejected else "fail"}
            for source in sources
        ]
        with closing(records):
            result["library"] = compile_reaction_library(records, output, sources=compiler_sources)
        result["success"] = True
    except (OSError, ValueError, TypeError, RuntimeError, sqlite3.Error, ImportError) as exc:
        result["error"] = {"type": type(exc).__name__, "message": str(exc)}
        if isinstance(exc, OrdSourceError):
            result["source_errors"] = {"reason_counts": exc.reason_counts, "issues": exc.issues}
    except KeyboardInterrupt:
        result["error"] = {"type": "KeyboardInterrupt", "message": "ORD import interrupted; no publication completed"}
    finally:
        result["extraction"] = {"totals": extraction_totals(reports), "files": reports}
        print(json.dumps(result, sort_keys=True, ensure_ascii=True))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
