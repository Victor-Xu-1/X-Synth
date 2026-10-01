#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge ORD template extraction shard outputs into one ASKCOS-compatible template file."
    )
    parser.add_argument(
        "--shards-dir",
        type=Path,
        required=True,
        help="Directory containing shard_XX ORD extraction output folders.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory for merged ORD templates and summary.",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Use partial shard snapshots when final shard template files are not present.",
    )
    args = parser.parse_args()

    summary = merge_ord_template_shards(
        shards_dir=args.shards_dir,
        output_dir=args.output_dir,
        allow_partial=args.allow_partial,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def merge_ord_template_shards(*, shards_dir: Path, output_dir: Path, allow_partial: bool) -> dict[str, Any]:
    shard_paths = _discover_shard_template_paths(shards_dir, allow_partial=allow_partial)
    if not shard_paths:
        raise FileNotFoundError(f"No ORD shard template files found under {shards_dir}")

    merged: dict[str, dict[str, Any]] = {}
    input_template_rows = 0
    for shard_path in shard_paths:
        for row in _read_template_rows(shard_path):
            input_template_rows += 1
            reaction_smarts = str(row.get("reaction_smarts") or "").strip()
            if not reaction_smarts:
                continue
            existing = merged.get(reaction_smarts)
            if existing is None:
                existing = dict(row)
                existing["count"] = int(row.get("count") or 0)
                existing["references"] = list(row.get("references") or [])[:100]
                existing["attributes"] = dict(row.get("attributes") or {})
                existing["attributes"]["source"] = "Open Reaction Database"
                existing["attributes"]["source_format"] = "ord_schema_pb_gz"
                existing["template_set"] = "ord_extracted"
                existing["_id"] = reaction_smarts
                merged[reaction_smarts] = existing
                continue
            existing["count"] = int(existing.get("count") or 0) + int(row.get("count") or 0)
            if len(existing["references"]) < 100:
                existing["references"].extend(list(row.get("references") or [])[: 100 - len(existing["references"])])

    ordered = sorted(
        merged.values(),
        key=lambda row: (-int(row.get("count") or 0), str(row.get("reaction_smarts") or "")),
    )
    for index, row in enumerate(ordered):
        row["index"] = index
        row["_id"] = str(index)

    output_dir.mkdir(parents=True, exist_ok=True)
    template_path = output_dir / "retro.templates.ord_extracted.json.gz"
    with gzip.open(template_path, "wt", encoding="utf-8") as handle:
        json.dump(ordered, handle, ensure_ascii=False)

    summary = {
        "source": "Open Reaction Database",
        "shards_dir": str(shards_dir),
        "shard_template_files": [str(path) for path in shard_paths],
        "shard_count": len(shard_paths),
        "input_template_rows": input_template_rows,
        "merged_templates": len(ordered),
        "merged_template_occurrences": sum(int(row.get("count") or 0) for row in ordered),
        "template_path": str(template_path),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def _discover_shard_template_paths(shards_dir: Path, *, allow_partial: bool) -> list[Path]:
    paths: list[Path] = []
    for shard_dir in sorted(shards_dir.glob("shard_*")):
        final_path = shard_dir / "retro.templates.ord_extracted.json.gz"
        partial_path = shard_dir / "retro.templates.ord_extracted.partial.json.gz"
        if final_path.is_file():
            paths.append(final_path)
        elif allow_partial and partial_path.is_file():
            paths.append(partial_path)
    return paths


def _read_template_rows(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        rows = json.load(handle)
    if not isinstance(rows, list):
        raise ValueError(f"ORD shard template file must contain a list: {path}")
    return [row for row in rows if isinstance(row, dict)]


if __name__ == "__main__":
    raise SystemExit(main())
