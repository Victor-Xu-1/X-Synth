"""Real temporary SQLite files and filesystem faults; no provider simulation."""

import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest

from packages.platform.immutable_sqlite import (
    ImmutableSQLite, ImmutableSQLiteError, validate_index, validate_table,
)


def database(path):
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("CREATE TABLE entries(id TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("INSERT INTO entries VALUES ('key','record')")
        connection.commit()
    return path


def test_read_only_connection_closes_and_is_thread_local(tmp_path):
    snapshot = ImmutableSQLite(database(tmp_path / "snapshot.sqlite"))

    def read(_):
        with snapshot.connect() as connection:
            return connection.execute("SELECT value FROM entries WHERE id='key'").fetchone()[0]

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(read, range(16))) == ["record"] * 16
    with snapshot.connect() as connection:
        validate_table(connection, "entries", (("id", "TEXT", 1), ("value", "TEXT", 0)))
        validate_index(connection, "entries", ("id",))
        with pytest.raises(sqlite3.Error, match="readonly"):
            connection.execute("DELETE FROM entries")
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
def test_sidecars_rejected_at_initialization_and_cache_check(tmp_path, suffix):
    path = database(tmp_path / "snapshot.sqlite")
    snapshot = ImmutableSQLite(path)
    sidecar = path.with_name(path.name + suffix)
    sidecar.write_bytes(b"filesystem-fault-control")
    with pytest.raises(ImmutableSQLiteError, match="sidecars"):
        snapshot.check()
    with pytest.raises(ImmutableSQLiteError, match="sidecars"):
        ImmutableSQLite(path)


def test_same_size_mtime_replacement_is_rejected_before_and_after_query(tmp_path):
    path = database(tmp_path / "snapshot.sqlite")
    snapshot = ImmutableSQLite(path)
    replacement = database(tmp_path / "replacement.sqlite")
    before = path.stat()
    assert replacement.stat().st_size == before.st_size
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    with pytest.raises(ImmutableSQLiteError, match="identity changed"):
        with snapshot.connect() as connection:
            assert connection.execute("SELECT count(*) FROM entries").fetchone() == (1,)
            replacement.replace(path)
    with pytest.raises(ImmutableSQLiteError):
        snapshot.check()


def test_missing_lookup_index_and_bad_columns_are_rejected(tmp_path):
    snapshot = ImmutableSQLite(database(tmp_path / "snapshot.sqlite"))
    with snapshot.connect() as connection:
        with pytest.raises(ImmutableSQLiteError, match="schema"):
            validate_table(connection, "entries", (("id", "INTEGER", 1),))
        with pytest.raises(ImmutableSQLiteError, match="index"):
            validate_index(connection, "entries", ("value",))


def test_query_execution_deadline_is_enforced(tmp_path):
    snapshot = ImmutableSQLite(database(tmp_path / "snapshot.sqlite"))
    with snapshot.connect(seconds=0) as connection:
        with pytest.raises(sqlite3.OperationalError, match="interrupted"):
            connection.execute(
                "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT sum(x) FROM n"
            ).fetchone()
