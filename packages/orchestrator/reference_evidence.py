"""Additive route citations preserving query coverage and source-only evidence."""

from __future__ import annotations

import re

from packages.adapters.askcos.reference_models import ReferenceSearchResponse
from packages.knowledge_base.reaction_models import (
    EvidenceSourceStatus,
    ReactionLibraryResponse,
)
from packages.knowledge_base.reaction_library import verify_evidence_record
from packages.adapters.askcos.evidence_proposals import recorded_candidate_exclusion
from .process_support import process_observations, process_fields


def recorded_support_proofs_are_valid(proofs):
    return isinstance(proofs, list) and bool(proofs) and all(
        isinstance(proof, dict) and isinstance(proof.get("id"), str) and proof["id"].strip()
        and proof.get("source") == "ORD"
        and isinstance(proof.get("snapshot"), str) and re.fullmatch(r"[a-f0-9]{64}", proof["snapshot"])
        and isinstance(proof.get("source_sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", proof["source_sha256"])
        and proof.get("basis") == "exact_recorded_reaction_with_positive_yield"
        for proof in proofs
    )


def recorded_reaction_support(response: ReferenceSearchResponse) -> list[dict]:
    """Positive exact ORD outcomes support a candidate only under recorded conditions."""
    if not isinstance(response, ReactionLibraryResponse):
        return []
    sources = {item.source: item for item in response.sources}
    source = sources.get("ORD")
    if (source is None or not source.ready or not source.snapshot or response.has_more
            or any(not item.ready for item in response.sources)):
        return []
    supported = []
    for record in response.results:
        if (
            record.provenance.source != "ORD" or record.match_scope != "reaction_identity"
            or recorded_candidate_exclusion(record)
        ):
            continue
        verify_evidence_record(record, response.query)
        observations = process_observations(record, response.query.product)
        if observations:
            supported.append({"id": record.id, "source": "ORD", "snapshot": source.snapshot,
                              "source_sha256": record.provenance.source_sha256,
                              "recorded_outcomes": observations,
                              "basis": "exact_recorded_reaction_with_positive_yield"})
    return supported


def reference_evidence(response: ReferenceSearchResponse) -> dict:
    """Counts describe returned records, not experiments or exhaustive coverage.

    Reaction identity compares product and reactant structures only. Recorded
    conditions/yield presence is counted only for that identity, never copied
    onto a proposed step. Even complete search coverage is not validation of
    agents, conditions, outcomes, or experimental success.
    """
    configured_sources = isinstance(response, ReactionLibraryResponse)
    sources = response.sources if configured_sources else [
        EvidenceSourceStatus(
            source="USPTO_FULL", ready=True, product_index_available=True,
        )
    ]
    known_sources = configured_sources and bool(sources)
    available = not sources or any(item.ready for item in sources)
    if response.has_more or any(not item.ready for item in sources):
        search_status = "incomplete"
    else:
        search_status = "complete" if known_sources else "available"
    source_record_count = (
        sum(item.record_count for item in sources)
        if sources and all(item.record_count is not None for item in sources)
        else None
    )
    refs = []
    for row in response.results:
        exact = row.match_scope == "reaction_identity"
        conditions_recorded = bool(
            exact and row.conditions and any(row.conditions.model_dump().values())
        )
        refs.append({
            "id": row.id,
            "url": row.patent_url or getattr(row, "publication_url", None)
            or getattr(row, "source_url", None),
            "match_scope": row.match_scope,
            "source": row.provenance.source,
            "provenance": row.provenance.model_dump(mode="json"),
            "reaction_conditions_recorded": conditions_recorded,
            "reaction_yields_recorded": exact and bool(row.reported_yields),
            "reaction_procedure_recorded": exact and bool(getattr(row, "procedure", None) and row.procedure.strip()),
            **(process_fields(row) if exact and row.provenance.source == "ORD" else {}),
        })
    return {
        "reaction_count": sum(
            row.match_scope == "reaction_identity" for row in response.results
        ),
        "product_count": sum(
            row.match_scope == "product_identity" for row in response.results
        ),
        "refs": refs,
        "search_status": search_status,
        "available": available,
        "complete": search_status == "complete",
        "has_more": response.has_more,
        "source": response.source,
        "sources": [item.model_dump(mode="json") for item in sources],
        "source_record_count": source_record_count,
        "count": response.count,
        "query": response.query.model_dump(mode="json"),
        "requested": response.requested.model_dump(mode="json"),
        "match_basis": response.match_basis,
        "retrieved_at": response.retrieved_at,
        "reaction_match_basis": "product_and_reactant_identity",
        "reaction_identity_excludes": ["agents", "conditions", "outcomes"],
        "reaction_conditions_count": sum(
            row["reaction_conditions_recorded"] for row in refs
        ),
        "reaction_yields_count": sum(row["reaction_yields_recorded"] for row in refs),
    }
