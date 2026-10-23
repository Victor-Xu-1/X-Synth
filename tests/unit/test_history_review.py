"""Real artifact/process lifecycle controls; no provider mock or fresh inference."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from functools import partial
from threading import Event, Thread, current_thread
import time

import pytest

from apps.api.job_views import load_history_review
from apps.api.job_views import result_record
from apps.api.job_views import route_result
from packages.orchestrator.delivery_review import selected_routes_review
from packages.orchestrator.delivery_review import pending_routes_review
from packages.orchestrator.history_review import HistoryReviewIndex
from packages.orchestrator import history_review
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


@pytest.fixture
def retained_review(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    index = index_for(tmp_path)
    receipt = selected_routes_review([reviewed], job_id=job["id"],
        snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(job, receipt)
    try:
        yield index, job, receipt
    finally:
        index.close()


@pytest.fixture
def paused_validation(monkeypatch):
    @contextmanager
    def pause(operation, *, call=1, error=None):
        entered, release = Event(), Event()
        results, errors = [], []
        original = history_review.artifact_identity
        calls = 0

        def stamp(*args):
            nonlocal calls
            if current_thread() is worker:
                calls += 1
                if calls == call:
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError("Blocked artifact stamp was not released")
                    if error is not None:
                        raise error("Artifact validation failed")
            return original(*args)

        def run():
            try:
                results.append(operation())
            except BaseException as failure:
                errors.append(failure)

        worker = Thread(target=run)
        monkeypatch.setattr(history_review, "artifact_identity", stamp)
        worker.start()
        try:
            assert entered.wait(5), "Operation did not reach artifact validation"
            yield results
        finally:
            release.set()
            worker.join(5)
            monkeypatch.setattr(history_review, "artifact_identity", original)
            assert not worker.is_alive(), "Artifact validation worker did not finish"
        if errors:
            raise errors[0]
    return pause


def validation_call(index, job, receipt, operation):
    if operation == "read":
        return partial(index.read, job), 1
    if operation == "publish":
        return partial(index.remember, job, receipt, token=index.token(job)), 1
    light = {**job, "checkpoint": {}}
    failed = pending_routes_review(job["id"], None, unavailable=True)
    return partial(index.remember, light, failed, token=history_review.review_context(light)), 2


@pytest.fixture
def stored_review(tmp_path, reviewed):
    from packages.orchestrator.job_repository import JobRepository

    root = tmp_path / "routes"
    repository = JobRepository(tmp_path / "jobs.sqlite")
    created = repository.create("owner", {"smiles": reviewed["target_smiles"]})
    claimed = repository.claim_next()
    searching = repository.transition(created["id"], "searching", expected_revision=claimed["revision"])
    source = staged(root, reviewed, identifier=created["id"])
    evaluated = repository.transition(created["id"], "evaluating", expected_revision=searching["revision"],
        summary=source["summary"], checkpoint=source["checkpoint"])
    job = repository.transition(created["id"], "completed", expected_revision=evaluated["revision"])
    index = HistoryReviewIndex(artifacts=root, loader=partial(load_history_review,
        artifacts=root, budget=PerformanceBudget(), jobs_path=repository.path))
    return index, job


@pytest.fixture
def paused_background_validation(monkeypatch):
    @contextmanager
    def pause(index, job, *, error=None):
        entered, release, settled, resume = Event(), Event(), Event(), Event()
        stamps = []
        original_stamp, original_idle = history_review.artifact_identity, index.idle

        def stamp(*args):
            if current_thread() is index._thread:
                stamps.append(args[2])
                if not entered.is_set():
                    entered.set()
                    if not release.wait(10):
                        raise AssertionError("Background artifact stamp was not released")
                    if error is not None:
                        raise error("Background artifact validation failed")
            return original_stamp(*args)

        def idle():
            if entered.is_set() and release.is_set() and not index._inflight and not resume.is_set():
                settled.set()
                return False
            return original_idle()

        monkeypatch.setattr(history_review, "artifact_identity", stamp)
        monkeypatch.setattr(index, "idle", idle)
        try:
            assert index.read(job)["status"] == "pending"
            index.start()
            assert entered.wait(10), "Actual background projection did not reach its publication stamp"
            yield release, settled, resume, stamps
        finally:
            release.set()
            index.close()
            monkeypatch.setattr(history_review, "artifact_identity", original_stamp)
        assert index._executor._process is None and not index._thread.is_alive()
    return pause


@pytest.mark.parametrize("poll", [
    "identical", "light", "unknown_light", "evicted", "evicted_light", "evicted_unknown_light", "aba",
])
def test_poll_during_background_ready_validation_preserves_progress(
    reviewed, stored_review, paused_background_validation, poll,
):
    index, job = stored_review
    light = {**job, "checkpoint": {}}
    initial = light if "unknown_light" in poll else job
    polled = light if "light" in poll else job
    recover = poll.startswith("evicted") or poll == "aba"
    with paused_background_validation(index, initial) as (release, settled, resume, stamps):
        ticket = index._desired[job["id"]]
        assert job["id"] in index._inflight and not index._entries and not index._pending
        if poll.startswith("evicted"):
            index._desired.pop(job["id"])
        elif poll == "aba":
            changed = deepcopy(reviewed)
            changed["starting_materials"] = ["O=C([O-])[O-]"]
            other = staged(index.artifacts, changed, identifier=job["id"])
            assert index.read({**job, "checkpoint": other["checkpoint"]})["status"] == "pending"
        assert index.read(polled)["status"] == "pending"
        for _ in range(3):
            assert index.read(polled)["status"] == "pending"
        release.set()
        assert settled.wait(5), "Background publication attempt did not finish and retire its in-flight owner"
        if recover:
            queued = index._pending.get(job["id"])
            assert queued is not None, "A changed desired ticket lost its only background work"
            assert queued[1]["checkpoint"] == history_review.projection_job(polled)["checkpoint"]
            assert index._desired[job["id"]] is not ticket
        else:
            assert job["id"] in index._entries, "An identical poll discarded the only ready publication"
        resume.set()
        assert await_ready(index, polled)["status"] == "ready"
        assert len(stamps) == (2 if recover else 1)


@pytest.mark.parametrize("error", [OSError, ValueError])
def test_identical_poll_during_background_source_error_stays_unavailable(
    stored_review, paused_background_validation, error,
):
    index, job = stored_review
    with paused_background_validation(index, job, error=error) as (release, settled, resume, stamps):
        assert index.read(job)["status"] == "pending"
        release.set()
        assert settled.wait(5)
        assert index._entries[job["id"]].receipt["status"] == "unavailable"
        assert index.read(job)["status"] == "unavailable" and not index._pending
        assert len(stamps) == 2


def test_new_ticket_recovery_respects_pending_capacity(stored_review, paused_background_validation):
    index, job = stored_review
    index.limits = HistoryReviewLimits(max_entries=2, max_pending=1, batch_size=1)
    other = {**job, "id": "b" * 32}
    with paused_background_validation(index, job) as (release, settled, resume, stamps):
        assert index.read(other)["status"] == "pending"
        index._desired.pop(job["id"])
        assert index.read(job)["status"] == "pending"
        assert list(index._pending) == [other["id"]]
        release.set()
        assert settled.wait(5) and len(stamps) == 1
        assert list(index._pending) == [other["id"]] and not index._entries
        resume.set()
        assert await_ready(index, job)["status"] == "ready"
        assert len(stamps) == 3 and len(index._pending) <= index.limits.max_pending


def test_slow_artifact_stamp_does_not_block_unrelated_history_read(
    tmp_path, reviewed, retained_review, paused_validation,
):
    index, job, receipt = retained_review
    other = staged(tmp_path, reviewed, identifier="b" * 32)
    with ThreadPoolExecutor(max_workers=1) as readers:
        with paused_validation(partial(index.read, job)) as results:
            assert readers.submit(index.read, other).result(timeout=1)["status"] == "pending"
            assert index._pending[other["id"]][0] == history_review.review_context(other)
    assert results == [receipt]


@pytest.mark.parametrize("operation", ["read", "remember"])
def test_slow_stamp_does_not_block_unrelated_confirmation(
    tmp_path, reviewed, retained_review, paused_validation, operation,
):
    index, job, receipt = retained_review
    other = staged(tmp_path, reviewed, identifier="b" * 32)
    other_receipt = selected_routes_review([reviewed], job_id=other["id"],
        snapshot_id=other["checkpoint"]["published_result"]["snapshot_id"])
    action, call = validation_call(index, job, receipt, operation)
    with ThreadPoolExecutor(max_workers=1) as writers:
        with paused_validation(action, call=call) as results:
            assert writers.submit(index.remember, other, other_receipt).result(timeout=1)
            assert index._entries[other["id"]].receipt == other_receipt
    assert results == ([False] if operation == "remember" else [receipt])


def test_slow_ready_preservation_does_not_block_unrelated_read(
    tmp_path, reviewed, retained_review, paused_validation,
):
    index, job, receipt = retained_review
    other = staged(tmp_path, reviewed, identifier="b" * 32)
    action, call = validation_call(index, job, receipt, "remember")
    with ThreadPoolExecutor(max_workers=1) as readers:
        with paused_validation(action, call=call) as results:
            assert readers.submit(index.read, other).result(timeout=1)["status"] == "pending"
    assert results == [False] and index.read(job) == receipt


@pytest.mark.parametrize("operation", ["read", "remember"])
def test_validation_rechecks_replaced_entry(retained_review, paused_validation, operation):
    index, job, receipt = retained_review
    snapshot = receipt["source_binding"]["snapshot_id"]
    replacement = pending_routes_review(job["id"], snapshot, unavailable=True)
    action, call = validation_call(index, job, receipt, operation)
    with paused_validation(action, call=call) as results:
        if operation == "remember":
            (index.artifacts / job["id"] / "results" / snapshot / "selected_routes.json").unlink()
        assert index.remember(job, replacement)
    expected = [False] if operation == "remember" else [pending_routes_review(job["id"], snapshot)]
    assert results == expected
    assert index._entries[job["id"]].receipt == replacement
    assert not index._pending


@pytest.mark.parametrize("operation", ["read", "remember"])
def test_validation_cannot_overwrite_newer_desired_revision(retained_review, paused_validation, operation):
    index, job, receipt = retained_review
    newer = {**job, "revision": 2}
    action, call = validation_call(index, job, receipt, operation)
    with paused_validation(action, call=call) as results:
        assert index.read(newer)["status"] == "pending"
    pending = pending_routes_review(job["id"], receipt["source_binding"]["snapshot_id"])
    assert results == ([False] if operation == "remember" else [pending])
    assert index._desired[job["id"]] == (history_review.review_context(newer), 2,
        receipt["source_binding"]["snapshot_id"])
    assert index._pending[job["id"]][1]["revision"] == 2


@pytest.mark.parametrize("operation", ["read", "remember", "publish"])
def test_validation_rechecks_equal_context_with_replaced_snapshot(
    tmp_path, reviewed, retained_review, paused_validation, operation,
):
    index, job, receipt = retained_review
    snapshot = receipt["source_binding"]["snapshot_id"]
    action, call = validation_call(index, job, receipt, operation)
    with paused_validation(action, call=call) as results:
        changed = deepcopy(reviewed)
        changed["starting_materials"] = ["O=C([O-])[O-]"]
        replacement = staged(tmp_path, changed)
        assert history_review.review_context(replacement) == history_review.review_context(job)
        assert index.read(replacement)["status"] == "pending"
        if operation == "remember":
            (index.artifacts / job["id"] / "results" / snapshot / "selected_routes.json").unlink()
    expected = [pending_routes_review(job["id"], snapshot)] if operation == "read" else [False]
    assert results == expected
    assert index._pending[job["id"]][1]["checkpoint"] == replacement["checkpoint"]
    assert index._entries[job["id"]].receipt == receipt


@pytest.mark.parametrize("state", ["queued", "confirmed", "light", "desired_evicted", "queued_desired_evicted", "old_inflight"])
def test_ready_publication_cannot_replace_prior_specific_snapshot(tmp_path, reviewed, retained_review, state):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    current = staged(tmp_path, changed)
    confirmed = selected_routes_review([changed], job_id=job["id"],
        snapshot_id=current["checkpoint"]["published_result"]["snapshot_id"])
    assert history_review.review_context(current) == history_review.review_context(job)
    if state == "old_inflight":
        index._inflight[job["id"]] = (history_review.review_context(job),
            receipt["source_binding"]["snapshot_id"], index._entries[job["id"]])
    assert index.read(current)["status"] == "pending"
    if state not in {"queued", "queued_desired_evicted"}:
        assert index.remember(current, confirmed, token=index.token(current))
    if state == "light":
        assert index.read({**current, "checkpoint": {}}) == confirmed
    elif state in {"desired_evicted", "queued_desired_evicted", "old_inflight"}:
        # Retained publication ownership must outlive the independent desired LRU.
        index._desired.pop(job["id"])
    desired, retained = index._desired.get(job["id"]), index._entries[job["id"]]
    queued = index._pending.get(job["id"])
    assert not index.remember(job, receipt, token=index.token(job))
    assert index._desired.get(job["id"]) is desired
    assert index._entries[job["id"]] is retained
    assert index._pending.get(job["id"]) is queued


def test_validated_ready_read_retires_obsolete_publication_queue(tmp_path, reviewed, retained_review):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    obsolete = staged(tmp_path, changed)
    assert index.read(obsolete)["status"] == "pending"
    assert index.read(job) == receipt
    assert not index._pending


def test_ready_publication_rechecks_queue_when_desired_is_evicted_during_stamp(
    tmp_path, reviewed, retained_review, paused_validation,
):
    index, job, receipt = retained_review
    index._desired.pop(job["id"])
    retained = index._entries[job["id"]]
    action, call = validation_call(index, job, receipt, "publish")
    with paused_validation(action, call=call) as results:
        changed = deepcopy(reviewed)
        changed["starting_materials"] = ["O=C([O-])[O-]"]
        current = staged(tmp_path, changed)
        assert index.read(current)["status"] == "pending"
        queued = index._pending[job["id"]]
        index._desired.pop(job["id"])
    assert results == [False]
    assert index._pending[job["id"]] is queued and index._entries[job["id"]] is retained


def test_inflight_publication_binding_survives_desired_eviction(tmp_path, reviewed, retained_review):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    current = staged(tmp_path, changed)
    confirmed = selected_routes_review([changed], job_id=job["id"],
        snapshot_id=current["checkpoint"]["published_result"]["snapshot_id"])
    assert index.read(current)["status"] == "pending"
    token, queued = index._pending.pop(job["id"])
    index._inflight[job["id"]] = (token, history_review.snapshot_identifier(queued), index._entries[job["id"]])
    index._desired.pop(job["id"])
    assert not index.remember(job, receipt, token=index.token(job))
    assert index.remember(current, confirmed, token=index.token(current))
    assert index.read(current) == confirmed


@pytest.mark.parametrize("incoming", ["full", "light"])
def test_light_desired_accepts_source_bound_full_publication(tmp_path, reviewed, incoming):
    job = staged(tmp_path, reviewed)
    light = {**job, "checkpoint": {}}
    index = index_for(tmp_path)
    receipt = selected_routes_review([reviewed], job_id=job["id"],
        snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    try:
        assert index.read(light)["status"] == "pending"
        if incoming == "full":
            assert index.remember(job, receipt, token=index.token(job))
        else:
            assert index.remember(light, receipt, token=history_review.review_context(light),
                source_identity=index.token(job)[1])
        assert not index._pending and index.read(light) == receipt
    finally:
        index.close()


def test_unbound_failure_cannot_erase_specific_publication_queue(tmp_path, reviewed, retained_review):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    current = staged(tmp_path, changed)
    assert index.read(current)["status"] == "pending"
    queued = index._pending[job["id"]]
    snapshot = receipt["source_binding"]["snapshot_id"]
    (index.artifacts / job["id"] / "results" / snapshot / "selected_routes.json").unlink()
    light = {**job, "checkpoint": {}}
    failed = pending_routes_review(job["id"], None, unavailable=True)
    assert index.remember(light, failed, token=history_review.review_context(light))
    assert index._pending.get(job["id"]) is queued
    assert index.read(light)["status"] == "unavailable"


@pytest.mark.parametrize("inflight", [False, True])
def test_light_read_preserves_specific_pending_publication(tmp_path, reviewed, retained_review, inflight):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    current = staged(tmp_path, changed)
    if inflight:
        index._inflight[job["id"]] = (history_review.review_context(job),
            receipt["source_binding"]["snapshot_id"], index._entries[job["id"]])
    assert index.read(current)["status"] == "pending"
    queued = index._pending[job["id"]]
    assert queued[1]["checkpoint"] == current["checkpoint"]
    index._desired.pop(job["id"])
    assert index.read({**current, "checkpoint": {}})["status"] == "pending"
    assert index._pending[job["id"]] is queued
    assert index._desired[job["id"]][2] == current["checkpoint"]["published_result"]["snapshot_id"]


def test_higher_revision_publication_advances_snapshot_without_weakening_rollback_guard(
    tmp_path, reviewed, retained_review,
):
    index, job, receipt = retained_review
    changed = deepcopy(reviewed)
    changed["starting_materials"] = ["O=C([O-])[O-]"]
    current = {**staged(tmp_path, changed), "revision": 2}
    confirmed = selected_routes_review([changed], job_id=job["id"],
        snapshot_id=current["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(current, confirmed, token=index.token(current))
    index._desired.pop(job["id"])
    assert not index.remember(job, receipt, token=index.token(job))
    assert index.read(current) == confirmed


def test_source_bound_legacy_none_publication_remains_accepted(tmp_path, reviewed):
    import json

    job = {**staged(tmp_path, reviewed), "checkpoint": {}}
    (tmp_path / job["id"] / "selected_routes.json").write_text(json.dumps([reviewed]))
    receipt = selected_routes_review([reviewed], job_id=job["id"], snapshot_id=None)
    index = index_for(tmp_path)
    try:
        assert index.read(job)["status"] == "pending"
        assert index.remember(job, receipt, token=index.token(job))
        assert index.read(job) == receipt and not index._pending
    finally:
        index.close()


@pytest.mark.parametrize("operation", ["read", "remember", "publish"])
def test_validation_cannot_restore_old_publication(
    tmp_path, reviewed, retained_review, paused_validation, operation,
):
    index, job, receipt = retained_review
    action, call = validation_call(index, job, receipt, operation)
    with paused_validation(action, call=call) as results:
        changed = deepcopy(reviewed)
        changed["starting_materials"] = ["O=C([O-])[O-]"]
        newer = staged(tmp_path, changed)
        newer["revision"] = 2
        current = selected_routes_review([changed], job_id=job["id"],
            snapshot_id=newer["checkpoint"]["published_result"]["snapshot_id"])
        assert index.read(newer)["status"] == "pending"
        assert index.remember(newer, current, token=index.token(newer))
    pending = pending_routes_review(job["id"], receipt["source_binding"]["snapshot_id"])
    assert results == ([pending] if operation == "read" else [False])
    assert index.read(newer) == current and not index._pending


@pytest.mark.parametrize("binding", ["token", "source_identity"])
def test_publication_rechecks_original_source_identity(retained_review, paused_validation, binding):
    index, job, receipt = retained_review
    token = index.token(job)
    kwargs = {"token": token} if binding == "token" else {"source_identity": token[1]}
    source = index.artifacts / job["id"] / "results" / receipt["source_binding"]["snapshot_id"] / "selected_routes.json"
    with paused_validation(partial(index.remember, job, receipt, **kwargs)) as results:
        source.write_bytes(source.read_bytes() + b" ")
    assert results == [False]
    assert index.read(job)["status"] == "pending"


@pytest.mark.parametrize("operation", ["read", "remember", "publish"])
@pytest.mark.parametrize("error", [OSError, ValueError])
def test_validation_errors_never_cache_an_approval(retained_review, paused_validation, operation, error):
    index, job, receipt = retained_review
    retained = index._entries[job["id"]]
    action, call = validation_call(index, job, receipt, operation)
    if operation == "read":
        with paused_validation(action, call=call, error=error) as results:
            pass
        assert results[0]["status"] == "unavailable"
    else:
        with pytest.raises(error, match="Artifact validation failed"):
            with paused_validation(action, call=call, error=error):
                pass
    assert index._entries[job["id"]] is retained and not index._pending
    assert index.read(job) == receipt


@pytest.mark.parametrize("change", ["missing", "changed", "symlink"])
def test_out_of_lock_validation_still_checks_actual_artifacts(retained_review, paused_validation, change):
    index, job, receipt = retained_review
    source = index.artifacts / job["id"] / "results" / receipt["source_binding"]["snapshot_id"] / "selected_routes.json"
    with paused_validation(partial(index.read, job)) as results:
        if change == "missing":
            source.unlink()
        elif change == "changed":
            source.write_bytes(source.read_bytes() + b" ")
        else:
            target = source.with_name("retained-route.json")
            source.rename(target)
            source.symlink_to(target)
    assert results[0]["status"] == ("unavailable" if change == "symlink" else "pending")


@pytest.mark.parametrize("operation", ["read", "remember", "publish"])
def test_shutdown_finishes_during_validation_and_rejects_late_work(retained_review, paused_validation, operation):
    index, job, receipt = retained_review
    index.start()
    action, call = validation_call(index, job, receipt, operation)
    with ThreadPoolExecutor(max_workers=1) as lifecycle:
        with paused_validation(action, call=call) as results:
            lifecycle.submit(index.close).result(timeout=1)
            assert not index._thread.is_alive() and index._executor._process is None
            desired, entries = dict(index._desired), dict(index._entries)
    unavailable = pending_routes_review(job["id"], receipt["source_binding"]["snapshot_id"], unavailable=True)
    assert results == ([unavailable] if operation == "read" else [False])
    assert dict(index._desired) == desired and dict(index._entries) == entries and not index._pending


@pytest.mark.parametrize("operation", ["read", "remember"])
def test_validation_rechecks_evicted_desired_state_without_growing_queues(
    tmp_path, reviewed, paused_validation, operation,
):
    limits = HistoryReviewLimits(max_entries=1, max_pending=1, batch_size=1)
    index = index_for(tmp_path, limits=limits)
    job = staged(tmp_path, reviewed)
    receipt = selected_routes_review([reviewed], job_id=job["id"],
        snapshot_id=job["checkpoint"]["published_result"]["snapshot_id"])
    assert index.remember(job, receipt)
    action, call = validation_call(index, job, receipt, operation)
    try:
        with paused_validation(action, call=call) as results:
            for prefix in ("b", "c", "d", "e"):
                assert index.read({**job, "id": prefix * 32})["status"] == "pending"
            assert job["id"] not in index._desired
        pending = pending_routes_review(job["id"], receipt["source_binding"]["snapshot_id"])
        assert results == ([False] if operation == "remember" else [pending])
        assert len(index._desired) == 3 and len(index._pending) == 1 and len(index._entries) == 1
    finally:
        index.close()


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


def test_explicit_result_read_seeds_same_history_index(tmp_path, reviewed):
    job = staged(tmp_path, reviewed)
    index = index_for(tmp_path)
    try:
        result = route_result(job, artifacts=tmp_path, budget=PerformanceBudget(), review_index=index)
        receipt = result["result"]["unified_route_pool"]["summary"]["delivery_review"]
        assert receipt["status"] == "ready" and receipt["grade"] == "model_checked"
        assert receipt["source_binding"]["snapshot_id"] == job["checkpoint"]["published_result"]["snapshot_id"]
        assert index.read(job) == receipt
        assert index._executor is None and not index._pending
    finally:
        index.close()


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
    index._inflight[first["id"]] = (old_token, history_review.snapshot_identifier(queued), index._entries.get(first["id"]))
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
