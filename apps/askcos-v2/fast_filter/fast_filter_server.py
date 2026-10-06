import argparse
import logging
import os
import sys
import time
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from prometheus_client import Histogram, make_asgi_app
from pydantic import BaseModel, ConfigDict, Field, field_validator
from rdkit import Chem, RDLogger
from fast_filter import FastFilterScorer
from typing import Annotated
from packages.platform.performance import PerformanceBudget
from packages.adapters.askcos.native_service_limits import FAST_FILTER_BATCH_SIZE, NativeExecutionSlot, NativeRequestLimits, bounded_response
import global_config as gc

execution = NativeExecutionSlot()

@asynccontextmanager
async def lifespan(app):
    global fast_filter
    fast_filter = FastFilterScorer()
    fast_filter.load(model_path=gc.FAST_FILTER_MODEL["model_path"])
    yield
    fast_filter = None


app = FastAPI(lifespan=lifespan)
app.add_middleware(NativeRequestLimits, slot=execution)
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health/ready")
def ready():
    scorer = globals().get("fast_filter")
    if scorer is None or scorer.model is None:
        raise HTTPException(503, "Fast-filter checkpoint is not loaded")
    return {"status": "ready", "model": "askcos_fast_filter"}

INFERENCE_TIME = Histogram(
    "inference_duration_seconds",
    "Time spent on inference",
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5)  # customize
)


def parse_args():
    parser = argparse.ArgumentParser("fast_filter_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9611)
    parser.add_argument("--log_file", help="Log file", type=str, default="fast_filter_server")

    return parser.parse_args()


Structure = Annotated[str, Field(min_length=1, max_length=20000)]


def validate_structure(smiles):
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None or molecule.GetNumAtoms() > PerformanceBudget.from_environment().max_structure_atoms:
        raise ValueError("Invalid or oversized molecular structure")
    return smiles


class EvaluateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    smiles: list[Structure] = Field(min_length=2, max_length=2)

    @field_validator("smiles")
    @classmethod
    def structures(cls, values):
        return [validate_structure(value) for value in values]


class EvaluateThresholdBody(EvaluateBody):
    threshold: float = Field(ge=0, le=1, allow_inf_nan=False)


class EvaluateBatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rxn_smiles: list[Structure] = Field(max_length=FAST_FILTER_BATCH_SIZE)

    @field_validator("rxn_smiles")
    @classmethod
    def reactions(cls, values):
        for value in values:
            parts = value.split(">")
            if len(parts) != 3:
                raise ValueError("Invalid reaction structure")
            validate_structure(parts[0])
            validate_structure(parts[2])
        return values


def execute(operation):
    with execution.acquire():
        if globals().get("fast_filter") is None:
            raise HTTPException(503, "Fast-filter checkpoint is not loaded")
        start = time.perf_counter()
        try:
            output = operation()
            response = bounded_response({"status": "SUCCESS", "error": "", "results": output})
        except HTTPException:
            raise
        except (ValueError, TypeError, KeyError, IndexError):
            raise HTTPException(422, "Invalid fast-filter input") from None
        except Exception:
            raise HTTPException(503, "Fast-filter execution failed") from None
        INFERENCE_TIME.observe(time.perf_counter() - start)
        return response


@app.post("/fast_filter_evaluate")
def fast_filter_service(request_json: EvaluateBody):
    return execute(lambda: [fast_filter.evaluate(*request_json.smiles)])


@app.post("/filter_with_threshold")
def filter_with_threshold(request_json: EvaluateThresholdBody):
    def operation():
        flag, outcome = fast_filter.filter_with_threshold(*request_json.smiles, request_json.threshold)
        return [{"flag": flag, "score": outcome}]

    return execute(operation)


@app.post("/fast_filter_evaluate_batch")
def fast_filter_evaluate_batch(request_json: EvaluateBatchBody):
    return execute(lambda: fast_filter.evaluate_batch(request_json.rxn_smiles))


if __name__ == "__main__":
    args = parse_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")

    os.makedirs(f"./logs", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")

    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(f"./logs/{args.log_file}.{dt}.log")
    sh = logging.StreamHandler(sys.stdout)
    fh.setLevel(logging.INFO)
    sh.setLevel(logging.INFO)
    logger.addHandler(fh)
    logger.addHandler(sh)

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
