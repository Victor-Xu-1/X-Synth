"""Reference projection contracts using real parsed and deposited source records."""

from copy import deepcopy

import pytest

from packages.adapters.askcos.references import (
    ReferenceQuery,
    reference_search_response,
)
from packages.knowledge_base.reaction_models import (
    EvidenceSourceStatus,
    ReactionLibraryResponse,
    RecordedConditions,
)
from packages.orchestrator.reference_evidence import reference_evidence, recorded_reaction_support
from test_reaction_library import public_record, query


def library_response(*, records=None, ready=True, native_count=10, has_more=False):
    original = public_record()
    canonical = query(original, original.reactants)
    sources = [
        EvidenceSourceStatus(
            source="USPTO_FULL",
            ready=ready,
            product_index_available=ready,
            record_count=native_count if ready else None,
            reason=None if ready else "reference_query_timeout",
        ),
        EvidenceSourceStatus(
            source="ORD",
            ready=True,
            product_index_available=True,
            record_count=1,
            conditions_count=1,
            yields_count=1,
            snapshot="a" * 64,
            license="CC-BY-SA-4.0",
        ),
    ]
    selected = [] if records is None else records
    return ReactionLibraryResponse(
        source="OPEN_REACTIONS",
        sources=sources,
        query=canonical,
        requested=canonical.model_copy(deep=True),
        results=selected,
        count=len(selected),
        has_more=has_more,
        retrieved_at="2026-10-07T08:00:00+00:00",
    )


def native_response(*, patent=None, has_more=False):
    documents = [{
        "_id": "USPTO_FULL_parser_contract",
        "template_set": "USPTO_FULL",
        "reaction_smiles": "CBr.[OH-]>>CO.[Br-]",
        "patent_number": patent,
        "text_mined_yield": "0%",
    }]
    if has_more:
        documents.append({**documents[0], "_id": "USPTO_FULL_parser_other"})
    return reference_search_response(
        documents,
        ReferenceQuery(product="CO.[Br-]", reactants=["CBr", "[OH-]"]),
        requested=ReferenceQuery(product="[Br-].OC", reactants=["BrC", "[OH-]"]),
        limit=1,
    )


def test_positive_deposited_exact_reaction_support_is_distinct_from_model_top1():
    record = public_record().model_copy(update={"match_scope": "reaction_identity"})
    response = library_response(records=[record])
    proof = recorded_reaction_support(response)
    assert proof[0]["id"] == record.id
    assert proof[0]["source_sha256"] == record.provenance.source_sha256
    assert proof[0]["basis"] == "exact_recorded_reaction_with_positive_yield"
    assert recorded_reaction_support(library_response(records=[public_record()])) == []
    assert recorded_reaction_support(native_response()) == []
    assert recorded_reaction_support(library_response(records=[record], has_more=True)) == []
    assert recorded_reaction_support(library_response(records=[record], ready=False)) == []


@pytest.mark.parametrize("value", [0, None, -1, 101])
def test_unknown_zero_or_invalid_yields_cannot_support_a_lower_ranked_candidate(value):
    record = public_record().model_copy(deep=True, update={"match_scope": "reaction_identity"})
    record.reported_yields[0].value = value
    assert recorded_reaction_support(library_response(records=[record])) == []


def test_only_reactant_inventory_is_not_recorded_reaction_conditions():
    record = public_record().model_copy(deep=True, update={"match_scope": "reaction_identity", "procedure": None})
    record.conditions.temperature = []
    assert record.conditions.inputs
    assert recorded_reaction_support(library_response(records=[record])) == []


def test_native_reference_without_patent_does_not_access_ord_only_attributes():
    response = native_response()
    assert reference_evidence(response)["refs"][0]["url"] is None


def test_native_projection_preserves_search_identity_without_inventing_totals():
    response = native_response(patent="US1234567A1")
    evidence = reference_evidence(response)
    assert evidence["search_status"] == "available"
    assert evidence["available"] is True and evidence["complete"] is False
    assert evidence["source_record_count"] is None
    assert evidence["sources"][0]["source"] == "USPTO_FULL"
    assert evidence["sources"][0]["ready"] is True
    assert evidence["sources"][0]["record_count"] is None
    assert evidence["query"] == response.query.model_dump(mode="json")
    assert evidence["requested"] == response.requested.model_dump(mode="json")
    assert evidence["retrieved_at"] == response.retrieved_at
    assert evidence["source"] == response.source
    assert evidence["match_basis"] == response.match_basis
    assert evidence["count"] == 1
    assert evidence["reaction_count"] == 1 and evidence["product_count"] == 0
    assert evidence["reaction_yields_count"] == 1  # Zero is recorded, not absent.


def test_source_failure_is_preserved_when_the_available_source_has_no_match():
    response = library_response(ready=False)
    evidence = reference_evidence(response)
    assert evidence["search_status"] == "incomplete"
    assert evidence["available"] is True and evidence["complete"] is False
    assert evidence["has_more"] is False
    assert evidence["source_record_count"] is None
    assert evidence["sources"] == [
        item.model_dump(mode="json") for item in response.sources
    ]
    assert evidence["sources"][0]["reason"] == "reference_query_timeout"
    assert evidence["reaction_count"] == evidence["product_count"] == 0
    assert evidence["refs"] == []


