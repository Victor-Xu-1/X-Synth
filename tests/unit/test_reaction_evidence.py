"""Real ORD/SQLite merging; transport doubles exercise failure boundaries only."""

import pytest

from packages.adapters.askcos.references import ReferenceSearchInput, reference_search_response
from packages.adapters.askcos.transport import EngineUnavailable
from packages.knowledge_base.reaction_evidence import ReactionEvidenceService
from packages.knowledge_base.reaction_library import compile_reaction_library
from packages.orchestrator.reference_evidence import reference_evidence
from test_reaction_library import public_record, query, sources
from test_reaction_references import BoundaryTransport


def test_source_drift_after_query_cannot_publish_stale_ord_records(tmp_path, monkeypatch):
    record = public_record()
    canonical = query(record, record.reactants)
    path, replacement = tmp_path / "reactions.sqlite", tmp_path / "replacement.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    compile_reaction_library([record], replacement, sources=sources(record))
    transport = BoundaryTransport(search=reference_search_response(
        [], canonical, limit=1,
    ).model_dump(mode="json"))
    service = ReactionEvidenceService(transport, path)
    original_search = service.library.search

    def replaced_after_query(*args, **kwargs):
        result = original_search(*args, **kwargs)
        replacement.replace(path)
        return result

    monkeypatch.setattr(service.library, "search", replaced_after_query)
    response = service.search(ReferenceSearchInput(
        product=canonical.product, reactants=canonical.reactants, limit=1,
    ), max_atoms=1024)
    assert response.sources[0].ready
    assert not response.sources[1].ready
    assert response.sources[1].reason == "reaction_library_invalid"
    assert response.results == [] and response.count == 0 and not response.has_more


@pytest.mark.parametrize("complete_reactants", [False, True])
def test_available_ord_keeps_record_evidence_separate_from_route_identity(
    tmp_path, complete_reactants,
):
    record = public_record()
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    service = ReactionEvidenceService(
        BoundaryTransport(error=EngineUnavailable("native_http_404")), path,
    )
    response = service.search(ReferenceSearchInput(
        product=record.products[0],
        reactants=record.reactants if complete_reactants else record.reactants[:1],
        limit=1,
    ), max_atoms=1024)
    assert response.sources[0].reason == "reference_endpoint_unavailable"
    assert response.sources[1].ready
    assert response.results[0].conditions == record.conditions
    assert response.results[0].reported_yields == record.reported_yields
    evidence = reference_evidence(response)
    assert evidence["search_status"] == "incomplete" and not evidence["has_more"]
    assert evidence["reaction_count"] == int(complete_reactants)
    assert evidence["product_count"] == int(not complete_reactants)
    assert evidence["reaction_conditions_count"] == int(complete_reactants)
    assert evidence["reaction_yields_count"] == int(complete_reactants)
    assert "conditions" not in evidence["refs"][0]
    assert "reported_yields" not in evidence["refs"][0]


def test_merged_limit_keeps_source_totals_distinct_from_returned_match_counts(tmp_path):
    record = public_record()
    canonical = query(record, record.reactants)
    path = tmp_path / "reactions.sqlite"
    compile_reaction_library([record], path, sources=sources(record))
    native = reference_search_response([{
        "_id": "USPTO_FULL_merge_boundary_contract",
        "template_set": "USPTO_FULL",
        "reaction_smiles": record.reaction_smiles,
    }], canonical, limit=1)
    service = ReactionEvidenceService(
        BoundaryTransport(search=native.model_dump(mode="json")), path,
    )
    response = service.search(ReferenceSearchInput(
        product=canonical.product, reactants=canonical.reactants, limit=1,
    ), max_atoms=1024)
    assert response.count == 1 and response.has_more
    assert response.results[0].provenance.source == "ORD"
    evidence = reference_evidence(response)
    assert evidence["reaction_count"] == 1
    assert evidence["search_status"] == "incomplete"
    assert evidence["source_record_count"] is None  # Native total was not reported.
    assert all(item["ready"] for item in evidence["sources"])
