import argparse
import copy
import Fusion_Cycle
import logging
import os
import pandas as pd
import sys
import time
import torch
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import RDLogger
from typing import List

# Detect number of available CUDA devices
num_devices = torch.cuda.device_count()

if num_devices > 0:
    # If GPUs exist, pick device 0 by default
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    print(f"Using GPU device 0 (total available: {num_devices})")
else:
    # No GPUs → run on CPU
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    print("No GPU detected, running on CPU")

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


def parse_args():
    parser = argparse.ArgumentParser("Fusion_Cycle_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9771)
    parser.add_argument("--log_file", help="Log file", type=str, default="Fusion_Cycle_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    solute_smiles: List[str]
    solvent_smiles: List[str]
    temperature: List[float]
    density: List[float]


@app.post("/Fusion_Cycle")
def fusion_cycle_service(request_json: RequestBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        logging.info("Received request: %s", request_json.dict())

        df = pd.DataFrame(
            {
                "solute_smiles_canonical": request_json.solute_smiles,
                "solvent_smiles_canonical": request_json.solvent_smiles,
                "Temperature [K]": request_json.temperature,
                "solvent_density": request_json.density,
            }
        )
        logging.info("Input dataframe:\n%s", df)

        try:
            results = fusion_cycle.calculate_solubility(df)
        except Exception as inner_e:
            logging.error("Error in calculate_solubility: %s", traceback.format_exc())
            response["error"] = f"calculate_solubility failed: {inner_e}"
            return response

        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        logging.error("Error in fusion_cycle_service: %s", traceback.format_exc())
        response["error"] = f"Error during fusion cycle calculation, traceback: {traceback.format_exc()}"

        return response


if __name__ == "__main__":
    args = parse_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")

    os.makedirs("./logs", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")

    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(f"./logs/{args.log_file}.{dt}.log")
    sh = logging.StreamHandler(sys.stdout)
    fh.setLevel(logging.INFO)
    sh.setLevel(logging.INFO)
    logger.addHandler(fh)
    logger.addHandler(sh)

    # set up model
    try:
        fusion_cycle = Fusion_Cycle.model()
        logging.info("Fusion_Cycle model loaded: %s", type(fusion_cycle))
    except Exception:
        logging.error("Failed to initialize Fusion_Cycle model: %s", traceback.format_exc())
        sys.exit(1)

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
