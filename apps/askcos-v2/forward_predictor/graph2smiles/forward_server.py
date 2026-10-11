"""Bounded native forward inference; scientific output stays typed and traceable."""

import os
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from threading import BoundedSemaphore

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from model_runtime import Graph2SmilesRuntime
from packages.adapters.askcos.forward_provenance import build_native_result
from packages.adapters.askcos.native_models import model_response_limit
from packages.adapters.askcos.native_service_limits import bounded_response
from packages.platform.performance import PerformanceBudget
from packages.chemistry.forward_evaluation import validate_forward_input


class PredictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str = Field(min_length=1, max_length=16384)


guard = BoundedSemaphore(1)


@asynccontextmanager
async def lifespan(app):
    torch.set_num_threads(int(os.environ.get("X_SYNTH_MODEL_THREADS", "4")))
    assets = Path(os.environ["ASKCOS_DATA_DIR"]) / "models/forward/USPTO_STEREO"
    runtime = Graph2SmilesRuntime().load(assets)
    app.state.runtime = runtime
    try:
        yield
    finally:
        runtime.close()
        app.state.runtime = None


app = FastAPI(lifespan=lifespan)


@app.get("/health/ready")
def ready():
    runtime = getattr(app.state, "runtime", None)
    if runtime is None or not runtime.initialized:
        raise HTTPException(503, "Forward model is not loaded")
    return {"status": "ready", "model": "graph2smiles_uspto_stereo", "asset_identity": runtime.identity,
            "provenance_version": 1}


@app.post("/predict")
def predict(body: PredictBody):
    try:
        reactants = validate_forward_input(body.reactants)
    except ValueError as exc:
        raise HTTPException(422, "Invalid reactant structure") from exc
    if not guard.acquire(blocking=False):
        raise HTTPException(429, "Forward model is busy")
    try:
        runtime = app.state.runtime
        output = runtime.predict(reactants)
        result = build_native_result(
            reactants=reactants, asset_identity=runtime.identity,
            parameters=output["parameters"], hypotheses=output["hypotheses"],
        ).model_dump(mode="json", exclude_none=True)
        return bounded_response(result, budget=replace(
            PerformanceBudget.from_environment(), response_bytes=model_response_limit("/predict"),
        ))
    finally:
        guard.release()
