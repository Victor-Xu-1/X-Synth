"""Private child lifecycle checks with controlled callbacks, not scientific inference."""

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from packages.adapters.askcos.native_search_jobs import (
    ChildSearchBody, NativeSearchJobs, SearchCancelled, acquire_search_slot, register_search_jobs,
)
from packages.adapters.askcos.native_search_protocol import (
    NATIVE_SEARCH_HEADER, NATIVE_SEARCH_READY_PATH, NATIVE_SEARCH_PROTOCOL,
    NATIVE_SEARCH_PROTOCOL_VERSION, managed_search_profile,
)
from packages.platform.atomic_file import write_json
from packages.platform import native_search_contract


ROOT = Path(__file__).resolve().parents[2]
IDENTIFIER = "a" * 32
UNIT_KEY = "controlled-unit-key"


def protocol_output(smiles="CCO"):
    return {"uds": {"node_dict": {smiles: {"smiles": smiles}}, "uuid2smiles": {},
                    "graph": [], "pathways": [], "pathways_properties": []}, "stats": {}}


def eventually(check, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.01)
    raise AssertionError("Controlled native lifecycle did not reach the expected boundary")


@contextmanager
def child_app(runner):
    app = FastAPI()
    jobs = register_search_jobs(app, "unit_protocol", runner)()
    app.state.search_jobs = jobs
    try:
        with TestClient(app) as client:
            yield client, jobs
    finally:
        jobs.close()


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", UNIT_KEY)


def test_authentication_precedes_body_parsing_and_covers_all_child_operations(tmp_path, monkeypatch):
    calls = []
    with child_app(lambda *args: calls.append(args) or protocol_output()) as (client, jobs):
        routes = [("POST", "/api/search-jobs"), ("GET", f"/api/search-jobs/{IDENTIFIER}"),
                  ("GET", f"/api/search-jobs/{IDENTIFIER}/result"), ("DELETE", f"/api/search-jobs/{IDENTIFIER}"),
                  ("GET", NATIVE_SEARCH_READY_PATH)]
        for method, path in routes:
            reply = client.request(method, path, content=b"not JSON", headers={NATIVE_SEARCH_HEADER: "wrong"})
            assert reply.status_code == 403
            assert UNIT_KEY not in reply.text
        monkeypatch.delenv("X_SYNTH_NATIVE_SEARCH_KEY")
        for method, path in routes:
            assert client.request(method, path).status_code == 503
        assert calls == []
        assert not list(jobs.root.glob("*.json"))


def test_authenticated_readiness_is_small_and_does_not_execute_or_create_children():
    calls = []
    with child_app(lambda *args: calls.append(args)) as (client, jobs):
        reply = client.get(NATIVE_SEARCH_READY_PATH, headers={NATIVE_SEARCH_HEADER: UNIT_KEY})
        assert reply.status_code == 200
        assert reply.json() == {"status": "ready", "protocol": NATIVE_SEARCH_PROTOCOL,
                                "protocol_version": NATIVE_SEARCH_PROTOCOL_VERSION, "strategy": "unit_protocol"}
        assert len(reply.content) < 256
        assert calls == []
        assert not list(jobs.root.glob("*.json"))
        jobs.close()
        assert client.get(NATIVE_SEARCH_READY_PATH, headers={NATIVE_SEARCH_HEADER: UNIT_KEY}).status_code == 503


def test_authenticated_readiness_refuses_a_full_child_queue():
    started = threading.Event()

    def runner(payload, event, *_):
        started.set()
        event.wait(2)
        raise SearchCancelled()

    with child_app(runner) as (client, jobs):
        jobs.budget = replace(jobs.budget, native_queue_size=1)
        jobs.submit(ChildSearchBody(id=IDENTIFIER, input={"smiles": "CCO"}))
        assert started.wait(1)
        assert client.get(NATIVE_SEARCH_READY_PATH, headers={NATIVE_SEARCH_HEADER: UNIT_KEY}).status_code == 503
        jobs.cancel(IDENTIFIER)


