import argparse
import copy
import logging
import os
import sys
import traceback
from datetime import datetime
from typing import List

import pandas
import uvicorn
from fastapi import FastAPI
from fastsolv import fastsolv
from pydantic import BaseModel
from rdkit import RDLogger

app = FastAPI()

base_response = {"status": "FAIL", "error": "", "results": []}


def parse_args():
    parser = argparse.ArgumentParser("fastsolv_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9761)
    parser.add_argument("--log_file", help="Log file", type=str, default="fastsolv_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    solvent_smiles: List[str]
    solute_smiles: List[str]
    temperature: List[float]


@app.post("/fastsolv")
def fastsolv_service(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        df = fastsolv(pandas.DataFrame(dict(request_json)))
        df = df.reset_index()  # order might not be preserved - return index
        response["results"] = df.to_dict("records")
        response["status"] = "SUCCESS"

        return response

    except Exception:
        response["error"] = f"Error during fastsolv prediction, traceback: " f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


if __name__ == "__main__":
    args = parse_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")

    os.makedirs("./logs", exist_ok=True)
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
