import argparse
import copy
import logging
import os
import sys
import time
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from impurity_predictor import ImpurityPredictor
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import RDLogger
from typing import Optional

app = FastAPI()
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

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


class RequestBody(BaseModel):
    predictor_backend: str = "wldn5"
    predictor_model_name: str = "pistachio"
    inspector: str = None
    atom_map_backend: str = "rxnmapper"

    rct_smi: Optional[str]
    prd_smi: Optional[str]
    sol_smi: Optional[str]
    rea_smi: Optional[str]

    top_k: int = 3
    threshold: float = 0.2
    check_mapping: bool = True


def parse_args():
    parser = argparse.ArgumentParser("impurity_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9691)
    parser.add_argument("--log_file", help="Log file", type=str, default="impurity_server")

    return parser.parse_args()


@app.post("/impurity")
def impurity_service(request_json: RequestBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        # set up api *per query*
        handler = ImpurityPredictor(
            predictor_backend=request_json.predictor_backend,
            predictor_model_name=request_json.predictor_model_name,
            inspector=request_json.inspector,
            atom_map_backend=request_json.atom_map_backend,
            topn_outcome=request_json.top_k,
            insp_threshold=request_json.threshold,
            check_mapping=request_json.check_mapping,
        )

        rct_smi = request_json.rct_smi
        prd_smi = request_json.prd_smi
        sol_smi = request_json.sol_smi
        rea_smi = request_json.rea_smi

        results = handler.predict(
            reactants=rct_smi,
            products=prd_smi,
            reagents=rea_smi,
            solvents=sol_smi
        )
        del handler
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during impurity prediction, traceback: " \
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
