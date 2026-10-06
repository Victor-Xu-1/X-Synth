from __future__ import annotations

import gzip
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from packages.platform.immutable_sqlite import ImmutableSQLite
from .template_models import DEFAULT_TEMPLATE_STRATEGIES
from .template_schema import validate_template_schema

def export_template_runtime_assets(
    *,
    database_path: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    """Export template knowledge; these files are not trained-model output indexes."""
    from .template_library import TemplateLibraryService
    service = TemplateLibraryService(database_path)
    output = Path(output_dir)
    askcos_dir = output / "askcos_templates"
    askcos_dir.mkdir(parents=True, exist_ok=True)

    with service.connect() as connection:
        source_rows = connection.execute(
            """
            select source, direction, domain, count(*)
            from templates
            group by source, direction, domain
            order by source
            """
        ).fetchall()

    if sum(row[1] == "forward" for row in source_rows) > 1:
        raise ValueError("A single forward export cannot represent multiple source namespaces")

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
        "evidence_role": "template_knowledge_not_a_trained_model_index",
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

def _askcos_template_filename(*, source: str, direction: str) -> str:
    if direction == "forward":
        return "forward.templates.json.gz"
    return f"retro.templates.{source}.json.gz"

def _raw_templates(database_path, where, params, ordering):
    snapshot = ImmutableSQLite(database_path)
    with snapshot.connect(seconds=30) as connection:
        validate_template_schema(connection)
        rows = connection.execute(
            "SELECT raw_json FROM templates WHERE " + where + " ORDER BY " + ordering,
            params,
        )
        for (raw_json,) in rows:
            yield json.loads(raw_json)


def _raw_templates_for_source(database_path, *, source, direction):
    yield from _raw_templates(
        database_path, "source=? AND direction=?", (source, direction),
        "template_count DESC,template_id ASC",
    )


def _raw_templates_for_direction(database_path, *, direction):
    yield from _raw_templates(
        database_path, "direction=?", (direction,),
        "source ASC,template_count DESC,template_id ASC",
    )

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
