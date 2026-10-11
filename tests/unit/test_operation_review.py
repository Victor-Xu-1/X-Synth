"""Real deposited ORD evidence, captured inference and receipt boundaries."""

from copy import deepcopy

import pytest
from fastapi import HTTPException

from apps.api.job_views import delivery_routes
from packages.knowledge_base.reaction_models import RecordedParameter
from packages.orchestrator.delivery_review import delivery_review
from packages.orchestrator.delivery_review import independent_review
from packages.orchestrator.operation_review import (
    _support_bound, operation_record, operation_receipt, operation_records_validated, operations_summary,
)
from packages.orchestrator.reference_evidence import reference_evidence, recorded_reaction_support
from packages.orchestrator.review_policy import REVIEW_POLICY
from packages.route_schema.route_schema import RouteStep
from packages.validation.reaction_operations import screen_step_operations
from test_delivery_review import BUDGET, reviewed
from test_reaction_library import public_record
from test_reference_evidence import library_response
from test_reaction_operations import step, REDUCTIVE_COUPLING


def recorded():
    record = public_record().model_copy(deep=True, update={"match_scope": "reaction_identity"})
    response = library_response(records=[record])
    route_step = RouteStep("s1", record.reaction_smiles, record.reactants, record.products[0], "ORD")
    return record, response, route_step


def test_actual_ord_fields_bind_positive_outcome_conditions_and_target():
    record, response, route_step = recorded()
    proof = recorded_reaction_support(response)
    assert proof[0]["recorded_outcomes"][0]["yield_source_field"] == record.reported_yields[0].source_field
    assert _support_bound(proof, route_step, reference_evidence(response))


@pytest.mark.parametrize("field", ['inputs["base"].addition_time', 'inputs["base"].addition_duration', 'outcomes[1].reaction_time'])
def test_addition_or_another_outcome_time_is_not_a_reaction_condition(field):
    record, response, _ = recorded()
    record.procedure = None
    record.conditions.temperature = []
    record.conditions.time = [RecordedParameter(value=10, unit="MINUTE", source_field=field)]
    assert recorded_reaction_support(response) == []


def test_matching_recorded_outcome_time_can_support_the_process():
    record, response, _ = recorded()
    record.procedure = None
    record.conditions.temperature = []
    record.conditions.time = [RecordedParameter(value=10, unit="MINUTE", source_field="outcomes[0].reaction_time")]
    assert recorded_reaction_support(response)


def test_actual_procedure_support_is_distinct_from_missing_numeric_conditions():
    record, response, route_step = recorded()
    record.conditions = None
    proof = recorded_reaction_support(response)
    assert proof and proof[0]["recorded_outcomes"][0]["condition_source_fields"] == ["procedure"]
    assert _support_bound(proof, route_step, reference_evidence(response))


@pytest.mark.parametrize("tamper", ["product", "reactants", "source", "yield", "zero", "scope", "other_outcome", "addition_field", "truncated"])
def test_operation_support_cannot_be_spliced_or_relabelled(tamper):
    _, response, route_step = recorded()
    proof = recorded_reaction_support(response)
    refs = reference_evidence(response)
    observation = proof[0]["recorded_outcomes"][0]
    if tamper == "product": observation["product_smiles"] = "CCO"
    elif tamper == "reactants": refs["query"]["reactants"] = ["CCO"]
    elif tamper == "source": proof[0]["source_sha256"] = "b" * 64
    elif tamper == "yield": observation["yield_source_field"] = "outcomes[0].products[0].measurements[1]"
    elif tamper == "zero": observation["yield_value"] = 0
    elif tamper == "scope": refs["refs"][0]["match_scope"] = "product_identity"
    elif tamper == "other_outcome": observation["outcome_index"] = 1
    elif tamper == "addition_field": observation["condition_source_fields"] = ['inputs["base"].addition_time']
    elif tamper == "truncated": refs["has_more"] = True
    assert not _support_bound(proof, route_step, refs)


def current_review(route):
    route = deepcopy(route)
    metadata, review = route["metadata"], route["metadata"]["automated_review"]
    review["version"] = 3
    forward = review["forward"]
    forward.update(model_top1_matched_steps=1, record_supported_steps=0)
    forward["records"][0].update(model_top1_matched=True, record_support=[], support_kind="model_top1")
    source = RouteStep(**route["steps"][0])
    review["operations"] = operations_summary([operation_record(source, screen_step_operations(source), [])], 1)
    review["references"] = {"records": []}
    metadata["operation_validation_passed"] = True
    return route


