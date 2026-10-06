from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from copy import deepcopy

from packages.platform.asset_identity import content_digest
from packages.platform.immutable_sqlite import ImmutableSQLite
from packages.platform.performance import PerformanceBudget
from .commercial_stock import CommercialStockRegistry, EvidenceDecision, canonicalize_smiles
from .stock_snapshot import StockIndexError, compile_stock_index, validate_stock_schema, validate_stock_summary
from .supplier_evidence import SCHEMA_VERSION, SUPPLIER_DOMAINS, SUPPLIER_ALIASES, supplier_record
from .catalog_pricing import price_value

__all__ = [
    "StockIndex", "IndexedCommercialStockRegistry", "StockIndexError",
    "compile_stock_index", "supplier_record", "SCHEMA_VERSION",
    "SUPPLIER_DOMAINS", "SUPPLIER_ALIASES",
]

LOOKUP_SQL = (
    "SELECT * FROM evidence WHERE smiles=? "
    "ORDER BY ppg IS NULL,ppg,source,catalog_id LIMIT ?"
)
LEGACY_FANOUT_ROWS = 1000


class StockIndex:
    def __init__(self, path: Path | str) -> None:
        try:
            self._snapshot = ImmutableSQLite(path)
            self.path = self._snapshot.path
            with self.connect() as connection:
                validate_stock_schema(connection)
                plan = connection.execute(
                    "EXPLAIN QUERY PLAN " + LOOKUP_SQL, ("", 1)
                ).fetchall()
                self._ordered_lookup = not any("TEMP B-TREE" in row[3] for row in plan)
                self._summary = {
                    key: json.loads(value)
                    for key, value in connection.execute(
                        "SELECT key,substr(value,1,65537) FROM metadata LIMIT 64"
                    )
                }
            validate_stock_summary(self._summary)
            self._summary["catalog_sha256"] = content_digest(self.path)
            self.check_snapshot()
        except (sqlite3.Error, OSError, ValueError) as exc:
            raise StockIndexError("Commercial stock index is invalid") from exc

    def check_snapshot(self):
        self.assert_current()

    def assert_current(self, *, catalog_sha256=None, source_sha256=None):
        """Assert pinned identity and optional task digests without rehashing."""
        try:
            self._snapshot.check()
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock snapshot changed or is invalid") from exc
        for key, expected in (
            ("catalog_sha256", catalog_sha256), ("source_sha256", source_sha256),
        ):
            if expected is not None and self._summary.get(key) != expected:
                raise StockIndexError("Commercial stock does not match the bound task snapshot")
        try:
            self._snapshot.check()
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock snapshot changed or is invalid") from exc

    @property
    def summary(self):
        self.check_snapshot()
        result = deepcopy(self._summary)
        self.check_snapshot()
        return result

    @contextmanager
    def connect(self):
        try:
            with self._snapshot.connect() as connection:
                yield connection
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock snapshot is invalid") from exc

    def lookup(self, smiles: str, *, limit: int = 100) -> list[dict]:
        self.assert_current()
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Stock lookup limit must be between 1 and 100")
        canonical = canonicalize_smiles(smiles)
        if not canonical:
            self.assert_current()
            return []
        try:
            with self.connect() as connection:
                connection.row_factory = sqlite3.Row
                return self._lookup_records(connection, canonical, limit)
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock lookup failed") from exc

    def _lookup_records(self, connection, smiles, limit):
        if self._ordered_lookup:
            return [dict(row) for row in connection.execute(LOOKUP_SQL, (smiles, limit))]
        rows = [dict(row) for row in connection.execute(
            "SELECT * FROM evidence WHERE smiles=? LIMIT ?", (smiles, LEGACY_FANOUT_ROWS + 1)
        )]
        if len(rows) > LEGACY_FANOUT_ROWS:
            raise StockIndexError("Legacy catalog fan-out exceeds the read budget; compile a new indexed snapshot")

        def order(record):
            price, _ = price_value(record["ppg"])
            return price is None, price or 0, record["source"], record["catalog_id"]

        return sorted(rows, key=order)[:limit]

    def iter_records(self, *, limit: int | None = None) -> Iterator[dict]:
        if limit is not None and limit < 1:
            return
        with self.connect() as connection:
            connection.row_factory = sqlite3.Row
            cursor = connection.execute(
                "SELECT * FROM evidence LIMIT ?", (-1 if limit is None else limit,)
            )
            for row in cursor:
                yield dict(row)

    def lookup_many(self, smiles_list: Iterable[str]) -> dict[str, list[dict]]:
        self.assert_current()
        keys = {}
        for number, smiles in enumerate(smiles_list, 1):
            if number > 5000:
                raise ValueError("A stock batch may contain at most 5000 structures")
            canonical = canonicalize_smiles(smiles)
            if canonical:
                keys[canonical] = None
        keys = list(keys)
        result = {key: [] for key in keys}
        try:
            with self.connect() as connection:
                connection.row_factory = sqlite3.Row
                batch_size = PerformanceBudget.from_environment().stock_batch_size
                for start in range(0, len(keys), batch_size):
                    chunk = keys[start : start + batch_size]
                    for key in chunk:
                        result[key] = self._lookup_records(connection, key, 100)
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock batch lookup failed") from exc
        return result


class IndexedCommercialStockRegistry(CommercialStockRegistry):
    def __init__(self, index: StockIndex) -> None:
        super().__init__([], canonicalize_decisions=False)
        self.index = index
        self._lookup_cache = {}
        self._cache_lock = RLock()

    @staticmethod
    def _decision(record: dict) -> EvidenceDecision:
        return EvidenceDecision(
            **{
                key: record[key]
                for key in ("smiles", "source", "reason", "catalog_id", "cas", "url")
            },
            decision="accepted",
        )

    @property
    def decisions(self) -> list[EvidenceDecision]:
        return [self._decision(record) for record in self.index.iter_records()]

    def decisions_for(self, smiles: str) -> list[EvidenceDecision]:
        self.index.check_snapshot()
        smiles = canonicalize_smiles(smiles)
        if not smiles:
            self.index.assert_current()
            return []
        with self._cache_lock:
            missing = smiles not in self._lookup_cache
        if missing:
            self.prefetch([smiles])
        with self._cache_lock:
            result = list(self._lookup_cache[smiles])
        self.index.check_snapshot()
        return result

    def prefetch(self, smiles):
        self.index.check_snapshot()
        with self._cache_lock:
            values = [
                value for value in dict.fromkeys(canonicalize_smiles(item) for item in smiles)
                if value and value not in self._lookup_cache
            ]
        for offset in range(0, len(values), 500):
            batch = self.index.lookup_many(values[offset:offset + 500])
            with self._cache_lock:
                self.index.check_snapshot()
                self._lookup_cache.update({
                    key: [self._decision(record) for record in records]
                    for key, records in batch.items()
                })
        self.index.check_snapshot()

    def accepted_decision_count(self, *, limit: int | None = None) -> int:
        self.index.check_snapshot()
        count = self.index.summary["accepted_records"]
        return min(count, limit) if limit is not None else count

    def accepted_smiles(self, *, limit: int | None = None) -> list[str]:
        with self.index.connect() as connection:
            return [
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT smiles FROM evidence LIMIT ?",
                    (-1 if limit is None else limit,),
                )
            ]
