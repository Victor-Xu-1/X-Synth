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
from general_selectivity import (
    GnnGeneralSelectivityPredictor,
    QmGnnGeneralSelectivityPredictor,
    QmGnnGeneralSelectivityPredictorNoReagent
)

app = FastAPI()
base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("general_selectivity_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9641)
    parser.add_argument("--log_file", help="Log file", type=str, default="general_selectivity_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    smiles: str
    atom_map_backend: str = "rxnmapper"
    mapped: bool = False
    all_outcomes: bool = False
    no_map_reagents: bool = True


@app.post("/general_selectivity")
def general_select_service(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = general_select.predict(
            rxnsmiles=request_json.smiles,
            atom_map_backend=request_json.atom_map_backend,
            mapped=request_json.mapped,
            all_outcomes=request_json.all_outcomes,
            no_map_reagents=request_json.no_map_reagents
        )
        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during general selectivity with gnn, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/qm_predictor")
def qm_general_selectivity(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = qm_predictor.predict(
            rxnsmiles=request_json.smiles,
            atom_map_backend=request_json.atom_map_backend,
            mapped=request_json.mapped,
            all_outcomes=request_json.all_outcomes,
            no_map_reagents=request_json.no_map_reagents
        )
        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during general selectivity with qm, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


@app.post("/qm_no_reagent")
def qm_general_selectivity(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = qm_no_reagent.predict(
            rxnsmiles=request_json.smiles,
            atom_map_backend=request_json.atom_map_backend,
            mapped=request_json.mapped,
            all_outcomes=request_json.all_outcomes,
            no_map_reagents=request_json.no_map_reagents
        )
        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during general selectivity with qm (no reagent), traceback: " \
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
    general_select = GnnGeneralSelectivityPredictor()
    qm_predictor = QmGnnGeneralSelectivityPredictor()
    qm_no_reagent = QmGnnGeneralSelectivityPredictorNoReagent()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
