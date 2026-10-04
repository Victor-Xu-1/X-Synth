"""Streaming ORD Parquet extraction with auditable rejection/coverage statistics."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from .ord_measurements import recorded_conditions, recorded_yields, representation_gaps
from .ord_reader import (
    ORD_LICENSE, OrdRecordError, file_fingerprint, official_source_url, public_publication_url,
    validate_source_identity,
)
from .ord_structures import audit_ord_structures, evidence_reaction_smiles
from .reaction_models import EvidenceProvenance, ReactionEvidence


@dataclass
class OrdExtractionStats:
    source_rows: int = 0
    rows_seen: int = 0
    reactions_seen: int = 0
    outcomes_seen: int = 0
    records_emitted: int = 0
    reactions_emitted: int = 0
    rejected_reactions: int = 0
    rejected_outcomes: int = 0
    multiple_outcome_reactions: int = 0
    conditions_records: int = 0
    yield_records: int = 0
    yield_measurements: int = 0
    zero_yield_measurements: int = 0
    text_only_yield_measurements: int = 0
    missing_yield_analyses: int = 0
    rejection_reasons: Counter = field(default_factory=Counter)
    representation_gaps: Counter = field(default_factory=Counter)
    issue_samples: list[dict] = field(default_factory=list)

    def note(self, reaction_id: str, reason: str, *, source_field: str | None = None,
             detail: str | None = None) -> None:
        if len(self.issue_samples) < 20:
            self.issue_samples.append({"reaction_id": reaction_id, "reason": reason,
                                       "source_field": source_field, "detail": detail})

    def as_dict(self) -> dict:
        result = {
            key: value for key, value in vars(self).items()
            if key not in ("rejection_reasons", "representation_gaps", "issue_samples")
        }
        return {
            **result, "unread_rows": self.source_rows - self.rows_seen,
            "rejection_reasons": dict(sorted(self.rejection_reasons.items())),
            "representation_gaps": dict(sorted(self.representation_gaps.items())),
            "issue_samples": list(self.issue_samples),
        }

    def emitted(self, record: ReactionEvidence) -> None:
        self.records_emitted += 1
        self.conditions_records += int(record.conditions is not None)
        self.yield_records += int(bool(record.reported_yields))
        for measurement in record.reported_yields:
            self.yield_measurements += 1
            self.zero_yield_measurements += int(measurement.value == 0.0)
            self.text_only_yield_measurements += int(measurement.value is None)
            if measurement.analysis and not json.loads(measurement.analysis)["analysis_record_present"]:
                self.missing_yield_analyses += 1


class OrdReadError(RuntimeError):
    def __init__(self, source_path: str, stats: OrdExtractionStats):
        self.source_path, self.stats = source_path, stats
        super().__init__(f"ORD Parquet read failed after {stats.rows_seen} rows: {source_path}")


def _publication_fields(reaction) -> dict:
    provenance = reaction.provenance
    patent = provenance.patent or None
    patent_url = None
    if patent and re.fullmatch(r"[A-Z]{2}[0-9]{5,14}(?:[A-Z][0-9]?)?", patent):
        patent_url = "https://patents.google.com/patent/" + patent
    return {
        "doi": provenance.doi or None, "patent_number": patent, "patent_url": patent_url,
        "publication_url": public_publication_url(provenance.publication_url),
        "procedure": reaction.notes.procedure_details or None,
    }


def _reaction_records(reaction, *, dataset_id: str, dataset_name: str, source_path: str,
                      source_sha256: str, source_revision: str, stats: OrdExtractionStats):
    identity = reaction.reaction_id
    if not re.fullmatch(r"ord-[a-f0-9]{32}", identity):
        raise OrdRecordError("invalid_reaction_id")
    structures = audit_ord_structures(reaction)
    for index, reason in structures.rejected_outcomes:
        stats.rejected_outcomes += 1
        stats.rejection_reasons[reason] += 1
        stats.note(identity, reason, source_field=f"outcomes[{index}]")
    for reason, source_field in representation_gaps(reaction):
        stats.representation_gaps[reason] += 1
        stats.note(identity, reason, source_field=source_field)
    groups = defaultdict(list)
    for outcome in structures.outcomes:
        groups[outcome.products].append(outcome)
    emitted = 0
    for products, outcomes in sorted(groups.items()):
        try:
            record_id = identity
            if len(groups) > 1:
                signature = hashlib.sha256(json.dumps(products, separators=(",", ":")).encode()).hexdigest()[:24]
                record_id += ":products:" + signature
            smiles, reactants, product_list, agents = evidence_reaction_smiles(structures, products)
            yields = recorded_yields(reaction, outcomes)
            record = ReactionEvidence(
                id=record_id, reaction_smiles=smiles, reactants=reactants,
                products=product_list, agents=agents, match_scope="product_identity",
                reported_yields=yields,
                conditions=recorded_conditions(reaction, structures, [item.index for item in outcomes]),
                provenance=EvidenceProvenance(
                    source="ORD", record_id=record_id, evidence_type="structured_reaction_record",
                    yield_extraction_fields=["ord_product_measurement"] if yields else [],
                    dataset_id=dataset_id, dataset_name=dataset_name or None,
                    source_sha256=source_sha256, source_path=source_path, license=ORD_LICENSE,
                    original_reaction_id=identity, outcome_indices=[item.index for item in outcomes],
                ),
                source_url=official_source_url(source_path, source_revision), **_publication_fields(reaction),
            )
        except (OrdRecordError, ValidationError, ValueError, RuntimeError) as exc:
            reason = exc.code if isinstance(exc, OrdRecordError) else "evidence_contract_violation"
            stats.rejected_outcomes += len(outcomes)
            stats.rejection_reasons[reason] += len(outcomes)
            detail = json.dumps(exc.errors(include_input=False, include_context=False)) if isinstance(exc, ValidationError) else str(exc)
            stats.note(identity, reason, source_field=",".join(f"outcomes[{item.index}]" for item in outcomes), detail=detail[:1024])
            continue
        stats.emitted(record)
        if emitted == 0:
            stats.reactions_emitted += 1
        emitted += 1
        yield record
    if not emitted:
        stats.rejected_reactions += 1


def iter_ord_evidence(path: Path, *, source_path: str, source_sha256: str,
                      source_revision: str, stats: OrdExtractionStats | None = None,
                      row_group: int | None = None) -> Iterator[ReactionEvidence]:
    """Read only current ORD Parquet; caller verifies the source hash beforehand.

    All structural rejections are counted even when some records remain usable.
    Unreadable Parquet/protobuf aborts the stream instead of reporting success.
    """
    from ord_schema import parquet

    path = Path(path)
    expected_id = "ord_dataset-" + validate_source_identity(source_path, source_sha256, source_revision)
    if path.suffix != ".parquet":
        raise ValueError("ORD evidence import accepts only official Parquet files")
    stats = stats if stats is not None else OrdExtractionStats()
    fingerprint = file_fingerprint(path)
    try:
        view = parquet.DatasetView(path)
        if view.dataset_id != expected_id:
            raise ValueError("ORD footer dataset identity disagrees with the manifest path")
        if row_group is None:
            stats.source_rows += len(view.reactions)
        else:
            import pyarrow.parquet as pq

            if type(row_group) is not int or not 0 <= row_group < view.num_row_groups:
                raise ValueError("ORD row_group is outside the source file")
            with pq.ParquetFile(path) as source:
                stats.source_rows += source.metadata.row_group(row_group).num_rows
        iterator = iter(view.iter_reactions(row_group=row_group))
        while True:
            try:
                row_id, reaction = next(iterator)
            except StopIteration:
                break
            except Exception as exc:
                stats.rejection_reasons["parquet_or_protobuf_read_error"] += 1
                raise OrdReadError(source_path, stats) from exc
            stats.rows_seen += 1
            stats.reactions_seen += 1
            stats.outcomes_seen += len(reaction.outcomes)
            stats.multiple_outcome_reactions += int(len(reaction.outcomes) > 1)
            try:
                if row_id != reaction.reaction_id:
                    raise OrdRecordError("row_reaction_id_mismatch")
                yield from _reaction_records(
                    reaction, dataset_id=view.dataset_id, dataset_name=view.name,
                    source_path=source_path, source_sha256=source_sha256,
                    source_revision=source_revision, stats=stats,
                )
            except OrdRecordError as exc:
                stats.rejected_reactions += 1
                stats.rejected_outcomes += len(reaction.outcomes)
                stats.rejection_reasons[exc.code] += 1
                stats.note(row_id, exc.code)
        if stats.rows_seen != stats.source_rows:
            raise ValueError("ORD row count disagrees with the Parquet footer")
    finally:
        if file_fingerprint(path) != fingerprint:
            raise ValueError("ORD source changed during streaming extraction")
