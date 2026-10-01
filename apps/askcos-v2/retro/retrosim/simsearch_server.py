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
from similarity_search import SimilaritySearch
from typing import List


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("simsearch_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9441)
    parser.add_argument("--log_file", help="Log file", type=str, default="simsearch_server")

    return parser.parse_args()


class RetrosimInput(BaseModel):
    smiles: List[str]
    threshold: float = 0.3
    top_k: int = 10
    reaction_set: str = "USPTO_FULL"
    method: str = "accurate"


@app.post("/predictions")
def retro_sim(request_json: RetrosimInput):
    response = copy.deepcopy(base_response)

    # make predictions
    try:
        smis = request_json.smiles
        threshold = request_json.threshold
        top_k = request_json.top_k
        reaction_set = request_json.reaction_set
        method = request_json.method

        results = []
        for smi in smis:
            valid_products = []
            valid_scores = []
            reaction_ids = []
            reaction_sets = []
            reaction_data = []

            result = searcher.find_similar_retrosim(
                smi,
                threshold=threshold,
                top_k=top_k,
                reaction_set=reaction_set,
                method=method
            )
            for sim_score, reactant, reaction_id, reaction_d in result:
                valid_products.append(reactant)
                valid_scores.append(sim_score)
                reaction_ids.append(reaction_id)
                reaction_sets.append(reaction_set)
                reaction_data.append(reaction_d)

            result = {
                "products": valid_products,
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
        response["error"] = f"Error during retrosim prediction, traceback: " \
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
    searcher = SimilaritySearch()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
