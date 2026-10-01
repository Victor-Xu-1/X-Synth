import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from pydantic import BaseModel
from rdkit import RDLogger
from reaction_class import ReactionClass
from typing import List


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("reaction_class_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9621)
    parser.add_argument("--log_file", help="Log file", type=str, default="reaction_class_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    smiles: List[str]
    num_results: int = 10


class RequestBodyBatch(BaseModel):
    smiles: List[str]
    level: int = 2
    threshold: float = None


@app.post("/reaction_class")
def reaction_class_service(request: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        smis = request.smiles[0]
        num_results = request.num_results

        # Should we make a "list" argument, not a single string?
        outputs = reaction_class.get_classes(smis, num_results=num_results)["result"]
        response["results"] = outputs
        response["status"] = "SUCCESS"
        return response

    except Exception:
        response["error"] = f"Error during reaction classification, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/get_top_class_batch")
def get_top_class_batch_service(request: RequestBodyBatch):
    response = copy.deepcopy(base_response)

    try:
        smiles_list = request.smiles
        level = request.level
        threshold = request.threshold

        outputs = reaction_class.get_top_class_batch(
            smiles_list=smiles_list,
            level=level,
            threshold=threshold
        )
        response["results"] = outputs
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during get_top_class_batch (part of reaction classification), traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


if __name__ == "__main__":
    args = parse_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")

    os.makedirs(f"./logs", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")

    # Is the following code necessary?
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(f"./logs/{args.log_file}.{dt}.log")
    sh = logging.StreamHandler(sys.stdout)
    fh.setLevel(logging.INFO)
    sh.setLevel(logging.INFO)
    logger.addHandler(fh)
    logger.addHandler(sh)

    # set up apis
    reaction_class = ReactionClass()
    reaction_class.load_model()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
