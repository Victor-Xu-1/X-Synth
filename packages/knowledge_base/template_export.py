from __future__ import annotations

import gzip
import json
import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from packages.platform.immutable_sqlite import ImmutableSQLite
from .template_models import DEFAULT_TEMPLATE_STRATEGIES
from .template_schema import validate_template_schema
from .template_export_publication import EXPORT_MANIFEST, publish_export, require_new_destination


def export_template_runtime_assets(
    *,
    database_path: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    """Export independent template knowledge, never replace a trained index."""
    output = Path(output_dir).absolute()
    require_new_destination(output)
    snapshot = ImmutableSQLite(database_path)
    with snapshot.connect(seconds=30) as connection:
        validate_template_schema(connection)
        source_rows = connection.execute(
            "SELECT source,direction,domain,count(*) FROM templates "
            "GROUP BY source,direction,domain ORDER BY source"
        ).fetchall()
    if sum(row[1] == "forward" for row in source_rows) > 1:
        raise ValueError("A single forward export cannot represent multiple source namespaces")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".template-export-", dir=output.parent) as name:
        staging = Path(name)
        runtime = _write_export_bundle(snapshot, staging, output, source_rows)
        snapshot.check()
        publish_export(staging, output, snapshot)
    return runtime


def _write_export_bundle(snapshot, staging, output, source_rows):
    askcos_dir = staging / "askcos_templates"
    askcos_dir.mkdir()
    retro_files: dict[str, dict[str, Any]] = {}
    forward_file: dict[str, Any] | None = None
    unified_retro_count = 0
    for source, direction, domain, template_count in source_rows:
        filename = _askcos_template_filename(source=source, direction=direction)
        path = askcos_dir / filename
        written = _write_template_json_array_gzip(
            path,
            _raw_templates_for_source(
                snapshot, source=source, direction=direction
            ),
        )
        if written != int(template_count):
            raise ValueError("Export count does not match the pinned source group")
        entry = {
            "path": str(output / "askcos_templates" / filename),
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
    written = _write_template_json_array_gzip(
        unified_retro_file,
        _raw_templates_for_direction(snapshot, direction="retro"),
    )
    if written != unified_retro_count:
        raise ValueError("Unified export count does not match its pinned sources")

    runtime = {
        "template_database": str(snapshot.path),
        "evidence_role": "template_knowledge_not_a_trained_model_index",
        "askcos": {
            "template_files": retro_files,
            "unified_retro_templates": {
                "path": str(output / "askcos_templates" / unified_retro_file.name),
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
            "source": str(snapshot.path),
        },
        "retrosim": {
            "status": "requires_similarity_index_builder",
            "source": str(snapshot.path),
        },
    }
    with (staging / EXPORT_MANIFEST).open("x", encoding="utf-8") as handle:
        json.dump(runtime, handle, ensure_ascii=False, indent=2)
    return runtime


def _askcos_template_filename(*, source: str, direction: str) -> str:
    if direction == "forward":
        return "forward.templates.json.gz"
    return f"retro.templates.{source}.json.gz"


def _raw_templates(snapshot, where, params, ordering):
    with snapshot.connect(seconds=30) as connection:
        rows = connection.execute(
            "SELECT raw_json FROM templates WHERE " + where + " ORDER BY " + ordering,
            params,
        )
        for (raw_json,) in rows:
            record = json.loads(raw_json)
            if not isinstance(record, dict):
                raise ValueError("Template export requires original mapping records")
            yield record


def _raw_templates_for_source(snapshot, *, source, direction):
    yield from _raw_templates(
        snapshot, "source=? AND direction=?", (source, direction),
        "template_count DESC,template_id ASC",
    )


def _raw_templates_for_direction(snapshot, *, direction):
    yield from _raw_templates(
        snapshot, "direction=?", (direction,),
        "source ASC,template_count DESC,template_id ASC",
    )


def _write_template_json_array_gzip(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with path.open("xb") as binary, gzip.open(binary, "wt", encoding="utf-8") as handle:
        handle.write("[")
        first = True
        for row in rows:
            if first:
                first = False
            else:
                handle.write(",")
            json.dump(row, handle, ensure_ascii=False)
            written += 1
        handle.write("]")
    return written


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
