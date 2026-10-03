"""Owned route documents with optimistic revisions and immutable provenance."""

import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

from packages.orchestrator.job_repository import JobConflict, now_utc
from packages.platform.performance import PerformanceBudget

from .route_graph import RouteGraph
from .route_summaries import SUMMARY_COLUMNS, initialize_summaries, list_summaries
from .source_evidence import SourceEvidence

DOCUMENT_COLUMNS = (
    "id",
    "owner",
    "title",
    "graph",
    "source",
    "revision",
    "created",
    "modified",
)
PUBLIC_SOURCE_FIELDS = frozenset({"engine", "route_id", "job_id", "route_index"})


class UnsupportedRouteDocumentSchema(RuntimeError):
    pass


def _supported_schema(connection):
    try:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        if not tables:
            return False
        if "route_document_schema" not in tables or connection.execute(
            "SELECT version FROM route_document_schema"
        ).fetchall() != [(1,)]:
            raise UnsupportedRouteDocumentSchema("Unsupported route document schema")
        expected = {"route_documents": DOCUMENT_COLUMNS}
        if "route_document_summaries" in tables:
            expected["route_document_summaries"] = SUMMARY_COLUMNS
        for table, columns in expected.items():
            if (
                tuple(
                    row[1] for row in connection.execute(f"PRAGMA table_info({table})")
                )
                != columns
            ):
                raise UnsupportedRouteDocumentSchema(
                    "Unsupported route document schema"
                )
    except sqlite3.DatabaseError as exc:
        raise UnsupportedRouteDocumentSchema(
            "Unsupported route document schema"
        ) from exc
    return True


def _owner(owner):
    if not isinstance(owner, str) or not owner.strip() or len(owner) > 256:
        raise ValueError("A bounded document owner is required")


def _title(title):
    if not isinstance(title, str) or not title.strip() or len(title) > 160:
        raise ValueError("A document title of 1-160 characters is required")
    return title.strip()


def _source(source, graph):
    if source is None:
        return {}
    if not isinstance(source, dict):
        raise TypeError("Invalid route source")
    if not source:
        return {}
    evidence = SourceEvidence.model_validate(source)
    reaction_ids = {node.id for node in graph.nodes if node.type == "reaction"}
    if (
        evidence.signature != graph.semantic_signature()
        or not evidence.prediction_scores.keys() <= reaction_ids
    ):
        raise ValueError("Route source does not match its chemistry or reaction nodes")
    return evidence.model_dump(exclude_unset=True)


