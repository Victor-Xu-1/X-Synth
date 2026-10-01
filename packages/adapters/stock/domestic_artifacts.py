from __future__ import annotations

import csv
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Iterable

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "smiles": ("smiles", "SMILES", "canonical_smiles", "Canonical SMILES", "结构SMILES"),
    "cas": ("cas", "CAS", "cas_no", "cas_number", "CAS No.", "CAS号", "CAS 号"),
    "source": ("source", "platform", "vendor_source", "数据源", "来源", "平台"),
    "supplier": ("supplier", "vendor", "manufacturer", "company", "供应商", "厂家", "生产商"),
    "catalog_id": ("catalog_id", "catalog", "catalog_no", "catalog_number", "sku", "货号", "目录号", "产品编号"),
    "url": ("url", "link", "product_url", "chemicalbook_url", "供应商链接", "链接", "网址"),
    "availability": ("availability", "stock", "stock_status", "inventory", "lead_time", "库存", "库存状态", "现货", "交期"),
    "ppg": ("ppg", "price_per_gram", "price", "unit_price", "价格", "报价", "单价"),
}


@dataclass(frozen=True)
class DomesticStockArtifacts:
    output_dir: Path
    askcos_buyables_path: Path
    synon_stock_path: Path
    aizynth_stock_path: Path
    aizynth_smiles_audit_path: Path
    aizynth_stock_config_path: Path
    summary_path: Path
    rejected_path: Path
    summary: dict[str, Any]


