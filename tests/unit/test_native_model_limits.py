"""Admission, schemas and batch preservation with controlled callbacks, not inference."""

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from native_rpc_helpers import load_source, local_http
from packages.adapters.askcos.native_service_limits import (
    FAST_FILTER_BATCH_SIZE, FINGERPRINT_BATCH_SIZE, RANKER_BATCH_NODES,
    NativeExecutionSlot, NativeRequestLimits, bounded_response,
)


class ControlledWork:
    """Counts callback execution only; it never loads a trained model."""
    def __init__(self):
        self.model = object()
        self.active = self.peak = self.calls = 0
        self.lock = threading.Lock()
        self.entered, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.failure = None

    def load(self, **_):
        pass

    def work(self, output):
        with self.lock:
            self.active += 1
            self.calls += 1
            self.peak = max(self.peak, self.active)
        self.entered.set()
        try:
            assert self.release.wait(3)
            if self.failure:
                raise RuntimeError(self.failure)
            return output
        finally:
            with self.lock:
                self.active -= 1

    def evaluate_batch(self, reactions):
        return self.work([0.5] * len(reactions))

    def evaluate(self, *_):
        return self.work(0.5)

    def filter_with_threshold(self, *_):
        return self.work((True, 0.5))

    def scorer(self, trees, **_):
        return self.work({"scores": [-1] * len(trees), "encoded_trees": [[] for _ in trees],
                          "clusters": list(range(len(trees)))})


@pytest.fixture(params=["fast_filter", "pathway_ranker"])
def service(request, monkeypatch):
    kind, controlled = request.param, ControlledWork()
    monkeypatch.setitem(sys.modules, kind, SimpleNamespace(
        **({"FastFilterScorer": lambda: controlled} if kind == "fast_filter" else {"PathwayRanker": lambda: controlled})))
    if kind == "fast_filter":
        monkeypatch.setitem(sys.modules, "global_config", SimpleNamespace(FAST_FILTER_MODEL={"model_path": "unused-unit-path"}))
        monkeypatch.setitem(sys.modules, "prometheus_client", SimpleNamespace(
            Histogram=lambda *_, **__: SimpleNamespace(observe=lambda *_: None), make_asgi_app=FastAPI))
    module = load_source(f"apps/askcos-v2/{kind}/{kind}_server.py", f"unit_{kind}_service", monkeypatch)
    path = "/fast_filter_evaluate_batch" if kind == "fast_filter" else "/pathway_ranker"
    payload = {"rxn_smiles": ["CCO>>CC=O"]} if kind == "fast_filter" else {"trees": [{"smiles": "CCO", "children": []}]}
    return module, controlled, path, payload


def test_native_service_has_one_execution_and_bounded_admission_queue(service, monkeypatch):
    module, controlled, path, payload = service
    controlled.release.clear()
    module.execution.admission = threading.BoundedSemaphore(2)
    module.execution.wait_seconds = 1
    admitted_second, admission_lock, count = threading.Event(), threading.Lock(), []
    acquire = module.execution.admission.acquire

    def observed(*args, **kwargs):
        granted = acquire(*args, **kwargs)
        if granted:
            with admission_lock:
                count.append(True)
                if len(count) == 2:
                    admitted_second.set()
        return granted

    monkeypatch.setattr(module.execution.admission, "acquire", observed)
    with TestClient(module.app) as client, ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, path, json=payload)
        try:
            assert controlled.entered.wait(1)
            second = pool.submit(client.post, path, json=payload)
            assert admitted_second.wait(1)
            reply = client.post(path, json=payload)
            assert reply.status_code == 429
            assert controlled.calls == 1
            controlled.release.set()
            assert first.result(timeout=2).status_code == 200
            assert second.result(timeout=2).status_code == 200
            assert controlled.peak == 1
            assert controlled.calls == 2
        finally:
            controlled.release.set()


def test_native_service_limits_input_and_output_without_executing_oversized_input(service, monkeypatch):
    module, controlled, path, payload = service
    monkeypatch.setenv("X_SYNTH_REQUEST_BYTES", "1000")
    monkeypatch.setenv("X_SYNTH_RESPONSE_BYTES", "64")
    with TestClient(module.app) as client:
        assert client.post(path, content=b"x" * 1001, headers={"Content-Type": "application/json"}).status_code == 413
        assert controlled.calls == 0
        reply = client.post(path, json=payload)
        if path == "/pathway_ranker":
            assert reply.status_code == 413
        else:
            assert reply.status_code == 200
            reply = client.post(path, json={"rxn_smiles": ["CCO>>CC=O"] * 20})
            assert reply.status_code == 413


