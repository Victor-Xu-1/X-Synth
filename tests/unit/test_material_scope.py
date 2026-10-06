import pytest

from packages.chemistry.material_scope import material_scope_exclusion, route_scope_exclusions, stored_route_scope_exclusions
from packages.orchestrator.route_request import RouteJobRequest
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy


@pytest.mark.parametrize("smiles", ["CN(CCCl)CCCl", "C[NH+](CCCl)CCCl.[Cl-]", "[13CH3]N(CCCl)CCCl"])
def test_known_listed_parent_is_identified_including_salts_and_isotopes(smiles):
    assert material_scope_exclusion(smiles) == "OPCW-1A6-HN2"


@pytest.mark.parametrize("smiles", ["CN1CCNCC1", "OCCN(CCO)CCO", "CCO", "Cc1ccc(N)cc1"])
def test_ordinary_research_materials_are_not_conflated_with_listed_structures(smiles):
    assert material_scope_exclusion(smiles) is None


def test_scope_guard_does_not_modify_original_identity():
    source = "C[NH+](CCCl)CCCl.[Cl-]"
    material_scope_exclusion(source)
    assert source == "C[NH+](CCCl)CCCl.[Cl-]"


def test_scope_check_precedes_target_submission():
    with pytest.raises(ValueError, match="规划范围"):
        RouteJobRequest(smiles="CN(CCCl)CCCl")


def test_catalogue_closure_does_not_override_material_scope():
    step = RouteStep(step_id="step", reaction_smiles="", precursors=["CN(CCCl)CCCl"], product="CCO", source="native")
    route = RouteCandidate(route_id="candidate", engine="askcos", target_smiles="CCO", steps=[step], starting_materials=["CN(CCCl)CCCl"], closed=True)
    decision = RouteQualityPolicy().evaluate_route(route)
    assert "material_outside_ordinary_research_scope" in decision.reasons
    assert decision.accepted is False
    assert decision.metrics["restricted_material_count"] == 1
    assert route.closed is True
    assert route_scope_exclusions(route) == stored_route_scope_exclusions({"starting_materials": route.starting_materials, "steps": [{"product": step.product, "precursors": step.precursors}]})


def test_stored_candidates_are_not_published_as_procurement_or_route_documents(tmp_path):
    import json
    from fastapi import HTTPException
    from apps.api.job_views import selected_route_data
    from packages.platform.performance import PerformanceBudget

    path = tmp_path / "selected_routes.json"
    original = json.dumps([{"starting_materials": ["CN(CCCl)CCCl"], "steps": []}])
    path.write_text(original)
    with pytest.raises(HTTPException) as caught:
        selected_route_data(path, budget=PerformanceBudget())
    assert caught.value.status_code == 409
    assert path.read_text() == original


@pytest.mark.parametrize("payload", ['"not a list"', '[{"steps":["invalid"]}]'])
def test_malformed_stored_candidates_fail_as_controlled_http_errors(tmp_path, payload):
    from fastapi import HTTPException
    from apps.api.job_views import selected_route_data
    from packages.platform.performance import PerformanceBudget

    path = tmp_path / "selected_routes.json"
    path.write_text(payload)
    with pytest.raises(HTTPException) as caught:
        selected_route_data(path, budget=PerformanceBudget())
    assert caught.value.status_code == 409