def build_domestic_stock_artifacts(
    *,
    source_paths: Iterable[Path | str],
    output_dir: Path | str,
    default_source: str = "operator_supplier_export",
    default_ppg: float = 1.0,
) -> DomesticStockArtifacts:
    """Compile one domestic supplier export set into ASKCOS, Synon, and AiZynthFinder stock artifacts."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    accepted_rows: list[dict[str, Any]] = []
    rejected_rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for source_path in source_paths:
        path = Path(source_path)
        for row_number, row in enumerate(_read_records(path), start=1):
            compiled = _compile_row(
                row,
                source_path=path,
                row_number=row_number,
                default_source=default_source,
                default_ppg=default_ppg,
            )
            if compiled["decision"] != "accepted":
                rejected_rows.append(compiled)
                continue
            key = (
                compiled["smiles"],
                compiled["source"],
                compiled.get("catalog_id") or compiled.get("cas") or "",
            )
            if key in seen:
                continue
            seen.add(key)
            accepted_rows.append(compiled)

    askcos_rows = [_to_askcos_row(row) for row in accepted_rows]
    synon_rows = [_to_synon_stock_row(row) for row in accepted_rows]
    aizynth_audit_lines = [_to_aizynth_audit_line(row) for row in accepted_rows]
    aizynth_stock_lines = [_to_aizynth_stock_line(row) for row in accepted_rows if row.get("inchi_key")]

    askcos_path = output / "askcos_buyables.json"
    synon_path = output / "synon_stock.json"
    aizynth_path = output / "aizynthfinder_stock_inchikeys.txt"
    aizynth_audit_path = output / "aizynthfinder_stock_smiles.smi"
    aizynth_config_path = output / "aizynthfinder_stock_config.yml"
    rejected_path = output / "rejected_stock_rows.json"
    summary_path = output / "summary.json"

    askcos_path.write_text(json.dumps(askcos_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    synon_path.write_text(json.dumps(synon_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    aizynth_path.write_text("\n".join(aizynth_stock_lines) + ("\n" if aizynth_stock_lines else ""), encoding="utf-8")
    aizynth_audit_path.write_text("\n".join(aizynth_audit_lines) + ("\n" if aizynth_audit_lines else ""), encoding="utf-8")
    aizynth_config_path.write_text(
        "stock:\n"
        "  domestic:\n"
        f"    type: inchiset\n"
        f"    path: {aizynth_path}\n",
        encoding="utf-8",
    )
    rejected_path.write_text(json.dumps(rejected_rows, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {
        "accepted_records": len(accepted_rows),
        "rejected_records": len(rejected_rows),
        "sources": sorted({row["source"] for row in accepted_rows}),
        "askcos_buyables_path": str(askcos_path),
        "synon_stock_path": str(synon_path),
        "aizynthfinder_stock_path": str(aizynth_path),
        "aizynthfinder_smiles_audit_path": str(aizynth_audit_path),
        "aizynthfinder_stock_config_path": str(aizynth_config_path),
        "rejected_path": str(rejected_path),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return DomesticStockArtifacts(
        output_dir=output,
        askcos_buyables_path=askcos_path,
        synon_stock_path=synon_path,
        aizynth_stock_path=aizynth_path,
        aizynth_smiles_audit_path=aizynth_audit_path,
        aizynth_stock_config_path=aizynth_config_path,
        summary_path=summary_path,
        rejected_path=rejected_path,
        summary=summary,
    )


def _compile_row(
    row: dict[str, Any],
    *,
    source_path: Path,
    row_number: int,
    default_source: str,
    default_ppg: float,
) -> dict[str, Any]:
    raw_smiles = _first_text(row, FIELD_ALIASES["smiles"])
    if not raw_smiles:
        return _rejected(row, source_path, row_number, "missing_smiles")
    smiles = _canonicalize_valid_smiles(raw_smiles)
    if not smiles:
        return _rejected(row, source_path, row_number, "invalid_smiles", smiles=raw_smiles)

    source = _first_text(row, FIELD_ALIASES["source"]) or default_source
    supplier = _first_text(row, FIELD_ALIASES["supplier"])
    catalog_id = _first_text(row, FIELD_ALIASES["catalog_id"])
    cas = _first_text(row, FIELD_ALIASES["cas"])
    url = _first_text(row, FIELD_ALIASES["url"])
    availability = _first_text(row, FIELD_ALIASES["availability"])

    if not any([cas, supplier, catalog_id, url, availability]):
        return _rejected(
            row,
            source_path,
            row_number,
            "missing_supplier_cas_catalog_evidence",
            smiles=smiles,
            source=source,
        )

    return {
        "decision": "accepted",
        "reason": "exact canonical smiles with supplier/CAS/catalog/availability evidence",
        "smiles": smiles,
        "inchi_key": _inchi_key(smiles),
        "source": source,
        "supplier": supplier,
        "catalog_id": catalog_id,
        "cas": cas,
        "url": url,
        "availability": availability,
        "ppg": _parse_ppg(_first_text(row, FIELD_ALIASES["ppg"]), default_ppg),
        "source_file": str(source_path),
        "row": row_number,
    }


def _read_records(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    text = path.read_text(encoding="utf-8-sig")
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        return list(csv.DictReader(text.splitlines(), delimiter=delimiter))
    if suffix in {".jsonl", ".ndjson"}:
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    if suffix == ".json":
        payload = json.loads(text)
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        for key in ("records", "data", "rows", "items", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return [payload] if isinstance(payload, dict) else []
    raise ValueError(f"unsupported domestic stock file format: {path}")


def _to_askcos_row(row: dict[str, Any]) -> dict[str, Any]:
    properties = []
    for key in ("cas", "supplier", "catalog_id", "url", "availability"):
        if row.get(key):
            properties.append({key: row[key]})
    properties.extend([{"evidence_source": row["source"]}, {"country": "CN"}])
    return {
        "smiles": row["smiles"],
        "ppg": row["ppg"],
        "lead_time": row.get("availability") or "",
        "source": row["source"],
        "properties": properties,
    }


def _to_synon_stock_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "smiles": row["smiles"],
        "source": row["source"],
        "decision": "accepted",
        "reason": row["reason"],
        "catalog_id": row.get("catalog_id") or None,
        "cas": row.get("cas") or None,
        "url": row.get("url") or None,
    }


def _to_aizynth_audit_line(row: dict[str, Any]) -> str:
    catalog = row.get("catalog_id") or row.get("cas") or row["source"]
    return f"{row['smiles']} {catalog} {row['source']}"


def _to_aizynth_stock_line(row: dict[str, Any]) -> str:
    return str(row["inchi_key"])


def _inchi_key(smiles: str) -> str:
    try:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return ""
        return Chem.MolToInchiKey(mol)
    except Exception:
        return ""


def _canonicalize_valid_smiles(smiles: str) -> str:
    value = (smiles or "").strip()
    if not value:
        return ""
    try:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(value)
        if mol is None:
            return ""
        return Chem.MolToSmiles(mol, canonical=True)
    except Exception:
        return ""


def _rejected(
    row: dict[str, Any],
    source_path: Path,
    row_number: int,
    reason: str,
    *,
    smiles: str = "",
    source: str = "",
) -> dict[str, Any]:
    return {
        "decision": "rejected",
        "reason": reason,
        "smiles": smiles,
        "source": source,
        "source_file": str(source_path),
        "row": row_number,
        "raw": row,
    }


def _first_text(row: dict[str, Any], aliases: tuple[str, ...]) -> str:
    for key in aliases:
        if key in row:
            text = _clean_text(row[key])
            if text:
                return text
    lower_map = {str(key).strip().lower(): value for key, value in row.items()}
    for key in aliases:
        value = lower_map.get(key.strip().lower())
        text = _clean_text(value)
        if text:
            return text
    return ""


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "none", "null"} else text


def _parse_ppg(value: str, default_ppg: float) -> float:
    if not value:
        return float(default_ppg)
    import re

    match = re.search(r"\d+(?:\.\d+)?", value.replace(",", ""))
    if not match:
        return float(default_ppg)
    parsed = float(match.group(0))
    return parsed if parsed > 0 else float(default_ppg)
