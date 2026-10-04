"""Bounded native forward inference; scientific output stays typed and traceable."""

import math
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import BoundedSemaphore

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from model_runtime import Graph2SmilesRuntime
from packages.workspace.structure_validation import canonical_structure
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
    return {"status": "ready", "model": "graph2smiles_uspto_stereo", "asset_identity": runtime.identity}


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
        products = []
        for smiles, score in zip(output["products"], output["scores"], strict=True):
            if not math.isfinite(score) or score > 0:
                raise ValueError("Invalid model score")
            try:
                canonical = canonical_structure(smiles, max_atoms=300)[0]
            except ValueError:
                continue
            if canonical not in {row["product"] for row in products}:
                products.append({"product": canonical, "log_probability": score})
        return {"reactants": reactants, "products": products,
                "model": "graph2smiles_uspto_stereo", "asset_identity": runtime.identity,
                "evidence_type": "model_prediction"}
    finally:
        guard.release()
