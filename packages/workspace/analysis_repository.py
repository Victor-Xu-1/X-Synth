"""Owned, immutable input/result records for scientific tool executions."""

import json
import os
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

from packages.orchestrator.job_repository import now_utc
from packages.platform.resource_metrics import process_sample

KINDS = {"conditions", "forward", "assessment", "process", "optimization", "impurity"}
MAX_RECORD_BYTES = 4 * 1024 * 1024


class AnalysisRepository:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            tables = {
                row[0]
                for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if version not in {0, 1} or (version == 0 and tables):
                raise ValueError("Unsupported analysis database schema")
            if version == 1 and tuple(
                row[1] for row in db.execute("PRAGMA table_info(analyses)")
            ) != (
                "id",
                "owner",
                "kind",
                "status",
                "inputs",
                "result",
                "error",
                "created",
                "finished",
                "worker_pid",
                "worker_start",
            ):
                raise ValueError("Unsupported analysis database schema")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, "
                "status TEXT NOT NULL, inputs TEXT NOT NULL, result TEXT, error TEXT, created TEXT NOT NULL, finished TEXT, "
                "worker_pid INTEGER NOT NULL, worker_start INTEGER NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS analyses_owner ON analyses(owner,created DESC,id DESC)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS analyses_owner_kind ON analyses(owner,kind,created DESC,id DESC)"
            )
            db.execute("PRAGMA user_version=1")
            db.commit()
        self.recover_interrupted()

    def recover_interrupted(self):
        with self.connect() as db:
            for row in db.execute(
                "SELECT id,worker_pid,worker_start FROM analyses WHERE status='running'"
            ).fetchall():
                try:
                    alive = (
                        process_sample(row["worker_pid"])["start_ticks"]
                        == row["worker_start"]
                    )
                except (OSError, ValueError, IndexError):
                    alive = False
                if not alive:
                    db.execute(
                        "UPDATE analyses SET status='interrupted',error=?,finished=? WHERE id=? AND status='running'",
                        (
                            "服务已中断，该次输入已保留，可重新提交。",
                            now_utc(),
                            row["id"],
                        ),
                    )
            db.commit()

    @contextmanager
    def connect(self):
        with closing(sqlite3.connect(self.path, timeout=5)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA synchronous=FULL")
            db.execute("PRAGMA secure_delete=ON")
            yield db

    @staticmethod
    def _owner(owner):
        if not isinstance(owner, str) or not owner.strip() or len(owner) > 256:
            raise ValueError("Invalid analysis owner")

    def start(self, owner, kind, inputs):
        self._owner(owner)
        if kind not in KINDS or not isinstance(inputs, dict):
            raise ValueError("Invalid analysis input")
        raw = json.dumps(inputs, allow_nan=False, ensure_ascii=False)
        if len(raw.encode()) > MAX_RECORD_BYTES:
            raise ValueError("Oversized analysis input")
        identifier = uuid4().hex
        worker = os.getpid()
        stamp = process_sample(worker)["start_ticks"]
        with self.connect() as db:
            db.execute(
                "INSERT INTO analyses VALUES(?,?,?,'running',?,NULL,NULL,?,NULL,?,?)",
                (identifier, owner, kind, raw, now_utc(), worker, stamp),
            )
            db.commit()
        return identifier

    def finish(self, identifier, owner, *, result=None, error=None):
        self._owner(owner)
        if (result is None) == (error is None):
            raise ValueError("Exactly one outcome is required")
        raw = (
            json.dumps(result, allow_nan=False, ensure_ascii=False)
            if result is not None
            else None
        )
        if raw is not None and len(raw.encode()) > MAX_RECORD_BYTES:
            raise ValueError("Oversized analysis output")
        if error is not None and (not isinstance(error, str) or len(error) > 512):
            raise ValueError("Invalid analysis error")
        with self.connect() as db:
            changed = db.execute(
                "UPDATE analyses SET status=?,result=?,error=?,finished=? WHERE id=? AND owner=? AND status='running'",
                (
                    "completed" if result is not None else "failed",
                    raw,
                    error,
                    now_utc(),
                    identifier,
                    owner,
                ),
            ).rowcount
            if changed != 1:
                raise KeyError("Analysis is not owned or already finished")
            db.commit()

    @staticmethod
    def _public(row, *, detail):
        output = {
            key: row[key]
            for key in ("id", "kind", "status", "created", "finished", "error")
        }
        inputs = json.loads(row["inputs"])
        if detail:
            output.update(
                inputs=inputs,
                result=json.loads(row["result"]) if row["result"] else None,
            )
        else:
            output["structure"] = ""
            for key in ("product", "known_product", "reactants", "smiles"):
                value = inputs.get(key)
                if isinstance(value, dict):
                    value = value.get("smiles")
                if isinstance(value, list) and all(
                    isinstance(item, str) for item in value
                ):
                    value = ".".join(value)
                if isinstance(value, str) and value:
                    output["structure"] = value
                    break
        return output

    def list(self, owner, *, kind=None, limit=50, offset=0):
        self._owner(owner)
        if kind is not None and kind not in KINDS:
            raise ValueError("Invalid analysis kind")
        if (
            type(limit) is not int
            or not 1 <= limit <= 100
            or type(offset) is not int
            or offset < 0
        ):
            raise ValueError("Invalid analysis pagination")
        predicate = "owner=?" + (" AND kind=?" if kind else "")
        params = (owner, kind) if kind else (owner,)
        with self.connect() as db:
            total = db.execute(
                f"SELECT COUNT(*) FROM analyses WHERE {predicate}", params
            ).fetchone()[0]
            # Summaries must not load uploaded CSVs or complete model output.
            columns = "id,kind,status,created,finished,error," + (
                "json_object('product',json_extract(inputs,'$.product'),"
                "'known_product',json_extract(inputs,'$.known_product'),"
                "'reactants',json_extract(inputs,'$.reactants'),"
                "'smiles',json_extract(inputs,'$.smiles')) AS inputs"
            )
            rows = db.execute(
                f"SELECT {columns} FROM analyses WHERE {predicate} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            return {
                "total": total,
                "items": [self._public(row, detail=False) for row in rows],
            }

    def get(self, identifier, owner):
        self._owner(owner)
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM analyses WHERE id=? AND owner=?", (identifier, owner)
            ).fetchone()
            if row is None:
                raise KeyError("Analysis does not exist")
            return self._public(row, detail=True)

    def delete(self, identifier, owner):
        self._owner(owner)
        with self.connect() as db:
            changed = db.execute(
                "DELETE FROM analyses WHERE id=? AND owner=? AND status != 'running'",
                (identifier, owner),
            ).rowcount
            if changed != 1:
                raise KeyError("Completed analysis does not exist")
            db.commit()
