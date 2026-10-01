#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
import statistics
from collections import Counter
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze extracted ORD template quality.")
    parser.add_argument("--template-path", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    report = analyze_quality(template_path=args.template_path, checkpoints=args.checkpoint)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def analyze_quality(*, template_path: Path, checkpoints: list[Path]) -> dict[str, Any]:
    rows = _read_template_rows(template_path)
    counts = [int(row.get("count") or 0) for row in rows]
    lengths = [len(str(row.get("reaction_smarts") or "")) for row in rows]
    rdkit_available, invalid_count = _rdkit_invalid_count(rows)

    empty_templates = 0
    missing_arrow = 0
    missing_references = 0
    missing_atom_map_colon = 0
    for row in rows:
        smarts = str(row.get("reaction_smarts") or "")
        if not smarts.strip():
            empty_templates += 1
        if ">>" not in smarts:
            missing_arrow += 1
        if not row.get("references"):
            missing_references += 1
        if ":" not in smarts:
            missing_atom_map_colon += 1

    checkpoint_summary = _checkpoint_summary(checkpoints)
    singleton_templates = sum(1 for count in counts if count == 1)
    return {
        **checkpoint_summary,
        "template_path": str(template_path),
        "merged_unique_templates": len(rows),
        "merged_occurrences": sum(counts),
        "template_count_min": min(counts) if counts else 0,
        "template_count_max": max(counts) if counts else 0,
        "template_count_mean": round(statistics.mean(counts), 3) if counts else 0,
        "template_count_median": statistics.median(counts) if counts else 0,
        "singleton_templates": singleton_templates,
        "singleton_percent": round(singleton_templates / max(len(rows), 1) * 100, 2),
        "length_min": min(lengths) if lengths else 0,
        "length_p50": statistics.median(lengths) if lengths else 0,
        "length_p95": _percentile(lengths, 0.95),
        "length_max": max(lengths) if lengths else 0,
        "empty_templates": empty_templates,
        "missing_arrow": missing_arrow,
        "missing_references": missing_references,
        "missing_atom_map_colon": missing_atom_map_colon,
        "rdkit_available": rdkit_available,
        "rdkit_invalid_reaction_smarts": invalid_count,
        "top_templates": _top_templates(rows),
        "sample_singletons": _sample_singletons(rows),
    }


def _read_template_rows(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        rows = json.load(handle)
    if not isinstance(rows, list):
        raise ValueError(f"Template file must contain a list: {path}")
    return [row for row in rows if isinstance(row, dict)]


def _rdkit_invalid_count(rows: list[dict[str, Any]]) -> tuple[bool, int | None]:
    try:
        from rdkit.Chem import rdChemReactions
    except Exception:
        return False, None
    invalid = 0
    for row in rows:
        smarts = str(row.get("reaction_smarts") or "")
        try:
            reaction = rdChemReactions.ReactionFromSmarts(smarts)
            if (
                reaction is None
                or reaction.GetNumReactantTemplates() < 1
                or reaction.GetNumProductTemplates() < 1
            ):
                invalid += 1
        except Exception:
            invalid += 1
    return True, invalid


def _checkpoint_summary(checkpoints: list[Path]) -> dict[str, Any]:
    processed = 0
    accepted = 0
    rejected = 0
    counters: Counter[str] = Counter()
    rows = []
    for checkpoint in checkpoints:
        if not checkpoint.exists():
            rows.append({"path": str(checkpoint), "missing": True})
            continue
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        processed += int(data.get("processed_reactions") or 0)
        accepted += int(data.get("accepted_template_occurrences") or 0)
        rejected += int(data.get("rejected_reactions") or 0)
        counters.update({str(k): int(v) for k, v in (data.get("counters") or {}).items()})
        rows.append(
            {
                "path": str(checkpoint),
                "processed_reactions": data.get("processed_reactions"),
                "accepted_template_occurrences": data.get("accepted_template_occurrences"),
                "accepted_templates": data.get("accepted_templates"),
                "rejected_reactions": data.get("rejected_reactions"),
                "completed": data.get("completed"),
                "elapsed_sec": data.get("elapsed_sec"),
            }
        )
    return {
        "checkpoint_processed_reactions": processed,
        "checkpoint_accepted_occurrences": accepted,
        "checkpoint_rejected_reactions": rejected,
        "checkpoint_acceptance_rate": round(accepted / max(processed, 1), 4),
        "checkpoint_counters": dict(sorted(counters.items())),
        "checkpoints": rows,
    }


def _percentile(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    index = min(len(values) - 1, int(len(values) * percentile))
    return sorted(values)[index]


def _top_templates(rows: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    output = []
    for row in rows[:limit]:
        output.append(
            {
                "count": int(row.get("count") or 0),
                "references": len(row.get("references") or []),
                "reaction_smarts": str(row.get("reaction_smarts") or "")[:240],
            }
        )
    return output


def _sample_singletons(rows: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        if int(row.get("count") or 0) != 1:
            continue
        output.append(
            {
                "count": 1,
                "reaction_smarts": str(row.get("reaction_smarts") or "")[:240],
            }
        )
        if len(output) >= limit:
            break
    return output


if __name__ == "__main__":
    raise SystemExit(main())
