from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_TEMPLATE_STRATEGIES: dict[str, dict[str, Any]] = {
    "all": {},
    "high_precision": {
        "sources": ("reaxys", "pistachio", "pistachio_ringbreaker"),
        "min_count": 2,
    },
    "ringbreaker": {
        "sources": ("pistachio_ringbreaker",),
    },
    "uspto_backfill": {
        "sources": (
            "uspto_higher_level",
            "uspto_50k",
            "uspto_aizynthfinder",
            "uspto_ringbreaker_aizynthfinder",
        ),
    },
    "ord_backfill": {
        "sources": ("ord", "ord_extracted"),
    },
    "public_reaction_corpus": {
        "domain": "public_reaction_corpus",
    },
    "forward_validation": {
        "domain": "forward_validation",
        "direction": "forward",
    },
    "biocatalysis": {
        "domain": "biocatalysis",
    },
    "metabolism": {
        "domain": "metabolism",
    },
}


@dataclass(frozen=True)
class TemplateRecord:
    template_id: str
    source: str
    source_path: str
    template_set: str
    direction: str
    domain: str
    reaction_smarts: str
    count: int
    necessary_reagent: str
    intra_only: bool
    dimer_only: bool
    ring_delta: float | None
    chiral_delta: int | None
    references: list[Any]
    attributes: dict[str, Any]
    raw: dict[str, Any]


class TemplateLibraryService:
    """Local query service over the shared template SQLite database."""

    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path)
        if not self.database_path.is_file():
            raise FileNotFoundError(
                f"Template database not found: {self.database_path}"
            )

    def summary(self) -> dict[str, Any]:
        with self.connect() as connection:
            template_count = connection.execute(
                "select count(*) from templates"
            ).fetchone()[0]
            source_count = connection.execute(
                "select count(*) from template_sources"
            ).fetchone()[0]
            sources = [
                row[0]
                for row in connection.execute(
                    "select source from template_sources order by source"
                ).fetchall()
            ]
            domains = {
                row[0]: row[1]
                for row in connection.execute(
                    "select domain, count(*) from templates group by domain order by domain"
                ).fetchall()
            }
            directions = {
                row[0]: row[1]
                for row in connection.execute(
                    "select direction, count(*) from templates group by direction order by direction"
                ).fetchall()
            }
        return {
            "path": str(self.database_path),
            "template_count": template_count,
            "source_count": source_count,
            "sources": sources,
            "domains": domains,
            "directions": directions,
            "strategies": sorted(DEFAULT_TEMPLATE_STRATEGIES),
        }

    def connect(self):
        return closing(
            sqlite3.connect(
                self.database_path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True
            )
        )

    def query_templates(
        self,
        *,
        strategy: str | None = None,
        sources: Iterable[str] | None = None,
        domain: str | None = None,
        min_count: int | None = None,
        limit: int = 100,
        direction: str | None = None,
    ) -> list[TemplateRecord]:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        profile = _template_strategy(strategy)
        resolved_sources = tuple(sources or profile.get("sources") or ())
        resolved_domain = domain if domain is not None else profile.get("domain")
        resolved_min_count = (
            min_count if min_count is not None else profile.get("min_count")
        )
        resolved_direction = (
            direction if direction is not None else profile.get("direction", "retro")
        )

        where = ["direction = ?"]
        params: list[Any] = [resolved_direction]
        if resolved_sources:
            placeholders = ",".join("?" for _ in resolved_sources)
            where.append(f"source in ({placeholders})")
            params.extend(resolved_sources)
        if resolved_domain:
            where.append("domain = ?")
            params.append(str(resolved_domain))
        if resolved_min_count is not None:
            where.append("template_count >= ?")
            params.append(int(resolved_min_count))
        params.append(limit)

        sql = f"""
            select
              template_id,
              source,
              source_path,
              template_set,
              direction,
              domain,
              reaction_smarts,
              template_count,
              necessary_reagent,
              intra_only,
              dimer_only,
              ring_delta,
              chiral_delta,
              references_json,
              attributes_json,
              raw_json
            from templates
            where {" and ".join(where)}
            order by template_count desc, source asc, template_id asc
            limit ?
        """
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [_template_record_from_row(row) for row in rows]


