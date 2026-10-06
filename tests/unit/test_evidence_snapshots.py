"""Exact catalog/ORD readers using only small locally compiled SQLite fixtures."""

import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager

import pytest

from packages.adapters.stock.stock_index import (
    IndexedCommercialStockRegistry, StockIndex, StockIndexError, compile_stock_index,
)
from packages.knowledge_base.reaction_library import ReactionLibrary, compile_reaction_library
from test_stock_index import catalog_row
from test_reaction_library import public_record, sources


def catalog(path, smiles="CCO"):
    compile_stock_index([catalog_row(smiles=smiles)], output=path,
                        source_id="catalog", source_sha256="a" * 64)
    return path


@contextmanager
def writable(path):
    path.chmod(0o644)
    with closing(sqlite3.connect(path)) as connection:
        yield connection
        connection.commit()


@pytest.mark.parametrize("cached", ["CCO", "CCN"])
def test_stock_cache_hits_and_misses_reject_atomic_replacement(tmp_path, cached):
    path = catalog(tmp_path / "catalog.sqlite")
    registry = IndexedCommercialStockRegistry(StockIndex(path))
    registry.decisions_for(cached)
    before = path.stat()
    other = catalog(tmp_path / "other.sqlite", "CCN")
    assert other.stat().st_size == before.st_size
    os.utime(other, ns=(before.st_atime_ns, before.st_mtime_ns))
    other.replace(path)
    with pytest.raises(StockIndexError):
        registry.decisions_for(cached)
    with pytest.raises(StockIndexError):
        registry.accepted_decision_count()


def test_stock_prefetch_cannot_publish_decisions_after_drift(tmp_path, monkeypatch):
    path = catalog(tmp_path / "catalog.sqlite")
    index = StockIndex(path)
    replacement = catalog(tmp_path / "other.sqlite", "CCN")
    original = index.lookup_many

    def changed(values):
        result = original(values)
        replacement.replace(path)
        return result

    monkeypatch.setattr(index, "lookup_many", changed)
    registry = IndexedCommercialStockRegistry(index)
    with pytest.raises(StockIndexError):
        registry.prefetch(["CCO"])
    assert registry._lookup_cache == {}


def test_assert_current_checks_task_digests_without_hashing_on_hits(tmp_path, monkeypatch):
    index = StockIndex(catalog(tmp_path / "catalog.sqlite"))
    bound = index.summary

    def forbidden(*args):
        raise AssertionError("Cached integrity checks must not hash file contents")

    monkeypatch.setattr("packages.adapters.stock.stock_index.content_digest", forbidden)
    for _ in range(12):
        index.assert_current(
            catalog_sha256=bound["catalog_sha256"], source_sha256=bound["source_sha256"],
        )
        assert index.lookup("CCO")
    for key in ("catalog_sha256", "source_sha256"):
        with pytest.raises(StockIndexError, match="bound task snapshot"):
            index.assert_current(**{key: "0" * 64})


def test_fresh_review_reader_must_match_the_search_bound_catalog(tmp_path):
    path = catalog(tmp_path / "catalog.sqlite")
    bound = StockIndex(path).summary
    other = catalog(tmp_path / "other.sqlite", "CCN")
    other.replace(path)
    fresh = StockIndex(path)
    assert fresh.summary["source_sha256"] == bound["source_sha256"]
    with pytest.raises(StockIndexError, match="bound task snapshot"):
        fresh.assert_current(
            catalog_sha256=bound["catalog_sha256"], source_sha256=bound["source_sha256"],
        )


def test_stock_batch_uses_one_connection_and_cache_copies_are_defensive(tmp_path, monkeypatch):
    index = StockIndex(catalog(tmp_path / "catalog.sqlite"))
    calls = []
    original = index.connect

    @contextmanager
    def measured():
        calls.append(1)
        with original() as connection:
            yield connection

    monkeypatch.setattr(index, "connect", measured)
    result = index.lookup_many(["CCO", "OCC", "CCN"] * 100)
    assert len(calls) == 1 and result["CCN"] == []
    registry = IndexedCommercialStockRegistry(index)
    first = registry.decisions_for("CCO")
    first.clear()
    assert registry.is_buyable("CCO")
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert all(pool.map(registry.is_buyable, ["CCO"] * 16))


