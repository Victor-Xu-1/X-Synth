import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from scscore import SCScorePrecursorPrioritizer
from pydantic import BaseModel
from rdkit import RDLogger
from typing import List

app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": 0.0
}


class RequestBody(BaseModel):
    smiles: str


class RequestBatchBody(BaseModel):
    smiles_list: List[str]


def parse_args():
    parser = argparse.ArgumentParser("scscore_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9741)
    parser.add_argument("--log_file", help="Log file", type=str, default="scscore_server")

    return parser.parse_args()


@app.post("/scscore")
def scscore_service(request: RequestBody):
    response = copy.deepcopy(base_response)
    try:
        results = float(scscorer.get_score_from_smiles(request.smiles))
        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during scscore, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/scscore_batch")
def scscore_batch_service(request: RequestBatchBody):
    response = copy.deepcopy(base_response)
    try:
        scores = scscorer.get_batch_scores(smiles_list=request.smiles_list)
        response["results"] = scores
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during scscore_batch, traceback: " \
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

    # set up api *per query*
    scscorer = SCScorePrecursorPrioritizer()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
