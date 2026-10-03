from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import time

import pytest

from packages.orchestrator.job_repository import JobRepository
from packages.platform.atomic_file import write_json
from packages.platform.leader_lock import LeaderLock
from packages.adapters.askcos.native_search_jobs import NativeSearchJobs, ChildSearchBody, SearchCancelled


def test_unknown_job_schema_is_rejected_without_mutation(tmp_path):
    path = tmp_path / "jobs.sqlite"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE schema_version(version INTEGER PRIMARY KEY)")
        connection.execute("INSERT INTO schema_version VALUES (99)")
    with pytest.raises(RuntimeError):
        JobRepository(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT version FROM schema_version").fetchall() == [(99,)]


def test_worker_leadership_and_checkpoint_recovery(tmp_path):
    first, second = LeaderLock(tmp_path / "worker.lock"), LeaderLock(tmp_path / "worker.lock")
    assert first.acquire()
    assert not second.acquire()
    first.close()
    assert second.acquire()
    repository = JobRepository(tmp_path / "jobs.sqlite")
    job = repository.create("owner", {"smiles": "CCO"})
    active = repository.claim_next()
    repository.transition(job["id"], "searching", expected_revision=active["revision"], checkpoint={"children": {"mcts": "child"}})
    assert repository.recover_interrupted() == 1
    recovered = repository.get(job["id"])
    assert recovered["status"] == "waiting_for_engine"
    assert recovered["checkpoint"]["children"]["mcts"] == "child"
    second.close()


def test_child_execution_is_idempotent_and_cancellable(tmp_path, monkeypatch):
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path))
    calls = []

    def controlled_work(payload, cancellation, checkpoint, progress):
        calls.append(payload)
        progress({"iterations": 1})
        while not cancellation.wait(.01):
            pass
        raise SearchCancelled()

    jobs = NativeSearchJobs("protocol_test", controlled_work)
    request = ChildSearchBody(id="a" * 32, input={"operation": "cancellation"})
    jobs.submit(request)
    jobs.submit(request)
    deadline = time.monotonic() + 2
    while not calls and time.monotonic() < deadline:
        time.sleep(.01)
    jobs.cancel(request.id)
    jobs.close()
    assert len(calls) == 1
    assert jobs.get(request.id)["status"] == "cancelled"


def test_atomic_generated_state_remains_valid(tmp_path):
    import json
    path = tmp_path / "checkpoint.json"
    for revision in range(10):
        write_json(path, {"revision": revision})
        assert json.loads(path.read_text())["revision"] == revision
    assert not list(tmp_path.glob("*.tmp"))


def test_real_network_outage_is_resumable_not_a_chemical_failure(tmp_path, monkeypatch):
    import requests
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path))

    def disconnected_work(payload, cancellation, checkpoint, progress):
        requests.get("http://127.0.0.1:1/", timeout=.1)

    jobs = NativeSearchJobs("network_protocol_test", disconnected_work)
    request = ChildSearchBody(id="b" * 32, input={"smiles": "CCO"})
    jobs.submit(request)
    deadline = time.monotonic() + 2
    while jobs.get(request.id)["status"] in {"queued", "running"} and time.monotonic() < deadline:
        time.sleep(.01)
    jobs.close()
    assert jobs.get(request.id)["status"] == "interrupted"
    assert jobs.get(request.id)["error_code"] == "native_dependency_unavailable"
