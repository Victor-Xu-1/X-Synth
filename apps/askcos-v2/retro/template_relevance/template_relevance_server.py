"""Serve the native ASKCOS inference handler without an obsolete model server."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
from threading import BoundedSemaphore
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from rdkit import Chem
import torch

from templ_rel_handler import TemplRelHandler


class PredictionRequest(BaseModel):
    smiles: list[str] = Field(min_length=1, max_length=32)
    max_num_templates: int = Field(default=1000, ge=1, le=5000)
    max_cum_prob: float = Field(default=0.999, gt=0, le=1)
    attribute_filter: list[dict] = Field(default_factory=list, max_length=20)


handlers = {}
inference_slots = BoundedSemaphore(1)


@asynccontextmanager
async def lifespan(app):
    torch.set_num_threads(int(os.environ.get("ASKCOS_MODEL_THREADS", "4")))
    paths = json.loads(os.environ["ASKCOS_TEMPLATE_MODEL_DIRS"])
    for name, raw_path in paths.items():
        path = Path(raw_path).resolve()
        handler = TemplRelHandler()
        handler.initialize(SimpleNamespace(manifest={}, system_properties={"model_dir": str(path)}))
        handlers[name] = handler
    if not handlers:
        raise RuntimeError("No ASKCOS template-relevance model was configured")
    yield
    handlers.clear()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/ping")
@app.get("/health/ready")
def ready():
    if not handlers:
        raise HTTPException(503, "No model is loaded")
    return {"status": "ready", "models": {
        name: {"template_count": len(handler.templates), "fingerprint_bits": handler.args.fp_size}
        for name, handler in handlers.items()
    }}


@app.post("/predictions/{model_name}")
def predict(model_name: str, request: PredictionRequest):
    handler = handlers.get(model_name)
    if handler is None:
        raise HTTPException(404, "Model is not configured")
    if any(len(smiles) > 20_000 or Chem.MolFromSmiles(smiles) is None for smiles in request.smiles):
        raise HTTPException(422, "Invalid molecular structure")
    if not inference_slots.acquire(timeout=30):
        raise HTTPException(429, "Inference queue is full", headers={"Retry-After": "5"})
    try:
        return handler.inference(handler.preprocess([{"body": request.model_dump()}]))
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Invalid template attribute filter") from exc
    finally:
        inference_slots.release()
