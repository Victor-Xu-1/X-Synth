"""Receipt contracts using preserved scientific fixtures, without model calls."""

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from apps.api.job_views import delivery_routes, job_response, result_record, selected_route_data, selected_routes_for_job
from packages.orchestrator.review_policy import REVIEW_POLICY
from packages.orchestrator.route_artifacts import RouteArtifactStore
from packages.orchestrator.delivery_review import delivery_review, history_delivery_review
from packages.workspace.history_projection import historical_routes
from packages.adapters.askcos.forward import RankedResult
from packages.orchestrator.route_verification import forward_match
from packages.workspace.analysis_repository import AnalysisRepository


BUDGET = SimpleNamespace(response_bytes=32 * 1024**2)


@pytest.fixture
def reviewed(tmp_path):
    path = Path(__file__).parents[1] / "fixtures/askcos/forward_sorafenib_result.json"
    captured = json.loads(path.read_text(encoding="utf-8"))
    assert captured["provenance"]["kind"] == "captured_real_model_output"
    output = RankedResult.model_validate(captured["result"])
    analyses = AnalysisRepository(tmp_path / "public-captured-analysis.sqlite")
    identifier = analyses.start("owner", "forward", {"reactants": output.reactants, "count": 10})
    analyses.finish(identifier, "owner", result=output.model_dump(mode="json"))
    retained = analyses.get(identifier, "owner")
    assert retained["status"] == "completed"
    product = output.products[0].product
    rank, score, matched = forward_match(RankedResult.model_validate(retained["result"]), product, .75)
    assert matched
    inputs = output.reactants.split(".")
    return {"route_id": "public-captured-forward", "engine": "askcos", "target_smiles": product,
            "closed": False, "starting_materials": inputs,
            "steps": [{"step_id": "s1", "product": product, "precursors": inputs,
                       "reaction_smiles": f"{output.reactants}>>{product}", "source": "captured_real_model_output"}],
            "metadata": {"full_forward_prediction_validated": matched, "forward_validation_passed": matched,
                         "automated_review": {"version": 1, "forward": {"matched_steps": 1, "total_steps": 1,
                             "records": [{"step_id": "s1", "record_id": identifier, "expected_rank": rank,
                                          "feasibility_score": score, "matched": matched, "model": output.model}]}}}}


def test_native_fixture_projects_only_additive_unreviewed_metadata():
    source = Path(__file__).parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    routes = historical_routes(json.loads(source.read_text()))
    before = deepcopy(routes)
    projected = delivery_routes(routes, budget=BUDGET)
    for original, route in zip(routes, projected, strict=True):
        assert route["metadata"].pop("delivery_review")["independent_review"]["status"] == "missing"
        assert route == original
    assert routes == before


@pytest.mark.parametrize("version", [1, 2])
def test_captured_forward_receipts_grade_without_demanding_exact_literature(reviewed, version):
    reviewed["metadata"]["automated_review"]["version"] = version
    if version == 2:
        forward = reviewed["metadata"]["automated_review"]["forward"]
        forward.update(model_top1_matched_steps=1, record_supported_steps=0)
        forward["records"][0].update(model_top1_matched=True, record_support=[], support_kind="model_top1")
    original = deepcopy(reviewed)
    receipt = delivery_review(reviewed)
    assert receipt["grade"] == "model_checked"
    assert receipt["version"] == 1 and receipt["phase"] == "automated_review"
    assert receipt["independent_review"]["review_version"] == version
    assert reviewed == original


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
    assert route["starting_materials"] == [smiles] and route["closed"] is False


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


def test_saved_source_receipt_survives_layout_save_reopen_but_chemical_edits_are_sticky(reviewed, tmp_path):
    from packages.workspace.route_graph import graph_from_candidate
    from packages.workspace.route_repository import RouteDocumentRepository

    graph, source = graph_from_candidate(reviewed)
    receipt = delivery_review(reviewed)
    source["delivery_review"] = receipt
    repository = RouteDocumentRepository(tmp_path / "isolated-copies.sqlite")
    saved = repository.create("owner", "Captured route", graph, source=source)
    assert saved["metadata"]["delivery_review"]["grade"] == "model_checked"
    layout = graph.model_copy(deep=True)
    layout.nodes[0].position.x += 100
    layout.nodes[0].note = "Raw annotation"
    saved = repository.update(saved["id"], "owner", title="Raw title", graph=layout, revision=0)
    assert saved["metadata"]["delivery_review"] == receipt
    assert RouteDocumentRepository(repository.path).get(saved["id"], "owner")["metadata"]["delivery_review"] == receipt
    changed = graph.model_copy(deep=True)
    next(node for node in changed.nodes if node.id == changed.target_id).smiles = "CCO"
    saved = repository.update(saved["id"], "owner", title="Edited", graph=changed, revision=1)
    assert saved["state"] == "draft" and saved["metadata"]["delivery_review"] is None
    saved = repository.update(saved["id"], "owner", title="Reverted", graph=graph, revision=2)
    assert saved["metadata"]["delivery_review"] is None
    assert RouteDocumentRepository(repository.path).get(saved["id"], "owner")["metadata"]["delivery_review"] is None
    with repository.connect() as connection:
        retained = json.loads(connection.execute("SELECT source FROM route_documents").fetchone()[0])
    assert retained["delivery_review"] == receipt and retained["_chemistry_edited"] is True
