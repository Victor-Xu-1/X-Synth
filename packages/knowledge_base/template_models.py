from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_TEMPLATE_STRATEGIES: dict[str, dict[str, Any]] = {
    "all": {},
    "high_precision": {
        "sources": ("reaxys", "pistachio", "pistachio_ringbreaker"),
        "min_count": 2,
    },
    "ringbreaker": {
        "sources": ("pistachio_ringbreaker",),
    },
    "uspto_backfill": {
        "sources": (
            "uspto_higher_level",
            "uspto_50k",
            "uspto_aizynthfinder",
            "uspto_ringbreaker_aizynthfinder",
        ),
    },
    "ord_backfill": {
        "sources": ("ord", "ord_extracted"),
    },
    "public_reaction_corpus": {
        "domain": "public_reaction_corpus",
    },
    "forward_validation": {
        "domain": "forward_validation",
        "direction": "forward",
    },
    "biocatalysis": {
        "domain": "biocatalysis",
    },
    "metabolism": {
        "domain": "metabolism",
    },
}
@dataclass(frozen=True)
class TemplateRecord:
    template_id: str
    source: str
    source_path: str
    template_set: str
    direction: str
    domain: str
    reaction_smarts: str
    count: int
    necessary_reagent: str
    intra_only: bool
    dimer_only: bool
    ring_delta: float | None
    chiral_delta: int | None
    references: list[Any]
    attributes: dict[str, Any]
    raw: dict[str, Any]
def _normalise_template_record(
    *,
    raw: dict[str, Any],
    source: str,
    source_path: Path,
    direction: str,
    domain: str,
) -> TemplateRecord | None:
    reaction_smarts = str(raw.get("reaction_smarts") or "").strip()
    if not reaction_smarts:
        return None
    external_id = str(raw.get("_id") or raw.get("id") or raw.get("index") or "")
    if not external_id:
        external_id = hashlib.sha256(reaction_smarts.encode("utf-8")).hexdigest()[:24]
    attributes = raw.get("attributes")
    if not isinstance(attributes, dict):
        attributes = {}
    references = raw.get("references")
    if not isinstance(references, list):
        references = []
    count = _safe_int(raw.get("count"), default=0)
    template_set = str(raw.get("template_set") or source)
    return TemplateRecord(
        template_id=f"{source}:{external_id}",
        source=source,
        source_path=str(source_path),
        template_set=template_set,
        direction=direction,
        domain=domain,
        reaction_smarts=reaction_smarts,
        count=count,
        necessary_reagent=str(raw.get("necessary_reagent") or ""),
        intra_only=bool(raw.get("intra_only")),
        dimer_only=bool(raw.get("dimer_only")),
        ring_delta=_safe_float(attributes.get("ring_delta")),
        chiral_delta=_safe_optional_int(attributes.get("chiral_delta")),
        references=references,
        attributes=attributes,
        raw=raw,
    )

def _template_record_from_row(row: tuple[Any, ...]) -> TemplateRecord:
    return TemplateRecord(
        template_id=row[0],
        source=row[1],
        source_path=row[2],
        template_set=row[3],
        direction=row[4],
        domain=row[5],
        reaction_smarts=row[6],
        count=int(row[7]),
        necessary_reagent=row[8],
        intra_only=bool(row[9]),
        dimer_only=bool(row[10]),
        ring_delta=row[11],
        chiral_delta=row[12],
        references=json.loads(row[13]),
        attributes=json.loads(row[14]),
        raw=json.loads(row[15]),
    )

def _safe_int(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

def _safe_optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
