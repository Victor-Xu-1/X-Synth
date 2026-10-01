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
from descriptors import ReactivityDescriptor


app = FastAPI()

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


class RequestBody(BaseModel):
    # smiles: List[str]
    smiles: str


def parse_args():
    parser = argparse.ArgumentParser("descriptor_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9631)
    parser.add_argument("--log_file", help="Log file", type=str, default="descriptor_server")

    return parser.parse_args()


@app.post("/descriptors")
def descriptor_service(request_json: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = []
        # outcome = handler.evaluate(str(smis))
        outcome = handler.evaluate(request_json.smiles)
        results.append(outcome)
        response["results"] = results
        response["status"] = "SUCCESS"
        return response

    except Exception:
        response["error"] = f"Error during descriptors, traceback: " \
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
    handler = ReactivityDescriptor()

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)
