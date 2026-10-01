import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from graphenum import RxnGraphEnumerator
from pydantic import BaseModel
from rdkit import RDLogger
from typing import List, Optional

app = FastAPI()
base_response = {
    "status": "FAIL",
    "error": "",
    "results": 0
}


def parse_args():
    parser = argparse.ArgumentParser("count_analogs_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9911)
    parser.add_argument("--log_file", help="Log file", type=str, default="count_analogs_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    reaction_smiles: List[str]
    reaction_smarts: Optional[List[str]]
    atom_map_backend: str = "rxnmapper"
    min_plausibility: float = 0.1


@app.post("/count_analogs")
def count_analogs_service(request: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        graph = RxnGraphEnumerator(
            reaction_smiles=request.reaction_smiles,
            reaction_smarts=request.reaction_smarts,
            atom_map_backend=request.atom_map_backend
        )
        graph.search_building_blocks()
        graph.filter_by_similarity(threshold=0.5)
        graph.filter_by_plausibility(threshold=request.min_plausibility)
        result = graph.count_combinations()
        response["results"] = int(result)
        response["status"] = "SUCCESS"

        # V1 does create a graph per query. TODO: We'll optimize this later
        del graph

    except Exception:
        response["error"] = f"Error during count_analogs, traceback: " \
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
