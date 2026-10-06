"""Compile typed, source-bound ORD records into a new snapshot."""

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

from packages.adapters.askcos.reference_identity import canonical_structure
from packages.adapters.askcos.reference_models import MAX_REFERENCE_ATOMS
from .reaction_models import ReactionEvidence
from .reaction_snapshot import SCHEMA_VERSION, reactant_signature, validate_reaction_summary

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
            validate_reaction_summary(summary)
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
