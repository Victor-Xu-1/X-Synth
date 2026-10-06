"""Externally supervised native services; X-Synth owns search jobs and budgets."""
from copy import deepcopy
import os

from configs.module_config_full import module_config as upstream_config
from packages.platform.native_endpoints import module_deployment_endpoints
from packages.platform.performance import PerformanceBudget

module_config = deepcopy(upstream_config)
enabled = {
    "cluster", "fast_filter", "pathway_ranker", "retro_template_relevance",
    "scscore", "tree_search_expand_one", "value_network",
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

for name, deployment in module_deployment_endpoints().items():
    module_config[name]["deployment"].update(deployment)

template = module_config["retro_template_relevance"]["deployment"]
template["available_model_names"] = os.environ.get(
    "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
).split(",")
budget = PerformanceBudget.from_environment()
for name in enabled - {"tree_search_expand_one"}:
    module_config[name]["deployment"]["timeout"] = budget.model_timeout_seconds
module_config["tree_search_expand_one"]["deployment"]["timeout"] = budget.expansion_timeout_seconds
module_config["tree_search_mcts"]["deployment"]["timeout"] = 7800
module_config["tree_search_retro_star"]["deployment"]["timeout"] = 7800
