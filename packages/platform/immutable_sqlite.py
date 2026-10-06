"""Low-cost identity and schema checks for operator-installed SQLite snapshots."""

from __future__ import annotations

import sqlite3
import stat
from contextlib import closing, contextmanager
from pathlib import Path
from time import monotonic

FileIdentity = tuple[int, int, int, int, int]


class ImmutableSQLiteError(sqlite3.DatabaseError):
    """An unavailable or changed snapshot must not become an empty query result."""


def stat_identity(metadata) -> FileIdentity:
    return (
        metadata.st_dev, metadata.st_ino, metadata.st_size,
        metadata.st_mtime_ns, metadata.st_ctime_ns,
    )


def file_identity(path: Path) -> FileIdentity:
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size == 0:
        raise ValueError("Snapshots must be nonempty regular files")
    return stat_identity(metadata)


def validate_table(connection, table: str, columns: tuple) -> None:
    actual = tuple(
        (name, kind.upper(), primary_key, required)[:len(columns[0])]
        for _, name, kind, required, _, primary_key in connection.execute(
            f"PRAGMA table_info({table})"
        )
    )
    if actual != columns:
        raise ImmutableSQLiteError(f"Invalid snapshot table schema: {table}")


def validate_index(connection, table: str, columns: tuple[str, ...]) -> None:
    indexes = connection.execute(f"PRAGMA index_list({table})").fetchall()
    if len(indexes) > 32:
        raise ImmutableSQLiteError("Snapshot has too many indexes")
    for _, name, _, _, partial in indexes:
        if partial:
            continue
        # SQLite's quoted identifier syntax, not caller-controlled SQL.
        name = name.replace('"', '""')
        actual = tuple(
            row[2] for row in connection.execute(f'PRAGMA index_info("{name}")')
        )
        if actual[:len(columns)] == columns:
            return
    raise ImmutableSQLiteError(f"Missing snapshot lookup index: {table}{columns}")


class ImmutableSQLite:
    def __init__(self, path: str | Path):
        self.path = Path(path).absolute()
        try:
            self.identity = file_identity(self.path)
            self.check()
        except (OSError, ValueError) as exc:
            raise ImmutableSQLiteError("Snapshot is missing or invalid") from exc

    def check(self) -> None:
        try:
            if file_identity(self.path) != self.identity:
                raise ImmutableSQLiteError("Immutable snapshot identity changed")
            for path in {self.path, self.path.resolve()}:
                if any(Path(str(path) + suffix).exists() for suffix in (
                    "-wal", "-shm", "-journal"
                )):
                    raise ImmutableSQLiteError("Immutable snapshots cannot have SQLite sidecars")
        except (OSError, ValueError) as exc:
            raise ImmutableSQLiteError("Snapshot is missing or invalid") from exc

    @contextmanager
    def connect(self, *, seconds: float = 2.0):
        self.check()
        with closing(sqlite3.connect(
            self.path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=seconds
        )) as connection:
            connection.execute("PRAGMA query_only=ON")
            deadline = monotonic() + seconds
            connection.set_progress_handler(lambda: int(monotonic() > deadline), 1000)
            try:
                yield connection
            finally:
                self.check()
