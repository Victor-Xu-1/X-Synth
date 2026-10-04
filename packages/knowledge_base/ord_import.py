"""Bounded ORD extraction workers feeding the single authoritative compiler."""

from __future__ import annotations

import multiprocessing
import tempfile
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from contextlib import closing, nullcontext
from multiprocessing.util import Finalize
from pathlib import Path

from .ord_extract import OrdExtractionStats, OrdReadError, iter_ord_evidence
from .ord_incremental import (
    OrdBaselineIdentity,
    OrdBaselineLookup,
    VerifiedOrdBaseline,
)
from .ord_reader import VerifiedOrdSource
from .reaction_models import ReactionEvidence


class OrdImportError(ValueError):
    pass


_worker_baseline: OrdBaselineLookup | None = None


def _initialize_worker(identity: OrdBaselineIdentity | None) -> None:
    global _worker_baseline
    if identity is not None:
        _worker_baseline = OrdBaselineLookup(identity)
        Finalize(_worker_baseline, _worker_baseline.close, exitpriority=10)


def _evidence(
    source: VerifiedOrdSource,
    stats: OrdExtractionStats,
    row_group: int | None = None,
    baseline: OrdBaselineLookup | None = None,
):
    source.check_unchanged()
    for record in iter_ord_evidence(
        source.local_path,
        source_path=source.path,
        source_sha256=source.sha256,
        source_revision=source.revision,
        stats=stats,
        row_group=row_group,
        baseline=baseline,
    ):
        if baseline is not None and baseline.matches_existing(record):
            if (
                record.provenance.original_reaction_id
                in baseline.identity.recheck_reaction_ids
            ):
                stats.records_rechecked_existing += 1
            else:
                stats.records_skipped_existing += 1
                continue
        else:
            stats.records_new_emitted += 1
        yield record
    source.check_unchanged()
    if baseline is not None:
        baseline.identity.check_unchanged()


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
            for record in _evidence(source, stats, row_group, _worker_baseline):
                handle.write(record.model_dump_json() + "\n")
    except (OSError, ValueError, OrdReadError) as exc:
        error = f"{type(exc).__name__}: {exc}"
    return _report(source, stats, error)


def _serial(
    sources: list[VerifiedOrdSource],
    reports: list[dict],
    baseline: OrdBaselineLookup | None = None,
) -> Iterator[ReactionEvidence]:
    for source in sources:
        stats = OrdExtractionStats()
        error = None
        try:
            yield from _evidence(source, stats, baseline=baseline)
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
    baseline: OrdBaselineIdentity | None = None,
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
        with ProcessPoolExecutor(
            max_workers=workers,
            mp_context=context,
            initializer=_initialize_worker,
            initargs=(baseline,),
        ) as pool:
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
    report["rechecked_reaction_ids_seen"] = sorted(
        set(report["rechecked_reaction_ids_seen"])
        | set(shard["rechecked_reaction_ids_seen"])
    )
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
    base_library: VerifiedOrdBaseline | None = None,
) -> Iterator[ReactionEvidence]:
    if not 1 <= workers <= 4:
        raise ValueError("ORD extraction workers must be between 1 and 4")
    identity = None
    if base_library is not None:
        if tuple(sources) != base_library.identity.sources:
            raise OrdImportError(
                "Incremental extraction must retain the complete baseline source set"
            )
        yield from base_library.iter_records()
        identity = base_library.freeze()
    try:
        with (
            OrdBaselineLookup(identity)
            if identity is not None and (
                workers == 1 or identity.recheck_reaction_ids
            )
            else nullcontext()
        ) as baseline:
            if workers == 1:
                extracted = _serial(sources, reports, baseline)
            else:
                extracted = _parallel(
                    sources,
                    reports,
                    workers=workers,
                    staging_root=staging_root,
                    baseline=identity,
                )
            with closing(extracted):
                for record in extracted:
                    if base_library is not None and baseline is not None:
                        base_library.note_rechecked_record(record, baseline)
                    yield record
    finally:
        if identity is not None:
            identity.check_unchanged()
    for source in sources:
        source.check_unchanged()
    if base_library is not None:
        base_library.check_raw_rechecks_seen(reports)
    if not allow_rejected and any(
        item["rejected_reactions"] or item["rejected_outcomes"] for item in reports
    ):
        raise OrdImportError(
            "ORD records were rejected; inspect statistics or explicitly use --allow-rejected"
        )


def extraction_totals(reports: list[dict]) -> dict:
    totals, reasons, gaps = {}, {}, {}
    rechecks_seen = set()
    for report in reports:
        rechecks_seen.update(report["rechecked_reaction_ids_seen"])
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
        "reactions_recheck_seen": len(rechecks_seen),
        "rejection_reasons": reasons,
        "representation_gaps": gaps,
    }
