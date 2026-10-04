"""Read-only, manifest-bound reuse of an immutable ORD reaction library."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import stat
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from .ord_reader import (
    ORD_LICENSE,
    VerifiedOrdSource,
    file_fingerprint,
    official_source_url,
    validate_source_identity,
)
from .reaction_library import SCHEMA_VERSION
from .reaction_models import ReactionEvidence


class OrdBaselineError(ValueError):
    """A baseline may not weaken source verification or hide record conflicts."""


@dataclass(frozen=True)
class OrdBaselineIdentity:
    path: Path
    fingerprint: tuple[int, int, int, int, int]
    snapshot: str
    sha256: str
    sources: tuple[VerifiedOrdSource, ...]

    def check_unchanged(self) -> None:
        if file_fingerprint(self.path) != self.fingerprint:
            raise OrdBaselineError("ORD baseline changed during incremental import")
        if any(
            Path(str(self.path) + suffix).exists()
            for suffix in ("-wal", "-shm", "-journal")
        ):
            raise OrdBaselineError("ORD baseline must not have SQLite sidecars")


def _connect(identity: OrdBaselineIdentity) -> sqlite3.Connection:
    identity.check_unchanged()
    connection = sqlite3.connect(
        identity.path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=2
    )
    connection.execute("PRAGMA query_only=ON")
    return connection


def _validate_schema(connection: sqlite3.Connection) -> None:
    columns = {
        "metadata": [("key", "TEXT", 1, 1), ("value", "TEXT", 1, 0)],
        "reactions": [
            ("id", "TEXT", 1, 1),
            ("product", "TEXT", 1, 0),
            ("reactants", "TEXT", 1, 0),
            ("has_conditions", "INTEGER", 1, 0),
            ("has_yield", "INTEGER", 1, 0),
            ("payload", "TEXT", 1, 0),
        ],
    }
    for table, expected in columns.items():
        actual = [
            (name, kind, required, key)
            for _, name, kind, required, _, key in connection.execute(
                f"PRAGMA table_info({table})"
            )
        ]
        if actual != expected:
            raise OrdBaselineError(f"ORD baseline table schema is invalid: {table}")
    index = [row[2] for row in connection.execute("PRAGMA index_info(reaction_product)")]
    if index != ["product", "reactants", "has_conditions", "has_yield", "id"]:
        raise OrdBaselineError("ORD baseline product index schema is invalid")


def _validate_summary(
    connection: sqlite3.Connection, sources: tuple[VerifiedOrdSource, ...]
) -> dict:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    row = connection.execute(
        "SELECT value FROM metadata WHERE key='summary'"
    ).fetchone()
    summary = json.loads(row[0]) if row else None
    if (
        version != SCHEMA_VERSION
        or not isinstance(summary, dict)
        or type(summary.get("schema_version")) is not int
        or summary["schema_version"] != version
        or summary.get("source") != "ORD"
        or summary.get("license") != ORD_LICENSE
        or not isinstance(summary.get("snapshot"), str)
        or not re.fullmatch(r"[a-f0-9]{64}", summary["snapshot"])
    ):
        raise OrdBaselineError("ORD baseline schema, snapshot or licence is invalid")
    _validate_schema(connection)
    for field in (
        "record_count", "conditions_count", "yields_count", "duplicate_count"
    ):
        value = summary.get(field)
        if type(value) is not int or value < 0:
            raise OrdBaselineError("ORD baseline record counts are invalid")
    if not summary["record_count"] or any(
        summary[field] > summary["record_count"]
        for field in ("conditions_count", "yields_count")
    ):
        raise OrdBaselineError("ORD baseline record counts are inconsistent")
    declared = summary.get("sources")
    if not isinstance(declared, list) or len(declared) != len(sources):
        raise OrdBaselineError("ORD baseline must match the complete verified manifest")
    known = {source.path: source.as_source() for source in sources}
    seen = set()
    for entry in declared:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise OrdBaselineError("ORD baseline source identity is invalid")
        expected = known.get(entry["path"])
        if (
            expected is None
            or entry["path"] in seen
            or any(entry.get(key) != value for key, value in expected.items())
            or entry.get("rejection_policy", "fail") not in ("allow", "fail")
        ):
            raise OrdBaselineError(
                "ORD baseline sources disagree with the verified manifest"
            )
        seen.add(entry["path"])
    return summary


def _validate_record(
    record: ReactionEvidence,
    record_id: str,
    sources: dict[str, VerifiedOrdSource],
) -> None:
    provenance = record.provenance
    source = sources.get(provenance.source_path)
    original = provenance.original_reaction_id
    if (
        source is None
        or provenance.source != "ORD"
        or provenance.source_sha256 != source.sha256
        or provenance.license != ORD_LICENSE
        or record.id != record_id
        or record.match_scope != "product_identity"
        or not original
        or not re.fullmatch(r"ord-[a-f0-9]{32}", original)
        or not re.fullmatch(
            re.escape(original) + r"(?::products:[a-f0-9]{24})?", record.id
        )
        or not provenance.outcome_indices
        or len(set(provenance.outcome_indices)) != len(provenance.outcome_indices)
    ):
        raise OrdBaselineError(
            "ORD baseline record identity disagrees with the verified sources"
        )
    dataset_id = "ord_dataset-" + validate_source_identity(
        source.path, source.sha256, source.revision
    )
    if (
        provenance.dataset_id != dataset_id
        or record.source_url != official_source_url(source.path, source.revision)
    ):
        raise OrdBaselineError("ORD baseline record dataset or revision is inconsistent")


class OrdBaselineLookup:
    """One process-local read-only connection; no payload or million-ID cache."""

    def __init__(self, identity: OrdBaselineIdentity):
        self.identity = identity
        self.connection = _connect(identity)
        try:
            summary = _validate_summary(self.connection, identity.sources)
            if summary["snapshot"] != identity.snapshot:
                raise OrdBaselineError("ORD baseline snapshot changed")
        except BaseException:
            self.connection.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self) -> None:
        self.connection.close()

    def has_single_record(
        self, reaction_id: str, source_path: str, source_sha256: str
    ) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM reactions WHERE id=? "
            "AND json_extract(payload, '$.provenance.source_path')=? "
            "AND json_extract(payload, '$.provenance.source_sha256')=? "
            "AND json_extract(payload, '$.provenance.original_reaction_id')=? "
            "AND json_extract(payload, '$.provenance.outcome_indices')='[0]'",
            (reaction_id, source_path, source_sha256, reaction_id),
        ).fetchone()
        return row is not None

    def matches_existing(self, record: ReactionEvidence) -> bool:
        row = self.connection.execute(
            "SELECT payload FROM reactions WHERE id=?", (record.id,)
        ).fetchone()
        if row is None:
            return False
        if row[0] == record.model_dump_json():
            return True
        prior = ReactionEvidence.model_validate_json(row[0])
        if prior.model_dump(mode="json") != record.model_dump(mode="json"):
            raise OrdBaselineError(
                f"Conflicting ORD baseline payload for record {record.id}"
            )
        return True


class VerifiedOrdBaseline:
    """Validate metadata, stream typed base records, then freeze worker identity."""

    def __init__(self, path: Path, sources: list[VerifiedOrdSource]):
        path = Path(path).resolve(strict=True)
        if not path.is_file() or path.stat().st_mode & (
            stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH
        ):
            raise OrdBaselineError("ORD baseline must be a read-only immutable file")
        if not sources or len({source.path for source in sources}) != len(sources):
            raise OrdBaselineError("ORD baseline requires distinct verified sources")
        for source in sources:
            source.check_unchanged()
        fingerprint = file_fingerprint(path)
        with path.open("rb") as handle:
            sha256 = hashlib.file_digest(handle, "sha256").hexdigest()
        identity = OrdBaselineIdentity(path, fingerprint, "", sha256, tuple(sources))
        with closing(_connect(identity)) as connection:
            summary = _validate_summary(connection, identity.sources)
            if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise OrdBaselineError("ORD baseline SQLite integrity check failed")
            count = connection.execute("SELECT count(*) FROM reactions").fetchone()[0]
            if count != summary["record_count"]:
                raise OrdBaselineError(
                    "ORD baseline count disagrees with its snapshot metadata"
                )
        identity.check_unchanged()
        self.identity = OrdBaselineIdentity(
            path, fingerprint, summary["snapshot"], sha256, tuple(sources)
        )
        self.summary = summary
        self.records_reused = 0
        self._verified = False
        self._started = False

    def iter_records(self) -> Iterator[ReactionEvidence]:
        if self._started:
            raise OrdBaselineError("ORD baseline records must be streamed exactly once")
        self._started = True
        known = {source.path: source for source in self.identity.sources}
        conditions_count = yields_count = 0
        try:
            with closing(_connect(self.identity)) as connection:
                for record_id, payload, has_conditions, has_yield in connection.execute(
                    "SELECT id, payload, has_conditions, has_yield FROM reactions ORDER BY id"
                ):
                    record = ReactionEvidence.model_validate_json(payload)
                    _validate_record(record, record_id, known)
                    conditions = int(bool(
                        record.conditions and any(record.conditions.model_dump().values())
                    ))
                    yields = int(bool(record.reported_yields))
                    if has_conditions != conditions or has_yield != yields:
                        raise OrdBaselineError(
                            "ORD baseline coverage flags disagree with the payload"
                        )
                    conditions_count += conditions
                    yields_count += yields
                    self.records_reused += 1
                    yield record
            if (self.records_reused, conditions_count, yields_count) != (
                self.summary["record_count"],
                self.summary["conditions_count"],
                self.summary["yields_count"],
            ):
                raise OrdBaselineError(
                    "ORD baseline coverage disagrees with its snapshot metadata"
                )
        finally:
            self.identity.check_unchanged()
        self._verified = True

    def freeze(self) -> OrdBaselineIdentity:
        if not self._verified:
            raise OrdBaselineError("ORD baseline records must be validated before extraction")
        self.identity.check_unchanged()
        return self.identity

    def audit(self, *, totals: dict, library: dict | None) -> dict:
        return {
            "base_library": str(self.identity.path),
            "base_snapshot": self.identity.snapshot,
            "base_sha256": self.identity.sha256,
            "base_record_count": self.summary["record_count"],
            "records_reused": self.records_reused,
            "base_records_verified": self._verified,
            "source_selection": "complete_verified_manifest",
            "rows_skipped_verified": totals.get("rows_skipped_verified", 0),
            "records_skipped_existing": totals.get("records_skipped_existing", 0),
            "new_records_emitted": (
                totals.get("records_emitted", 0)
                - totals.get("records_skipped_existing", 0)
            ),
            "new_records_indexed": (
                library["record_count"] - self.summary["record_count"]
                if library is not None else None
            ),
            "rows_seen": totals.get("rows_seen", 0),
            "unread_rows": totals.get("unread_rows"),
        }
