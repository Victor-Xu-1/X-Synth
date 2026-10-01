import argparse
import copy
import os
import quarc_parser
import sys
import time
import traceback
import uvicorn
from datetime import datetime
from fastapi import FastAPI
from fastapi.routing import APIRouter
from loguru import logger
from prometheus_client import CollectorRegistry, Histogram, multiprocess, make_asgi_app
from pydantic import BaseModel, Field
from quarc_predictor import QuarcPredictor
from typing import Optional


app = FastAPI()
router = APIRouter()
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

base_response = {
    "status": "FAIL",
    "error": "",
    "results": []
}

INFERENCE_TIME = Histogram(
    "inference_duration_seconds",
    "Time spent on inference",
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5)  # customize
)


class RequestBody(BaseModel):
    smiles: list[str]
    top_k: Optional[int] = Field(10, ge=1, le=80, description="Number of top predictions")


@router.post("/condition_prediction")
def quarc_prediction_service(request_json: RequestBody):
    start_time = time.perf_counter()
    response = copy.deepcopy(base_response)

    try:
        results = predictor.predict_batch(request_json.smiles, top_k=request_json.top_k)

        response["results"] = results
        response["status"] = "SUCCESS"

        INFERENCE_TIME.observe(time.perf_counter() - start_time)

        return response

    except Exception:
        response["error"] = (
            f"Error during QUARC prediction, traceback: " f"{traceback.format_exc()}"
        )
        traceback.print_exc()

        return response


@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "message": "Condition recommender is running",
        "model_loaded": True if predictor is not None else False,
    }


app.include_router(router)

if __name__ == "__main__":
    parser = argparse.ArgumentParser("quarc_server")
    quarc_parser.add_predict_opts(parser)
    quarc_parser.add_server_opts(parser)
    quarc_parser.add_data_opts(parser)

    args, unknown = parser.parse_known_args()

    # create logger
    os.makedirs("./logs/server", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")
    log_file = f"./logs/server/quarc_server.{dt}.log"

    logger.remove()
    logger.add(sys.stderr, level="INFO", colorize=True)
    logger.add(log_file, level="INFO")

    # set up model
    predictor = QuarcPredictor(args)

    # start running
    uvicorn.run(app, host=args.server_ip, port=args.server_port)

    # python quarc_server.py --config-path=configs/gnn_pipeline.yaml