def test_successful_empty_search_is_complete_only_for_queried_sources():
    evidence = reference_evidence(library_response())
    assert evidence["search_status"] == "complete"
    assert evidence["available"] is True and evidence["complete"] is True
    assert evidence["count"] == 0 and evidence["has_more"] is False
    assert evidence["source_record_count"] == 11
    assert evidence["reaction_conditions_count"] == 0
    assert evidence["reaction_yields_count"] == 0


@pytest.mark.parametrize("native", [False, True])
def test_pagination_is_incomplete_not_an_exhaustive_match_count(native):
    record = public_record().model_copy(update={"match_scope": "reaction_identity"})
    response = (
        native_response(patent="US1234567A1", has_more=True)
        if native else library_response(records=[record], has_more=True)
    )
    evidence = reference_evidence(response)
    assert evidence["search_status"] == "incomplete"
    assert evidence["available"] is True and evidence["complete"] is False
    assert evidence["has_more"] is True
    assert evidence["reaction_count"] == 1 and evidence["product_count"] == 0
    assert evidence["count"] == len(evidence["refs"]) == 1


def test_unknown_source_totals_remain_unknown_without_invalidating_query_success():
    evidence = reference_evidence(library_response(native_count=None))
    assert evidence["search_status"] == "complete"
    assert evidence["source_record_count"] is None
    assert evidence["sources"][0]["record_count"] is None


def test_library_response_without_source_metadata_is_available_not_complete():
    response = library_response()
    response.sources.clear()
    evidence = reference_evidence(response)
    assert evidence["search_status"] == "available"
    assert evidence["available"] is True and evidence["complete"] is False
    assert evidence["source_record_count"] is None
    assert evidence["sources"] == []


def test_unavailable_sources_cannot_be_presented_as_a_completed_empty_search():
    response = library_response(ready=False)
    response.sources[1] = EvidenceSourceStatus(
        source="ORD", ready=False, product_index_available=False,
        reason="reaction_library_query_failed",
    )
    evidence = reference_evidence(response)
    assert evidence["available"] is False and evidence["complete"] is False
    assert evidence["search_status"] == "incomplete"
    assert evidence["reaction_count"] == evidence["product_count"] == 0
    assert evidence["sources"][1]["reason"] == "reaction_library_query_failed"


def test_product_only_record_never_contributes_route_conditions_or_yields():
    record = public_record()
    assert record.conditions and record.reported_yields
    response = library_response(records=[record])
    response.query = query(record, record.reactants[:1])
    response.requested = response.query.model_copy(deep=True)
    original = deepcopy(response.model_dump(mode="json"))
    evidence = reference_evidence(response)
    assert evidence["reaction_count"] == 0 and evidence["product_count"] == 1
    assert evidence["reaction_conditions_count"] == 0
    assert evidence["reaction_yields_count"] == 0
    ref = evidence["refs"][0]
    assert ref["reaction_conditions_recorded"] is False
    assert ref["reaction_yields_recorded"] is False
    assert "conditions" not in ref and "reported_yields" not in ref
    assert ref["provenance"] == record.provenance.model_dump(mode="json")
    assert response.model_dump(mode="json") == original


def test_reaction_identity_does_not_claim_matching_agents_or_experimental_outcomes():
    record = public_record().model_copy(update={"match_scope": "reaction_identity"})
    evidence = reference_evidence(library_response(records=[record]))
    assert evidence["reaction_match_basis"] == "product_and_reactant_identity"
    assert evidence["reaction_identity_excludes"] == ["agents", "conditions", "outcomes"]
    assert evidence["reaction_conditions_count"] == evidence["reaction_yields_count"] == 1
    ref = evidence["refs"][0]
    assert ref["reaction_conditions_recorded"] is True
    assert ref["reaction_yields_recorded"] is True
    assert "conditions" not in ref and "reported_yields" not in ref
    assert ref["url"] == record.publication_url


def test_empty_condition_container_and_zero_yield_have_distinct_presence():
    record = public_record().model_copy(update={
        "match_scope": "reaction_identity",
        "conditions": RecordedConditions(),
        "reported_yields": [public_record().reported_yields[0].model_copy(update={"value": 0.0})],
    })
    evidence = reference_evidence(library_response(records=[record]))
    assert evidence["reaction_conditions_count"] == 0
    assert evidence["reaction_yields_count"] == 1


def test_projection_mutation_cannot_change_the_source_evidence():
    response = library_response(records=[public_record()])
    original = deepcopy(response.model_dump(mode="json"))
    evidence = reference_evidence(response)
    evidence["sources"][1]["record_count"] = 999
    evidence["refs"][0]["provenance"]["yield_extraction_fields"].clear()
    evidence["query"]["reactants"].clear()
    evidence["requested"]["reactants"].clear()
    assert response.model_dump(mode="json") == original