class RouteDocumentRepository:
    def __init__(self, path: Path, *, budget: PerformanceBudget | None = None):
        self.path = Path(path).resolve()
        self.budget = budget or PerformanceBudget.from_environment()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect(initializing=True) as connection:
            # No journal/schema/cache writes may precede the version check.
            _supported_schema(connection)
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("BEGIN IMMEDIATE")
            if not _supported_schema(connection):
                connection.execute(
                    "CREATE TABLE route_document_schema(version INTEGER PRIMARY KEY)"
                )
                connection.execute("INSERT INTO route_document_schema VALUES(1)")
                connection.execute("""
                    CREATE TABLE route_documents(
                        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
                        graph TEXT NOT NULL, source TEXT NOT NULL, revision INTEGER NOT NULL,
                        created TEXT NOT NULL, modified TEXT NOT NULL)
                """)
            index_columns = tuple(
                row[2]
                for row in connection.execute(
                    "PRAGMA index_info(route_documents_owner)"
                )
            )
            if index_columns != ("owner", "modified", "id"):
                connection.execute("DROP INDEX IF EXISTS route_documents_owner")
                connection.execute(
                    "CREATE INDEX route_documents_owner ON route_documents(owner,modified DESC,id DESC)"
                )
            initialize_summaries(connection)
            connection.commit()

    @property
    def validation_context(self):
        return {"max_structure_atoms": self.budget.max_structure_atoms}

    @contextmanager
    def connect(self, *, initializing=False):
        if self.path.exists():
            with closing(
                sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True, timeout=5)
            ) as probe:
                supported = _supported_schema(probe)
                if not supported and not initializing:
                    raise UnsupportedRouteDocumentSchema(
                        "Unsupported route document schema"
                    )
        elif not initializing:
            raise UnsupportedRouteDocumentSchema(
                "Route document database is unavailable"
            )
        with closing(sqlite3.connect(self.path, timeout=5)) as connection:
            if not _supported_schema(connection) and not initializing:
                raise UnsupportedRouteDocumentSchema(
                    "Unsupported route document schema"
                )
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA secure_delete=ON")
            yield connection

    def public(self, row):
        if row is None:
            raise KeyError("Route document does not exist")
        identifier, _, title, graph, source, revision, created, modified = row
        graph = RouteGraph.model_validate_json(graph, context=self.validation_context)
        provenance = json.loads(source)
        original = (
            bool(provenance)
            and not provenance.get("_chemistry_edited", False)
            and provenance.get("signature") == graph.semantic_signature()
        )
        return {
            "id": identifier,
            "title": title,
            "graph": graph.model_dump(),
            "revision": revision,
            "created": created,
            "modified": modified,
            "target_smiles": next(
                node.smiles for node in graph.nodes if node.id == graph.target_id
            ),
            "state": "source_copy" if original else "draft",
            "source": {
                key: value
                for key, value in provenance.items()
                if key in PUBLIC_SOURCE_FIELDS
            },
            "prediction_scores": provenance.get("prediction_scores", {})
            if original
            else {},
            "source_closed": original and provenance.get("closed") is True,
        }

    def create(self, owner: str, title: str, graph: RouteGraph, *, source=None):
        _owner(owner)
        title = _title(title)
        graph = RouteGraph.model_validate(
            graph.model_dump(), context=self.validation_context
        )
        provenance = _source(source, graph)
        identifier, timestamp = uuid4().hex, now_utc()
        row = (
            identifier,
            owner,
            title,
            graph.model_dump_json(),
            json.dumps(provenance, allow_nan=False),
            0,
            timestamp,
            timestamp,
        )
        result = self.public(row)
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO route_documents VALUES(?,?,?,?,?,?,?,?)", row
            )
            connection.commit()
        return result

    def get(self, identifier: str, owner: str):
        _owner(owner)
        with self.connect() as connection:
            return self.public(
                connection.execute(
                    "SELECT * FROM route_documents WHERE id=? AND owner=?",
                    (identifier, owner),
                ).fetchone()
            )

    def list(self, owner: str, *, limit=50, offset=0):
        _owner(owner)
        if (
            type(limit) is not int
            or type(offset) is not int
            or not 1 <= limit <= 100
            or offset < 0
        ):
            raise ValueError("Invalid document pagination")
        with self.connect() as connection:
            return list_summaries(connection, owner, limit=limit, offset=offset)

    def update(self, identifier, owner, *, title, graph, revision):
        _owner(owner)
        title = _title(title)
        if type(revision) is not int or revision < 0:
            raise ValueError("A nonnegative integer revision is required")
        graph = RouteGraph.model_validate(
            graph.model_dump(), context=self.validation_context
        )
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM route_documents WHERE id=? AND owner=?",
                (identifier, owner),
            ).fetchone()
            if row is None:
                raise KeyError(identifier)
            if row[5] != revision:
                raise JobConflict("文档已被其他页面修改，请重新载入或另存副本。")
            provenance = json.loads(row[4])
            previous = RouteGraph.model_validate_json(
                row[3], context=self.validation_context
            )
            if (
                provenance
                and previous.semantic_signature() != graph.semantic_signature()
            ):
                # Keep original evidence immutable; invalidation is separate and sticky.
                provenance["_chemistry_edited"] = True
            updated = (
                row[0],
                row[1],
                title,
                graph.model_dump_json(),
                json.dumps(provenance, allow_nan=False),
                revision + 1,
                row[6],
                now_utc(),
            )
            result = self.public(updated)
            connection.execute(
                "UPDATE route_documents SET title=?,graph=?,source=?,revision=?,modified=? WHERE id=? AND owner=?",
                (
                    updated[2],
                    updated[3],
                    updated[4],
                    updated[5],
                    updated[7],
                    identifier,
                    owner,
                ),
            )
            connection.commit()
        return result

    def delete(self, identifier, owner):
        _owner(owner)
        with self.connect() as connection:
            changed = connection.execute(
                "DELETE FROM route_documents WHERE id=? AND owner=?",
                (identifier, owner),
            ).rowcount
            if not changed:
                raise KeyError(identifier)
            connection.commit()