@pytest.mark.parametrize("key,value", [
    ("source_sha256", "invalid"), ("source_id", ""), ("accepted_records", True),
    ("source_counts", {"mcule": 2}), ("unique_structures", 2),
])
def test_stock_required_metadata_is_validated_without_row_scans(tmp_path, key, value):
    path = catalog(tmp_path / "catalog.sqlite")
    with writable(path) as connection:
        connection.execute("UPDATE metadata SET value=? WHERE key=?", (json.dumps(value), key))
    with pytest.raises(StockIndexError):
        StockIndex(path)


def test_metadata_only_database_cannot_be_stock(tmp_path):
    path = tmp_path / "invalid.sqlite"
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        connection.executemany("INSERT INTO metadata VALUES (?,?)", [
            ("schema_version", "1"), ("accepted_records", "1"),
        ])
        connection.commit()
    with pytest.raises(StockIndexError):
        StockIndex(path)


def test_ordered_index_bounds_high_fanout_and_legacy_lookup_fails_explicitly(tmp_path):
    path = tmp_path / "catalog.sqlite"
    rows = [
        catalog_row(ppg=1002 - number, properties=[{
            "link": f"https://mcule.com/MCULE-{number + 100}"
        }])
        for number in range(1001)
    ]
    compile_stock_index(rows, output=path, source_id="fanout-control", source_sha256="a" * 64)
    index = StockIndex(path)
    assert index._ordered_lookup
    assert len(index.lookup_many(["CCO"])["CCO"]) == 100
    assert index.lookup("CCO", limit=1)[0]["ppg"] == 2
    with writable(path) as connection:
        connection.execute("DROP INDEX evidence_price")
    legacy = StockIndex(path)
    assert not legacy._ordered_lookup
    with pytest.raises(StockIndexError, match="fan-out"):
        legacy.lookup_many(["CCO"])


def test_small_legacy_catalog_preserves_exact_price_order_and_summary_copy(tmp_path):
    path = catalog(tmp_path / "catalog.sqlite")
    with writable(path) as connection:
        connection.execute("DROP INDEX evidence_price")
    index = StockIndex(path)
    index.summary["source_counts"].clear()
    assert index.summary["source_counts"] == {"mcule": 1}
    assert index.lookup("OCC")[0]["ppg"] == 5.16


def test_stock_compiler_cannot_replace_a_destination_created_during_build(tmp_path):
    path = tmp_path / "catalog.sqlite"

    def rows():
        yield catalog_row()
        path.write_bytes(b"concurrent-owner-output")

    with pytest.raises(FileExistsError):
        compile_stock_index(rows(), output=path, source_id="catalog", source_sha256="a" * 64)
    assert path.read_bytes() == b"concurrent-owner-output"
    assert not path.with_name(path.name + ".building").exists()


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
def test_stock_and_ord_readiness_reject_sidecars(tmp_path, suffix):
    path = catalog(tmp_path / "catalog.sqlite")
    path.with_name(path.name + suffix).write_bytes(b"sidecar-control")
    with pytest.raises(StockIndexError):
        StockIndex(path)
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    library = ReactionLibrary(path)
    path.with_name(path.name + suffix).write_bytes(b"sidecar-control")
    assert not library.status().ready
    assert not ReactionLibrary(path).status().ready


@pytest.mark.parametrize("mutation", ["index", "snapshot", "source", "counts"])
def test_ord_invalid_schema_or_identity_never_reports_ready(tmp_path, mutation):
    record, path = public_record(), tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    with writable(path) as connection:
        if mutation == "index":
            connection.execute("DROP INDEX reaction_product")
        else:
            summary = json.loads(connection.execute(
                "SELECT value FROM metadata WHERE key='summary'"
            ).fetchone()[0])
            if mutation == "snapshot":
                summary["snapshot"] = "invalid"
            elif mutation == "source":
                summary["sources"][0]["sha256"] = "invalid"
            else:
                summary["yields_count"] = summary["record_count"] + 1
            connection.execute("UPDATE metadata SET value=? WHERE key='summary'", (json.dumps(summary),))
    assert ReactionLibrary(path).status().reason == "reaction_library_invalid"
