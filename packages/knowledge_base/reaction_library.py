"""Pinned exact-structure queries over independently validated ORD evidence."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Callable
from time import monotonic

from packages.platform.immutable_sqlite import ImmutableSQLite
from packages.adapters.askcos.reference_identity import (
    component_multiset, parse_reference_reaction, reaction_match_scope,
)
from packages.adapters.askcos.reference_models import ReferenceQuery
from .reaction_models import EvidenceSourceStatus, ReactionEvidence
from .reaction_compile import compile_reaction_library
from .reaction_snapshot import (
    SCHEMA_VERSION, ReactionLibraryError, reactant_signature,
    validate_reaction_schema, validate_reaction_summary,
)

__all__ = [
    "SCHEMA_VERSION", "ReactionLibraryError", "ReactionLibrary",
    "compile_reaction_library", "reactant_signature", "verify_evidence_record",
    "has_measured_zero_yield",
]
CONDITION_VARIANT_LIMIT = 8
RECORD_COLUMNS = "id, product, reactants, payload"


def has_measured_zero_yield(record: ReactionEvidence) -> bool:
    return any(
        item.method == "ord_product_measurement" and item.unit == "%" and item.value == 0
        for item in record.reported_yields
    )


def verify_evidence_record(record: ReactionEvidence, query: ReferenceQuery) -> None:
    reactants, products, agents = parse_reference_reaction(record.reaction_smiles)
    if (
        record.reactants != reactants
        or record.products != products
        or record.agents != agents
        or component_multiset(products) != component_multiset([query.product])
        or record.match_scope != reaction_match_scope(query, reactants)
    ):
        raise ValueError("Reaction evidence does not belong to the exact query")
    for measurement in record.reported_yields:
        if measurement.product_smiles and component_multiset(
            [measurement.product_smiles]
        ) not in (component_multiset([product]) for product in products):
            raise ValueError("Reported yield belongs to an unrecorded product")


class ReactionLibrary:
    def __init__(self, path: str | Path | None):
        self.path = Path(path).absolute() if path else None
        self._summary = None
        self._source_hashes = {}
        self._reason = "reaction_library_not_configured"
        if self.path:
            try:
                self._snapshot = ImmutableSQLite(self.path)
                with self._snapshot.connect() as connection:
                    validate_reaction_schema(connection)
                    version = connection.execute("PRAGMA user_version").fetchone()[0]
                    raw = connection.execute(
                        "SELECT value FROM metadata WHERE key='summary'"
                    ).fetchone()
                    if not raw or len(raw[0]) > 1048576:
                        raise ValueError("Reaction summary is missing or oversized")
                    summary = json.loads(raw[0])
                    validate_reaction_summary(summary)
                    if (
                        version != SCHEMA_VERSION
                        or summary.get("schema_version") != version
                    ):
                        raise ValueError("Unsupported reaction library schema")
                    self._ready_status(summary)
                    if (
                        connection.execute("SELECT 1 FROM reactions LIMIT 1").fetchone()
                        is None
                    ):
                        raise ValueError("Reaction library is empty")
                self._check_snapshot()
                self._summary, self._reason = summary, None
                self._source_hashes = {
                    item["path"]: item["sha256"] for item in summary["sources"]
                }
            except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, ReactionLibraryError):
                self._reason = "reaction_library_invalid"

    def _check_snapshot(self):
        try:
            self._snapshot.check()
        except sqlite3.Error as exc:
            raise ReactionLibraryError("reaction_library_invalid") from exc

    def status(self) -> EvidenceSourceStatus:
        try:
            if self._summary:
                self._check_snapshot()
                return self._ready_status(self._summary)
        except (OSError, ReactionLibraryError):
            pass
        return EvidenceSourceStatus(
            source="ORD",
            ready=False,
            product_index_available=False,
            reason=self._reason or "reaction_library_invalid",
        )

    @staticmethod
    def _ready_status(summary) -> EvidenceSourceStatus:
        return EvidenceSourceStatus(
            source="ORD", ready=True, product_index_available=True,
            **{key: summary[key] for key in (
                "record_count", "conditions_count", "yields_count", "snapshot", "license"
            )},
        )

    def _require_ready(self):
        status = self.status()
        if not status.ready:
            raise ReactionLibraryError(status.reason)

    def _decode(self, row, query: ReferenceQuery) -> ReactionEvidence:
        identifier, product, signature, payload = row
        record = ReactionEvidence.model_validate_json(payload)
        provenance = record.provenance
        if (
            record.id != identifier or product != query.product
            or reactant_signature(record.reactants) != signature
            or provenance.source != "ORD"
            or self._source_hashes.get(provenance.source_path) != provenance.source_sha256
        ):
            raise ValueError("Reaction record is outside the exact snapshot index/sources")
        record = record.model_copy(update={
            "match_scope": reaction_match_scope(query, record.reactants)
        })
        verify_evidence_record(record, query)
        return record

    @staticmethod
    def _validate_limit(limit):
        if type(limit) is not int or not 1 <= limit <= 30:
            raise ValueError("Reaction result limit must be 1-30")

    def search(
        self, query: ReferenceQuery, *, limit: int
    ) -> tuple[list[ReactionEvidence], bool]:
        self._validate_limit(limit)
        self._require_ready()
        try:
            with self._snapshot.connect(seconds=4) as connection:
                rows = connection.execute(
                    f"SELECT {RECORD_COLUMNS} FROM reactions WHERE product=? ORDER BY "
                    "(reactants<>?) ASC, has_conditions DESC, has_yield DESC, id LIMIT ?",
                    (query.product, reactant_signature(query.reactants), limit + 1),
                ).fetchall()
            records = [self._decode(row, query) for row in rows[:limit]]
            self._check_snapshot()
            return records, len(rows) > limit
        except (sqlite3.Error, OSError, ValueError, TypeError) as exc:
            raise ReactionLibraryError("reaction_library_query_failed") from exc

    def precursor_records(
        self, query: ReferenceQuery, limit: int = 30,
        *, eligible: Callable[[ReactionEvidence], bool] | None = None,
    ) -> tuple[list[ReactionEvidence], bool]:
        self._validate_limit(limit)
        self._require_ready()
        records, after, has_more = [], "", False
        deadline = monotonic() + 4
        try:
            with self._snapshot.connect(seconds=4) as connection:
                for index in range(limit + 1):
                    # Index seeks skip entire condition groups, including very large ones.
                    group = connection.execute(
                        "SELECT reactants FROM reactions WHERE product=? AND reactants>? "
                        "ORDER BY reactants LIMIT 1", (query.product, after),
                    ).fetchone()
                    if group is None:
                        break
                    if index == limit:
                        has_more = True
                        break
                    after = group[0]
                    rows = connection.execute(
                        f"SELECT {RECORD_COLUMNS} FROM reactions WHERE product=? AND reactants=? "
                        "ORDER BY has_conditions DESC, has_yield DESC, id LIMIT ?",
                        (query.product, after, CONDITION_VARIANT_LIMIT + 1),
                    ).fetchall()
                    variants = [self._decode(row, query) for row in rows[:CONDITION_VARIANT_LIMIT]]
                    if not variants:
                        raise ValueError("Reaction precursor index has no records")
                    if monotonic() > deadline:
                        raise ValueError("Reaction precursor query exceeded its time budget")
                    usable = next((r for r in variants if not has_measured_zero_yield(r)
                                   and (eligible is None or eligible(r))), None)
                    records.append(usable or variants[0])
                    has_more |= usable is None and len(rows) > CONDITION_VARIANT_LIMIT
            self._check_snapshot()
            return records, has_more
        except (sqlite3.Error, OSError, ValueError, TypeError) as exc:
            raise ReactionLibraryError("reaction_library_query_failed") from exc

    def get_record(self, identifier: str, query: ReferenceQuery) -> ReactionEvidence | None:
        self._require_ready()
        try:
            with self._snapshot.connect(seconds=4) as connection:
                row = connection.execute(
                    f"SELECT {RECORD_COLUMNS} FROM reactions WHERE id=? AND product=?",
                    (identifier, query.product),
                ).fetchone()
            record = self._decode(row, query) if row else None
            self._check_snapshot()
            return record
        except (sqlite3.Error, OSError, ValueError, TypeError) as exc:
            raise ReactionLibraryError("reaction_library_query_failed") from exc