def test_native_service_does_not_return_exception_content(service):
    module, controlled, path, payload = service
    controlled.failure = "unit-private-marker"
    with TestClient(module.app) as client:
        reply = client.post(path, json=payload)
        assert reply.status_code == 503
        assert controlled.failure not in reply.text


def test_execution_queue_wait_is_bounded():
    slot = NativeExecutionSlot(wait_seconds=0.01)
    slot.execution.acquire()
    try:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as failure:
            with slot.acquire():
                pytest.fail("Busy native slot was entered")
        assert failure.value.status_code == 429
    finally:
        slot.execution.release()


@pytest.mark.parametrize("wait", [None, 0, -1, float("inf"), float("nan")])
def test_execution_queue_wait_requires_a_finite_positive_bound(wait):
    with pytest.raises(ValueError):
        NativeExecutionSlot(wait_seconds=wait)


def test_admitted_model_call_survives_execution_longer_than_two_seconds(service, monkeypatch):
    module, controlled, path, payload = service
    controlled.release.clear()
    module.execution.admission = threading.BoundedSemaphore(2)
    admitted_second = threading.Event()
    admission_lock, count = threading.Lock(), []
    acquire = module.execution.admission.acquire

    def observed(*args, **kwargs):
        granted = acquire(*args, **kwargs)
        if granted:
            with admission_lock:
                count.append(True)
                if len(count) == 2:
                    admitted_second.set()
        return granted

    monkeypatch.setattr(module.execution.admission, "acquire", observed)
    with TestClient(module.app) as client, ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, path, json=payload)
        try:
            assert controlled.entered.wait(1)
            second = pool.submit(client.post, path, json=payload)
            assert admitted_second.wait(1)
            started = time.monotonic()
            time.sleep(2.25)
            controlled.release.set()
            assert first.result(timeout=2).status_code == 200
            reply = second.result(timeout=2)
            assert reply.status_code == 200, (
                f"Admitted call returned {reply.status_code} behind healthy work held "
                f"for {time.monotonic() - started:.2f}s"
            )
            assert controlled.peak == 1
            assert controlled.calls == 2
        finally:
            controlled.release.set()


def test_chunked_request_body_limit_is_enforced_without_declared_length():
    import asyncio
    from dataclasses import replace
    from packages.platform.performance import PerformanceBudget

    calls, replies = [], []

    async def app(*_):
        calls.append(True)

    messages = iter([{"type": "http.request", "body": b"a" * 40, "more_body": True},
                     {"type": "http.request", "body": b"b" * 40, "more_body": False}])

    async def receive():
        return next(messages)

    async def send(message):
        replies.append(message)

    middleware = NativeRequestLimits(app, budget=replace(PerformanceBudget(), request_bytes=64))
    asyncio.run(middleware({"type": "http", "method": "POST", "path": "/", "headers": []}, receive, send))
    assert replies[0]["status"] == 413
    assert calls == []


def test_model_response_rejects_nonfinite_values():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as failure:
        bounded_response({"score": float("nan")})
    assert failure.value.status_code == 502


def test_fast_filter_schema_rejects_bad_pair_batch_and_structure_without_model_work(monkeypatch):
    controlled = ControlledWork()
    monkeypatch.setitem(sys.modules, "fast_filter", SimpleNamespace(FastFilterScorer=lambda: controlled))
    monkeypatch.setitem(sys.modules, "global_config", SimpleNamespace(FAST_FILTER_MODEL={"model_path": "unused"}))
    monkeypatch.setitem(sys.modules, "prometheus_client", SimpleNamespace(
        Histogram=lambda *_, **__: SimpleNamespace(observe=lambda *_: None), make_asgi_app=FastAPI))
    module = load_source("apps/askcos-v2/fast_filter/fast_filter_server.py", "unit_fast_filter_validation", monkeypatch)
    with TestClient(module.app) as client:
        for pair in [["CCO"], ["CCO", "CCO", "CCO"], ["not a structure", "CCO"]]:
            assert client.post("/fast_filter_evaluate", json={"smiles": pair}).status_code == 422
        assert client.post("/fast_filter_evaluate_batch", json={"rxn_smiles": ["CCO>>CC=O"] * (FAST_FILTER_BATCH_SIZE + 1)}).status_code == 422
        assert client.post("/fast_filter_evaluate_batch", json={"rxn_smiles": ["CCO>CC=O"]}).status_code == 422
        assert controlled.calls == 0