def test_authenticated_submit_status_result_cancel_are_idempotent_and_key_is_not_persisted():
    calls = []

    def runner(payload, *_):
        calls.append(payload)
        return protocol_output()

    headers = {NATIVE_SEARCH_HEADER: UNIT_KEY}
    body = {"id": IDENTIFIER, "input": {"smiles": "CCO"}}
    with child_app(runner) as (client, jobs):
        assert client.post("/api/search-jobs", json=body, headers=headers).status_code == 200
        eventually(lambda: jobs.get(IDENTIFIER)["status"] == "completed")
        assert client.post("/api/search-jobs", json=body, headers=headers).json()["status"] == "completed"
        assert client.get(f"/api/search-jobs/{IDENTIFIER}", headers=headers).json()["status"] == "completed"
        assert client.get(f"/api/search-jobs/{IDENTIFIER}/result", headers=headers).json()["uds"]["node_dict"]["CCO"]
        assert client.delete(f"/api/search-jobs/{IDENTIFIER}", headers=headers).json()["status"] == "completed"
        assert len(calls) == 1
        changed = {**body, "input": {"smiles": "CCC"}}
        assert client.post("/api/search-jobs", json=changed, headers=headers).status_code == 409
        assert all(UNIT_KEY not in path.read_text() for path in jobs.root.glob("*.json"))


def test_acknowledged_cancel_survives_actual_worker_process_loss(tmp_path):
    script = """
import time, sys
import packages.platform
packages.platform.__path__.append(sys.argv[1])
from packages.adapters.askcos.native_search_jobs import NativeSearchJobs, ChildSearchBody
def controlled(payload, event, checkpoint, progress):
    while True:
        time.sleep(.05)
jobs = NativeSearchJobs('crash_unit', controlled)
jobs.submit(ChildSearchBody(id='a' * 32, input={'smiles': 'CCO'}))
jobs.cancel('a' * 32)
print('cancel-acknowledged', flush=True)
while True:
    time.sleep(.05)
"""
    env = {"HOME": str(tmp_path), "PATH": os.defpath, "PYTHONPATH": str(ROOT),
           "PYTHONDONTWRITEBYTECODE": "1", "X_SYNTH_STATE_DIR": str(tmp_path)}
    process = subprocess.Popen([sys.executable, "-u", "-c", script, str(Path(native_search_contract.__file__).parent)], cwd=ROOT, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        eventually(lambda: (tmp_path / "native/crash_unit" / (IDENTIFIER + ".json")).exists())
        path = tmp_path / "native/crash_unit" / (IDENTIFIER + ".json")
        eventually(lambda: json.loads(path.read_text()).get("cancel_requested"))
        process.kill()
        process.wait(timeout=3)
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=3)
    calls = []
    jobs = NativeSearchJobs("crash_unit", lambda *args: calls.append(args))
    try:
        record = jobs.submit(ChildSearchBody(id=IDENTIFIER, input={"smiles": "CCO"}))
        assert record["status"] == "cancelled"
        assert record["cancel_requested"] is True
        assert calls == []
    finally:
        jobs.close()


def test_interrupted_child_can_be_cancelled_without_a_live_event():
    request = ChildSearchBody(id=IDENTIFIER, input={"smiles": "CCO"})
    jobs = NativeSearchJobs("cancel_interrupted_unit", lambda *args: protocol_output())
    try:
        digest = hashlib.sha256(json.dumps(request.input, sort_keys=True, allow_nan=False).encode()).hexdigest()
        write_json(jobs.path(IDENTIFIER), {"id": IDENTIFIER, "input_sha256": digest, "status": "interrupted"})
        assert jobs.cancel(IDENTIFIER)["status"] == "cancelled"
        assert jobs.submit(request)["status"] == "cancelled"
    finally:
        jobs.close()


