"""Receipt contracts using preserved scientific fixtures, without model calls."""

from copy import deepcopy
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from apps.api.job_views import delivery_routes, job_response, result_record, selected_route_data, selected_routes_for_job
from packages.orchestrator.review_policy import REVIEW_POLICY
from packages.orchestrator.route_artifacts import RouteArtifactStore
from packages.orchestrator.delivery_review import delivery_review, history_delivery_review, with_delivery_review
from packages.workspace.history_projection import historical_routes


BUDGET = SimpleNamespace(response_bytes=32 * 1024**2)


@pytest.fixture
def audit_dir():
    path = Path(os.environ.get("X_SYNTH_DELIVERY_AUDIT_DIR", "/mnt/c/Users/Victor/Documents/New project/work/x-synth-scientific-deliverable-audit"))
    if not path.is_dir():
        pytest.skip("Preserved delivery audit not available; no substitute model provider")
    return path


def captured(path, identifier):
    return json.loads((path / f"{identifier}.json").read_text(encoding="utf-8"))


@pytest.fixture
def reviewed(audit_dir):
    return captured(audit_dir, "64997fb571744993b7511c6428f0e4f7")["result"]["unified_route_pool"]["selected_routes"][0]


def test_native_fixture_projects_only_additive_unreviewed_metadata():
    source = Path(__file__).parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    routes = historical_routes(json.loads(source.read_text()))
    before = deepcopy(routes)
    projected = delivery_routes(routes, budget=BUDGET)
    for original, route in zip(routes, projected, strict=True):
        assert route["metadata"].pop("delivery_review")["independent_review"]["status"] == "missing"
        assert route == original
    assert routes == before


@pytest.mark.parametrize("identifier,version,grade", [
    ("110515bcaa4c437b9a51930225649249", None, "not_independently_reviewed"),
    ("64997fb571744993b7511c6428f0e4f7", 1, "model_checked"),
    ("a4d86b7d5dfa43a8a0a8aae58b28d854", 2, "model_checked"),
])
def test_existing_receipts_grade_without_demanding_exact_literature(audit_dir, identifier, version, grade):
    payload = captured(audit_dir, identifier)
    routes = payload["result"]["unified_route_pool"]["selected_routes"]
    original = deepcopy(routes)
    receipt = delivery_review(routes[0])
    assert receipt["grade"] == grade
    assert receipt["version"] == 1 and receipt["phase"] == "automated_review"
    assert receipt["independent_review"].get("review_version") == version
    assert routes == original