def build_template_library_manifest(
    *,
    source_paths: Iterable[Path | str],
    output_dir: Path | str,
    version: str,
) -> dict[str, Any]:
    """Index canonical template sources and declare engine-specific artifacts derived from them."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    sources: dict[str, dict[str, Any]] = {}
    total_templates = 0
    for raw_path in source_paths:
        path = Path(raw_path)
        source_name = infer_template_source_name(path)
        count = count_template_records(path)
        total_templates += count
        sources[source_name] = {
            "path": str(path),
            "template_count": count,
            "sha256": sha256_file(path),
            "direction": infer_template_direction(path),
            "domain": infer_template_domain(path),
        }

    artifact_sources = sorted(sources)
    manifest = {
        "version": version,
        "total_templates": total_templates,
        "sources": sources,
        "artifacts": {
            "askcos": {
                "source_count": len(artifact_sources),
                "sources": artifact_sources,
                "format": "askcos.retro.templates.json.gz",
            },
            "aizynthfinder": {
                "source_count": len(artifact_sources),
                "sources": artifact_sources,
                "format": "aizynthfinder.policy.templates",
                "status": "manifest_only_compile_step_required",
            },
            "retrosim": {
                "source_count": len(artifact_sources),
                "sources": artifact_sources,
                "format": "retrosim.template_similarity_index",
                "status": "manifest_only_compile_step_required",
            },
        },
    }
    _write_manifest(output, manifest)
    return manifest


def build_template_library_database(
    *,
    source_paths: Iterable[Path | str],
    output_dir: Path | str,
    version: str,
    database_name: str = "template_library.sqlite",
) -> dict[str, Any]:
    """Compile canonical template sources into a shared SQLite database and manifest."""
    paths = [Path(path) for path in source_paths]
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    manifest = build_template_library_manifest(
        source_paths=paths, output_dir=output, version=version
    )

    database_path = output / database_name
    if database_path.exists():
        database_path.unlink()
    skipped_records = 0
    template_count = 0
    with sqlite3.connect(database_path) as connection:
        _create_template_schema(connection)
        for source, summary in manifest["sources"].items():
            connection.execute(
                """
                insert into template_sources(source, path, template_count, sha256, direction, domain)
                values (?, ?, ?, ?, ?, ?)
                """,
                (
                    source,
                    summary["path"],
                    summary["template_count"],
                    summary["sha256"],
                    summary["direction"],
                    summary["domain"],
                ),
            )
        for source_path in paths:
            source = infer_template_source_name(source_path)
            direction = infer_template_direction(source_path)
            domain = infer_template_domain(source_path)
            for raw in iter_template_records(source_path):
                record = _normalise_template_record(
                    raw=raw,
                    source=source,
                    source_path=source_path,
                    direction=direction,
                    domain=domain,
                )
                if record is None:
                    skipped_records += 1
                    continue
                _insert_template_record(connection, record)
                template_count += 1
        connection.commit()

    manifest["database"] = {
        "path": str(database_path),
        "format": "sqlite",
        "template_count": template_count,
        "skipped_records": skipped_records,
        "service": "TemplateLibraryService",
        "strategies": sorted(DEFAULT_TEMPLATE_STRATEGIES),
    }
    _write_manifest(output, manifest)
    return manifest


def export_template_runtime_assets(
    *,
    database_path: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    """Export engine-consumable template assets from the canonical SQLite library."""
    service = TemplateLibraryService(database_path)
    output = Path(output_dir)
    askcos_dir = output / "askcos_templates"
    askcos_dir.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(service.database_path) as connection:
        source_rows = connection.execute(
            """
            select source, direction, domain, count(*)
            from templates
            group by source, direction, domain
            order by source
            """
        ).fetchall()

    retro_files: dict[str, dict[str, Any]] = {}
    forward_file: dict[str, Any] | None = None
    unified_retro_count = 0
    for source, direction, domain, template_count in source_rows:
        filename = _askcos_template_filename(source=source, direction=direction)
        path = askcos_dir / filename
        _write_template_json_array_gzip(
            path,
            _raw_templates_for_source(
                service.database_path, source=source, direction=direction
            ),
        )
        entry = {
            "path": str(path),
            "template_count": int(template_count),
            "direction": direction,
            "domain": domain,
            "format": "askcos.template-json-array-gzip",
        }
        if direction == "forward":
            forward_file = entry
        else:
            retro_files[source] = entry
            unified_retro_count += int(template_count)

    unified_retro_file = askcos_dir / "retro.templates.synon_unified.json.gz"
    _write_template_json_array_gzip(
        unified_retro_file,
        _raw_templates_for_direction(service.database_path, direction="retro"),
    )

    runtime = {
        "template_database": str(service.database_path),
        "askcos": {
            "template_files": retro_files,
            "unified_retro_templates": {
                "path": str(unified_retro_file),
                "template_count": unified_retro_count,
                "direction": "retro",
                "domain": "mixed",
                "format": "askcos.template-json-array-gzip",
            },
            "forward_templates": forward_file,
        },
        "strategies": _runtime_strategy_manifest(
            retro_files=retro_files, forward_file=forward_file
        ),
        "aizynthfinder": {
            "status": "requires_policy_training_or_model_specific_asset_builder",
            "source": str(service.database_path),
        },
        "retrosim": {
            "status": "requires_similarity_index_builder",
            "source": str(service.database_path),
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "runtime_template_assets.json").write_text(
        json.dumps(runtime, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return runtime


def infer_template_source_name(path: Path) -> str:
    if path.name in {"templates.jsonl", "templates.jsonl.gz"}:
        return path.parent.name.lower().replace(".", "_")
    name = path.name
    if name.startswith("forward.templates"):
        name = name[len("forward.templates") :].lstrip(".")
        if name in ("json.gz", "jsonl.gz", "json", "jsonl", "gz", ""):
            return "forward"
    elif name.startswith("retro.templates."):
        name = name[len("retro.templates.") :]
    elif name == "uspto_templates.csv.gz" or name == "uspto_templates.csv":
        return "uspto_aizynthfinder"
    elif (
        name == "uspto_ringbreaker_templates.csv.gz"
        or name == "uspto_ringbreaker_templates.csv"
    ):
        return "uspto_ringbreaker_aizynthfinder"
    elif name.startswith("ord.templates."):
        name = name[len("ord.templates.") :]
    for suffix in (".json.gz", ".jsonl.gz", ".json", ".jsonl", ".gz"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    name = name.removesuffix(".csv")
    if name == "USPTO_50k":
        return "uspto_50k"
    if name == "ord" or name.startswith("ord_"):
        return name.lower().replace(".", "_")
    return name.lower().replace(".", "_")


def infer_template_direction(path: Path) -> str:
    name = path.name
    if name.startswith("forward.templates"):
        return "forward"
    return "retro"


def infer_template_domain(path: Path) -> str:
    source_name = infer_template_source_name(path)
    if infer_template_direction(path) == "forward":
        return "forward_validation"
    if source_name.startswith("uspto") or source_name in {"uspto_50k"}:
        return "public_reaction_corpus"
    if source_name == "ord" or source_name.startswith("ord_"):
        return "public_reaction_corpus"
    if "biocatalysis" in source_name:
        return "biocatalysis"
    if (
        "bkms" in source_name
        or "metabolic" in source_name
        or "metabolism" in source_name
    ):
        return "metabolism"
    return "strict_synthesis"


def discover_template_source_paths(source_dir: Path | str) -> list[Path]:
    root = Path(source_dir)
    if not root.is_dir():
        raise NotADirectoryError(f"Template source directory not found: {root}")
    return sorted(
        path
        for path in root.iterdir()
        if path.is_file() and _is_template_source_file(path)
    )


def discover_standard_template_source_paths(project_root: Path | str) -> list[Path]:
    """Find standard local template sources that live outside the ASKCOS template dir.

    This keeps USPTO/ORD source discovery deterministic: only real files already
    present in the project are returned. Missing ORD exports are not fabricated.
    """
    root = Path(project_root)
    candidates = [
        root
        / "apps/askcos-v2/retro/template_enumeration/data/retro.templates.USPTO_50k.json",
        root / "engines/aizynthfinder/models/uspto_templates.csv.gz",
        root / "engines/aizynthfinder/models/uspto_ringbreaker_templates.csv.gz",
    ]
    for relative_dir in (
        "data/sources/ord",
        "data/raw/ord",
        "data/external/ord",
        "data/compiled/ord_templates",
    ):
        directory = root / relative_dir
        if directory.is_dir():
            candidates.extend(path for path in directory.rglob("*") if path.is_file())
    return sorted(
        {
            path
            for path in candidates
            if path.is_file() and _is_template_source_file(path)
        }
    )


def count_template_records(path: Path) -> int:
    return sum(1 for _ in iter_template_records(path))


def iter_template_records(path: Path) -> Iterable[dict[str, Any]]:
    if _is_csv_template_source_file(path):
        yield from _iter_csv_template_records(path)
        return
    with _open_text(path) as handle:
        first = handle.read(1)
        handle.seek(0)
        if first == "[":
            payload = json.load(handle)
            if isinstance(payload, list):
                for row in payload:
                    if isinstance(row, dict):
                        yield row
            return
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            row = json.loads(stripped)
            if isinstance(row, dict):
                yield row


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("rt", encoding="utf-8")


def _is_template_source_file(path: Path) -> bool:
    name = path.name
    if _is_csv_template_source_file(path):
        return True
    if not (
        name.startswith(("retro.templates.", "forward.templates", "ord.templates."))
    ):
        return False
    return name.endswith((".json.gz", ".jsonl.gz", ".json", ".jsonl"))


def _is_csv_template_source_file(path: Path) -> bool:
    name = path.name
    return name in {
        "uspto_templates.csv",
        "uspto_templates.csv.gz",
        "uspto_ringbreaker_templates.csv",
        "uspto_ringbreaker_templates.csv.gz",
    } or (name.startswith("ord.templates.") and name.endswith((".csv", ".csv.gz")))


def _iter_csv_template_records(path: Path) -> Iterable[dict[str, Any]]:
    source = infer_template_source_name(path)
    with _open_text(path) as handle:
        sample = handle.readline()
        delimiter = "\t" if "\t" in sample else ","
        handle.seek(0)
        reader = csv.DictReader(handle, delimiter=delimiter)
        for row in reader:
            reaction_smarts = str(
                row.get("reaction_smarts")
                or row.get("retro_template")
                or row.get("template")
                or ""
            ).strip()
            if not reaction_smarts:
                continue
            template_hash = str(row.get("template_hash") or "").strip()
            template_code = str(
                row.get("template_code") or row.get("id") or row.get("_id") or ""
            ).strip()
            template_id = template_hash or template_code
            yield {
                "_id": template_id,
                "reaction_smarts": reaction_smarts,
                "count": _safe_int(
                    row.get("library_occurence")
                    or row.get("library_occurrence")
                    or row.get("count"),
                    default=0,
                ),
                "template_set": source,
                "references": [],
                "attributes": {
                    "source_format": "csv",
                    "template_code": template_code,
                    "template_hash": template_hash,
                    "classification": str(row.get("classification") or "").strip(),
                },
            }


def _write_manifest(output: Path, manifest: dict[str, Any]) -> None:
    (output / "template_library_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _askcos_template_filename(*, source: str, direction: str) -> str:
    if direction == "forward":
        return "forward.templates.json.gz"
    return f"retro.templates.{source}.json.gz"


def _raw_templates_for_source(
    database_path: Path,
    *,
    source: str,
    direction: str,
) -> Iterable[dict[str, Any]]:
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute(
            """
            select raw_json
            from templates
            where source = ? and direction = ?
            order by template_count desc, template_id asc
            """,
            (source, direction),
        ).fetchall()
    for (raw_json,) in rows:
        yield json.loads(raw_json)


def _raw_templates_for_direction(
    database_path: Path,
    *,
    direction: str,
) -> Iterable[dict[str, Any]]:
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute(
            """
            select raw_json
            from templates
            where direction = ?
            order by source asc, template_count desc, template_id asc
            """,
            (direction,),
        ).fetchall()
    for (raw_json,) in rows:
        yield json.loads(raw_json)


def _write_template_json_array_gzip(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write("[")
        first = True
        for row in rows:
            if first:
                first = False
            else:
                handle.write(",")
            json.dump(row, handle, ensure_ascii=False)
        handle.write("]")


def _runtime_strategy_manifest(
    *,
    retro_files: dict[str, dict[str, Any]],
    forward_file: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    strategies: dict[str, dict[str, Any]] = {}
    for name, profile in DEFAULT_TEMPLATE_STRATEGIES.items():
        domain = profile.get("domain")
        direction = profile.get("direction", "retro")
        sources = list(profile.get("sources") or [])
        if domain:
            if direction == "forward":
                sources = ["forward"] if forward_file else []
            else:
                sources = [
                    source
                    for source, entry in retro_files.items()
                    if entry["domain"] == domain
                ]
        elif not sources:
            sources = sorted(retro_files)
        elif direction == "retro":
            sources = [source for source in sources if source in retro_files]
        elif direction == "forward":
            sources = ["forward"] if forward_file and "forward" in sources else []
        strategies[name] = {
            "direction": direction,
            "domain": domain,
            "sources": sources,
            "min_count": profile.get("min_count"),
        }
    return strategies


def _create_template_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        create table template_sources (
            source text primary key,
            path text not null,
            template_count integer not null,
            sha256 text not null,
            direction text not null,
            domain text not null
        );
        create table templates (
            template_id text primary key,
            source text not null,
            source_path text not null,
            template_set text not null,
            direction text not null,
            domain text not null,
            reaction_smarts text not null,
            template_count integer not null,
            necessary_reagent text not null,
            intra_only integer not null,
            dimer_only integer not null,
            ring_delta real,
            chiral_delta integer,
            references_json text not null,
            attributes_json text not null,
            raw_json text not null,
            foreign key(source) references template_sources(source)
        );
        create index idx_templates_source_count on templates(source, template_count desc);
        create index idx_templates_direction_count on templates(direction, template_count desc);
        create index idx_templates_domain_count on templates(domain, template_count desc);
        create index idx_templates_template_set on templates(template_set);
        """
    )


