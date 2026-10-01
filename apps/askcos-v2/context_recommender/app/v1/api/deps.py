from functools import lru_cache
import os
from pathlib import Path

from fastapi import Depends

from app.v1.services.predictor import NeuralNetContextRecommender
from app.v1.services.config import ContextConfig

# get_model is for v1, get_models is for v2
# Should we make them in different files?

def get_context_config() -> ContextConfig:
    _DEFAULT_PATH = "app/resources/models/context/v1"
    CONTEXT_DIR = Path(os.getenv("app_V1_DIR", _DEFAULT_PATH))

    return ContextConfig(
        CONTEXT_DIR / "model.json",
        CONTEXT_DIR,
        CONTEXT_DIR / "weights.h5",
        CONTEXT_DIR / "ehs_solvent_scores.csv",
    )

print(get_context_config())

@lru_cache(maxsize=None)
def get_model(config: ContextConfig = Depends(get_context_config)):
    return NeuralNetContextRecommender(config=config).load()