def test_entire_preserved_population_is_read_only_and_phase_bounded(audit_dir):
    routes = legacy = checked = unresolved = steps = 0
    for path in sorted(audit_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        selected = payload.get("result", {}).get("unified_route_pool", {}).get("selected_routes", []) if isinstance(payload, dict) else []
        original = deepcopy(selected)
        for route in selected:
            receipt = with_delivery_review(route)["metadata"]["delivery_review"]
            routes += 1
            steps += len(route["steps"])
            legacy += receipt["independent_review"]["status"] == "missing"
            checked += receipt["independent_review"]["status"] == "checked"
            unresolved += receipt["purchase_identity"]["status"] == "unresolved"
            assert "experiment" not in json.dumps(receipt)
        assert selected == original
    assert (routes, steps, legacy, checked) == (80, 164, 51, 29)
    assert unresolved == 1


@pytest.mark.parametrize("tamper", ["boolean_only", "version", "bool_version", "wrong_step", "duplicate_step",
    "wrong_count", "bool_count", "missing_record", "wrong_model", "missing_id", "missing_score",
    "nan_score", "huge_score", "rank_two", "bool_rank", "wrong_matched", "false_flag", "metadata", "review", "steps"])
def test_malformed_or_unknown_review_never_certifies(reviewed, tamper):
    route = deepcopy(reviewed)
    metadata = route["metadata"]
    review, row = metadata["automated_review"], metadata["automated_review"]["forward"]["records"][0]
    if tamper == "boolean_only": del metadata["automated_review"]
    elif tamper == "version": review["version"] = 99
    elif tamper == "bool_version": review["version"] = True
    elif tamper == "wrong_step": row["step_id"] = "not-in-route"
    elif tamper == "duplicate_step": route["steps"] *= 2
    elif tamper == "wrong_count": review["forward"]["matched_steps"] += 1
    elif tamper == "bool_count": review["forward"]["total_steps"] = True
    elif tamper == "missing_record": review["forward"]["records"] = []
    elif tamper == "wrong_model": row["model"] = "template_reconstruction"
    elif tamper == "missing_id": row["record_id"] = None
    elif tamper == "missing_score": row["feasibility_score"] = None
    elif tamper == "nan_score": row["feasibility_score"] = float("nan")
    elif tamper == "huge_score": row["feasibility_score"] = 10**400
    elif tamper == "rank_two": row["expected_rank"] = 2
    elif tamper == "bool_rank": row["expected_rank"] = True
    elif tamper == "wrong_matched": row["matched"] = "true"
    elif tamper == "false_flag": metadata["full_forward_prediction_validated"] = False
    elif tamper == "metadata": route["metadata"] = []
    elif tamper == "review": metadata["automated_review"] = True
    elif tamper == "steps": route["steps"] = None
    assert delivery_review(route)["grade"] == "not_independently_reviewed"
    with pytest.raises(HTTPException) as error:
        delivery_routes([route], job={"checkpoint": {"review_policy": REVIEW_POLICY}}, budget=BUDGET)
    assert error.value.status_code == 409


@pytest.mark.parametrize("smiles,reason", [("O=C([O-])[O-]", "undefined_purchase_form"),
    ("*", "indeterminate_purchase_structure"), ("[Na+].[Na+].[O-]C([O-])=O", None)])
def test_purchase_form_uses_parent_identity_authority_without_rewriting_input(reviewed, smiles, reason):
    route = deepcopy(reviewed)
    route["starting_materials"] = [smiles]
    receipt = delivery_review(route)
    assert receipt["grade"] == ("purchase_form_unresolved" if reason else "model_checked")
    assert receipt["purchase_identity"]["unresolved_materials"] == ([{"smiles": smiles, "reason": reason}] if reason else [])
    assert route["starting_materials"] == [smiles] and route["closed"] is True


def test_summary_grade_is_policy_and_count_bound_without_artifact_reads():
    job = {"id": "history", "request": {"smiles": "CCO"}, "status": "completed", "revision": 1,
           "created": "2026-10-11", "modified": "2026-10-11", "checkpoint": {}, "error_code": None,
           "summary": {"selected_route_count": 10, "quality_accepted_route_count": 48}}
    before = deepcopy(job)
    for summary in (job_response(job)["summary"], result_record(job)["unified_route_pool_summary"]):
        assert summary["delivery_review"]["grade"] == "not_independently_reviewed"
    assert job_response(job)["status"] == "completed" and job == before
    for policy, selected, accepted, expected in [(REVIEW_POLICY, 3, 5, "model_checked"),
            ("unknown", 3, 5, "not_independently_reviewed"), (REVIEW_POLICY, 0, 5, "not_independently_reviewed"),
            (REVIEW_POLICY, 3, True, "not_independently_reviewed"), (REVIEW_POLICY, 5, 3, "not_independently_reviewed")]:
        receipt = history_delivery_review({"review_policy": policy, "selected_route_count": selected,
                                           "quality_accepted_route_count": accepted})
        assert receipt["grade"] == expected and receipt["basis"] == "stored_summary"
        assert receipt["purchase_identity"]["status"] == "unknown"


def test_flat_and_published_readers_share_fail_closed_guard(tmp_path):
    route = {"target_smiles": "CCO", "steps": [], "starting_materials": [], "metadata": {"full_forward_prediction_validated": True}}
    path = tmp_path / "selected_routes.json"
    path.write_text(json.dumps([route]))
    job = {"id": "a" * 32, "request": {"smiles": "CCO"}, "checkpoint": {"review_policy": REVIEW_POLICY}}
    with pytest.raises(HTTPException) as error:
        selected_route_data(path, budget=BUDGET, job=job)
    assert error.value.status_code == 409
    store = RouteArtifactStore(tmp_path)
    summary = {"id": job["id"], "target_key": "CCO", "selected_route_count": 1, "selected_closed_route_count": 0}
    pointer = store.stage(job["id"], all_routes=[route], selected_routes=[route], summary=summary)
    job.update(summary=summary, checkpoint={**job["checkpoint"], "result_artifact_schema": 1, "published_result": pointer})
    with pytest.raises(HTTPException) as error:
        selected_routes_for_job(job, artifacts=tmp_path, budget=BUDGET)
    assert error.value.status_code == 409
    assert json.loads(path.read_text()) == [route]