@pytest.mark.parametrize("policy", ["exact_stock_graph2smiles_operation_evidence_v5", REVIEW_POLICY])
def test_current_real_forward_receipt_requires_operation_ledger_not_a_boolean(reviewed, policy):
    route = current_review(reviewed)
    assert operation_records_validated(route)
    assert delivery_routes([route], job={"checkpoint": {"review_policy": policy}}, budget=BUDGET)
    del route["metadata"]["automated_review"]["operations"]
    assert not operation_records_validated(route)
    with pytest.raises(HTTPException) as error:
        delivery_routes([route], job={"checkpoint": {"review_policy": policy}}, budget=BUDGET)
    assert error.value.status_code == 409


@pytest.mark.parametrize("tamper", ["hash", "status", "count", "bool_count", "bool_center", "duplicate", "version"])
def test_current_operation_ledger_is_step_and_version_bound(reviewed, tamper):
    route = current_review(reviewed)
    review = route["metadata"]["automated_review"]
    ledger, row = review["operations"], review["operations"]["records"][0]
    if tamper == "hash": row["template_sha256"] = ["a" * 64]
    elif tamper == "status": row["status"] = "record_supported"
    elif tamper == "count": ledger["screened_steps"] += 1
    elif tamper == "bool_count": ledger["total_steps"] = True
    elif tamper == "bool_center": row["center_count"] = False
    elif tamper == "duplicate": ledger["records"].append(row)
    elif tamper == "version": review["version"] = 2
    assert not operation_records_validated(route)


def test_legacy_compound_step_is_not_certified_by_a_claim_or_another_reaction_record():
    source = step(REDUCTIVE_COUPLING)
    route = {"steps": [source.__dict__], "starting_materials": source.precursors,
             "metadata": {"operation_validation_passed": True}}
    original = deepcopy(route)
    assert operation_receipt(route)["status"] == "evidence_required"
    assert delivery_review(route)["grade"] == "operation_evidence_required"
    assert route == original and not operation_records_validated(route)


@pytest.mark.parametrize("ledger", [True, [], {"records": [{"step_id": []}]}, {"records": False}])
def test_malformed_operation_ledger_does_not_erase_detected_risk(ledger):
    source = step(REDUCTIVE_COUPLING)
    route = {"steps": [source.__dict__], "metadata": {"automated_review": {"version": 3, "operations": ledger}}}
    assert operation_receipt(route)["status"] == "evidence_required"


@pytest.mark.parametrize("tamper", ["missing", "wrong_target", "zero_yield", "other_outcome"])
def test_v3_lower_rank_support_needs_bound_outcomes_even_for_an_ordinary_step(reviewed, tamper):
    record, response, source = recorded()
    # Receipt-binding controls, not a new claim of model inference for this record.
    baseline = deepcopy(reviewed)
    baseline.update(target_smiles=source.product, starting_materials=source.precursors, steps=[source.__dict__])
    route = current_review(baseline)
    proof = recorded_reaction_support(response)
    row = route["metadata"]["automated_review"]["forward"]["records"][0]
    row.update(expected_rank=2, model_top1_matched=False, support_kind="record_supported_model_candidate", record_support=proof)
    forward = route["metadata"]["automated_review"]["forward"]
    forward.update(model_top1_matched_steps=0, record_supported_steps=1)
    reference = reference_evidence(response)
    reference["step_id"] = "s1"
    route["metadata"]["automated_review"]["references"] = {"records": [reference]}
    assert independent_review(route)["status"] == "checked"
    assert record.reported_yields[0].value > 0
    if tamper == "missing": del proof[0]["recorded_outcomes"]
    elif tamper == "wrong_target": proof[0]["recorded_outcomes"][0]["product_smiles"] = "CCO"
    elif tamper == "zero_yield": proof[0]["recorded_outcomes"][0]["yield_value"] = 0
    elif tamper == "other_outcome": proof[0]["recorded_outcomes"][0]["outcome_index"] = 1
    assert independent_review(route)["status"] == "invalid"
    route["metadata"]["automated_review"]["version"] = 2
    assert independent_review(route)["status"] == "checked"
