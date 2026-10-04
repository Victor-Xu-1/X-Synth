"""Loopback HTTP boundary for the centrally supervised impurity model process."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from native_mapper import service_ready
from native_runtime import WORKER_RSS_BYTES, ImpurityRuntime

from apps.api.request_limits import RequestLimitMiddleware
from packages.adapters.askcos.impurities import (
    MAX_FORWARD_CALLS,
    MAX_MAPPING_CALLS,
    REQUEST_TIMEOUT,
    ImpurityInput,
    ImpurityResult,
    canonical_input,
)
from packages.adapters.askcos.native_models import NativeModelError
from packages.workspace.http_validation import WorkspaceRoute


@asynccontextmanager
async def lifespan(app):
    app.state.runtime = ImpurityRuntime().load()
    try:
        yield
    finally:
        app.state.runtime.close()


app = FastAPI(lifespan=lifespan)
app.router.route_class = WorkspaceRoute
app.add_middleware(RequestLimitMiddleware, limit=524288)


def _loopback(request):
    if (
        request.client is None
        or request.client.host not in {"127.0.0.1", "::1"}
        or request.url.hostname not in {"127.0.0.1", "localhost", "::1"}
        or request.headers.get("origin")
        or request.headers.get("sec-fetch-site") == "cross-site"
    ):
        raise HTTPException(
            403, "Native impurity service accepts only loopback clients."
        )


@app.get("/health/ready")
def ready(request: Request):
    _loopback(request)
    runtime = getattr(app.state, "runtime", None)
    if runtime is None or not runtime.initialized:
        raise HTTPException(503, "Actual impurity models are not loaded.")
    try:
        service_ready(
            os.environ.get("X_SYNTH_FORWARD_URL", "http://127.0.0.1:9911"),
            "graph2smiles_uspto_stereo",
        )
        service_ready(
            os.environ.get("X_SYNTH_FAST_FILTER_URL", "http://127.0.0.1:9611"),
            "askcos_fast_filter",
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "An actual impurity dependency is not ready.") from exc
    return {
        "status": "ready",
        "model": "askcos_impurity_rxnmapper",
        "provenance": runtime.provenance,
        "check_mapping": True,
        "cpu_threads": runtime.threads,
        "execution_parallelism": 1,
        "max_reactants": 4,
        "max_forward_calls": MAX_FORWARD_CALLS,
        "max_mapping_calls": MAX_MAPPING_CALLS,
        "timeout_seconds": REQUEST_TIMEOUT,
        "worker_rss_limit_bytes": WORKER_RSS_BYTES,
        "worker_pid": runtime.process.pid,
    }


@app.post("/predict", response_model=ImpurityResult)
def predict(body: ImpurityInput, request: Request):
    _loopback(request)
    try:
        canonical = canonical_input(body)
    except ValueError as exc:
        raise HTTPException(
            422, "Invalid impurity structures or input atom budget."
        ) from exc
    try:
        return app.state.runtime.predict(canonical)
    except NativeModelError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
