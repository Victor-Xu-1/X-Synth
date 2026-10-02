"""Serve the upstream USPTO_FULL value network without executing archive code."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from threading import BoundedSemaphore

from fastapi import FastAPI, HTTPException
import numpy as np
from pydantic import BaseModel, Field
import torch

from model.value_mlp import ValueMLP
from route.utils import smi_to_fp, clear_atom_map


model = None
slots = BoundedSemaphore(1)


@asynccontextmanager
async def lifespan(app):
    global model
    torch.set_num_threads(int(os.environ.get("ASKCOS_MODEL_THREADS", "4")))
    asset = Path(os.environ["ASKCOS_DATA_DIR"]) / "models/value_network/epoch_99.pt"
    state = torch.load(asset, map_location="cpu", weights_only=True)
    state = {key.removeprefix("module."): value for key, value in state.items()}
    model = ValueMLP(n_layers=6, fp_dim=2048, latent_dim=128, dropout_rate=0.1, device="cpu")
    model.load_state_dict(state, strict=True)
    model.eval()
    yield
    model = None


app = FastAPI(lifespan=lifespan)


class ValueRequest(BaseModel):
    smiles: list[str] = Field(min_length=1, max_length=500)


@app.get("/health/ready")
def ready():
    if model is None:
        raise HTTPException(503, "Value-network checkpoint is not loaded")
    return {"status": "ready", "model": "USPTO_FULL", "fingerprint_bits": 2048}


@app.post("/predictions/USPTO_FULL")
def predict(request: ValueRequest):
    if model is None:
        raise HTTPException(503, "Value-network checkpoint is not loaded")
    try:
        fingerprints = np.stack([smi_to_fp(clear_atom_map(smi)).reshape(2048) for smi in request.smiles])
    except (ValueError, AttributeError):
        raise HTTPException(422, "Invalid SMILES") from None
    with slots, torch.inference_mode():
        scores = model(torch.as_tensor(fingerprints, dtype=torch.float32)).flatten().tolist()
    if not np.isfinite(scores).all():
        raise HTTPException(502, "Value network returned invalid scores")
    return scores
