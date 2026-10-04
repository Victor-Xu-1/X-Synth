"""Bounded ORD extraction workers feeding the single authoritative compiler."""

from __future__ import annotations

import multiprocessing
import tempfile
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from .ord_extract import OrdExtractionStats, OrdReadError, iter_ord_evidence
from .ord_reader import VerifiedOrdSource
from .reaction_models import ReactionEvidence


class OrdImportError(ValueError):
    pass


def _evidence(
    source: VerifiedOrdSource, stats: OrdExtractionStats, row_group: int | None = None
):
    source.check_unchanged()
    yield from iter_ord_evidence(
        source.local_path,
        source_path=source.path,
        source_sha256=source.sha256,
        source_revision=source.revision,
        stats=stats,
        row_group=row_group,
    )
    source.check_unchanged()


def _report(
    source: VerifiedOrdSource, stats: OrdExtractionStats, error: str | None = None
) -> dict:
    return {
        "path": source.path,
        "sha256": source.sha256,
        "error": error,
        "complete": error is None and stats.rows_seen == stats.source_rows,
        **stats.as_dict(),
    }


def _extract_spool(task: tuple[VerifiedOrdSource, Path, int]) -> dict:
    source, spool, row_group = task
    stats = OrdExtractionStats()
    error = None
    try:
        with spool.open("x", encoding="utf-8") as handle:
            for record in _evidence(source, stats, row_group):
                handle.write(record.model_dump_json() + "\n")
    except (OSError, ValueError, OrdReadError) as exc:
        error = f"{type(exc).__name__}: {exc}"
    return _report(source, stats, error)


def _serial(
    sources: list[VerifiedOrdSource], reports: list[dict]
) -> Iterator[ReactionEvidence]:
    for source in sources:
        stats = OrdExtractionStats()
        error = None
        try:
            yield from _evidence(source, stats)
        except (OSError, ValueError, OrdReadError) as exc:
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            reports.append(_report(source, stats, error))


def _parallel(
    sources: list[VerifiedOrdSource],
    reports: list[dict],
    *,
    workers: int,
    staging_root: Path,
) -> Iterator[ReactionEvidence]:
    import pyarrow.parquet as pq

    # Workers spool typed records, not independent indexes. The parent consumes
    # source order deterministically and remains the only SQLite publisher.
    with tempfile.TemporaryDirectory(
        prefix=".ord-extract-", dir=staging_root
    ) as directory:
        tasks, by_source = [], {}
        for source in sources:
            source.check_unchanged()
            with pq.ParquetFile(source.local_path) as file:
                report = _report(
                    source, OrdExtractionStats(source_rows=file.metadata.num_rows)
                )
                report.update(
                    complete=False,
                    row_groups=file.num_row_groups,
                    row_groups_processed=0,
                )
                reports.append(report)
                by_source[source.path] = report
                for group in range(file.num_row_groups):
                    tasks.append(
                        (source, Path(directory) / f"{len(tasks):06d}.jsonl", group)
                    )
        context = multiprocessing.get_context("spawn")
        with ProcessPoolExecutor(max_workers=workers, mp_context=context) as pool:
            results = pool.map(_extract_spool, tasks, chunksize=1)
            failed = False
            for (source, spool, _), result in zip(tasks, results, strict=True):
                report = by_source[source.path]
                _merge_shard(report, result)
                source.check_unchanged()
                if result["error"]:
                    failed = True
                    continue
                with spool.open(encoding="utf-8") as handle:
                    for line in handle:
                        yield ReactionEvidence.model_validate_json(line)
                spool.unlink()
            if failed:
                raise OrdImportError("ORD worker failure; no library may be published")


def _merge_shard(report: dict, shard: dict) -> None:
    report["row_groups_processed"] += 1
    for key, value in shard.items():
        if type(value) is int and key not in ("source_rows", "unread_rows"):
            report[key] += value
    for field in ("rejection_reasons", "representation_gaps"):
        for key, value in shard[field].items():
            report[field][key] = report[field].get(key, 0) + value
    report["issue_samples"] = (report["issue_samples"] + shard["issue_samples"])[:20]
    report["unread_rows"] = report["source_rows"] - report["rows_seen"]
    if shard["error"]:
        report["error"] = shard["error"]
    report["complete"] = (
        report["row_groups_processed"] == report["row_groups"]
        and report["error"] is None
    )


def iter_import_records(
    sources: list[VerifiedOrdSource],
    *,
    reports: list[dict],
    workers: int,
    staging_root: Path,
    allow_rejected: bool,
) -> Iterator[ReactionEvidence]:
    if not 1 <= workers <= 4:
        raise ValueError("ORD extraction workers must be between 1 and 4")
    if workers == 1:
        yield from _serial(sources, reports)
    else:
        yield from _parallel(
            sources, reports, workers=workers, staging_root=staging_root
        )
    for source in sources:
        source.check_unchanged()
    if not allow_rejected and any(
        item["rejected_reactions"] or item["rejected_outcomes"] for item in reports
    ):
        raise OrdImportError(
            "ORD records were rejected; inspect statistics or explicitly use --allow-rejected"
        )


def extraction_totals(reports: list[dict]) -> dict:
    totals, reasons, gaps = {}, {}, {}
    for report in reports:
        for key, value in report.items():
            if type(value) is int:
                totals[key] = totals.get(key, 0) + value
        for key, value in report["rejection_reasons"].items():
            reasons[key] = reasons.get(key, 0) + value
        for key, value in report["representation_gaps"].items():
            gaps[key] = gaps.get(key, 0) + value
    return {
        **totals,
        "files_processed": sum(item["complete"] for item in reports),
        "rejection_reasons": reasons,
        "representation_gaps": gaps,
    }