def _normalise_template_record(
    *,
    raw: dict[str, Any],
    source: str,
    source_path: Path,
    direction: str,
    domain: str,
) -> TemplateRecord | None:
    reaction_smarts = str(raw.get("reaction_smarts") or "").strip()
    if not reaction_smarts:
        return None
    external_id = str(raw.get("_id") or raw.get("id") or raw.get("index") or "")
    if not external_id:
        external_id = hashlib.sha256(reaction_smarts.encode("utf-8")).hexdigest()[:24]
    attributes = raw.get("attributes")
    if not isinstance(attributes, dict):
        attributes = {}
    references = raw.get("references")
    if not isinstance(references, list):
        references = []
    count = _safe_int(raw.get("count"), default=0)
    template_set = str(raw.get("template_set") or source)
    return TemplateRecord(
        template_id=f"{source}:{external_id}",
        source=source,
        source_path=str(source_path),
        template_set=template_set,
        direction=direction,
        domain=domain,
        reaction_smarts=reaction_smarts,
        count=count,
        necessary_reagent=str(raw.get("necessary_reagent") or ""),
        intra_only=bool(raw.get("intra_only")),
        dimer_only=bool(raw.get("dimer_only")),
        ring_delta=_safe_float(attributes.get("ring_delta")),
        chiral_delta=_safe_optional_int(attributes.get("chiral_delta")),
        references=references,
        attributes=attributes,
        raw=raw,
    )


