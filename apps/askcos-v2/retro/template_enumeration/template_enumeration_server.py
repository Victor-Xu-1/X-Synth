import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from pydantic import BaseModel, Field
from rdkit import RDLogger
from template_enumerator import TemplateEnumerator
from typing import List


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("template_enumeration_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9461)
    parser.add_argument("--log_file", help="Log file", type=str, default="template_enumeration_server")

    return parser.parse_args()


class TemplateEnumeratorInput(BaseModel):
    smiles: List[str] = Field(
        description="list of target SMILES",
        example=["CS(=N)(=O)Cc1cccc(Br)c1", "CN(C)CCOC(c1ccccc1)c1ccccc1"]
    )
    model_name: str = "USPTO_50k"


@app.post("/predictions")
def template_enumeration(request_json: TemplateEnumeratorInput):
    response = copy.deepcopy(base_response)

    # make predictions
    try:
        smis = request_json.smiles
        template_set = request_json.model_name

        results = []
        for smi in smis:
            reactants, templates, scores = enumerator.enumerate(
                target_product_smiles=smi,
                template_set=template_set
            )
            result = {
                "reactants": reactants,
                "templates": templates,
                "scores": scores
            }
                
            results.append(result)

        response["results"] = results
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during template enumeration, traceback: " \
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
    enumerator = TemplateEnumerator()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
