import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from packages.orchestrator.search_progress import begin_search_round, remaining_search_rounds


def test_second_round_resets_only_live_counters_and_retains_previous_artifacts():
    checkpoint = {
        "pass_number": 1,
        "native_progress": {"mcts": {"iterations": 601}},
        "completed_searches": ["1:mcts", "1:retro_star"],
        "children": {"1:mcts": "native-first", "2:mcts": "native-second"},
        "models": ["pistachio", "pistachio_ringbreaker"],
        "catalog_sha256": "unchanged",
    }
    updated = begin_search_round(checkpoint, 2)
    assert updated["pass_number"] == 2
    assert updated["native_progress"] == {}
    assert updated["completed_searches"] == checkpoint["completed_searches"]
    assert updated["children"] == checkpoint["children"]
    assert updated["models"] == checkpoint["models"]
    assert updated["catalog_sha256"] == checkpoint["catalog_sha256"]
    assert checkpoint["native_progress"]["mcts"]["iterations"] == 601


def test_resume_same_round_keeps_current_progress():
    checkpoint = {"pass_number": 2, "native_progress": {"retro_star": {"iterations": 15}}}
    assert begin_search_round(checkpoint, 2) == checkpoint


def test_resume_cannot_regress_to_previous_round():
    with pytest.raises(ValueError, match="earlier round"):
        begin_search_round({"pass_number": 2}, 1)


@pytest.mark.parametrize("checkpoint,budget,expected", [
    ({}, 1, [1, 2]),
    ({"pass_number": 1}, 1, [1, 2]),
    ({"pass_number": 2}, 1, [2]),
    ({"pass_number": 1}, 0, [1]),
])
def test_remaining_rounds_preserve_the_original_repair_budget(checkpoint, budget, expected):
    original = dict(checkpoint)
    assert list(remaining_search_rounds(checkpoint, budget)) == expected
    assert checkpoint == original


@pytest.mark.parametrize("number,budget", [
    (0, 1), (3, 1), (2, 0), (True, 1), (None, 1), ("2", 1), (2.0, 1),
])
def test_invalid_persisted_round_cannot_expand_the_budget_or_leave_a_job_idle(number, budget):
    with pytest.raises(ValueError, match="original repair budget"):
        remaining_search_rounds({"pass_number": number}, budget)


def test_real_job_transitions_clear_prior_round_and_keep_fresh_same_round_counters(tmp_path):
    from packages.orchestrator.job_repository import JobRepository
    from packages.orchestrator.pipeline import RoutePipeline
    from packages.platform.performance import PerformanceBudget

    repository = JobRepository(tmp_path / "jobs.sqlite")
    job = repository.create("owner", {"smiles": "CCO"})
    repository.claim_next(active_limit=1)
    # Only the real coordinator and SQLite transitions run; no model is invoked.
    pipeline = RoutePipeline(
        repository=repository, engine=None, stock=None,
        artifact_root=tmp_path / "artifacts", models=["pistachio"],
        budget=PerformanceBudget(),
    )
    first = {"pass_number": 1, "native_progress": {"mcts": {"iterations": 601}}}
    pipeline._transition(job["id"], "searching", checkpoint=first)
    second = begin_search_round(first, 2)
    pipeline._transition(job["id"], "searching", checkpoint=second)
    assert repository.get(job["id"])["checkpoint"]["native_progress"] == {}
    pipeline._progress(job["id"], "mcts", {"iterations": 11, "elapsed_seconds": 41.0})
    pipeline._transition(job["id"], "searching", checkpoint=second)
    current = repository.get(job["id"])["checkpoint"]
    assert current["pass_number"] == 2
    assert current["native_progress"]["mcts"]["iterations"] == 11


def test_evaluated_summary_is_retained_during_the_next_search_round(tmp_path):
    from packages.orchestrator.job_repository import JobRepository

    repository = JobRepository(tmp_path / "jobs.sqlite")
    job = repository.create("owner", {"smiles": "CCO"})
    claimed = repository.claim_next(active_limit=1)
    searching = repository.transition(job["id"], "searching", expected_revision=claimed["revision"])
    evaluated = repository.transition(job["id"], "evaluating", expected_revision=searching["revision"], summary={"selected_route_count": 1, "meets_min_routes": False})
    current = repository.transition(job["id"], "searching", expected_revision=evaluated["revision"], checkpoint={"pass_number": 2})
    assert current["summary"]["selected_route_count"] == 1
    assert current["summary"]["meets_min_routes"] is False


def test_pipeline_publishes_each_evaluated_summary_before_repair_or_completion():
    import ast
    from pathlib import Path

    module = ast.parse((Path(__file__).resolve().parents[2] / "packages/orchestrator/pipeline.py").read_text())
    calls = [node for node in ast.walk(module) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "_transition"]
    assert any(len(node.args) > 1 and isinstance(node.args[1], ast.Constant) and node.args[1].value == "evaluating" and any(argument.arg == "summary" for argument in node.keywords) for node in calls)


@pytest.fixture
def indexed_resume_stock(tmp_path):
    from packages.adapters.stock.stock_index import StockIndex, compile_stock_index

    path = tmp_path / "stock.sqlite"
    compile_stock_index(
        [{"smiles": "CCO", "source": "MC", "ppg": None,
          "properties": [{"link": "https://mcule.com/MCULE-7654109565"}]}],
        output=path, source_id="unit-test", source_sha256="a" * 64,
    )
    return StockIndex(path)


