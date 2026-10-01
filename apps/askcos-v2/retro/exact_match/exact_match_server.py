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
from exact_match import ExactMatch
from typing import List


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("exact_match_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9451)
    parser.add_argument("--log_file", help="Log file", type=str, default="exact_match_server")

    return parser.parse_args()


class ExactMatchInput(BaseModel):
    smiles: List[str]
    reaction_set: str = "USPTO_FULL"


@app.post("/predictions")
def exact_match(request_json: ExactMatchInput):
    response = copy.deepcopy(base_response)

    # make predictions
    try:
        smis = request_json.smiles
        reaction_set = request_json.reaction_set

        results = []
        for smi in smis:
            valid_reactants = []
            valid_scores = []
            reaction_ids = []
            reaction_sets = []
            reaction_data = []

            result = searcher.search_exact(
                target_product_smiles=smi,
                reaction_set=reaction_set
            )
            for reactant, reaction_id, reaction_d in result:
                valid_reactants.append(reactant)
                valid_scores.append(1.0)
                reaction_ids.append(reaction_id)
                reaction_sets.append(reaction_set)
                reaction_data.append(reaction_d)

            result = {
                "reactants": valid_reactants,
                "scores": valid_scores,
                "reaction_ids": reaction_ids,
                "reaction_sets": reaction_sets,
                "reaction_data": reaction_data
            }
                
            results.append(result)

        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during exact match, traceback: " \
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

    # set up model
    searcher = ExactMatch()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
