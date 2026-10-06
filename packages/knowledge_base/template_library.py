"""Pinned, bounded queries over template knowledge, not a trained model index."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from threading import RLock

from packages.platform.immutable_sqlite import ImmutableSQLite, ImmutableSQLiteError, file_identity
from .template_models import DEFAULT_TEMPLATE_STRATEGIES, TemplateRecord, _template_record_from_row
from .template_query import _TEMPLATE_SELECT, _template_filters
from .template_schema import validate_template_schema
from .template_statistics import read_summary
from .template_build import build_template_library_database, build_template_library_manifest
from .template_export import export_template_runtime_assets
from .template_sources import (
    count_template_records, iter_template_records, sha256_file,
    discover_standard_template_source_paths, discover_template_source_paths,
    infer_template_direction, infer_template_domain, infer_template_source_name,
)


class TemplateLibraryService:
    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path).absolute()
        self._lock = RLock()
        self._snapshot = None
        self._cached_summary = None
        self._current_snapshot()

    def _current_snapshot(self):
        with self._lock:
            try:
                identity = file_identity(self.database_path)
            except (OSError, ValueError) as exc:
                raise ImmutableSQLiteError("Template index is missing or invalid") from exc
            if self._snapshot is None or identity != self._snapshot.identity:
                snapshot = ImmutableSQLite(self.database_path)
                with snapshot.connect() as connection:
                    validate_template_schema(connection)
                self._snapshot, self._cached_summary = snapshot, None
            self._snapshot.check()
            return self._snapshot

    def summary(self) -> dict:
        with self._lock:
            snapshot = self._current_snapshot()
            if self._cached_summary is None:
                with snapshot.connect() as connection:
                    self._cached_summary = read_summary(connection)
            result = {"path": str(self.database_path), **deepcopy(self._cached_summary)}
            snapshot.check()
            return result

    def connect(self):
        return self._current_snapshot().connect()

    def check_snapshot(self):
        self._current_snapshot().check()

    def query_templates(
        self, *, strategy=None, sources=None, domain=None, min_count=None,
        limit=100, direction=None,
    ) -> list[TemplateRecord]:
        if not 1 <= limit <= 500:
            raise ValueError("Template result limit must be between 1 and 500")
        if direction is not None and direction not in {"retro", "forward"}:
            raise ValueError("Invalid template direction")
        sources = tuple(sources) if sources is not None else None
        if sources is not None and len(sources) > 20:
            raise ValueError("Template source budget exceeded")
        where, params = _template_filters(
            strategy=strategy, sources=sources, domain=domain,
            min_count=min_count, direction=direction,
        )
        sql = _TEMPLATE_SELECT + (
            " where " + " and ".join(where)
            + " order by template_count desc, source asc, template_id asc limit ?"
        )
        snapshot = self._current_snapshot()
        with snapshot.connect() as connection:
            rows = connection.execute(sql, [*params, limit]).fetchall()
        result = [_template_record_from_row(row) for row in rows]
        snapshot.check()
        return result

    def get_template(self, *, source: str, template_id: str) -> TemplateRecord | None:
        if (
            not source
            or len(source) > 128
            or ":" in source
            or any(character.isspace() for character in source)
            or len(template_id) > 256
            or not template_id.startswith(f"{source}:")
            or not template_id[len(source) + 1 :]
        ):
            raise ValueError("A source-matching namespaced template_id is required")
        snapshot = self._current_snapshot()
        with snapshot.connect() as connection:
            row = connection.execute(
                _TEMPLATE_SELECT + " where template_id = ? and source = ? limit 1",
                (template_id, source),
            ).fetchone()
        result = _template_record_from_row(row) if row is not None else None
        snapshot.check()
        return result

__all__ = [
    "TemplateLibraryService", "TemplateRecord", "DEFAULT_TEMPLATE_STRATEGIES",
    "build_template_library_database", "build_template_library_manifest",
    "discover_standard_template_source_paths", "discover_template_source_paths",
    "infer_template_direction", "infer_template_domain", "infer_template_source_name",
    "export_template_runtime_assets",
    "count_template_records", "iter_template_records", "sha256_file",
]
