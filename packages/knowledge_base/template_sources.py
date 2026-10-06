from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .template_models import _safe_int

def infer_template_source_name(path: Path) -> str:
    if path.name in {"templates.jsonl", "templates.jsonl.gz"}:
        return path.parent.name.lower().replace(".", "_")
    name = path.name
    if name.startswith("forward.templates"):
        name = name[len("forward.templates") :].lstrip(".")
        if name in ("json.gz", "jsonl.gz", "json", "jsonl", "gz", ""):
            return "forward"
    elif name.startswith("retro.templates."):
        name = name[len("retro.templates.") :]
    elif name == "uspto_templates.csv.gz" or name == "uspto_templates.csv":
        return "uspto_aizynthfinder"
    elif (
        name == "uspto_ringbreaker_templates.csv.gz"
        or name == "uspto_ringbreaker_templates.csv"
    ):
        return "uspto_ringbreaker_aizynthfinder"
    elif name.startswith("ord.templates."):
        name = name[len("ord.templates.") :]
    for suffix in (".json.gz", ".jsonl.gz", ".json", ".jsonl", ".gz"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    name = name.removesuffix(".csv")
    if name == "USPTO_50k":
        return "uspto_50k"
    if name == "ord" or name.startswith("ord_"):
        return name.lower().replace(".", "_")
    return name.lower().replace(".", "_")

def infer_template_direction(path: Path) -> str:
    name = path.name
    if name.startswith("forward.templates"):
        return "forward"
    return "retro"

def infer_template_domain(path: Path) -> str:
    source_name = infer_template_source_name(path)
    if infer_template_direction(path) == "forward":
        return "forward_validation"
    if source_name.startswith("uspto") or source_name in {"uspto_50k"}:
        return "public_reaction_corpus"
    if source_name == "ord" or source_name.startswith("ord_"):
        return "public_reaction_corpus"
    if "biocatalysis" in source_name:
        return "biocatalysis"
    if (
        "bkms" in source_name
        or "metabolic" in source_name
        or "metabolism" in source_name
    ):
        return "metabolism"
    return "strict_synthesis"

def discover_template_source_paths(source_dir: Path | str) -> list[Path]:
    root = Path(source_dir)
    if not root.is_dir():
        raise NotADirectoryError(f"Template source directory not found: {root}")
    return sorted(
        path
        for path in root.iterdir()
        if path.is_file() and _is_template_source_file(path)
    )

def discover_standard_template_source_paths(project_root: Path | str) -> list[Path]:
    """Find standard local template sources that live outside the ASKCOS template dir.

    This keeps USPTO/ORD source discovery deterministic: only real files already
    present in the project are returned. Missing ORD exports are not fabricated.
    """
    root = Path(project_root)
    candidates = [
        root
        / "apps/askcos-v2/retro/template_enumeration/data/retro.templates.USPTO_50k.json",
        root / "engines/aizynthfinder/models/uspto_templates.csv.gz",
        root / "engines/aizynthfinder/models/uspto_ringbreaker_templates.csv.gz",
    ]
    for relative_dir in (
        "data/sources/ord",
        "data/raw/ord",
        "data/external/ord",
        "data/compiled/ord_templates",
    ):
        directory = root / relative_dir
        if directory.is_dir():
            candidates.extend(path for path in directory.rglob("*") if path.is_file())
    return sorted(
        {
            path
            for path in candidates
            if path.is_file() and _is_template_source_file(path)
        }
    )

def count_template_records(path: Path) -> int:
    return sum(1 for _ in iter_template_records(path))

def iter_template_records(path: Path) -> Iterable[dict[str, Any]]:
    if _is_csv_template_source_file(path):
        yield from _iter_csv_template_records(path)
        return
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
            stripped = line.strip()
            if not stripped:
                continue
            row = json.loads(stripped)
            if isinstance(row, dict):
                yield row

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def _open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("rt", encoding="utf-8")

def _is_template_source_file(path: Path) -> bool:
    name = path.name
    if _is_csv_template_source_file(path):
        return True
    if not (
        name.startswith(("retro.templates.", "forward.templates", "ord.templates."))
    ):
        return False
    return name.endswith((".json.gz", ".jsonl.gz", ".json", ".jsonl"))

def _is_csv_template_source_file(path: Path) -> bool:
    name = path.name
    return name in {
        "uspto_templates.csv",
        "uspto_templates.csv.gz",
        "uspto_ringbreaker_templates.csv",
        "uspto_ringbreaker_templates.csv.gz",
    } or (name.startswith("ord.templates.") and name.endswith((".csv", ".csv.gz")))

def _iter_csv_template_records(path: Path) -> Iterable[dict[str, Any]]:
    source = infer_template_source_name(path)
    with _open_text(path) as handle:
        sample = handle.readline()
        delimiter = "\t" if "\t" in sample else ","
        handle.seek(0)
        reader = csv.DictReader(handle, delimiter=delimiter)
        for row in reader:
            reaction_smarts = str(
                row.get("reaction_smarts")
                or row.get("retro_template")
                or row.get("template")
                or ""
            ).strip()
            if not reaction_smarts:
                continue
            template_hash = str(row.get("template_hash") or "").strip()
            template_code = str(
                row.get("template_code") or row.get("id") or row.get("_id") or ""
            ).strip()
            template_id = template_hash or template_code
            yield {
                "_id": template_id,
                "reaction_smarts": reaction_smarts,
                "count": _safe_int(
                    row.get("library_occurence")
                    or row.get("library_occurrence")
                    or row.get("count"),
                    default=0,
                ),
                "template_set": source,
                "references": [],
                "attributes": {
                    "source_format": "csv",
                    "template_code": template_code,
                    "template_hash": template_hash,
                    "classification": str(row.get("classification") or "").strip(),
                },
            }
