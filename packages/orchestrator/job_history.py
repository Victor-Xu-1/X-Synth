"""Owned history metadata in the authoritative jobs SQLite database (schema 2)."""

from __future__ import annotations

import math
import sqlite3
from contextlib import contextmanager
from time import monotonic
from uuid import uuid4

from packages.platform.performance import PerformanceBudget

from .job_history_schema import (
    ARCHIVABLE_STATES,
    LEGACY_STATES,
    MAX_OFFSET,
    TERMINAL_STATES,
    initialize_schema,
    progress_projection,
)

__all__ = [
    "ARCHIVABLE_STATES",
    "HISTORY_ACTIVE_STATES",
    "HISTORY_COLUMNS",
    "LEGACY_STATES",
    "MAX_BATCH",
    "MAX_GROUP_NAME",
    "MAX_OFFSET",
    "MAX_QUERY",
    "MAX_TITLE",
    "TERMINAL_STATES",
    "HistoryQueryUnavailable",
    "JobConflict",
    "JobHistory",
    "history_casefold",
    "initialize_schema",
    "progress_projection",
]

HISTORY_ACTIVE_STATES = frozenset(
    {
        "queued",
        "preparing",
        "searching",
        "evaluating",
        "waiting_for_engine",
    }
)
MAX_GROUP_NAME = 128
MAX_TITLE = 256
MAX_QUERY = 20_000
MAX_BATCH = 100

HISTORY_COLUMNS = """
    id, owner, status,
    json_object('smiles', json_extract(request, '$.smiles'),
                'description', json_extract(request, '$.description')) AS request,
    revision, created, modified, summary, history_progress AS checkpoint,
    error_code, history_title, group_id, history_revision, archived
"""


class JobConflict(RuntimeError):
    pass


class HistoryQueryUnavailable(RuntimeError):
    code = "history_query_timeout"


def _check_deadline(deadline):
    if monotonic() >= deadline:
        raise HistoryQueryUnavailable("History query exceeded its time budget")


def history_casefold(value):
    return value.casefold() if isinstance(value, str) else ""


def _revision(value):
    if type(value) is not int or value < 0:
        raise ValueError("A nonnegative integer revision is required")


def _name(value, maximum):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise ValueError("A nonempty bounded name is required")
    return value.strip()


def _owner(owner):
    if not isinstance(owner, str) or not owner:
        raise ValueError("A task owner is required")


def _group(connection, owner, identifier):
    row = connection.execute(
        """SELECT g.id,g.name,g.revision,COUNT(j.id) AS count FROM job_groups g
           LEFT JOIN jobs j ON j.group_id=g.id AND j.owner=g.owner AND j.archived=0
           WHERE g.owner=? AND g.id=? GROUP BY g.id""",
        (owner, identifier),
    ).fetchone()
    if row is None:
        raise KeyError("Group does not exist")
    return dict(row)


def _groups(connection, owner):
    return [
        dict(row)
        for row in connection.execute(
            """SELECT g.id,g.name,g.revision,COUNT(j.id) AS count FROM job_groups g
               LEFT JOIN jobs j ON j.group_id=g.id AND j.owner=g.owner AND j.archived=0
               WHERE g.owner=? GROUP BY g.id ORDER BY g.name COLLATE NOCASE,g.id""",
            (owner,),
        )
    ]


def _group_write(connection, sql, values):
    try:
        connection.execute(sql, values)
    except sqlite3.IntegrityError as exc:
        if exc.sqlite_errorcode == sqlite3.SQLITE_CONSTRAINT_UNIQUE:
            raise JobConflict("A group with this name already exists") from exc
        raise


