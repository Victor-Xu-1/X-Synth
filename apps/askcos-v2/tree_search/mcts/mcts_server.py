import argparse
import copy
import logging
import os
import sys
import time
import traceback
import uvicorn
from contextlib import asynccontextmanager
from threading import BoundedSemaphore, Event
from starlette.concurrency import run_in_threadpool
from packages.adapters.askcos.native_search_jobs import register_search_jobs
from packages.adapters.askcos.search_checkpoint import SearchCheckpoint
from datetime import datetime
from fastapi import FastAPI
from mcts_controller import MCTS
from options import ExpandOneOptions, BuildTreeOptions, EnumeratePathsOptions
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import RDLogger

@asynccontextmanager
async def lifespan(app):
    app.state.search_jobs = make_jobs()
    try:
        yield
    finally:
        await run_in_threadpool(app.state.search_jobs.close)


app = FastAPI(lifespan=lifespan)
search_slots = BoundedSemaphore(1)
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health/ready")
def ready():
    return {"status": "ready", "engine": "askcos_mcts"}

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
    parser = argparse.ArgumentParser("mcts_server")
    parser.add_argument("--server_ip",
                        help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port",
                        help="Server port to use", type=int, default=9311)
    parser.add_argument("--log_file",
                        help="Log file", type=str, default="mcts_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    smiles: str
    expand_one_options: ExpandOneOptions = ExpandOneOptions()
    build_tree_options: BuildTreeOptions = BuildTreeOptions()
    enumerate_paths_options: EnumeratePathsOptions = EnumeratePathsOptions()


def run_native(payload, cancel_event, checkpoint_path=None, progress=lambda value: None):
    request = RequestBody(**payload)
    with search_slots:
        controller = MCTS()
        controller.cancel_event = cancel_event
        controller.checkpoint = SearchCheckpoint(checkpoint_path, progress) if checkpoint_path is not None else None
        uds, stats = controller.get_buyable_paths(
            target=request.smiles, expand_one_options=request.expand_one_options,
            build_tree_options=request.build_tree_options,
            enumerate_paths_options=request.enumerate_paths_options,
        )
        return {"stats": stats, "uds": uds, "version": 2}


make_jobs = register_search_jobs(app, "mcts", run_native)


@app.post("/get_buyable_paths")
def mcts_service(request: RequestBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        results = run_native(request.model_dump(), Event())
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

    except Exception:
        response["error"] = f"Error during mcts, traceback: " \
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
