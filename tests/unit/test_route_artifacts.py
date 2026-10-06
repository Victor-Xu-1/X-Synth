"""Publication consistency using real files, SQLite commits and captured routes."""

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from packages.orchestrator.job_repository import JobConflict, JobRepository
from packages.orchestrator.route_artifacts import RouteArtifactError, RouteArtifactStore
from packages.route_pool.askcos import normalize_askcos_tree_result


@pytest.fixture
def report_data():
    payload = json.loads(
        (Path(__file__).parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json").read_text()
    )
    routes = [asdict(route) for route in normalize_askcos_tree_result(payload, engine="askcos_retro_star")]
    selected = routes[:3]
    target = selected[0]["target_smiles"]
    summary = {"target_key": target, "selected_route_count": len(selected),
               "selected_closed_route_count": sum(route["closed"] for route in selected)}
    return routes, selected, summary


def active_job(root, target):
    repository = JobRepository(root / "jobs.sqlite")
    job = repository.create("chemist", {"smiles": target})
    for status in ("preparing", "searching", "evaluating"):
        job = repository.transition(job["id"], status, expected_revision=job["revision"])
    return repository, job


def stage(store, job, data, suffix=""):
    routes, selected, summary = data
    summary = {**summary, "id": job["id"], "label": suffix}
    return store.stage(job["id"], all_routes=routes, selected_routes=selected, summary=summary), summary


def commit(repository, job, pointer, summary):
    return repository.transition(job["id"], "evaluating", expected_revision=job["revision"],
        summary=summary, checkpoint={"result_artifact_schema": 1, "published_result": pointer})


def test_staged_artifacts_are_invisible_until_the_same_job_commit(tmp_path, report_data):
    repository, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    pointer, summary = stage(store, job, report_data)
    assert store.read(job, limit=1024 * 1024) == []
    committed = commit(repository, job, pointer, summary)
    assert store.read(committed, limit=1024 * 1024) == report_data[1]
    assert JobRepository(repository.path).get(job["id"])["checkpoint"]["published_result"] == pointer


def test_next_generation_never_mixes_with_the_previous_committed_summary(tmp_path, report_data):
    repository, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    first, summary = stage(store, job, report_data, "first")
    job = commit(repository, job, first, summary)
    second, next_summary = stage(store, job, report_data, "second")
    assert first != second
    assert store.read(job, limit=1024 * 1024) == report_data[1]
    committed = commit(repository, job, second, next_summary)
    assert store.read(committed, limit=1024 * 1024) == report_data[1]
    with pytest.raises(RouteArtifactError):
        store.read({**job, "summary": next_summary}, limit=1024 * 1024)


def test_cancellation_prevents_staged_results_becoming_public(tmp_path, report_data):
    repository, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    pointer, summary = stage(store, job, report_data)
    cancelled = repository.transition(job["id"], "cancelled", expected_revision=job["revision"])
    with pytest.raises(JobConflict):
        commit(repository, job, pointer, summary)
    assert store.read(cancelled, limit=1024 * 1024) == []


def test_corrupt_published_snapshot_never_falls_back_to_legacy_files(tmp_path, report_data):
    repository, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    pointer, summary = stage(store, job, report_data)
    committed = commit(repository, job, pointer, summary)
    generation = tmp_path / "routes" / job["id"] / "results" / pointer["snapshot_id"]
    (generation / "selected_routes.json").write_text("[]")
    (tmp_path / "routes" / job["id"] / "selected_routes.json").write_text("[]")
    with pytest.raises(RouteArtifactError):
        store.read(committed, limit=1024 * 1024)


def test_snapshot_identity_target_bounds_and_unknown_versions_are_rejected(tmp_path, report_data):
    repository, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    pointer, summary = stage(store, job, report_data)
    committed = commit(repository, job, pointer, summary)
    with pytest.raises(RouteArtifactError):
        store.read(committed, limit=1)
    with pytest.raises(RouteArtifactError):
        store.read({**committed, "request": {"smiles": "CCO"}}, limit=1024 * 1024)
    for bad in ({"schema_version": 2, "snapshot_id": pointer["snapshot_id"]},
                {"schema_version": 1, "snapshot_id": "../escape"}):
        with pytest.raises(RouteArtifactError):
            store.read({**committed, "checkpoint": {"published_result": bad}}, limit=1024 * 1024)


def test_unchanged_content_reuses_the_same_sealed_snapshot(tmp_path, report_data):
    _, job = active_job(tmp_path, report_data[2]["target_key"])
    store = RouteArtifactStore(tmp_path / "routes")
    first, _ = stage(store, job, report_data)
    second, _ = stage(store, job, report_data)
    assert first == second
    assert len(list((tmp_path / "routes" / job["id"] / "results").iterdir())) == 1
