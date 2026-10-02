from __future__ import annotations

import json
import math
import re
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

from packages.platform.asset_identity import content_digest
from packages.platform.performance import PerformanceBudget

from .commercial_stock import (
    CommercialStockRegistry,
    EvidenceDecision,
    canonicalize_smiles,
)

SCHEMA_VERSION = 1
SUPPLIER_DOMAINS = {
    "mcule": ("mcule.com",),
    "chembridge": ("chembridge.com", "hit2lead.com"),
    "chemspace": ("chem-space.com", "chemspace.com"),
    "aladdin": ("aladdin-e.com", "aladdin-e.com.cn"),
    "ambeed": ("ambeed.com",),
    "chemscene": ("chemscene.com", "chemscene.cn"),
    "combi_blocks": ("combi-blocks.com",),
    "sigma_aldrich": ("sigmaaldrich.com",),
    "targetmol": ("targetmol.com", "targetmol.cn"),
}
SUPPLIER_ALIASES = {"MC": "mcule", "CB": "chembridge", "CS": "chemspace"}


class StockIndexError(RuntimeError):
    """A missing or damaged stock index is not an empty supplier catalog."""


def supplier_record(row: dict) -> dict | None:
    source = str(row.get("source") or "").strip()
    source = SUPPLIER_ALIASES.get(source, source.lower())
    properties = row.get("properties") or []
    url = row.get("url") or next(
        (
            item.get("link")
            for item in properties
            if isinstance(item, dict) and item.get("link")
        ),
        "",
    )
    if source not in SUPPLIER_DOMAINS or not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    domains = SUPPLIER_DOMAINS[source]
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.query
        or not any(host == domain or host.endswith("." + domain) for domain in domains)
        or parsed.path in {"", "/"}
    ):
        return None
    if parsed.path.rstrip("/").rsplit("/", 1)[-1].lower() in {
        "search",
        "catalog",
        "products",
        "product",
        "login",
        "about",
        "contact",
        "home",
    }:
        return None
    if source == "mcule" and not re.fullmatch(r"/MCULE-[0-9]+/?", parsed.path):
        return None
    if source == "chemspace" and not re.fullmatch(r"/CS[A-Za-z]*[0-9]+/?", parsed.path):
        return None
    if (
        source == "chembridge"
        and host.endswith("hit2lead.com")
        and not re.fullmatch(
            r"/(?:building-blocks|screening-compounds)/[0-9]+/?", parsed.path
        )
    ):
        return None
    catalog_id = row.get("catalog_id") or parsed.path.rstrip("/").rsplit("/", 1)[-1]
    if not isinstance(catalog_id, str) or not catalog_id.strip():
        return None
    if (
        source in {"mcule", "chemspace", "chembridge"}
        and catalog_id.strip() != parsed.path.rstrip("/").rsplit("/", 1)[-1]
    ):
        return None
    smiles = canonicalize_smiles(str(row.get("smiles") or ""))
    if not smiles:
        return None
    price = row.get("ppg")
    try:
        price = float(price) if price is not None else None
    except (TypeError, ValueError):
        price = None
    if price is not None and (not math.isfinite(price) or price <= 0):
        price = None
    return {
        "smiles": smiles,
        "source": source,
        "catalog_id": catalog_id.strip(),
        "url": url,
        "cas": row.get("cas") or None,
        "ppg": price,
        "lead_time": str(row.get("lead_time") or ""),
        "reason": "Exact ASKCOS supplier-catalog structure; availability refers to this snapshot",
    }


def compile_stock_index(
    rows: Iterable[dict],
    *,
    output: Path,
    source_id: str,
    source_sha256: str,
) -> dict:
    """Stream a catalog into a new immutable snapshot, never overwrite live stock."""
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
                    duplicates += 1
                if index % 10_000 == 0:
                    connection.commit()
            if not accepted:
                raise StockIndexError("No exact supplier-catalog evidence was accepted")
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
        staging.replace(output)
        return summary
    except BaseException:
        # The staging file is this importer's output, never a live snapshot.
        staging.unlink(missing_ok=True)
        raise


class StockIndex:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise StockIndexError("Commercial stock index is missing")
        try:
            with self.connect() as connection:
                self.summary = {
                    key: json.loads(value)
                    for key, value in connection.execute(
                        "SELECT key,value FROM metadata"
                    )
                }
            if self.summary.get(
                "schema_version"
            ) != SCHEMA_VERSION or not self.summary.get("accepted_records"):
                raise StockIndexError("Unsupported or empty commercial stock index")
            self.summary["catalog_sha256"] = content_digest(self.path)
        except (sqlite3.Error, json.JSONDecodeError) as exc:
            raise StockIndexError("Commercial stock index is invalid") from exc

    def connect(self):
        return closing(
            sqlite3.connect(self.path.as_uri() + "?mode=ro&immutable=1", uri=True)
        )

    def lookup(self, smiles: str, *, limit: int = 100) -> list[dict]:
        if not 1 <= limit <= 100:
            raise ValueError("Stock lookup limit must be between 1 and 100")
        canonical = canonicalize_smiles(smiles)
        if not canonical:
            return []
        try:
            with self.connect() as connection:
                connection.row_factory = sqlite3.Row
                return [
                    dict(row)
                    for row in connection.execute(
                        "SELECT * FROM evidence WHERE smiles=? ORDER BY ppg IS NULL,ppg,source,catalog_id LIMIT ?",
                        (canonical, limit),
                    )
                ]
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock lookup failed") from exc

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
        keys = list(
            dict.fromkeys(canonicalize_smiles(smiles) for smiles in smiles_list)
        )
        keys = [key for key in keys if key]
        if len(keys) > 5000:
            raise ValueError("A stock batch may contain at most 5000 structures")
        result = {key: [] for key in keys}
        try:
            with self.connect() as connection:
                connection.row_factory = sqlite3.Row
                batch_size = PerformanceBudget.from_environment().stock_batch_size
                for start in range(0, len(keys), batch_size):
                    chunk = keys[start : start + batch_size]
                    placeholders = ",".join("?" for _ in chunk)
                    for row in connection.execute(
                        f"SELECT * FROM evidence WHERE smiles IN ({placeholders}) ORDER BY ppg IS NULL,ppg,source,catalog_id",
                        chunk,
                    ):
                        if len(result[row["smiles"]]) < 100:
                            result[row["smiles"]].append(dict(row))
        except sqlite3.Error as exc:
            raise StockIndexError("Commercial stock batch lookup failed") from exc
        return result


class IndexedCommercialStockRegistry(CommercialStockRegistry):
    def __init__(self, index: StockIndex) -> None:
        super().__init__([], canonicalize_decisions=False)
        self.index = index
        self._lookup_cache = {}

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
        smiles = canonicalize_smiles(smiles)
        if not smiles:
            return []
        if smiles not in self._lookup_cache:
            self.prefetch([smiles])
        return self._lookup_cache[smiles]

    def prefetch(self, smiles):
        values = [
            value
            for value in dict.fromkeys(canonicalize_smiles(item) for item in smiles)
            if value and value not in self._lookup_cache
        ]
        for offset in range(0, len(values), 500):
            batch = self.index.lookup_many(values[offset : offset + 500])
            self._lookup_cache.update(
                {
                    key: [self._decision(record) for record in records]
                    for key, records in batch.items()
                }
            )

    def accepted_decision_count(self, *, limit: int | None = None) -> int:
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
