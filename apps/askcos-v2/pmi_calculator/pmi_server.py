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
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel
from rdkit import RDLogger
from pmi_calculator import PMICalculator
from typing import List, Dict

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


class PmiCalculatorInput(BaseModel):
    trees: List[Dict]


def parse_args():
    parser = argparse.ArgumentParser("pmi_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9701)
    parser.add_argument("--log_file", help="Log file", type=str, default="pmi_server")

    return parser.parse_args()


@app.post("/pmi_calculator")
def pmi_service(data: PmiCalculatorInput):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        results = []
        tree_input = data.trees
        calculator.set_graphs(tree_input)
        rxns = calculator.get_reactions_from_tree(tree_input)
        calculator.predict_conditions(rxns)
        outcome = calculator.calculate_pmi_batch()
        results.append(outcome)
        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = f"Error during pmi calculation, traceback: " \
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

    # set up apis

    calculator = PMICalculator()
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
