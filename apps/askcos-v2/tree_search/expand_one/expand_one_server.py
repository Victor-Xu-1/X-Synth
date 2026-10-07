import argparse
import copy
import logging
import os
import sys
import traceback
import uvicorn
from contextlib import asynccontextmanager
from api.cluster_api import ClusterSetting
from datetime import datetime
from expand_one_controller import ExpandOneController, RetroBackendOption
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rdkit import RDLogger
from typing import List

@asynccontextmanager
async def lifespan(app):
    global controller
    controller = ExpandOneController()
    try:
        yield
    finally:
        controller.close()
        controller = None


app = FastAPI(lifespan=lifespan)


@app.get("/health/ready")
def ready():
    active = globals().get("controller")
    if active is None:
        raise HTTPException(503, "One-step controller is not initialized")
    evidence = active.evidence_library.status() if active.evidence_library else None
    if evidence is not None and not evidence.ready:
        raise HTTPException(503, "Configured reaction evidence is unavailable")
    return {"status": "ready", "engine": "askcos_expand_one",
            "evidence_source": evidence.model_dump(mode="json") if evidence else None}

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}


def parse_args():
    parser = argparse.ArgumentParser("expand_one_server")
    parser.add_argument("--server_ip",
                        help="Server IP to use", type=str, default="0.0.0.0")
    parser.add_argument("--server_port",
                        help="Server port to use", type=int, default=9301)
    parser.add_argument("--log_file",
                        help="Log file", type=str, default="expand_one_server")

    return parser.parse_args()


class RequestBody(BaseModel):
    smiles: str
    retro_backend_options: List[RetroBackendOption] = [RetroBackendOption()]
    banned_chemicals: List[str] = None
    banned_reactions: List[str] = None
    use_fast_filter: bool = True
    fast_filter_threshold: float = 0.75
    retro_rerank_backend: str = "relevance_heuristic"
    atom_map_backend: str = "rxnmapper"
    cluster_precursors: bool = True
    cluster_setting: ClusterSetting = ClusterSetting()
    max_num_for_clustering: int = 100
    extract_template: bool = False
    return_reacting_atoms: bool = True
    selectivity_check: bool = False
    include_evidence_candidates: bool = True


@app.post("/get_outcomes")
def expand_one_service(request: RequestBody):
    response = copy.deepcopy(base_response)

    try:
        results = controller.get_outcomes(
            smiles=request.smiles,
            retro_backend_options=request.retro_backend_options,
            banned_chemicals=request.banned_chemicals,
            banned_reactions=request.banned_reactions,
            use_fast_filter=request.use_fast_filter,
            fast_filter_threshold=request.fast_filter_threshold,
            retro_rerank_backend=request.retro_rerank_backend,
            atom_map_backend=request.atom_map_backend,
            cluster_precursors=request.cluster_precursors,
            cluster_setting=request.cluster_setting,
            max_num_for_clustering=request.max_num_for_clustering,
            extract_template=request.extract_template,
            return_reacting_atoms=request.return_reacting_atoms,
            selectivity_check=request.selectivity_check,
            include_evidence_candidates=request.include_evidence_candidates,
        )
        response["results"] = results
        response["status"] = "SUCCESS"

    except Exception:
        response["error"] = f"Error during expand one, traceback: " \
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
