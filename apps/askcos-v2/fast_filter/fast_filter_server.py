import argparse
import copy
import logging
import os
import sys
import time
import traceback
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import RDLogger
from fast_filter import FastFilterScorer
from typing import List
import global_config as gc

# Turn off multiproc for now.
# Seems that we'll have to switch to gunicorn-based (vs. uvicorn) serving to make multiproc work

# # Set the directory for multiprocess mode
# multiproc_dir = "/tmp/prometheus_multiproc_dir"
# os.environ["PROMETHEUS_MULTIPROC_DIR"] = multiproc_dir
# os.makedirs(multiproc_dir, exist_ok=True)
#
#
# def make_metrics_app():
#     registry = CollectorRegistry()
#     multiprocess.MultiProcessCollector(registry)
#
#     return make_asgi_app(registry=registry)

@asynccontextmanager
async def lifespan(app):
    global fast_filter
    fast_filter = FastFilterScorer()
    fast_filter.load(model_path=gc.FAST_FILTER_MODEL["model_path"])
    yield
    fast_filter = None


app = FastAPI(lifespan=lifespan)
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health/ready")
def ready():
    scorer = globals().get("fast_filter")
    if scorer is None or scorer.model is None:
        raise HTTPException(503, "Fast-filter checkpoint is not loaded")
    return {"status": "ready", "model": "askcos_fast_filter"}

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}

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


class EvaluateBody(BaseModel):
    smiles: List[str]


class EvaluateThresholdBody(BaseModel):
    smiles: List[str]
    threshold: float


class EvaluateBatchBody(BaseModel):
    rxn_smiles: List[str]


@app.post("/fast_filter_evaluate")
def fast_filter_service(request_json: EvaluateBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        results = []
        smis = request_json.smiles
        reactant, target = smis[0], smis[1]
        outcome = fast_filter.evaluate(reactant, target)
        results.append(outcome)
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during fast filter, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/filter_with_threshold")
def filter_with_threshold(request_json: EvaluateThresholdBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        smis = request_json.smiles
        results = []
        reactant, target = smis[0], smis[1]
        flag, outcome = fast_filter.filter_with_threshold(
            reactant,
            target,
            request_json.threshold
        )
        dict_ = {"flag": flag, "score": outcome}
        results.append(dict_)
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during filter with threshold, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/fast_filter_evaluate_batch")
def fast_filter_evaluate_batch(request_json: EvaluateBatchBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        scores = fast_filter.evaluate_batch(request_json.rxn_smiles)
        response["results"] = scores
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during fast filter evaluate batch, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


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
