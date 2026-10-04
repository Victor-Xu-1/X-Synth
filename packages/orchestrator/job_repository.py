from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .job_history import (
    TERMINAL_STATES,
    JobConflict,
    JobHistory,
    history_casefold,
)
from .job_history_schema import initialize_schema, progress_projection

__all__ = [
    "ACTIVE_STATES",
    "TERMINAL_STATES",
    "TRANSITIONS",
    "JobConflict",
    "JobHistory",
    "JobRepository",
    "history_casefold",
    "initialize_schema",
    "now_utc",
    "progress_projection",
]

ACTIVE_STATES = frozenset({"preparing", "searching", "evaluating"})
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


def now_utc() -> str:
    return datetime.now(UTC).isoformat()


class JobRepository:
    """One transactional authority for product jobs; native task IDs are children."""

    def __init__(self, path: Path | str):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            initialize_schema(connection)
        self.history = JobHistory(self)

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        connection.create_function(
            "history_casefold", 1, history_casefold, deterministic=True
        )
        return closing(connection)

    @staticmethod
    def _decode(row):
        if row is None:
            return None
        result = dict(row)
        for key in ("request", "summary", "checkpoint"):
            result[key] = json.loads(result[key]) if result[key] is not None else None
        if "history_progress" in result:
            result["history_progress"] = json.loads(result["history_progress"])
        result["archived"] = bool(result.get("archived", False))
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
        return self.history_page(owner, limit=limit, offset=offset)["results"]

    def history_page(
        self,
        owner: str,
        *,
        limit: int = 24,
        offset: int = 0,
        query: str = "",
        status: str = "all",
        group: str = "all",
        archived: bool = False,
    ):
        return self.history.page(
            owner,
            limit=limit,
            offset=offset,
            query=query,
            status=status,
            group=group,
            archived=archived,
        )

    def list_groups(self, owner: str):
        return self.history.groups(owner)

    def create_group(self, owner: str, name: str):
        return self.history.create_group(owner, name)

    def update_group(
        self, owner: str, group_id: str, *, name: str, expected_revision: int
    ):
        return self.history.update_group(
            owner, group_id, name=name, expected_revision=expected_revision
        )

    def delete_group(self, owner: str, group_id: str, *, expected_revision: int):
        return self.history.delete_group(
            owner, group_id, expected_revision=expected_revision
        )

    def batch_history(
        self, owner: str, *, action: str, items: list[dict], group_id: str | None = None
    ):
        return self.history.batch(owner, action=action, items=items, group_id=group_id)

    def edit_history(
        self,
        job_id: str,
        *,
        owner: str,
        expected_revision: int | None = None,
        expected_history_revision: int | None = None,
        description: str | None = None,
        archive: bool = False,
    ):
        return self.history.edit(
            job_id,
            owner=owner,
            expected_revision=expected_revision,
            expected_history_revision=expected_history_revision,
            description=description,
            archive=archive,
        )

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
                "UPDATE jobs SET status=?,revision=?,modified=?,summary=?,checkpoint=?,history_progress=?,error_code=? WHERE id=?",
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
                    json.dumps(progress_projection(checkpoint), ensure_ascii=False)
                    if checkpoint is not None
                    else row["history_progress"],
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
                "SELECT COUNT(*) FROM jobs WHERE owner=? AND archived=0",
                (owner,),
            ).fetchone()[0]
