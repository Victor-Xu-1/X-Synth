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
from template_free import TemplateFreeNeuralNetScorer
from typing import List, Optional


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


class RequestBody(BaseModel):
    model_name: str = "pistachio"
    reactants: str
    contexts: Optional[List[str]]


def parse_args():
    parser = argparse.ArgumentParser("wln_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9501)
    parser.add_argument("--log_file", help="Log file", type=str, default="wldn5_server")

    return parser.parse_args()


@app.post("/wldn5_predict")
def RxnMapperService(request: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        if request.model_name == "uspto_500k":
            results = wldn5_uspto_api.evaluate(
                reactants=request.reactants,
                contexts=request.contexts
            )
        elif request.model_name == "pistachio":
            results = wldn5_pistachio_api.evaluate(
                reactants=request.reactants,
                contexts=request.contexts
            )
        else:
            raise ValueError(f"model_name {request.model_name} not supported!")

        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during wldn5 forward prediction, traceback: " \
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
    wldn5_uspto_api = TemplateFreeNeuralNetScorer()
    wldn5_uspto_api.load(model_name="uspto_500k")
    wldn5_pistachio_api = TemplateFreeNeuralNetScorer()
    wldn5_pistachio_api.load(model_name="pistachio")

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
