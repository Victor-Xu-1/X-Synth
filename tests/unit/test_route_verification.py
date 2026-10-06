"""Qualification contracts using captured real inference and local persistence."""

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from apps.api.analysis_routes import analysis_runner
from apps.api.job_views import selected_route_data
from packages.adapters.askcos.engine import build_search_options
from packages.adapters.askcos.forward import ForwardAdapter, RankedResult
from packages.adapters.askcos.transport import EngineUnavailable
from packages.orchestrator.review_policy import (
    PREVIOUS_REVIEW_POLICY, REVIEW_POLICY, upgrade_review_checkpoint,
)
from packages.orchestrator.route_request import RouteJobRequest
from packages.orchestrator.route_verification import RouteVerifier, forward_match
from packages.orchestrator.verification_cache import VerificationCache
from packages.platform.atomic_file import write_json
from packages.platform.performance import PerformanceBudget
from packages.workspace.analysis_repository import AnalysisRepository
from packages.route_pool.workflow import build_unified_route_pool_artifacts


@pytest.fixture
def captured():
    path = Path(__file__).resolve().parents[1] / "fixtures/askcos/forward_sorafenib_result.json"
    value = json.loads(path.read_text())
    assert value["provenance"]["kind"] == "captured_real_model_output"
    return RankedResult.model_validate(value["result"])


def test_independent_rank_and_threshold_use_the_actual_model_result(captured):
    rank, score, accepted = forward_match(captured, captured.products[0].product, .75)
    assert rank == 1 and score > .99 and accepted is True
    assert forward_match(captured, captured.products[1].product, .75)[2] is False
    assert forward_match(captured, "CCO", .75) == (None, None, False)


def test_completed_owned_records_resume_without_a_provider(captured, tmp_path):
    analyses = AnalysisRepository(tmp_path / "analyses.sqlite")
    inputs = {"reactants": captured.reactants, "count": 10}
    identifier = analyses.start("owner", "forward", inputs)
    analyses.finish(identifier, "owner", result=captured.model_dump(mode="json"))
    path = tmp_path / "verification.json"
    cache = VerificationCache(path, "owner", "a" * 64)
    cache.save(captured.reactants, identifier)
    restored = VerificationCache(path, "owner", "a" * 64)
    verifier = RouteVerifier(
        forward=ForwardAdapter("http://127.0.0.1:1", "http://127.0.0.1:1"),
        analyses=analyses, run_analysis=analysis_runner(analyses), references=None,
        epoch=lambda: "a" * 64, max_atoms=300,
    )
    output, record = verifier.prediction(captured.reactants, "owner", restored)
    assert output == captured and record == identifier
    assert VerificationCache(path, "other_owner", "a" * 64).records == {}
    assert VerificationCache(path, "owner", "b" * 64).records == {}
    assert VerificationCache(path, "owner", "unmanaged:one").records == {}


def test_review_upgrade_preserves_native_checkpoint_and_rejects_stock_changes():
    identity = {"review_policy": REVIEW_POLICY, "catalog_sha256": "a" * 64}
    previous = {**identity, "review_policy": PREVIOUS_REVIEW_POLICY,
                "children": {"2:mcts": "child"}, "pass_number": 2}
    upgraded = upgrade_review_checkpoint(previous, identity)
    assert upgraded["children"] == previous["children"] and upgraded["pass_number"] == 2
    assert previous["review_policy"] == PREVIOUS_REVIEW_POLICY
    with pytest.raises(ValueError):
        upgrade_review_checkpoint(previous, {**identity, "catalog_sha256": "b" * 64})


def test_rejected_reactions_reach_native_repair_without_changing_legacy_input():
    request = RouteJobRequest(smiles="CCO")
    baseline = build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2)
    assert baseline == build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2, rejected_reactions=[])
    actual = build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2, rejected_reactions=["CC>>CCO"])
    assert actual["expand_one_options"]["banned_reactions"] == ["CC>>CCO"]
    assert actual["build_tree_options"] == baseline["build_tree_options"]


def test_all_public_selected_readers_refuse_template_only_new_results(tmp_path, captured):
    path = tmp_path / "selected_routes.json"
    route = {"starting_materials": [captured.reactants], "steps": [],
             "metadata": {"full_forward_prediction_validated": False}}
    write_json(path, [route])
    with pytest.raises(HTTPException) as error:
        selected_route_data(path, budget=PerformanceBudget(), job={"checkpoint": {"review_policy": REVIEW_POLICY}})
    assert error.value.status_code == 409
    assert selected_route_data(path, budget=PerformanceBudget(), job={"checkpoint": {"review_policy": PREVIOUS_REVIEW_POLICY}}) == [route]


def test_interruption_is_checked_at_the_publication_boundary(tmp_path):
    report = build_unified_route_pool_artifacts(
        id="cancelled", output_dir=tmp_path, publish_artifacts=False,
    )
    analyses = AnalysisRepository(tmp_path / "analyses.sqlite")
    verifier = RouteVerifier(
        forward=ForwardAdapter("http://127.0.0.1:1", "http://127.0.0.1:1"),
        analyses=analyses, run_analysis=analysis_runner(analyses), references=None,
        epoch=lambda: "a" * 64, max_atoms=300,
    )
    with pytest.raises(EngineUnavailable, match="route_verification_interrupted"):
        verifier.review(
            report, owner="owner", minimum=3, maximum=10, plausibility=.75,
            directory=tmp_path, interrupted=lambda: True, progress=lambda value: None,
        )
    assert not report.selected_routes_path.exists()
    assert not report.summary_path.exists()
