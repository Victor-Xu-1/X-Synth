"""Read-only price semantics for the ASKCOS stock-index contract.

The lookup envelope retains snapshot/results and adds price_basis. The API also
returns requested, an ordered echo of every raw smiles and canonical_smiles pair,
including duplicate inputs. Each original record retains its fields (including
ppg) and adds price with the same basis plus
amount, status and record_key. Valid ppg is a finite, positive JSON number; missing
and invalid values become null, never zero. record_key binds smiles/source/catalog_id
to the containing catalog record. snapshot is the existing source digest, while
catalog_sha256 identifies the compiled SQLite bytes. Neither is a quote date.

ASKCOS documents prices per gram and uses the literal $/g notation. This does not
establish an ISO currency for individual records. Currency, quoted_at, package and
purity remain null because stock-index schema 1 does not store those facts.
"""

from __future__ import annotations

import math
from collections.abc import Mapping

UNIT_EVIDENCE = (
    "https://askcos-docs.mit.edu/guide/7-Release-Notes/7.2-ASKCOS-v1/"
    "19-0.3.0-Release-Notes.html#changing-the-database-of-buyable-chemicals"
)
CATALOG_EVIDENCE = (
    "https://askcos-docs.mit.edu/guide/3-Advanced-Usage/"
    "3.5-Utilities.html#buyables-building-block-description"
)


def price_value(value: object) -> tuple[float | int | None, str]:
    if value is None:
        return None, "missing"
    if type(value) not in (float, int):
        return None, "invalid"
    try:
        valid = math.isfinite(value) and value > 0
    except OverflowError:
        valid = False
    return (value, "recorded") if valid else (None, "invalid")


def price_basis(summary: Mapping) -> dict:
    return {
        "semantics_version": 1,
        "basis": "supplier_catalog_snapshot",
        "raw_field": "ppg",
        "unit": "$/g",
        "currency": None,
        "quoted_at": None,
        "package": None,
        "purity": None,
        "source_id": summary["source_id"],
        "snapshot": summary["source_sha256"],
        "catalog_sha256": summary["catalog_sha256"],
        "unit_evidence": UNIT_EVIDENCE,
        "catalog_evidence": CATALOG_EVIDENCE,
    }


def priced_record(record: Mapping, basis: Mapping) -> dict:
    amount, status = price_value(record.get("ppg"))
    return {
        **record,
        "ppg": amount,
        "price": {
            **basis,
            "amount": amount,
            "status": status,
            "record_key": {
                key: record[key] for key in ("smiles", "source", "catalog_id")
            },
        },
    }


def priced_lookup(results: Mapping, summary: Mapping) -> dict:
    basis = price_basis(summary)
    return {
        "snapshot": summary["source_sha256"],
        "price_basis": basis,
        "results": {
            smiles: [priced_record(record, basis) for record in records]
            for smiles, records in results.items()
        },
    }
