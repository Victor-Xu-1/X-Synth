"""Low-cost schema and source-identity validation for ORD snapshots."""

import hashlib
import json
import re

from packages.adapters.askcos.reference_identity import component_multiset
from packages.platform.immutable_sqlite import validate_index, validate_table

SCHEMA_VERSION = 1


class ReactionLibraryError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reactant_signature(structures: list[str]) -> str:
    return hashlib.sha256(json.dumps(
        sorted(component_multiset(structures).items()), separators=(",", ":")
    ).encode()).hexdigest()


def validate_reaction_schema(connection):
    validate_table(connection, "metadata", (("key", "TEXT", 1, 1), ("value", "TEXT", 0, 1)))
    columns = (
        ("id", "TEXT", 1), ("product", "TEXT", 0), ("reactants", "TEXT", 0),
        ("has_conditions", "INTEGER", 0), ("has_yield", "INTEGER", 0),
        ("payload", "TEXT", 0),
    )
    validate_table(connection, "reactions", tuple((*column, 1) for column in columns))
    validate_index(connection, "reactions", (
        "product", "reactants", "has_conditions", "has_yield", "id"
    ))


def validate_reaction_summary(summary):
    if (
        not isinstance(summary, dict) or type(summary.get("schema_version")) is not int
        or summary["schema_version"] != SCHEMA_VERSION or summary.get("source") != "ORD"
        or summary.get("license") != "CC-BY-SA-4.0"
        or not isinstance(summary.get("snapshot"), str)
        or not re.fullmatch(r"[a-f0-9]{64}", summary["snapshot"])
    ):
        raise ValueError("Reaction snapshot identity is invalid")
    for key in ("record_count", "conditions_count", "yields_count", "duplicate_count"):
        if type(summary.get(key)) is not int or summary[key] < 0:
            raise ValueError("Reaction snapshot counts are invalid")
    if not summary["record_count"] or any(
        summary[key] > summary["record_count"] for key in ("conditions_count", "yields_count")
    ):
        raise ValueError("Reaction snapshot counts are inconsistent")
    sources = summary.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 256:
        raise ValueError("Reaction snapshot sources are missing")
    seen = set()
    for source in sources:
        if (
            not isinstance(source, dict) or not isinstance(source.get("path"), str)
            or not source["path"] or source["path"] in seen
            or not isinstance(source.get("sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"])
        ):
            raise ValueError("Reaction snapshot source identity is invalid")
        seen.add(source["path"])
