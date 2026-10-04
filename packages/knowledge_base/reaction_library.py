"""Immutable exact-structure index for traceable public reaction records."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
from collections.abc import Iterable
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic

from packages.adapters.askcos.reference_identity import (
    canonical_structure,
    component_multiset,
    parse_reference_reaction,
    reaction_match_scope,
)
from packages.adapters.askcos.reference_models import (
    MAX_REFERENCE_ATOMS,
    ReferenceQuery,
)

from .reaction_models import EvidenceSourceStatus, ReactionEvidence

SCHEMA_VERSION = 1


class ReactionLibraryError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reactant_signature(structures: list[str]) -> str:
    components = sorted(component_multiset(structures).items())
    return hashlib.sha256(
        json.dumps(components, separators=(",", ":")).encode()
    ).hexdigest()


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


def compile_reaction_library(
    records: Iterable[ReactionEvidence], output: Path, *, sources: list[dict]
) -> dict:
    """Write privately, validate, then publish without replacing an existing asset."""
    output = Path(output).absolute()
    if output.exists():
        raise FileExistsError("Reaction libraries are immutable; select a new output")
    known_sources = {item["path"]: item["sha256"] for item in sources}
    if len(known_sources) != len(sources) or not sources:
        raise ValueError("Distinct, checksummed reaction sources are required")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(
        prefix=".reaction-library-", suffix=".sqlite", dir=output.parent
    )
    os.close(descriptor)
    temporary = Path(name)
    identity = hashlib.sha256(
        json.dumps(sources, sort_keys=True, separators=(",", ":")).encode()
    )
    counts = {
        "record_count": 0,
        "conditions_count": 0,
        "yields_count": 0,
        "duplicate_count": 0,
    }
    try:
        with closing(sqlite3.connect(temporary)) as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=DELETE;
                PRAGMA synchronous=FULL;
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
                CREATE TABLE reactions (
                    id TEXT PRIMARY KEY, product TEXT NOT NULL, reactants TEXT NOT NULL,
                    has_conditions INTEGER NOT NULL, has_yield INTEGER NOT NULL,
                    payload TEXT NOT NULL
                ) WITHOUT ROWID;
                """
            )
            for record in records:
                if (
                    not isinstance(record, ReactionEvidence)
                    or record.provenance.source != "ORD"
                ):
                    raise ValueError(
                        "Only typed ORD records can enter the public reaction library"
                    )
                provenance = record.provenance
                if (
                    known_sources.get(provenance.source_path)
                    != provenance.source_sha256
                ):
                    raise ValueError(
                        "Reaction record does not belong to the checksummed inputs"
                    )
                product = canonical_structure(
                    ".".join(record.products), max_atoms=MAX_REFERENCE_ATOMS
                )[0]
                payload = record.model_dump_json()
                conditions = bool(
                    record.conditions and any(record.conditions.model_dump().values())
                )
                cursor = connection.execute(
                    "INSERT OR IGNORE INTO reactions VALUES (?,?,?,?,?,?)",
                    (
                        record.id,
                        product,
                        reactant_signature(record.reactants),
                        int(conditions),
                        int(bool(record.reported_yields)),
                        payload,
                    ),
                )
                if cursor.rowcount == 0:
                    prior = connection.execute(
                        "SELECT payload FROM reactions WHERE id=?", (record.id,)
                    ).fetchone()[0]
                    if prior != payload:
                        raise ValueError(
                            "Conflicting reaction records share an identifier"
                        )
                    counts["duplicate_count"] += 1
                    continue
                identity.update(payload.encode())
                counts["record_count"] += 1
                counts["conditions_count"] += int(conditions)
                counts["yields_count"] += int(bool(record.reported_yields))
                if counts["record_count"] % 10000 == 0:
                    connection.commit()
            if not counts["record_count"]:
                raise ValueError("No valid reactions were indexed")
            connection.execute(
                "CREATE INDEX reaction_product ON reactions(product, reactants, has_conditions DESC, has_yield DESC, id)"
            )
            summary = {
                "schema_version": SCHEMA_VERSION,
                "source": "ORD",
                "license": "CC-BY-SA-4.0",
                "snapshot": identity.hexdigest(),
                "created_at": datetime.now(UTC).isoformat(),
                "sources": sources,
                **counts,
            }
            connection.execute(
                "INSERT INTO metadata VALUES ('summary',?)",
                (json.dumps(summary, separators=(",", ":")),),
            )
            connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            connection.commit()
            if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("Reaction library integrity check failed")
        # link is an atomic no-replace publication on the same filesystem.
        os.chmod(temporary, 0o444)
        os.link(temporary, output)
        return summary
    finally:
        temporary.unlink(missing_ok=True)


class ReactionLibrary:
    def __init__(self, path: str | Path | None):
        self.path = Path(path).absolute() if path else None
        self._fingerprint = None
        self._summary = None
        self._reason = "reaction_library_not_configured"
        if self.path:
            try:
                self._fingerprint = self._stat()
                with closing(self._connect()) as connection:
                    version = connection.execute("PRAGMA user_version").fetchone()[0]
                    raw = connection.execute(
                        "SELECT value FROM metadata WHERE key='summary'"
                    ).fetchone()
                    summary = json.loads(raw[0]) if raw else {}
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
            except (OSError, sqlite3.Error, ValueError, KeyError, ReactionLibraryError):
                self._reason = "reaction_library_invalid"

    def _stat(self):
        stat = self.path.stat()
        return (
            stat.st_dev,
            stat.st_ino,
            stat.st_size,
            stat.st_mtime_ns,
            stat.st_ctime_ns,
        )

    def _check_snapshot(self):
        if self._fingerprint != self._stat():
            raise ReactionLibraryError("reaction_library_invalid")

    def _connect(self):
        self._check_snapshot()
        return sqlite3.connect(
            self.path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=2
        )

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
            with closing(self._connect()) as connection:
                deadline = monotonic() + 4
                connection.set_progress_handler(
                    lambda: int(monotonic() > deadline), 1000
                )
                rows = connection.execute(
                    "SELECT payload FROM reactions WHERE product=? ORDER BY "
                    "(reactants<>?) ASC, has_conditions DESC, has_yield DESC, id LIMIT ?",
                    (query.product, reactant_signature(query.reactants), limit + 1),
                ).fetchall()
            records = []
            for (payload,) in rows[:limit]:
                record = ReactionEvidence.model_validate_json(payload)
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
