"""Externally supervised native services; X-Synth owns search jobs and budgets."""
from copy import deepcopy
import os

from configs.module_config_full import module_config as upstream_config

module_config = deepcopy(upstream_config)
enabled = {
    "cluster", "fast_filter", "pathway_ranker", "retro_template_relevance",
    "scscore", "tree_search_expand_one", "tree_search_mcts",
    "tree_search_retro_star", "value_network",
    "context_recommender", "forward_graph2smiles", "impurity_predictor",
}
module_config["modules_to_start"] = {
    name: False for name in module_config["modules_to_start"]
}
module_config["compose_managed_modules"] = {name: True for name in enabled}
module_config["global"]["require_frontend"] = False

for config in module_config.values():
    deployment = config.get("deployment") if isinstance(config, dict) else None
    if deployment:
        for key in ("default_prediction_url", "custom_prediction_url"):
            deployment[key] = deployment.get(key, "").replace("0.0.0.0", "127.0.0.1")

template = module_config["retro_template_relevance"]["deployment"]
template["default_prediction_url"] = "http://127.0.0.1:19410/predictions"
template["ports_to_expose"] = [19410]
template["available_model_names"] = os.environ.get(
    "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
).split(",")
module_config["tree_search_expand_one"]["deployment"]["timeout"] = 300
module_config["tree_search_mcts"]["deployment"]["timeout"] = 7800
module_config["tree_search_retro_star"]["deployment"]["timeout"] = 7800
module_config["value_network"]["deployment"]["default_prediction_url"] = "http://127.0.0.1:9350/predictions"
