from dataclasses import dataclass
from os import PathLike
from typing import Dict

from app.v2.services.config.model import ModelConfig


@dataclass(frozen=True, unsafe_hash=True)
class ContextConfig:
    reagent_conv_rules_path: PathLike
    default_models: Dict[str, str]
    model_configs: Dict[str, ModelConfig]