def test_legacy_cancelling_record_becomes_a_nonreplayable_tombstone():
    request = ChildSearchBody(id=IDENTIFIER, input={"smiles": "CCO"})
    jobs = NativeSearchJobs("legacy_cancel_unit", lambda *args: protocol_output())
    digest = hashlib.sha256(json.dumps(request.input, sort_keys=True, allow_nan=False).encode()).hexdigest()
    write_json(jobs.path(IDENTIFIER), {"id": IDENTIFIER, "input_sha256": digest, "status": "cancelling"})
    jobs.close()
    calls = []
    recovered = NativeSearchJobs("legacy_cancel_unit", lambda *args: calls.append(args))
    try:
        assert recovered.submit(request)["status"] == "cancelled"
        assert recovered.get(IDENTIFIER)["cancel_requested"] is True
        assert calls == []
    finally:
        recovered.close()


def test_recoverable_rpc_failure_resumes_the_same_full_checkpoint_without_option_changes():
    from types import SimpleNamespace
    import networkx as nx
    from packages.adapters.askcos.native_http import NativeProtocolError
    from packages.adapters.askcos.search_checkpoint import SearchCheckpoint

    target = "[13CH3][C@H](O)[NH3+].[Cl-]"
    options = {"smiles": target, "expand_one_options": {"max_num_templates": 1000, "max_cum_prob": 0.999}}
    request = ChildSearchBody(id=IDENTIFIER, input=options)
    graph = nx.DiGraph()
    graph.add_node(target, smiles=target, retained="complete-unit-graph")
    controller = SimpleNamespace(tree=graph, target=target, chemicals=[target], reactions=[], iterations=17, time_to_solve=0)

    def first(payload, event, path, progress):
        assert payload == options
        SearchCheckpoint(path, progress).save(controller, 12.5, force=True)
        raise NativeProtocolError("Controlled unavailable dependency", recoverable=True)

    jobs = NativeSearchJobs("continuation_unit", first)
    jobs.submit(request)
    eventually(lambda: jobs.get(IDENTIFIER)["status"] == "interrupted")
    checkpoint_path = jobs.root / (IDENTIFIER + ".checkpoint.json")
    original = checkpoint_path.read_bytes()
    jobs.close()

    def resumed(payload, event, path, progress):
        assert payload == options
        restored = SimpleNamespace(chemicals=[], reactions=[])
        assert SearchCheckpoint(path, progress).restore(restored, target) == 12.5
        assert restored.tree.nodes[target]["retained"] == "complete-unit-graph"
        assert restored.iterations == 17
        assert path.read_bytes() == original
        return protocol_output(target)

    recovered = NativeSearchJobs("continuation_unit", resumed)
    try:
        recovered.submit(request)
        eventually(lambda: recovered.get(IDENTIFIER)["status"] == "completed")
        assert checkpoint_path.read_bytes() == original
    finally:
        recovered.close()


def test_cancelled_slot_waiter_does_not_run_and_shutdown_rejects_new_work():
    slot, started, calls = threading.BoundedSemaphore(1), threading.Event(), []
    slot.acquire()

    def runner(payload, event, *_):
        started.set()
        with acquire_search_slot(slot, event):
            calls.append(payload)
        return protocol_output()

    jobs = NativeSearchJobs("slot_unit", runner)
    try:
        jobs.submit(ChildSearchBody(id=IDENTIFIER, input={"smiles": "CCO"}))
        assert started.wait(2)
        jobs.cancel(IDENTIFIER)
        eventually(lambda: jobs.get(IDENTIFIER)["status"] == "cancelled")
        assert calls == []
        jobs.close()
        with pytest.raises(HTTPException) as rejected:
            jobs.submit(ChildSearchBody(id="b" * 32, input={"smiles": "CCO"}))
        assert rejected.value.status_code == 503
    finally:
        slot.release()
        jobs.close()


def test_profile_cannot_fall_back_to_unmanaged_when_managed_key_is_missing(monkeypatch):
    monkeypatch.delenv("X_SYNTH_NATIVE_SEARCH_KEY")
    monkeypatch.setenv("MODULE_CONFIG_PATH", "configs.module_config_x_synth")
    assert managed_search_profile()
    monkeypatch.setenv("MODULE_CONFIG_PATH", "configs.module_config_full")
    assert not managed_search_profile()
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "")
    assert managed_search_profile()
