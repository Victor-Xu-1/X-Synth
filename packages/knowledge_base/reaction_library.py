"""Pinned exact-structure queries over independently validated ORD evidence."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

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
]


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
                    EvidenceSourceStatus(
                        source="ORD",
                        ready=True,
                        product_index_available=True,
                        **{
                            key: summary[key]
                            for key in (
                                "record_count",
                                "conditions_count",
                                "yields_count",
                                "snapshot",
                                "license",
                            )
                        },
                    )
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
                return EvidenceSourceStatus(
                    source="ORD",
                    ready=True,
                    product_index_available=True,
                    **{
                        key: self._summary[key]
                        for key in (
                            "record_count",
                            "conditions_count",
                            "yields_count",
                            "snapshot",
                            "license",
                        )
                    },
                )
        except (OSError, ReactionLibraryError):
            pass
        return EvidenceSourceStatus(
            source="ORD",
            ready=False,
            product_index_available=False,
            reason=self._reason or "reaction_library_invalid",
        )

    def search(
        self, query: ReferenceQuery, *, limit: int
    ) -> tuple[list[ReactionEvidence], bool]:
        if not 1 <= limit <= 30:
            raise ValueError("Reaction result limit must be 1-30")
        snapshot = self.status()
        if not snapshot.ready:
            raise ReactionLibraryError(snapshot.reason)
        try:
            with self._snapshot.connect(seconds=4) as connection:
                rows = connection.execute(
                    "SELECT payload FROM reactions WHERE product=? ORDER BY "
                    "(reactants<>?) ASC, has_conditions DESC, has_yield DESC, id LIMIT ?",
                    (query.product, reactant_signature(query.reactants), limit + 1),
                ).fetchall()
            records = []
            for (payload,) in rows[:limit]:
                record = ReactionEvidence.model_validate_json(payload)
                provenance = record.provenance
                if (
                    provenance.source != "ORD"
                    or self._source_hashes.get(provenance.source_path)
                    != provenance.source_sha256
                ):
                    raise ValueError("Reaction record is outside the declared snapshot sources")
                record = record.model_copy(
                    update={
                        "match_scope": reaction_match_scope(query, record.reactants)
                    }
                )
                verify_evidence_record(record, query)
                records.append(record)
            self._check_snapshot()
            return records, len(rows) > limit
        except (sqlite3.Error, OSError, ValueError, TypeError) as exc:
            raise ReactionLibraryError("reaction_library_query_failed") from exc