def test_fast_filter_rpc_chunks_every_candidate_in_order(monkeypatch):
    module = load_source("apps/askcos-v2/tree_search/expand_one/api/fast_filter_batch_api.py", "unit_filter_rpc", monkeypatch)
    values = [str(index) for index in range(FAST_FILTER_BATCH_SIZE * 2 + 1)]
    batches = []

    def callback(_, payload):
        batches.append(len(payload["rxn_smiles"]))
        return 200, {"status_code": 200, "message": "ok", "result": [float(value) for value in payload["rxn_smiles"]]}, {}

    with local_http(callback) as (url, _):
        client = module.FastFilterBatchAPI(url)
        try:
            assert client(values) == [float(value) for value in values]
            assert batches == [FAST_FILTER_BATCH_SIZE, FAST_FILTER_BATCH_SIZE, 1]
            assert client([]) == []
        finally:
            client.session.close()


def test_fast_filter_tensor_batches_preserve_count_and_order(monkeypatch):
    monkeypatch.setitem(sys.modules, "global_config", SimpleNamespace(FAST_FILTER_MODEL={"model_path": "unused"}))
    monkeypatch.setitem(sys.modules, "tensorflow", SimpleNamespace(concat=lambda arrays, axis: np.concatenate(arrays, axis=axis)))
    monkeypatch.setitem(sys.modules, "fingerprinting", SimpleNamespace(reac_prod_smi_to_morgan_fp=None))
    monkeypatch.setitem(sys.modules, "logger", SimpleNamespace(MyLogger=None))
    monkeypatch.setitem(sys.modules, "scorer", SimpleNamespace(Scorer=object))
    module = load_source("apps/askcos-v2/fast_filter/fast_filter.py", "unit_filter_batches", monkeypatch)
    scorer, batches = module.FastFilterScorer(), []
    scorer.smiles_to_fp = lambda reactant, target: (np.array([[int(reactant)]]), np.array([[int(reactant)]]))

    def callback(products, reactions):
        batches.append(len(products))
        return SimpleNamespace(numpy=lambda: products)

    scorer._predict_fingerprints = callback
    count = FINGERPRINT_BATCH_SIZE * 2 + 1
    assert scorer.evaluate_batch([f"{index}>>0" for index in range(count)]) == list(range(count))
    assert batches == [FINGERPRINT_BATCH_SIZE, FINGERPRINT_BATCH_SIZE, 1]


def test_pathway_ranker_batches_preserve_placeholders_and_global_clustering(monkeypatch):
    for name in ["torch", "hdbscan", "sklearn.cluster"]:
        monkeypatch.setitem(sys.modules, name, SimpleNamespace())
    monkeypatch.setitem(sys.modules, "sklearn", SimpleNamespace(cluster=sys.modules["sklearn.cluster"]))
    monkeypatch.setitem(sys.modules, "model", SimpleNamespace(PathwayRankingModel=None))
    monkeypatch.setitem(sys.modules, "utils", SimpleNamespace(
        convert_askcos_trees=lambda trees: trees, tree_to_input=None, merge_into_batch=None))
    module = load_source("apps/askcos-v2/pathway_ranker/pathway_ranker.py", "unit_ranker_batches", monkeypatch)
    ranker, batches, clusters = module.PathwayRanker(), [], []
    ranker.preprocess = lambda trees: trees
    ranker.postprocess = lambda values: values

    def inference(trees):
        batches.append(len(trees))
        return {"scores": [tree["ordinal"] for tree in trees], "encoded_trees": [[tree["ordinal"]] for tree in trees]}

    def cluster(encodings, scores, **_):
        clusters.append((len(encodings), list(scores)))
        return list(range(len(encodings)))

    ranker.inference = inference
    ranker._cluster_encoded_trees = cluster
    trees = [{"ordinal": index, "depth": 2, "child": [{"child": []}]} for index in range(RANKER_BATCH_NODES + 1)]
    trees.insert(1, {"ordinal": -99, "depth": 1, "child": []})
    result = ranker.scorer(trees, clustering=True)
    expected = list(range(RANKER_BATCH_NODES + 1))
    expected.insert(1, -1)
    assert result["scores"] == expected
    assert result["encoded_trees"][1] == []
    assert result["clusters"][1] == -1
    assert len(clusters) == 1
    assert clusters[0][0] == RANKER_BATCH_NODES + 1
    assert max(batches) * 2 <= RANKER_BATCH_NODES
