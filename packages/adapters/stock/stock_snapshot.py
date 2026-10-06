"""Schema and no-replace compilation of supplier catalog snapshots."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from pathlib import Path

from packages.platform.immutable_sqlite import validate_index, validate_table
from .supplier_evidence import SCHEMA_VERSION, SUPPLIER_DOMAINS, supplier_record


class StockIndexError(RuntimeError):
    """A missing, changed or damaged index is not an empty supplier catalog."""


STOCK_COLUMNS = (
    ("smiles", "TEXT", 1), ("source", "TEXT", 2), ("catalog_id", "TEXT", 3),
    ("url", "TEXT", 0), ("cas", "TEXT", 0), ("ppg", "REAL", 0),
    ("lead_time", "TEXT", 0), ("reason", "TEXT", 0),
)
STOCK_COLUMNS = tuple(
    (*column, int(column[0] not in {"cas", "ppg"})) for column in STOCK_COLUMNS
)


def validate_stock_schema(connection):
    validate_table(connection, "metadata", (("key", "TEXT", 1, 0), ("value", "TEXT", 0, 1)))
    validate_table(connection, "evidence", STOCK_COLUMNS)
    validate_index(connection, "evidence", ("smiles", "source", "catalog_id"))


def validate_stock_summary(summary):
    if (
        not isinstance(summary, dict) or type(summary.get("schema_version")) is not int
        or summary["schema_version"] != SCHEMA_VERSION
    ):
        raise StockIndexError("Unsupported commercial stock schema")
    if not isinstance(summary.get("source_id"), str) or not summary["source_id"].strip():
        raise StockIndexError("Commercial stock source ID is missing")
    digest = summary.get("source_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise StockIndexError("Commercial stock source SHA-256 is invalid")
    for key in ("accepted_records", "unique_structures", "rejected_records", "duplicate_records"):
        if type(summary.get(key)) is not int or summary[key] < 0:
            raise StockIndexError("Commercial stock counts are invalid")
    counts = summary.get("source_counts")
    if (
        not summary["unique_structures"]
        or summary["unique_structures"] > summary["accepted_records"]
        or not isinstance(counts, dict) or not 1 <= len(counts) <= 128
        or any(not isinstance(k, str) or not k or type(v) is not int or v < 1 for k, v in counts.items())
        or not set(counts).issubset(SUPPLIER_DOMAINS)
        or sum(counts.values()) != summary["accepted_records"]
        or summary.get("availability_basis") != "supplier_catalog_snapshot"
    ):
        raise StockIndexError("Commercial stock metadata is inconsistent")


def compile_stock_index(
    rows: Iterable[dict],
    *,
    output: Path,
    source_id: str,
    source_sha256: str,
    publication_guard=None,
) -> dict:
    """Stream a catalog into a new immutable snapshot, never overwrite live stock."""
    output = Path(output)
    if not source_id.strip() or not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
        raise ValueError("A source ID and SHA-256 are required")
    if output.exists():
        raise FileExistsError("Stock snapshots are immutable; choose a new output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.with_name(output.name + ".building")
    if staging.exists():
        raise FileExistsError("A stock import is already staged at this path")
    staging.touch(exist_ok=False)
    accepted = rejected = duplicates = 0
    try:
        with closing(sqlite3.connect(staging)) as connection:
            connection.executescript("""
                PRAGMA journal_mode = DELETE;
                PRAGMA synchronous = FULL;
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE evidence (
                    smiles TEXT NOT NULL, source TEXT NOT NULL, catalog_id TEXT NOT NULL,
                    url TEXT NOT NULL, cas TEXT, ppg REAL, lead_time TEXT NOT NULL,
                    reason TEXT NOT NULL, PRIMARY KEY(smiles, source, catalog_id)
                ) WITHOUT ROWID;
            """)
            for index, row in enumerate(rows, 1):
                record = supplier_record(row)
                if record is None:
                    rejected += 1
                    continue
                cursor = connection.execute(
                    "INSERT OR IGNORE INTO evidence VALUES (:smiles,:source,:catalog_id,:url,:cas,:ppg,:lead_time,:reason)",
                    record,
                )
                if cursor.rowcount:
                    accepted += 1
                else:
                    stored = connection.execute(
                        "SELECT url,cas,ppg,lead_time FROM evidence "
                        "WHERE smiles=:smiles AND source=:source AND catalog_id=:catalog_id", record,
                    ).fetchone()
                    if stored != tuple(record[key] for key in ("url", "cas", "ppg", "lead_time")):
                        raise StockIndexError("Conflicting catalog records require an explicitly resolved source")
                    duplicates += 1
                if index % 10_000 == 0:
                    connection.commit()
            if not accepted:
                raise StockIndexError("No exact supplier-catalog evidence was accepted")
            connection.execute(
                "CREATE INDEX evidence_price ON evidence(smiles, ppg IS NULL, ppg, source, catalog_id)"
            )
            counts = dict(
                connection.execute(
                    "SELECT source, COUNT(*) FROM evidence GROUP BY source"
                )
            )
            summary = {
                "schema_version": SCHEMA_VERSION,
                "source_id": source_id,
                "source_sha256": source_sha256,
                "accepted_records": accepted,
                "rejected_records": rejected,
                "duplicate_records": duplicates,
                "source_counts": counts,
                "unique_structures": connection.execute(
                    "SELECT COUNT(DISTINCT smiles) FROM evidence"
                ).fetchone()[0],
                "availability_basis": "supplier_catalog_snapshot",
            }
            connection.executemany(
                "INSERT INTO metadata VALUES (?,?)",
                [
                    (key, json.dumps(value, ensure_ascii=False))
                    for key, value in summary.items()
                ],
            )
            connection.commit()
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise StockIndexError("Stock index integrity check failed")
        os.chmod(staging, 0o444)
        if publication_guard is not None:
            publication_guard()
        os.link(staging, output)
        staging.unlink()
        return summary
    except BaseException:
        # The staging file is this importer's output, never a live snapshot.
        staging.unlink(missing_ok=True)
        raise
