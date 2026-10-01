import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from rdkit import RDLogger
from typing import Any, Dict, List
from datetime import datetime
from rxnmapper import RXNMapper
from typing_extensions import LiteralString

app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


class RequestBody(BaseModel):
    smiles: List[str]
    batch_size: int = 256


def parse_args():
    parser = argparse.ArgumentParser("rxnmapper_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9671)
    parser.add_argument("--log_file", help="Log file", type=str, default="rxnmapper_server")

    return parser.parse_args()


class RXNMapperApi:
    def __init__(self):
        self.mapper = RXNMapper()

    def map_reactions(self, smiles: List[str], batch_size: int) -> List[Dict[str, Any]]:
        outcomes = []

        if any(len(smi) > 300 for smi in smiles):
            # hardcode to reduce batch size for very long reaction
            # for stability; just that RAM won't explode
            batch_size = 32

        for i in range(0, len(smiles), batch_size):
            batch_smiles = smiles[i:i+batch_size]

            try:
                outcome = self.mapper.get_attention_guided_atom_maps(batch_smiles)
                outcomes.extend(outcome)
            except Exception:
                # On exception, resort to 1-by-1 prediction
                # to retain as many successful ones as possible
                for smi in batch_smiles:
                    try:
                        outcome = self.mapper.get_attention_guided_atom_maps([smi])[0]
                    except Exception:
                        outcome = None
                    outcomes.append(outcome)

        return outcomes


@app.post("/ibm_rxnmapper")
def RxnMapperService(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = []
        outcomes = rxnmapper_api.map_reactions(
            smiles=request_json.smiles,
            batch_size=request_json.batch_size
        )

        if all(outcome is None for outcome in outcomes):
            response["error"] = f"Error in rxnmapper and all outcomes are None, traceback: " \
                                f"{traceback.format_exc()}"
            traceback.print_exc()
        else:
            # at least some results are successful
            results.append(outcomes)
            response["results"] = results
            response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error in rxnmapper, traceback: " \
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
    rxnmapper_api = RXNMapperApi()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
