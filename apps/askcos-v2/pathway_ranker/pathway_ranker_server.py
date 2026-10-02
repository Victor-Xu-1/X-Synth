import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rdkit import RDLogger
from pathway_ranker import PathwayRanker
from typing import List, Dict

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}

@asynccontextmanager
async def lifespan(app):
    global ranker
    ranker = PathwayRanker()
    ranker.load(model_path=os.path.join(os.environ.get("ASKCOS_DATA_DIR", "data"), "models"))
    yield
    ranker = None


app = FastAPI(lifespan=lifespan)


@app.get("/health/ready")
def ready():
    if globals().get("ranker") is None or ranker.model is None:
        raise HTTPException(503, "Pathway-ranker checkpoint is not loaded")
    return {"status": "ready", "model": "treeLSTM512-fp2048"}


class PathwayRankerInput(BaseModel):
    trees: List[Dict]
    clustering: bool = False
    cluster_method: str = "hdbscan"
    min_samples: int = 5
    min_cluster_size: int = 5


def parse_args():
    parser = argparse.ArgumentParser("pathway_ranker_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9681)
    parser.add_argument("--log_file", help="Log file", type=str, default="pathway_ranker_server")

    return parser.parse_args()


@app.post("/pathway_ranker")
# def pathway_ranker_service(json_data: List[dict] = Body(...)):
def pathway_ranker_service(data: PathwayRankerInput):
    response = copy.deepcopy(base_response)

    try:
        results = []
        outcome = ranker.scorer(
            trees=data.trees,
            clustering=data.clustering,
            cluster_method=data.cluster_method,
            min_samples=data.min_samples,
            min_cluster_size=data.min_cluster_size,
        )
        results.append(outcome)
        response["results"] = results
        response["status"] = "SUCCESS"
        return response

    except Exception:
        response["error"] = f"Error during pathway ranking, traceback: " \
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
