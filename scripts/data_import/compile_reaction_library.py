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

# Operator commands support both module and direct-path execution.
from packages.knowledge_base.ord_import import extraction_totals, iter_import_records  # noqa: E402
from packages.knowledge_base.ord_incremental import VerifiedOrdBaseline  # noqa: E402
from packages.knowledge_base.ord_reader import OrdSourceError, verify_ord_sources  # noqa: E402


def _arguments(argv: list[str] | None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Flat download or repository-layout directory; defaults to manifest parent.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="New immutable SQLite asset; existing outputs are refused.",
    )
    parser.add_argument(
        "--base-library",
        type=Path,
        help="Reuse an immutable verified ORD SQLite baseline matching the complete manifest; no source filters.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Write complete import statistics outside the source/output assets.",
    )
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument(
        "--source",
        action="append",
        default=[],
        help="Explicit manifest path(s) to import, after verifying every file.",
    )
    selection.add_argument(
        "--exclude-source",
        action="append",
        default=[],
        help="Explicit manifest path(s) excluded from ORD coverage, e.g. an already served native corpus.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        choices=range(1, 5),
        default=1,
        help="1 streams directly; 2-4 spool bounded-memory Parquet row-group workers into one compiler.",
    )
    parser.add_argument(
        "--allow-rejected",
        action="store_true",
        help="Explicitly publish valid records despite counted structural/contract rejections.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _arguments(argv)
    reports = []
    base_library = None
    report_path = args.report.resolve() if args.report else None
    report_allowed = False
    result = {
        "success": False,
        "output": str(args.output.absolute()),
        "workers": args.workers,
        "allow_rejected": args.allow_rejected,
        "base_library": str(args.base_library.absolute()) if args.base_library else None,
    }
    try:
        root = (args.source_dir or args.manifest.parent).resolve(strict=True)
        output = args.output.resolve()
        if args.report:
            if (
                report_path == output
                or (
                    args.base_library is not None
                    and report_path == args.base_library.resolve()
                )
                or report_path.is_relative_to(root)
                or report_path.is_relative_to(PROJECT_ROOT)
            ):
                raise ValueError(
                    "Import report must be external and distinct from source/library assets"
                )
            if report_path.exists():
                raise FileExistsError(
                    "Import reports are immutable; select a new report path"
                )
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_allowed = True
        if output.exists():
            raise FileExistsError(
                "Reaction libraries are immutable; select a new output"
            )
        if output.is_relative_to(root):
            raise ValueError(
                "Output must be outside the read-only ORD source directory"
            )
        all_sources = verify_ord_sources(args.manifest, root)
        result["files_verified"] = len(all_sources)
        if args.base_library and (args.source or args.exclude_source):
            raise ValueError("--base-library cannot be combined with --source or --exclude-source")
        known = {source.path for source in all_sources}
        requested = set(args.source or args.exclude_source)
        if not requested <= known:
            raise ValueError(
                "Selected paths are absent from the source manifest: "
                + str(sorted(requested - known))
            )
        sources = [
            source
            for source in all_sources
            if (not args.source or source.path in requested)
            and source.path not in set(args.exclude_source)
        ]
        if not sources:
            raise ValueError("No ORD files selected for extraction")
        result.update(
            files_verified=len(all_sources),
            files_selected=len(sources),
            excluded_sources=[
                source.as_source() for source in all_sources if source not in sources
            ],
        )
        # Extraction streams into the shared immutable index compiler.
        from packages.knowledge_base.reaction_library import compile_reaction_library

        if args.base_library is not None:
            base_library = VerifiedOrdBaseline(args.base_library, sources)
        output.parent.mkdir(parents=True, exist_ok=True)
        records = iter_import_records(
            sources,
            reports=reports,
            workers=args.workers,
            staging_root=output.parent,
            allow_rejected=args.allow_rejected,
            base_library=base_library,
        )
        compiler_sources = [
            {
                **source.as_source(),
                "rejection_policy": "allow" if args.allow_rejected else "fail",
            }
            for source in sources
        ]
        with closing(records):
            result["library"] = compile_reaction_library(
                records, output, sources=compiler_sources
            )
        result["success"] = True
    except (
        OSError,
        ValueError,
        TypeError,
        RuntimeError,
        sqlite3.Error,
        ImportError,
    ) as exc:
        result["error"] = {"type": type(exc).__name__, "message": str(exc)}
        if isinstance(exc, OrdSourceError):
            result["source_errors"] = {
                "reason_counts": exc.reason_counts,
                "issues": exc.issues,
            }
    except KeyboardInterrupt:
        result["error"] = {
            "type": "KeyboardInterrupt",
            "message": "ORD import interrupted; no publication completed",
        }
    finally:
        result["extraction"] = {"totals": extraction_totals(reports), "files": reports}
        if base_library is not None:
            result["incremental"] = base_library.audit(
                totals=result["extraction"]["totals"], library=result.get("library")
            )
        encoded = json.dumps(result, sort_keys=True, ensure_ascii=True)
        if report_allowed:
            try:
                report_path.parent.mkdir(parents=True, exist_ok=True)
                with report_path.open("x", encoding="utf-8") as destination:
                    destination.write(encoded + "\n")
                print(
                    json.dumps(
                        {
                            "success": result["success"],
                            "output": result["output"],
                            "report": str(report_path),
                            "totals": result["extraction"]["totals"],
                            "error": result.get("error"),
                        },
                        sort_keys=True,
                    )
                )
            except OSError as exc:
                result["success"] = False
                result["report_error"] = str(exc)
                print(json.dumps(result, sort_keys=True, ensure_ascii=True))
        else:
            print(encoded)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
