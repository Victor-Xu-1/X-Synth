import pytest

from packages.orchestrator.search_progress import begin_search_round


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
