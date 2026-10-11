"""Real artifact/process lifecycle controls; no provider mock or fresh inference."""
from copy import deepcopy
from functools import partial
from threading import Event
import time

import pytest

from apps.api.job_views import load_history_review
from apps.api.job_views import result_record
from packages.orchestrator.delivery_review import selected_routes_review
from packages.orchestrator.delivery_review import pending_routes_review
from packages.orchestrator.history_review import HistoryReviewIndex
from packages.orchestrator.route_artifacts import RouteArtifactStore
from packages.platform.performance import PerformanceBudget, HistoryReviewLimits
from test_delivery_review import reviewed


def staged(tmp_path, route, *, identifier="a" * 32):
    summary = {"id": identifier, "target_key": route["target_smiles"],
               "selected_route_count": 1, "selected_closed_route_count": 0}
    pointer = RouteArtifactStore(tmp_path).stage(identifier, all_routes=[route], selected_routes=[route], summary=summary)
    return {"id": identifier, "request": {"smiles": route["target_smiles"]}, "summary": summary,
            "checkpoint": {"result_artifact_schema": 1, "published_result": pointer},
            "revision": 1, "status": "completed", "created": "2026-10-11", "modified": "2026-10-11"}


def index_for(root, **kwargs):
    return HistoryReviewIndex(artifacts=root,
        loader=partial(load_history_review, artifacts=root, budget=PerformanceBudget()), **kwargs)


def await_ready(index, job):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        receipt = index.read(job)
        if receipt["status"] != "pending":
            return receipt
        time.sleep(0.02)
    pytest.fail("Actual history projection did not finish")


