"""Supervised NN-v1 inference; other condition models are not implicitly loaded."""

import logging
import math
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import BoundedSemaphore

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.common.services.model_assets import validate_assets
from app.v1.services.config import ContextConfig
from app.v1.services.predictor import NeuralNetContextRecommender
from packages.workspace.structure_validation import MAX_SMILES_LENGTH, canonical_structure

logger = logging.getLogger(__name__)
engine = None
identity = None
execution = BoundedSemaphore(1)


@asynccontextmanager
async def lifespan(app):
    global engine, identity
    directory = Path(os.environ["ASKCOS_DATA_DIR"]) / "models/context/v1"
    identity = validate_assets(directory)["archive_sha256"]
    config = ContextConfig(directory / "model.json", directory, directory / "weights.h5",
                           directory / "ehs_solvent_scores.csv")
    engine = NeuralNetContextRecommender(config=config).load()
    yield
    engine = None


app = FastAPI(lifespan=lifespan)


class ConditionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    product: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    count: int = Field(default=5, ge=1, le=20)


@app.get("/health/ready")
def health():
    if engine is None:
        raise HTTPException(503, "Condition model is not loaded")
    return {"status": "ready", "model": "nn_v1", "asset_identity": identity}


@app.post("/predict")
def predict(body: ConditionInput):
    if engine is None:
        raise HTTPException(503, "Condition model is not loaded")
    try:
        reactants = canonical_structure(body.reactants, max_atoms=1024)[0]
        product = canonical_structure(body.product, max_atoms=1024)[0]
    except ValueError as exc:
        raise HTTPException(422, "Invalid reaction structures") from exc
    if not execution.acquire(blocking=False):
        raise HTTPException(429, "Condition model is busy")
    try:
        conditions, scores = engine.recommend(
            f"{reactants}>>{product}", None, body.count,
            with_smiles=True, return_scores=True, return_separate=False,
        )
        if len(conditions) != len(scores):
            raise ValueError("Invalid condition model output")
        rows = []
        for condition, score in zip(conditions, scores):
            temperature, solvent, reagent, catalyst, *_ = condition
            if not math.isfinite(temperature) or not math.isfinite(score):
                raise ValueError("Nonfinite model output")
            rows.append({"temperature": float(temperature), "solvent": solvent,
                         "reagent": reagent, "catalyst": catalyst, "score": float(score)})
        return {"reactants": reactants, "product": product, "conditions": rows,
                "model": "nn_v1", "asset_identity": identity,
                "evidence_type": "model_prediction"}
    except Exception as exc:
        logger.exception("Condition model inference failed")
        raise HTTPException(502, "Condition model inference failed") from exc
    finally:
        execution.release()
