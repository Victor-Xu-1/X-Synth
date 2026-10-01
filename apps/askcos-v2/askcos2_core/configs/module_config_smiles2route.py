from configs.module_config_full_https import module_config


module_config["modules_to_start"]["tree_search_mcts"] = False
module_config.setdefault("compose_managed_modules", {})["tree_search_mcts"] = True
module_config["modules_to_start"]["tree_search_retro_star"] = False
module_config["modules_to_start"]["value_network"] = False
module_config["compose_managed_modules"]["tree_search_retro_star"] = True
module_config["compose_managed_modules"]["value_network"] = True

_templ_rel_deployment = module_config["retro_template_relevance"]["deployment"]
_templ_rel_deployment["ports_to_expose"] = [19410, 19411, 19412]
_templ_rel_deployment["default_prediction_url"] = "http://127.0.0.1:19410/predictions"
_templ_rel_deployment["custom_prediction_url"] = "http://127.0.0.1:19410/predictions"
# Keep this list aligned with TEMPLATE_RELEVANCE_MODELS in
# template_relevance/scripts/start_torchserve.sh. Advertising unloaded MAR files
# makes tree search call dead TorchServe endpoints and lose otherwise valid
# expansions to 404/JSON decode failures.
_templ_rel_deployment["available_model_names"] = [
    "reaxys",
    "pistachio",
    "uspto_higher_level",
]

_expand_one_deployment = module_config["tree_search_expand_one"]["deployment"]
_expand_one_deployment["timeout"] = max(
    int(_expand_one_deployment.get("timeout", 0)),
    300,
)

_retro_star_deployment = module_config["tree_search_retro_star"]["deployment"]
_retro_star_deployment["default_prediction_url"] = "http://127.0.0.1:9321/get_buyable_paths"
_retro_star_deployment["custom_prediction_url"] = "http://127.0.0.1:9321/get_buyable_paths"
_retro_star_deployment["timeout"] = max(
    int(_retro_star_deployment.get("timeout", 0)),
    2700,
)

_value_network_deployment = module_config["value_network"]["deployment"]
_value_network_deployment["default_prediction_url"] = "http://127.0.0.1:9350/predictions"
_value_network_deployment["custom_prediction_url"] = "http://127.0.0.1:9350/predictions"
# SMILES2ROUTE_LOCALHOST_URL_PATCH
for _cfg in module_config.values():
    _deployment = _cfg.get('deployment') if isinstance(_cfg, dict) else None
    if not isinstance(_deployment, dict):
        continue
    for _url_key in ('default_prediction_url', 'custom_prediction_url'):
        _value = _deployment.get(_url_key)
        if isinstance(_value, str):
            _deployment[_url_key] = _value.replace('http://0.0.0.0:', 'http://127.0.0.1:')