def test_real_spawned_projection_is_read_only_and_cached(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    original = deepcopy(job)
    index = index_for(tmp_path)
    assert index.read(job)["status"] == "pending"
    index.start()
    try:
        receipt = await_ready(index, job)
        assert receipt["status"] == "ready" and receipt["grade"] == "model_checked"
        assert receipt["route_count"] == 1
        assert index.read(job) == receipt
        assert not index._pending and job == original
    finally:
        index.close()
    assert index._executor._process is None and not index._thread.is_alive()


def test_display_changes_do_not_invalidate_but_missing_or_changed_artifacts_do(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    index = index_for(tmp_path)
    receipt = selected_routes_review([reviewed], job_id=job["id"], snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(job, receipt)
    display = {**job, "history_title": "User title", "history_revision": 9, "group_id": "other"}
    assert index.read(display) == receipt
    path = tmp_path / job["id"] / "results" / receipt["source_binding"]["snapshot_id"] / "selected_routes.json"
    path.rename(path.with_name("retained-route.json"))
    assert index.read(job)["status"] == "pending"
    index.start()
    try:
        assert await_ready(index, job)["status"] == "unavailable"
        assert not index._pending
    finally:
        index.close()


def test_old_inflight_result_cannot_replace_new_publication_or_erase_its_queue(tmp_path, reviewed):
    first = staged(tmp_path, reviewed)
    second_route = deepcopy(reviewed)
    second_route["starting_materials"] = ["O=C([O-])[O-]"]
    second = staged(tmp_path, second_route)
    second["revision"] = 2
    index = index_for(tmp_path)
    old_token = index.token(first)
    index.read(first)
    index.read(second)
    old = selected_routes_review([reviewed], job_id=first["id"], snapshot_id=first["checkpoint"]["published_result"]["snapshot_id"])
    assert not index.remember(first, old, token=old_token)
    assert index._pending[first["id"]][0] == index.token(second)[0]
    current = selected_routes_review([second_route], job_id=second["id"], snapshot_id=second["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(second, current)
    assert index.read(second)["grade"] == "purchase_form_unresolved"


def test_cache_and_pending_capacity_are_bounded_and_wrong_binding_is_rejected(tmp_path, reviewed):
    limits = HistoryReviewLimits(max_entries=1, max_pending=1, batch_size=1)
    index = index_for(tmp_path, limits=limits)
    first, second = staged(tmp_path, reviewed), staged(tmp_path, reviewed, identifier="b" * 32)
    index.read(first); index.read(second)
    assert len(index._pending) == 1
    for job in (first, second):
        receipt = selected_routes_review([reviewed], job_id=job["id"], snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
        assert index.remember(job, receipt)
    assert len(index._entries) == 1
    with pytest.raises(ValueError, match="another publication"):
        index.remember(first, receipt)


def test_failed_background_result_cannot_replace_same_generation_confirmed_by_result_read(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    index = index_for(tmp_path)
    token = index.token(job)
    receipt = selected_routes_review([reviewed], job_id=job["id"], snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(job, receipt)
    failed = pending_routes_review(job["id"], receipt["source_binding"]["snapshot_id"], unavailable=True)
    assert not index.remember(job, failed, token=token)
    assert index.read(job) == receipt


def test_checkpoint_free_batch_failure_preserves_direct_publication_confirmation(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    light = {**job, "checkpoint": {}}
    index = index_for(tmp_path)
    index.read(light)
    token = index._pending[job["id"]][0]
    receipt = selected_routes_review([reviewed], job_id=job["id"],
        snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(job, receipt, token=index.token(job))
    index._unavailable([(token, light)])
    assert index.read(light) == receipt
    source = tmp_path / job["id"] / "results" / receipt["source_binding"]["snapshot_id"] / "selected_routes.json"
    source.rename(source.with_name("retained-route.json"))
    index._unavailable([(token, light)])
    assert index.read(light)["status"] == "unavailable"


def test_newer_source_validated_direct_confirmation_advances_old_desired_state(tmp_path, reviewed):
    first = staged(tmp_path, reviewed)
    second = {**first, "revision": 2}
    index = index_for(tmp_path)
    index.read(first)
    receipt = selected_routes_review([reviewed], job_id=second["id"],
        snapshot_id=second["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(second, receipt, token=index.token(second))
    assert index.read(second) == receipt
    assert not index._pending


def test_desired_eviction_cannot_roll_back_retained_newer_confirmation(tmp_path, reviewed):
    first = staged(tmp_path, reviewed)
    second = {**first, "revision": 2}
    limits = HistoryReviewLimits(max_entries=1, max_pending=1, batch_size=1)
    index = index_for(tmp_path, limits=limits)
    index.read(first)
    old_token, queued = index._pending.pop(first["id"])
    index._inflight[first["id"]] = old_token
    receipt = selected_routes_review([reviewed], job_id=first["id"],
        snapshot_id=first["checkpoint"]["published_result"]["snapshot_id"])
    index.read(second)
    assert index.remember(second, receipt, token=index.token(second))
    for prefix in ("b", "c", "d"):
        index.read({**first, "id": prefix * 32})
    assert first["id"] not in index._desired
    assert not index.remember(queued, receipt, token=old_token)
    assert index.read(second) == receipt


def test_projection_defers_to_active_work_and_close_reaps_its_process(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    busy = Event()
    busy.set()
    index = index_for(tmp_path, idle=lambda: not busy.is_set())
    index.start()
    try:
        assert index.read(job)["status"] == "pending"
        time.sleep(0.25)
        assert index._executor._process is None
        busy.clear()
        assert await_ready(index, job)["status"] == "ready"
    finally:
        index.close()
    assert index._executor._process is None


def test_light_history_resolves_publication_in_background_without_reading_checkpoint_on_request(tmp_path, reviewed):
    import sqlite3
    from contextlib import contextmanager
    from packages.orchestrator.job_repository import JobRepository

    repository = JobRepository(tmp_path / "jobs.sqlite")
    created = repository.create("owner", {"smiles": reviewed["target_smiles"]})
    claimed = repository.claim_next()
    searching = repository.transition(created["id"], "searching", expected_revision=claimed["revision"])
    source = staged(tmp_path / "routes", reviewed, identifier=created["id"])
    evaluated = repository.transition(created["id"], "evaluating", expected_revision=searching["revision"],
        summary=source["summary"], checkpoint={**source["checkpoint"], "search_graph": {"private": "x" * 2_000_000}})
    repository.transition(created["id"], "completed", expected_revision=evaluated["revision"])
    connect = repository.connect
    @contextmanager
    def metadata_only():
        with connect() as db:
            db.set_authorizer(lambda action, table, column, *_:
                sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_READ and table == "jobs" and column == "checkpoint" else sqlite3.SQLITE_OK)
            yield db
    repository.connect = metadata_only
    light = repository.history_page("owner")["results"][0]
    assert "search_graph" not in light["checkpoint"] and "published_result" not in light["checkpoint"]
    index = HistoryReviewIndex(artifacts=tmp_path / "routes", loader=partial(load_history_review,
        artifacts=tmp_path / "routes", budget=PerformanceBudget(), jobs_path=repository.path))
    assert index.read(light)["status"] == "pending"
    index.start()
    try:
        receipt = await_ready(index, light)
        assert receipt["status"] == "ready" and receipt["grade"] == "model_checked"
        assert receipt["source_binding"]["snapshot_id"] == source["checkpoint"]["published_result"]["snapshot_id"]
        assert result_record(light, review=receipt)["result_snapshot"] == receipt["source_binding"]["snapshot_id"]
    finally:
        index.close()
