"""Bounded keysets with canonical, non-authoritative snapshot/filter cursors."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import islice
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from packages.platform.immutable_sqlite import ImmutableSQLite, ImmutableSQLiteError
from .template_models import TemplateRecord
from .template_query import _TEMPLATE_SELECT, _template_filters, _template_strategy

MAX_TEMPLATE_CURSOR_LENGTH = 2048
_ORDER = " order by template_count desc, source asc, template_id asc"


class TemplateCursorError(ValueError):
    """A cursor must never become a silently restarted first page."""


class StaleTemplateCursorError(TemplateCursorError):
    """The caller must explicitly start a new browse of the replaced snapshot."""


class TemplatePosition(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    template_count: int = Field(ge=1, le=2**63 - 1)
    source: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9_]+$")
    template_id: str = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def matching_namespace(self) -> TemplatePosition:
        prefix = self.source + ":"
        if not self.template_id.startswith(prefix) or not self.template_id[len(prefix):]:
            raise ValueError("Template identity must match its source namespace")
        return self


class _CursorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    version: int = Field(default=1, ge=1, le=1)
    snapshot: str = Field(pattern=r"^[a-f0-9]{64}$")
    filters: str = Field(pattern=r"^[a-f0-9]{64}$")
    after: TemplatePosition


@dataclass(frozen=True)
class TemplatePage:
    templates: list[TemplateRecord]
    matched_count: int
    next_cursor: str | None
    has_more: bool


@dataclass(frozen=True)
class TemplateQueryPlan:
    where: tuple[str, ...]
    params: tuple[str | int, ...]
    fingerprint: str

    @property
    def predicate(self) -> str:
        return " where " + " and ".join(self.where)


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=True, separators=(",", ":"),
    ).encode("ascii")).hexdigest()


def prepare_template_query(
    *, strategy: str | None, sources: Iterable[str] | None, domain: str | None,
    min_count: int | None, limit: int, direction: str | None,
) -> TemplateQueryPlan:
    if type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError("Template result limit must be between 1 and 500")
    if min_count is not None and (
        type(min_count) is not int or not 0 <= min_count <= 2147483647
    ):
        raise ValueError("Invalid template minimum count")
    for value in (strategy, domain):
        if value is not None and (not isinstance(value, str) or len(value) > 100):
            raise ValueError("Invalid template query text")
    if direction is not None and (
        not isinstance(direction, str) or direction not in {"retro", "forward"}
    ):
        raise ValueError("Invalid template direction")
    if sources is not None:
        if isinstance(sources, (str, bytes)) or not isinstance(sources, Iterable):
            raise ValueError("Template sources must be a bounded collection")
        sources = tuple(islice(sources, 21))
        if len(sources) > 20 or any(
            not isinstance(source, str) or not 1 <= len(source) <= 128
            for source in sources
        ):
            raise ValueError("Invalid template sources or source budget exceeded")
    profile = _template_strategy(strategy)
    sources = tuple(sorted(set(sources or profile.get("sources") or ())))
    where, params = _template_filters(
        strategy=strategy, sources=sources, domain=domain,
        min_count=min_count, direction=direction,
    )
    # IN-list order and duplicates are not filter changes. Defaults and overrides
    # are resolved by the existing filter authority, never by a second profile.
    return TemplateQueryPlan(tuple(where), tuple(params), _digest([where, params]))


def snapshot_fingerprint(snapshot: ImmutableSQLite) -> str:
    return _digest([str(snapshot.path), snapshot.identity])


def _base64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _cursor_checksum(payload: str) -> str:
    # Integrity only, not authentication. Snapshot/filter matching and an exact
    # filtered-index anchor check determine validity across workers and restarts.
    return _base64(hashlib.sha256(payload.encode("ascii")).digest())


def validate_template_page_rows(rows: list[tuple[Any, ...]]) -> None:
    for row in rows:
        try:
            TemplatePosition(template_count=row[7], source=row[1], template_id=row[0])
        except ValidationError as exc:
            raise ImmutableSQLiteError("Template paging record identity or count is invalid") from exc


def encode_template_cursor(
    *, snapshot: str, filters: str, record: TemplateRecord,
) -> str:
    try:
        payload = _CursorPayload(
            snapshot=snapshot, filters=filters,
            after=TemplatePosition(
                template_count=record.count, source=record.source,
                template_id=record.template_id,
            ),
        )
    except ValidationError as exc:
        raise ImmutableSQLiteError("Template paging identity is invalid") from exc
    encoded = _base64(payload.model_dump_json().encode("utf-8"))
    cursor = encoded + "." + _cursor_checksum(encoded)
    if len(cursor) > MAX_TEMPLATE_CURSOR_LENGTH:
        raise ImmutableSQLiteError("Template paging identity exceeds cursor budget")
    return cursor


def decode_template_cursor(
    cursor: str, *, snapshot: str, filters: str,
) -> TemplatePosition:
    if (
        not isinstance(cursor, str) or not 1 <= len(cursor) <= MAX_TEMPLATE_CURSOR_LENGTH
        or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}", cursor)
    ):
        raise TemplateCursorError("Invalid template cursor")
    encoded, checksum = cursor.split(".")
    if not hmac.compare_digest(_cursor_checksum(encoded), checksum):
        raise TemplateCursorError("Invalid template cursor checksum")
    try:
        decoded = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True,
        )
        if _base64(decoded) != encoded:
            raise ValueError("Noncanonical cursor encoding")
        payload = _CursorPayload.model_validate_json(decoded)
        if payload.model_dump_json().encode("utf-8") != decoded:
            raise ValueError("Noncanonical cursor payload")
    except (ValueError, ValidationError) as exc:
        raise TemplateCursorError("Invalid template cursor payload") from exc
    if payload.snapshot != snapshot:
        raise StaleTemplateCursorError("Template cursor snapshot has changed")
    if payload.filters != filters:
        raise TemplateCursorError("Template cursor does not match query filters")
    return payload.after


def count_template_matches(connection: sqlite3.Connection, plan: TemplateQueryPlan) -> int:
    parts, offset = [], 0
    for clause in plan.where:
        width = clause.count("?")
        parts.append((clause, plan.params[offset:offset + width]))
        offset += width
    if offset != len(plan.params):
        raise ValueError("Template count parameters do not match predicates")
    if len(parts) > 1 and parts[-1][0] == "template_count >= ?":
        minimum, minimum_params = parts.pop()
        # Existing dimension/count indexes avoid a separate full threshold set.
        parts = [(clause + " and " + minimum, params + minimum_params)
                 for clause, params in parts]
    if len(parts) == 1:
        sql = "select count(*) from templates where " + parts[0][0]
    else:
        # Each predicate reads rowids from an existing covering lookup index.
        # Intersecting avoids fetching large record JSON just to combine filters.
        sql = "select count(*) from (" + " intersect ".join(
            "select rowid from templates where " + clause for clause, _ in parts
        ) + ")"
    return connection.execute(sql, tuple(value for _, params in parts for value in params)).fetchone()[0]


def select_template_rows(
    connection: sqlite3.Connection, plan: TemplateQueryPlan, *, limit: int,
    after: TemplatePosition | None = None, lookahead: bool = False,
) -> tuple[list[tuple[Any, ...]], bool]:
    predicate, params = plan.predicate, list(plan.params)
    if after is not None:
        # The redundant count bound lets existing count indexes seek past higher
        # counts; the exact secondary/tertiary tie predicate remains authoritative.
        predicate += (
            " and template_count <= ? and (template_count < ? or "
            "(template_count = ? and (source > ? or (source = ? and template_id > ?))))"
        )
        params.extend((
            after.template_count, after.template_count, after.template_count,
            after.source, after.source, after.template_id,
        ))
    keys = connection.execute(
        "select template_count, source, template_id from templates"
        + predicate + _ORDER + " limit ?",
        [*params, limit + int(lookahead)],
    ).fetchall()
    has_more = len(keys) > limit
    keys = keys[:limit]
    if not keys:
        return [], has_more
    rows = connection.execute(
        _TEMPLATE_SELECT + " where template_id in (" + ",".join("?" for _ in keys) + ")",
        [key[2] for key in keys],
    ).fetchall()
    by_id = {row[0]: row for row in rows}
    if len(by_id) != len(keys) or any(
        key[2] not in by_id or (by_id[key[2]][7], by_id[key[2]][1], key[2]) != key
        for key in keys
    ):
        raise ImmutableSQLiteError("Template page records changed")
    return [by_id[key[2]] for key in keys], has_more