class JobHistory:
    """History operations borrow the job repository's connections, never a second DB."""

    def __init__(self, repository):
        self.repository = repository
        self.query_seconds = PerformanceBudget.from_environment().history_query_seconds
        if not math.isfinite(self.query_seconds) or self.query_seconds <= 0:
            raise ValueError("History query budget must be finite and positive")

    @contextmanager
    def _read_connection(self):
        deadline = monotonic() + self.query_seconds
        try:
            with self.repository.connect() as connection:
                try:
                    _check_deadline(deadline)
                    busy_ms = max(
                        0, int(min((deadline - monotonic()) * 1000, 2**31 - 1))
                    )
                    connection.execute(f"PRAGMA busy_timeout={busy_ms}")
                    connection.set_progress_handler(
                        lambda: int(monotonic() >= deadline), 1000
                    )
                    connection.execute("BEGIN")
                    yield connection
                    _check_deadline(deadline)
                finally:
                    connection.set_progress_handler(None, 0)
                    connection.rollback()
        except sqlite3.OperationalError as exc:
            code = getattr(exc, "sqlite_errorcode", None)
            if isinstance(code, int) and code & 255 in {
                sqlite3.SQLITE_INTERRUPT,
                sqlite3.SQLITE_BUSY,
                sqlite3.SQLITE_LOCKED,
            }:
                raise HistoryQueryUnavailable(
                    "History query was interrupted or could not acquire a database lock"
                ) from exc
            raise

    def page(
        self,
        owner,
        *,
        limit=24,
        offset=0,
        query="",
        status="all",
        group="all",
        archived=False,
    ):
        _owner(owner)
        if (
            type(limit) is not int
            or not 1 <= limit <= 100
            or type(offset) is not int
            or not 0 <= offset <= MAX_OFFSET
        ):
            raise ValueError("Invalid job pagination")
        if (
            not isinstance(query, str)
            or len(query) > MAX_QUERY
            or type(archived) is not bool
        ):
            raise ValueError("Invalid history filters")
        if not isinstance(
            status, str
        ) or status not in ARCHIVABLE_STATES | HISTORY_ACTIVE_STATES | {
            "all",
            "active",
        }:
            raise ValueError("Invalid job status filter")
        if not isinstance(group, str) or not 1 <= len(group) <= 128:
            raise ValueError("Invalid job group filter")
        where, values = ["owner=?", "archived=?"], [owner, archived]
        if query:
            title = "COALESCE(NULLIF(history_title,''),NULLIF(json_extract(request,'$.description'),''),json_extract(request,'$.smiles'))"
            where.append(
                f"""(instr(history_casefold({title}),?)>0
                OR instr(history_casefold(json_extract(request,'$.smiles')),?)>0
                OR instr(history_casefold(id),?)>0)"""
            )
            values.extend([query.casefold()] * 3)
        if status == "active":
            states = sorted(HISTORY_ACTIVE_STATES)
            where.append("status IN (" + ",".join("?" for _ in states) + ")")
            values.extend(states)
        elif status != "all":
            where.append("status=?")
            values.append(status)
        if group == "ungrouped":
            where.append("group_id IS NULL")
        elif group != "all":
            where.append("group_id=?")
            values.append(group)
        predicate = " AND ".join(where)
        with self._read_connection() as connection:
            if group not in {"all", "ungrouped"}:
                _group(connection, owner, group)
            counts = connection.execute(
                """SELECT COUNT(*) AS all_total,
                   COUNT(CASE WHEN group_id IS NULL THEN 1 END) AS ungrouped_total
                   FROM jobs WHERE owner=? AND archived=0""",
                (owner,),
            ).fetchone()
            total = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE " + predicate, values
            ).fetchone()[0]
            groups = _groups(connection, owner)
            rows = connection.execute(
                "SELECT "
                + HISTORY_COLUMNS
                + " FROM jobs WHERE "
                + predicate
                + " ORDER BY modified DESC,id DESC LIMIT ? OFFSET ?",
                [*values, limit, offset],
            ).fetchall()
            return {
                "results": [self.repository._decode(row) for row in rows],
                "total": total,
                **dict(counts),
                "groups": groups,
            }

    def groups(self, owner):
        _owner(owner)
        with self._read_connection() as connection:
            return _groups(connection, owner)

    def create_group(self, owner, name):
        _owner(owner)
        name = _name(name, MAX_GROUP_NAME)
        identifier = uuid4().hex
        with self.repository.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            _group_write(
                connection,
                "INSERT INTO job_groups(id,owner,name) VALUES (?,?,?)",
                (identifier, owner, name),
            )
            result = _group(connection, owner, identifier)
            connection.commit()
            return result

    def update_group(self, owner, identifier, *, name, expected_revision):
        _owner(owner)
        _revision(expected_revision)
        name = _name(name, MAX_GROUP_NAME)
        with self.repository.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if _group(connection, owner, identifier)["revision"] != expected_revision:
                raise JobConflict("The group changed before this operation")
            _group_write(
                connection,
                "UPDATE job_groups SET name=?,revision=revision+1 WHERE id=? AND owner=?",
                (name, identifier, owner),
            )
            result = _group(connection, owner, identifier)
            connection.commit()
            return result

    def delete_group(self, owner, identifier, *, expected_revision):
        _owner(owner)
        _revision(expected_revision)
        with self.repository.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if _group(connection, owner, identifier)["revision"] != expected_revision:
                raise JobConflict("The group changed before this operation")
            connection.execute(
                "UPDATE jobs SET group_id=NULL,history_revision=history_revision+1 WHERE owner=? AND group_id=?",
                (owner, identifier),
            )
            connection.execute(
                "DELETE FROM job_groups WHERE owner=? AND id=?", (owner, identifier)
            )
            connection.commit()

    def edit(
        self,
        job_id,
        *,
        owner,
        expected_revision=None,
        expected_history_revision=None,
        description=None,
        archive=False,
    ):
        _owner(owner)
        for revision in (expected_revision, expected_history_revision):
            if revision is not None:
                _revision(revision)
        if description is not None:
            description = _name(description, MAX_TITLE)
        if description is None and not archive:
            raise ValueError("A history change is required")
        with self.repository.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT id,status,revision,history_revision,archived FROM jobs WHERE id=? AND owner=?",
                (job_id, owner),
            ).fetchone()
            if row is None:
                raise KeyError("Task does not exist")
            if expected_revision is not None and row["revision"] != expected_revision:
                raise JobConflict("The job changed before this operation")
            if (
                expected_history_revision is not None
                and row["history_revision"] != expected_history_revision
            ):
                raise JobConflict("The history metadata changed before this operation")
            if archive and row["status"] not in ARCHIVABLE_STATES:
                raise JobConflict("Only finished tasks can be archived")
            if description is not None or archive and not row["archived"]:
                connection.execute(
                    """UPDATE jobs SET history_title=COALESCE(?,history_title),
                       archived=CASE WHEN ? THEN 1 ELSE archived END,
                       history_revision=history_revision+1 WHERE id=? AND owner=?""",
                    (description, archive, job_id, owner),
                )
            result = self.repository._decode(
                connection.execute(
                    "SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)
                ).fetchone()
            )
            connection.commit()
            return result

    def batch(self, owner, *, action, items, group_id=None):
        _owner(owner)
        identifiers = _batch_items(action, items, group_id)
        with self.repository.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if action == "group" and group_id is not None:
                _group(connection, owner, group_id)
            rows = connection.execute(
                "SELECT id,status,history_revision FROM jobs WHERE owner=? AND id IN ("
                + ",".join("?" for _ in identifiers)
                + ")",
                [owner, *identifiers],
            ).fetchall()
            by_id = {row["id"]: row for row in rows}
            if len(by_id) != len(items):
                raise KeyError("Task does not exist")
            for item in items:
                row = by_id[item["id"]]
                if row["history_revision"] != item["revision"]:
                    raise JobConflict(
                        "The history metadata changed before this operation"
                    )
                if action == "archive" and row["status"] not in ARCHIVABLE_STATES:
                    raise JobConflict("Only finished tasks can be archived")
            assignment = "group_id=?" if action == "group" else "archived=?"
            value = group_id if action == "group" else action == "archive"
            connection.executemany(
                "UPDATE jobs SET "
                + assignment
                + ",history_revision=history_revision+1 WHERE owner=? AND id=? AND history_revision=?",
                [(value, owner, item["id"], item["revision"]) for item in items],
            )
            connection.commit()
            return len(items)


def _batch_items(action, items, group_id):
    if not isinstance(action, str) or action not in {"group", "archive", "restore"}:
        raise ValueError("Invalid history action")
    if group_id is not None and (
        action != "group"
        or not isinstance(group_id, str)
        or not 1 <= len(group_id) <= 128
    ):
        raise ValueError("Invalid destination group")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH:
        raise ValueError("A batch requires 1-100 tasks")
    identifiers = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"id", "revision"}:
            raise ValueError("Invalid history item")
        if not isinstance(item["id"], str) or not 1 <= len(item["id"]) <= 128:
            raise ValueError("Invalid task ID")
        _revision(item["revision"])
        identifiers.append(item["id"])
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Duplicate task IDs are not allowed")
    return identifiers