def _insert_template_record(
    connection: sqlite3.Connection, record: TemplateRecord
) -> None:
    connection.execute(
        """
        insert into templates(
            template_id,
            source,
            source_path,
            template_set,
            direction,
            domain,
            reaction_smarts,
            template_count,
            necessary_reagent,
            intra_only,
            dimer_only,
            ring_delta,
            chiral_delta,
            references_json,
            attributes_json,
            raw_json
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record.template_id,
            record.source,
            record.source_path,
            record.template_set,
            record.direction,
            record.domain,
            record.reaction_smarts,
            record.count,
            record.necessary_reagent,
            int(record.intra_only),
            int(record.dimer_only),
            record.ring_delta,
            record.chiral_delta,
            json.dumps(record.references, ensure_ascii=False),
            json.dumps(record.attributes, ensure_ascii=False),
            json.dumps(record.raw, ensure_ascii=False),
        ),
    )


def _template_strategy(strategy: str | None) -> dict[str, Any]:
    if not strategy:
        return {}
    try:
        return DEFAULT_TEMPLATE_STRATEGIES[strategy]
    except KeyError as exc:
        raise ValueError(f"Unknown template strategy: {strategy}") from exc


def _template_record_from_row(row: tuple[Any, ...]) -> TemplateRecord:
    return TemplateRecord(
        template_id=row[0],
        source=row[1],
        source_path=row[2],
        template_set=row[3],
        direction=row[4],
        domain=row[5],
        reaction_smarts=row[6],
        count=int(row[7]),
        necessary_reagent=row[8],
        intra_only=bool(row[9]),
        dimer_only=bool(row[10]),
        ring_delta=row[11],
        chiral_delta=row[12],
        references=json.loads(row[13]),
        attributes=json.loads(row[14]),
        raw=json.loads(row[15]),
    )


def _safe_int(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
