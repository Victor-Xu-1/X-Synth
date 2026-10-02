from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ACTIVE_STATES = frozenset({"preparing", "searching", "evaluating"})
TERMINAL_STATES = frozenset(
    {
        "completed",
        "failed_unclosed",
        "failed",
        "cancelled",
        "completed_not_enough_routes",
    }
)
TRANSITIONS = {
    "queued": {"preparing", "cancelled"},
    "preparing": {"searching", "waiting_for_engine", "failed", "cancelled"},
    "searching": {"evaluating", "waiting_for_engine", "failed", "cancelled"},
    "evaluating": {
        "searching",
        "waiting_for_engine",
        "completed",
        "completed_not_enough_routes",
        "failed_unclosed",
        "failed",
        "cancelled",
    },
    "waiting_for_engine": {"queued", "cancelled"},
}


class JobConflict(RuntimeError):
    pass


def now_utc() -> str:
    return datetime.now(UTC).isoformat()


class JobRepository:
    """One transactional authority for product jobs; native task IDs are children."""

    def __init__(self, path: Path | str):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            existing = connection.execute(
                "SELECT name FROM sqlite_master WHERE name='schema_version'"
            ).fetchone()
            if existing and [
                row[0]
                for row in connection.execute("SELECT version FROM schema_version")
            ] != [1]:
                raise RuntimeError("Unsupported product job database schema")
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
                INSERT OR IGNORE INTO schema_version VALUES (1);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
                    request TEXT NOT NULL, request_key TEXT, revision INTEGER NOT NULL DEFAULT 0,
                    created TEXT NOT NULL, modified TEXT NOT NULL, summary TEXT,
                    checkpoint TEXT NOT NULL DEFAULT '{}', error_code TEXT,
                    UNIQUE(owner, request_key)
                );
                CREATE INDEX IF NOT EXISTS jobs_owner_modified ON jobs(owner, modified DESC);
                CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created);
                CREATE TABLE IF NOT EXISTS events (
                    job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL,
                    at TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(job_id,revision)
                );
            """)
            versions = [
                row[0]
                for row in connection.execute("SELECT version FROM schema_version")
            ]
            if versions != [1]:
                raise RuntimeError("Unsupported product job database schema")
            connection.commit()

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        return closing(connection)

    @staticmethod
    def _decode(row):
        if row is None:
            return None
        result = dict(row)
        for key in ("request", "summary", "checkpoint"):
            result[key] = json.loads(result[key]) if result[key] is not None else None
        return result

    def create(
        self,
        owner: str,
        request: dict,
        *,
        request_key: str | None = None,
        queue_limit: int = 64,
    ):
        if not owner or not 1 <= queue_limit <= 10000:
            raise ValueError("A task owner and bounded queue are required")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if request_key:
                existing = connection.execute(
                    "SELECT * FROM jobs WHERE owner=? AND request_key=?",
                    (owner, request_key),
                ).fetchone()
                if existing:
                    job = self._decode(existing)
                    if job["request"] != request:
                        raise JobConflict(
                            "An idempotency key cannot identify different input"
                        )
                    return job
            pending = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE status='queued'"
            ).fetchone()[0]
            if pending >= queue_limit:
                raise JobConflict("The task queue is full")
            job_id, timestamp = uuid4().hex, now_utc()
            connection.execute(
                "INSERT INTO jobs(id,owner,status,request,request_key,created,modified) VALUES (?,?,?,?,?,?,?)",
                (
                    job_id,
                    owner,
                    "queued",
                    json.dumps(request, ensure_ascii=False),
                    request_key,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                "INSERT INTO events VALUES (?,?,?,?)", (job_id, 0, timestamp, "queued")
            )
            connection.commit()
        return self.get(job_id, owner=owner)

    def get(self, job_id: str, *, owner: str | None = None):
        with self.connect() as connection:
            query, values = "SELECT * FROM jobs WHERE id=?", [job_id]
            if owner is not None:
                query += " AND owner=?"
                values.append(owner)
            return self._decode(connection.execute(query, values).fetchone())

    def list(self, owner: str, *, limit: int = 100, offset: int = 0):
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid job pagination")
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id,owner,status,request,request_key,revision,created,modified,summary,checkpoint,error_code FROM jobs WHERE owner=? AND status!='archived' ORDER BY modified DESC LIMIT ? OFFSET ?",
                (owner, limit, offset),
            )
            return [self._decode(row) for row in rows]

    def edit_history(
        self,
        job_id: str,
        *,
        owner: str,
        expected_revision: int | None = None,
        description: str | None = None,
        archive: bool = False,
    ):
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)
            ).fetchone()
            if row is None:
                raise KeyError("Task does not exist")
            if row["status"] == "archived" and archive:
                return self._decode(row)
            if row["status"] not in TERMINAL_STATES | {
                "legacy_completed",
                "legacy_incomplete",
            }:
                raise JobConflict("Only finished tasks can be edited or archived")
            if expected_revision is not None and expected_revision != row["revision"]:
                raise JobConflict("The job changed before this operation")
            request = json.loads(row["request"])
            if description is not None:
                request["description"] = description
            status = "archived" if archive else row["status"]
            revision, timestamp = row["revision"] + 1, now_utc()
            connection.execute(
                "UPDATE jobs SET status=?,request=?,revision=?,modified=? WHERE id=?",
                (
                    status,
                    json.dumps(request, ensure_ascii=False),
                    revision,
                    timestamp,
                    job_id,
                ),
            )
            connection.execute(
                "INSERT INTO events VALUES (?,?,?,?)",
                (job_id, revision, timestamp, status),
            )
            connection.commit()
        return self.get(job_id, owner=owner)

    def transition(
        self,
        job_id: str,
        status: str,
        *,
        expected_revision: int,
        summary=None,
        checkpoint=None,
        error_code=None,
    ):
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
            if row is None or row["revision"] != expected_revision:
                raise JobConflict("The job changed before this operation")
            if status not in TRANSITIONS.get(row["status"], set()) and not (
                status == row["status"] and status in ACTIVE_STATES
            ):
                raise JobConflict("Invalid job state transition")
            revision, timestamp = row["revision"] + 1, now_utc()
            connection.execute(
                "UPDATE jobs SET status=?,revision=?,modified=?,summary=?,checkpoint=?,error_code=? WHERE id=?",
                (
                    status,
                    revision,
                    timestamp,
                    json.dumps(summary, ensure_ascii=False)
                    if summary is not None
                    else row["summary"],
                    json.dumps(checkpoint, ensure_ascii=False)
                    if checkpoint is not None
                    else row["checkpoint"],
                    error_code,
                    job_id,
                ),
            )
            connection.execute(
                "INSERT INTO events VALUES (?,?,?,?)",
                (job_id, revision, timestamp, status),
            )
            connection.commit()
        return self.get(job_id)

    def claim_next(self, *, active_limit: int = 1):
        if not 1 <= active_limit <= 32:
            raise ValueError("Invalid active task budget")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('preparing','searching','evaluating')"
            ).fetchone()[0]
            if active >= active_limit:
                return None
            row = connection.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            timestamp, revision = now_utc(), row["revision"] + 1
            connection.execute(
                "UPDATE jobs SET status='preparing',revision=?,modified=? WHERE id=?",
                (revision, timestamp, row["id"]),
            )
            connection.execute(
                "INSERT INTO events VALUES (?,?,?,?)",
                (row["id"], revision, timestamp, "preparing"),
            )
            connection.commit()
        return self.get(row["id"])

    def recover_interrupted(self) -> int:
        """Call only while holding the sole worker lock; preserve all checkpoints."""
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT id,revision FROM jobs WHERE status IN ('preparing','searching','evaluating')"
            ).fetchall()
            timestamp = now_utc()
            for row in rows:
                revision = row["revision"] + 1
                connection.execute(
                    "UPDATE jobs SET status='waiting_for_engine',revision=?,modified=?,error_code='worker_restarted' WHERE id=?",
                    (revision, timestamp, row["id"]),
                )
                connection.execute(
                    "INSERT INTO events VALUES (?,?,?,?)",
                    (row["id"], revision, timestamp, "waiting_for_engine"),
                )
            connection.commit()
        return len(rows)

    def events(self, job_id: str):
        with self.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM events WHERE job_id=? ORDER BY revision", (job_id,)
                )
            ]

    def import_history(
        self,
        *,
        identifier: str,
        owner: str,
        request: dict,
        summary: dict,
        created: str,
        modified: str,
        completed: bool,
    ) -> bool:
        """Non-destructive, idempotent import. Imported tasks can never enter the queue."""
        status = "legacy_completed" if completed else "legacy_incomplete"
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "INSERT OR IGNORE INTO jobs(id,owner,status,request,created,modified,summary) VALUES (?,?,?,?,?,?,?)",
                (
                    identifier,
                    owner,
                    status,
                    json.dumps(request, ensure_ascii=False),
                    created,
                    modified,
                    json.dumps(summary, ensure_ascii=False),
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                connection.execute(
                    "INSERT INTO events VALUES (?,?,?,?)",
                    (identifier, 0, modified, status),
                )
            connection.commit()
        return inserted

    def count(self, owner: str) -> int:
        with self.connect() as connection:
            return connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE owner=? AND status!='archived'",
                (owner,),
            ).fetchone()[0]
