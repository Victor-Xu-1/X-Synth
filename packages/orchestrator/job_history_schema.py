"""Jobs schema 2 and bounded progress projection; operations live in docs/operations.md."""

from __future__ import annotations

import json
import math

__all__ = [
    "ARCHIVABLE_STATES",
    "LEGACY_STATES",
    "MAX_OFFSET",
    "PROGRESS_FIELDS",
    "TERMINAL_STATES",
    "HistorySchemaError",
    "initialize_schema",
    "progress_projection",
]


class HistorySchemaError(RuntimeError):
    """The stored schema or legacy records cannot be safely migrated."""


TERMINAL_STATES = frozenset(
    {
        "completed",
        "failed_unclosed",
        "failed",
        "cancelled",
        "completed_not_enough_routes",
    }
)
LEGACY_STATES = frozenset({"legacy_completed", "legacy_incomplete"})
ARCHIVABLE_STATES = TERMINAL_STATES | LEGACY_STATES
MAX_OFFSET = 2**63 - 1
PROGRESS_FIELDS = frozenset(
    {
        "phase",
        "status",
        "elapsed",
        "elapsed_seconds",
        "time",
        "search_time",
        "nodes",
        "edges",
        "iterations",
        "paths",
        "routes",
        "expanded",
        "num_nodes",
        "num_edges",
        "num_paths",
        "chemicals",
        "reactions",
        "num_chemicals",
        "num_reactions",
        "percent",
    }
)


def _progress_value(value):
    if type(value) is int:
        return -MAX_OFFSET - 1 <= value <= MAX_OFFSET
    if type(value) is float:
        return math.isfinite(value)
    return isinstance(value, str) and len(value) <= 256


def progress_projection(checkpoint: dict) -> dict:
    """Bounded display counters only, never search graphs or asset identities."""
    projection = {}
    if type(checkpoint.get("pass_number")) is int and _progress_value(
        checkpoint["pass_number"]
    ):
        projection["pass_number"] = checkpoint["pass_number"]
    completed = checkpoint.get("completed_searches")
    if isinstance(completed, list):
        projection["completed_searches"] = [
            item for item in completed[:4] if isinstance(item, str) and len(item) <= 32
        ]
    native = checkpoint.get("native_progress")
    if isinstance(native, dict):
        projection["native_progress"] = {}
        for strategy in ("mcts", "retro_star"):
            values = native.get(strategy)
            if not isinstance(values, dict):
                continue
            projection["native_progress"][strategy] = {
                key: values[key]
                for key in sorted(PROGRESS_FIELDS)
                if key in values and _progress_value(values[key])
            }
    return projection


def _schema_versions(connection):
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if not exists:
        return None
    versions = [
        row[0] for row in connection.execute("SELECT version FROM schema_version")
    ]
    if versions not in ([1], [2]):
        raise HistorySchemaError("Unsupported product job database schema")
    return versions


def initialize_schema(connection):
    _schema_versions(
        connection
    )  # Refuse future schemas before changing even journal mode.
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("BEGIN IMMEDIATE")
    try:
        versions = _schema_versions(connection)
        if versions == [2]:
            connection.commit()
            return
        for statement in (
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)",
            """CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
                request TEXT NOT NULL, request_key TEXT, revision INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL, modified TEXT NOT NULL, summary TEXT,
                checkpoint TEXT NOT NULL DEFAULT '{}', error_code TEXT,
                UNIQUE(owner, request_key)
            )""",
            "CREATE INDEX IF NOT EXISTS jobs_owner_modified ON jobs(owner, modified DESC)",
            "CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created)",
            """CREATE TABLE IF NOT EXISTS events (
                job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL,
                at TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(job_id,revision)
            )""",
        ):
            connection.execute(statement)
        if versions is None:
            connection.execute("INSERT INTO schema_version VALUES (1)")
        _upgrade_history(connection)
        connection.execute("UPDATE schema_version SET version=2 WHERE version=1")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _upgrade_history(connection):
    connection.execute("""CREATE TABLE job_groups (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        UNIQUE(owner, name)
    )""")
    for definition in (
        "history_title TEXT",
        "group_id TEXT REFERENCES job_groups(id)",
        "history_revision INTEGER NOT NULL DEFAULT 0 CHECK(history_revision >= 0)",
        "archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))",
        "history_progress TEXT NOT NULL DEFAULT '{}'",
    ):
        connection.execute("ALTER TABLE jobs ADD COLUMN " + definition)
    for row in connection.execute("SELECT id,status,revision,checkpoint FROM jobs"):
        status, archived = row["status"], row["status"] == "archived"
        if archived:
            previous = connection.execute(
                """SELECT status FROM events WHERE job_id=? AND revision<=?
                   AND status!='archived' ORDER BY revision DESC LIMIT 1""",
                (row["id"], row["revision"]),
            ).fetchone()
            if previous is None or previous["status"] not in ARCHIVABLE_STATES:
                raise HistorySchemaError(
                    "Cannot recover legacy archive status from terminal events"
                )
            status = previous["status"]
        try:
            checkpoint = json.loads(row["checkpoint"])
        except json.JSONDecodeError as exc:
            raise HistorySchemaError("Invalid legacy job checkpoint") from exc
        if not isinstance(checkpoint, dict):
            raise HistorySchemaError("Invalid legacy job checkpoint")
        connection.execute(
            "UPDATE jobs SET status=?,archived=?,history_progress=? WHERE id=?",
            (status, archived, json.dumps(progress_projection(checkpoint)), row["id"]),
        )
    connection.execute(
        "CREATE INDEX jobs_history_page ON jobs(owner,archived,modified DESC,id DESC)"
    )
    connection.execute(
        "CREATE INDEX jobs_history_group ON jobs(owner,group_id,archived,modified DESC,id DESC)"
    )