def resume_test_job(repository, job_id, checkpoint, summary):
    claimed = repository.claim_next(active_limit=1)
    searching = repository.transition(
        job_id, "searching", expected_revision=claimed["revision"], checkpoint=checkpoint,
    )
    waiting = repository.transition(
        job_id, "waiting_for_engine", expected_revision=searching["revision"],
        summary=summary, error_code="worker_restarted",
    )
    repository.transition(job_id, "queued", expected_revision=waiting["revision"])
    return repository.claim_next(active_limit=1)


@pytest.fixture
def second_round_resume_case(tmp_path, indexed_resume_stock, current_strategy_completed):
    from packages.adapters.askcos.engine import AskcosEngine
    from packages.adapters.askcos.transport import AskcosTransport
    from packages.orchestrator.job_repository import JobRepository
    from packages.orchestrator.pipeline import RoutePipeline
    from packages.orchestrator.route_request import RouteJobRequest
    from packages.platform.atomic_file import write_json
    from packages.platform.performance import PerformanceBudget

    stock = indexed_resume_stock
    repository = JobRepository(tmp_path / "jobs.sqlite")
    original_request = RouteJobRequest(smiles="CCO").model_dump(
        exclude={"search_policy_version"},
    )
    job = repository.create("owner", original_request)
    children = {
        f"{number}:{strategy}": hashlib.sha256(
            f"{job['id']}:{number}:{strategy}".encode(),
        ).hexdigest()[:32]
        for number in (1, 2) for strategy in ("mcts", "retro_star")
    }
    completed = ["1:retro_star"]
    if current_strategy_completed:
        completed.append("2:mcts")
    checkpoint = {
        "pass_number": 2,
        "completed_searches": completed,
        "children": children,
        "models": ["pistachio"],
        "stock_snapshot": stock.summary["source_sha256"],
        "catalog_sha256": stock.summary["catalog_sha256"],
        "review_policy": "exact_stock_template_reconstruction_target_bond_families_v1",
        "native_progress": {"retro_star": {"iterations": 15, "elapsed_seconds": 457.0}},
    }
    summary = {"selected_route_count": 0, "meets_min_routes": False,
               "pass_number": 1, "strategy_errors": ["native_search_failed"]}
    resumed = resume_test_job(repository, job["id"], checkpoint, summary)

    directory = tmp_path / "routes" / job["id"]
    directory.mkdir(parents=True)
    for key in completed:
        number, strategy = key.split(":")
        write_json(directory / f"native-{number}-{strategy}.json",
                   {"strategy": strategy, "payload": {"result": {"stats": {}}}})
    graph_path = tmp_path / "native.checkpoint.json"
    write_json(graph_path, {"elapsed": 457.0, "iterations": 15,
                           "graph": {"nodes": [{"id": "target"}], "links": []}})
    protected = {path: path.read_bytes() for path in [graph_path, *directory.iterdir()]}
    pipeline = RoutePipeline(
        repository=repository,
        engine=AskcosEngine(AskcosTransport("http://127.0.0.1:1")), stock=stock,
        artifact_root=directory.parent, models=checkpoint["models"],
        budget=PerformanceBudget(),
    )
    return SimpleNamespace(
        pipeline=pipeline, repository=repository, resumed=resumed,
        original_request=original_request, checkpoint=checkpoint, summary=summary,
        protected=protected,
    )


@pytest.mark.parametrize("current_strategy_completed", [False, True])
def test_resume_dispatches_current_round_without_retrying_failed_old_round(
    second_round_resume_case, monkeypatch, current_strategy_completed,
):
    from packages.adapters.askcos.engine import build_search_options
    from packages.orchestrator.route_request import RouteJobRequest

    case = second_round_resume_case
    strategy = "retro_star" if current_strategy_completed else "mcts"
    expected = build_search_options(
        RouteJobRequest.from_persisted(case.original_request), strategy=strategy,
        models=case.checkpoint["models"], pass_number=2,
    )
    expected_hash = hashlib.sha256(
        json.dumps(expected, sort_keys=True, allow_nan=False).encode(),
    ).hexdigest()
    dispatched = []

    class DispatchObserved(Exception):
        pass

    def observe_dispatch(executor, operation, request, **options):
        assert operation == case.pipeline.engine.search
        dispatched.append((
            options["pass_number"], options["strategy"], options["child_id"],
        ))
        actual = build_search_options(
            request, strategy=options["strategy"], models=options["models"],
            pass_number=options["pass_number"],
        )
        assert hashlib.sha256(
            json.dumps(actual, sort_keys=True, allow_nan=False).encode(),
        ).hexdigest() == expected_hash
        raise DispatchObserved()

    # Observe the real coordinator before any provider operation can execute.
    monkeypatch.setenv("X_SYNTH_MCTS_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("X_SYNTH_RETRO_STAR_URL", "http://127.0.0.1:1")
    monkeypatch.setattr(ThreadPoolExecutor, "submit", observe_dispatch)
    with pytest.raises(DispatchObserved):
        case.pipeline.run(case.resumed)
    assert dispatched == [(2, strategy, case.checkpoint["children"][f"2:{strategy}"])]
    current = case.repository.get(case.resumed["id"])
    assert current["status"] == "searching"
    assert current["request"] == case.original_request
    assert current["summary"] == case.summary
    assert current["checkpoint"] == case.checkpoint
    assert {path: path.read_bytes() for path in case.protected} == case.protected
