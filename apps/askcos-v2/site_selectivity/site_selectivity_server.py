import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from fastapi.routing import APIRouter
from pydantic import BaseModel
from rdkit import RDLogger
from site_selectivity import SiteSelectivityModel
from typing import List

app = FastAPI()
router = APIRouter()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("site_selectivity_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9601)
    parser.add_argument("--log_file", help="Log file", type=str, default="site_selectivity_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    smiles: List[str]


@app.post("/site_selectivity")
def site_select_service(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = []
        for smi in request_json.smiles:
            results.append(site_select.predict(smi))
        response["results"] = results
        response["status"] = "SUCCESS"
        return response

    except Exception:
        response["error"] = f"Error during site selectivity prediction, traceback: " \
                            f"{traceback.format_exc()}"
        traceback.print_exc()

        return response


app.include_router(router)


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
    site_select = SiteSelectivityModel()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
