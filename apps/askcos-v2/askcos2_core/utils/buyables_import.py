from __future__ import annotations

import math
import re
from collections.abc import Iterable
from typing import Any

from rdkit import Chem


DOMESTIC_BUYABLE_SOURCE_ALIASES: dict[str, list[str]] = {
    "domestic": [
        "chemicalbook_cn",
        "chemicalbook",
        "leyan",
        "bidepharm",
        "alichem",
        "energy_chemical",
        "macklin",
        "aladdin",
        "ambeed",
        "chemscene",
        "combi_blocks",
        "sigma_aldrich",
        "targetmol",
        "tansoole",
        "molbase",
        "ambeed_cn",
        "targetmol_cn",
        "medchemexpress_cn",
        "tcichemicals_cn",
        "labnetwork_cn",
    ],
}
DOMESTIC_BUYABLE_SOURCE_ALIASES["cn"] = DOMESTIC_BUYABLE_SOURCE_ALIASES["domestic"]
DOMESTIC_BUYABLE_SOURCE_ALIASES["china"] = DOMESTIC_BUYABLE_SOURCE_ALIASES["domestic"]
DOMESTIC_BUYABLE_SOURCE_ALIASES["unified_commercial"] = (
    DOMESTIC_BUYABLE_SOURCE_ALIASES["domestic"]
    + [
        "CB",
        "CS",
        "MC",
        "LN",
        "EM",
        "SA",
    ]
)


FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "smiles": (
        "smiles",
        "SMILES",
        "canonical_smiles",
        "Canonical SMILES",
        "structure_smiles",
        "结构SMILES",
    ),
    "cas": (
        "cas",
        "CAS",
        "cas_no",
        "cas_number",
        "CAS No.",
        "CAS号",
        "CAS 号",
        "CAS编号",
    ),
    "source": (
        "source",
        "platform",
        "vendor_source",
        "数据源",
        "来源",
        "平台",
    ),
    "supplier": (
        "supplier",
        "vendor",
        "manufacturer",
        "company",
        "供应商",
        "厂家",
        "生产商",
    ),
    "catalog_no": (
        "catalog",
        "catalog_no",
        "catalog_number",
        "catalog_id",
        "sku",
        "货号",
        "目录号",
        "产品编号",
    ),
    "product_url": (
        "url",
        "link",
        "product_url",
        "chemicalbook_url",
        "供应商链接",
        "链接",
        "网址",
    ),
    "availability": (
        "availability",
        "stock",
        "stock_status",
        "inventory",
        "lead_time",
        "库存",
        "库存状态",
        "现货",
        "交期",
    ),
    "ppg": (
        "ppg",
        "price_per_gram",
        "price",
        "unit_price",
        "价格",
        "报价",
        "单价",
    ),
}

COMMERCIAL_EVIDENCE_FIELDS = (
    "cas",
    "supplier",
    "catalog_no",
    "product_url",
    "availability",
)


def expand_buyables_source_aliases(
    source: list[str] | str | None,
) -> list[str] | None:
    """Expand source aliases such as domestic/cn into concrete buyables sources."""
    if source is None:
        return None
    source_list = source if isinstance(source, list) else [source]
    expanded: list[str] = []

    for item in source_list:
        if item in DOMESTIC_BUYABLE_SOURCE_ALIASES:
            expanded.extend(DOMESTIC_BUYABLE_SOURCE_ALIASES[item])
        else:
            expanded.append(item)

    deduped: list[str] = []
    for item in expanded:
        if item not in deduped:
            deduped.append(item)
    return deduped


def normalize_domestic_buyable_records(
    records: Iterable[dict[str, Any]] | dict[str, Any],
    default_source: str = "chemicalbook_cn",
    default_ppg: float = 1.0,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Normalize ChemicalBook/domestic supplier exports into ASKCOS buyable rows.

    Rows are accepted only when they contain a valid SMILES and at least one
    commercial evidence field such as CAS, supplier, catalog number, product URL,
    or stock/lead-time text. The normalized output is compatible with
    ``MongoPricer.add_many`` and the existing buyables upload endpoint.
    """
    normalized: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for row_number, row in enumerate(_coerce_records(records), start=1):
        smiles = _first_text(row, FIELD_ALIASES["smiles"])
        if not smiles:
            errors.append({"row": row_number, "error": "missing_smiles"})
            continue

        canonical_smiles = _canonicalize_smiles(smiles)
        if not canonical_smiles:
            errors.append(
                {"row": row_number, "error": "invalid_smiles", "smiles": smiles}
            )
            continue

        source = _first_text(row, FIELD_ALIASES["source"]) or default_source
        evidence = {
            "cas": _first_text(row, FIELD_ALIASES["cas"]),
            "supplier": _first_text(row, FIELD_ALIASES["supplier"]),
            "catalog_no": _first_text(row, FIELD_ALIASES["catalog_no"]),
            "product_url": _first_text(row, FIELD_ALIASES["product_url"]),
            "availability": _first_text(row, FIELD_ALIASES["availability"]),
        }
        if not any(evidence.values()):
            errors.append(
                {
                    "row": row_number,
                    "error": "missing_supplier_cas_catalog_evidence",
                    "smiles": canonical_smiles,
                }
            )
            continue

        properties = [
            {key: value}
            for key, value in evidence.items()
            if value not in (None, "")
        ]
        properties.extend(
            [
                {"evidence_source": source},
                {"country": "CN"},
            ]
        )

        normalized.append(
            {
                "smiles": canonical_smiles,
                "ppg": _parse_ppg(_first_text(row, FIELD_ALIASES["ppg"]), default_ppg),
                "lead_time": evidence["availability"] or "",
                "source": source,
                "properties": properties,
            }
        )

    return normalized, errors


def _coerce_records(records: Iterable[dict[str, Any]] | dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(records, dict):
        for key in ("records", "data", "rows", "items", "result"):
            value = records.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return [records]
    return [item for item in records if isinstance(item, dict)]


def _canonicalize_smiles(smiles: str) -> str:
    mol = Chem.MolFromSmiles(smiles)
    if not mol:
        return ""
    return Chem.MolToSmiles(mol, isomericSmiles=True)


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
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text


def _parse_ppg(value: str, default_ppg: float) -> float:
    if not value:
        return float(default_ppg)
    match = re.search(r"\d+(?:\.\d+)?", value.replace(",", ""))
    if not match:
        return float(default_ppg)
    ppg = float(match.group(0))
    return ppg if ppg > 0 else float(default_ppg)
