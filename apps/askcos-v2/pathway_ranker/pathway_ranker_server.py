import argparse
import logging
import os
import sys
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from rdkit import RDLogger
from pathway_ranker import PathwayRanker
from typing import Literal
from packages.adapters.askcos.native_service_limits import RANKER_BATCH_NODES, RANKER_MAX_TREES, NativeExecutionSlot, NativeRequestLimits, bounded_response

execution = NativeExecutionSlot()

@asynccontextmanager
async def lifespan(app):
    global ranker
    ranker = PathwayRanker()
    ranker.load(model_path=os.path.join(os.environ.get("ASKCOS_DATA_DIR", "data"), "models"))
    yield
    ranker = None


app = FastAPI(lifespan=lifespan)
app.add_middleware(NativeRequestLimits, slot=execution)


@app.get("/health/ready")
def ready():
    if globals().get("ranker") is None or ranker.model is None:
        raise HTTPException(503, "Pathway-ranker checkpoint is not loaded")
    return {"status": "ready", "model": "treeLSTM512-fp2048"}


class PathwayRankerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trees: list[dict] = Field(max_length=RANKER_MAX_TREES)
    clustering: bool = False
    cluster_method: Literal["hdbscan", "kmeans"] = "hdbscan"
    min_samples: int = Field(default=5, ge=1, le=RANKER_MAX_TREES)
    min_cluster_size: int = Field(default=5, ge=2, le=RANKER_MAX_TREES)

    @field_validator("trees")
    @classmethod
    def bounded_trees(cls, trees):
        for tree in trees:
            pending, nodes = [(tree, 0)], 0
            while pending:
                node, depth = pending.pop()
                nodes += 1
                if not isinstance(node, dict) or depth > 128 or nodes > 2 * RANKER_BATCH_NODES:
                    raise ValueError("Invalid or oversized pathway tree")
                children = node.get("children")
                if not isinstance(node.get("smiles"), str) or len(node["smiles"]) > 20000 or not isinstance(children, list):
                    raise ValueError("Invalid pathway node")
                pending.extend((child, depth + 1) for child in children)
        return trees


def parse_args():
    parser = argparse.ArgumentParser("pathway_ranker_server")
    parser.add_argument("--server_ip", help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port", help="Server port to use", type=int, default=9681)
    parser.add_argument("--log_file", help="Log file", type=str, default="pathway_ranker_server")

    return parser.parse_args()


@app.post("/pathway_ranker")
def pathway_ranker_service(data: PathwayRankerInput):
    with execution.acquire():
        if globals().get("ranker") is None:
            raise HTTPException(503, "Pathway-ranker checkpoint is not loaded")
        try:
            outcome = ranker.scorer(
                trees=data.trees, clustering=data.clustering, cluster_method=data.cluster_method,
                min_samples=data.min_samples, min_cluster_size=data.min_cluster_size,
            )
            return bounded_response({"status": "SUCCESS", "error": "", "results": [outcome]})
        except HTTPException:
            raise
        except (ValueError, TypeError, KeyError, IndexError):
            raise HTTPException(422, "Invalid pathway-ranker input") from None
        except Exception:
            raise HTTPException(503, "Pathway-ranker execution failed") from None


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
