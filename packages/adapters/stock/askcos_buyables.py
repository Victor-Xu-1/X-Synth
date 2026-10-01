from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .commercial_stock import canonicalize_smiles


@dataclass(frozen=True)
class AskcosBuyablesStockResult:
    output_dir: Path
    synon_stock_path: Path
    summary_path: Path
    summary: dict[str, Any]


def build_askcos_buyables_stock(
    *,
    source_paths: Iterable[Path | str],
    output_dir: Path | str,
) -> AskcosBuyablesStockResult:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    seen: set[tuple[str, str, str]] = set()
    records: list[dict[str, Any]] = []
    rejected = 0

    for raw_path in source_paths:
        source_path = Path(raw_path)
        for row in _iter_buyable_rows(source_path):
            record = _synon_stock_record(row, source_path=source_path)
            if record is None:
                rejected += 1
                continue
            key = (
                record["smiles"],
                record["source"],
                record.get("catalog_id") or record.get("url") or "",
            )
            if key in seen:
                continue
            seen.add(key)
            records.append(record)

    synon_stock_path = output / "synon_stock.json"
    summary_path = output / "summary.json"
    synon_stock_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "accepted_records": len(records),
        "rejected_records": rejected,
        "sources": sorted({record["source"] for record in records}),
        "synon_stock_path": str(synon_stock_path),
        "source_paths": [str(Path(path)) for path in source_paths],
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return AskcosBuyablesStockResult(
        output_dir=output,
        synon_stock_path=synon_stock_path,
        summary_path=summary_path,
        summary=summary,
    )


def _iter_buyable_rows(path: Path) -> Iterable[dict[str, Any]]:
    with _open_text(path) as handle:
        first = handle.read(1)
        handle.seek(0)
        if first == "[":
            payload = json.load(handle)
            if isinstance(payload, list):
                for row in payload:
                    if isinstance(row, dict):
                        yield row
            return
        for line in handle:
            stripped = line.strip().rstrip(",")
            if not stripped or stripped in {"[", "]"}:
                continue
            row = json.loads(stripped)
            if isinstance(row, dict):
                yield row


def _open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("rt", encoding="utf-8")


def _synon_stock_record(row: dict[str, Any], *, source_path: Path) -> dict[str, Any] | None:
    smiles = canonicalize_smiles(str(row.get("smiles") or "").strip())
    if not smiles:
        return None
    source = _supplier_source(row)
    url = _property_value(row, "link")
    availability = _property_value(row, "availability") or str(row.get("lead_time") or "").strip()
    catalog_id = _catalog_id_from_url(url) or str(row.get("_id") or "").strip() or None
    if not any([catalog_id, url, availability]):
        return None
    return {
        "smiles": smiles,
        "source": source,
        "decision": "accepted",
        "reason": "ASKCOS buyables exact structure with supplier catalog evidence",
        "catalog_id": catalog_id,
        "cas": None,
        "url": url or None,
        "source_file": str(source_path),
    }


def _supplier_source(row: dict[str, Any]) -> str:
    source = str(row.get("source") or "").strip()
    aliases = {
        "CB": "chembridge",
        "CS": "chemspace",
        "MC": "mcule",
    }
    return aliases.get(source, source.lower() or "askcos_buyables")


def _property_value(row: dict[str, Any], key: str) -> str:
    properties = row.get("properties")
    if not isinstance(properties, list):
        return ""
    for item in properties:
        if isinstance(item, dict) and item.get(key):
            return str(item[key]).strip()
    return ""


def _catalog_id_from_url(url: str) -> str | None:
    if not url:
        return None
    value = url.rstrip("/").split("/")[-1].strip()
    return value or None
