"""One endpoint authority for native launch, invocation and readiness."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from .native_search_contract import SEARCH_KEY_VARIABLE


@dataclass(frozen=True)
class EndpointSpec:
    variable: str
    port: int
    module_config_key: str | None
    prediction_path: str


ENDPOINTS = {
    "template_relevance": EndpointSpec("X_SYNTH_TEMPLATE_URL", 19410, "retro_template_relevance", "/predictions"),
    "fast_filter": EndpointSpec("X_SYNTH_FAST_FILTER_URL", 9611, "fast_filter", ""),
    "scscore": EndpointSpec("X_SYNTH_SCSCORE_URL", 9741, "scscore", "/scscore"),
    "pathway_ranker": EndpointSpec("X_SYNTH_PATHWAY_RANKER_URL", 9681, "pathway_ranker", "/pathway_ranker"),
    "value_network": EndpointSpec("X_SYNTH_VALUE_NETWORK_URL", 9350, "value_network", "/predictions"),
    "cluster": EndpointSpec("X_SYNTH_CLUSTER_URL", 9801, "cluster", "/cluster"),
    "gateway": EndpointSpec("X_SYNTH_ASKCOS_URL", 9100, None, ""),
    "expand_one": EndpointSpec("X_SYNTH_EXPAND_ONE_URL", 9301, "tree_search_expand_one", "/get_outcomes"),
    "mcts": EndpointSpec("X_SYNTH_MCTS_URL", 9311, "tree_search_mcts", "/get_buyable_paths"),
    "retro_star": EndpointSpec("X_SYNTH_RETRO_STAR_URL", 9321, "tree_search_retro_star", "/get_buyable_paths"),
    "condition_recommender": EndpointSpec("X_SYNTH_CONDITION_URL", 9901, "context_recommender", "/predict"),
    "forward_predictor": EndpointSpec("X_SYNTH_FORWARD_URL", 9911, "forward_graph2smiles", "/predict"),
    "impurity": EndpointSpec("X_SYNTH_IMPURITY_URL", 9941, "impurity_predictor", "/predict"),
}

@dataclass(frozen=True)
class NativeEndpoint:
    url: str
    host: str
    port: int

    @property
    def readiness_url(self) -> str:
        return self.url + "/health/ready"


def _endpoint(value: str, *, managed: bool) -> NativeEndpoint:
    try:
        parsed = urlsplit(value)
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment
            or not 1 <= port <= 65535
            or any(character.isspace() for character in value)
        ):
            raise ValueError
        host = parsed.hostname.lower()
        if managed and (parsed.scheme != "http" or host not in {"127.0.0.1", "localhost"}):
            raise ValueError
        if host == "localhost":
            host = "127.0.0.1"
        authority = f"[{host}]" if ":" in host else host
        return NativeEndpoint(f"{parsed.scheme}://{authority}:{port}", host, port)
    except (TypeError, ValueError):
        # Never echo an invalid URL: it may contain credentials.
        raise ValueError("Native endpoint must be a root HTTP URL; managed services require IPv4 loopback") from None


def resolve_native_endpoints(
    environment: Mapping[str, str] | None = None, *, managed: bool = False
) -> dict[str, NativeEndpoint]:
    environment = os.environ if environment is None else environment
    result = {}
    for name, spec in ENDPOINTS.items():
        raw = environment.get(spec.variable, f"http://127.0.0.1:{spec.port}")
        if name == "gateway" and "GATEWAY_URL" in environment:
            alias = _endpoint(environment["GATEWAY_URL"], managed=managed)
            if spec.variable in environment and alias != _endpoint(raw, managed=managed):
                raise ValueError("GATEWAY_URL and X_SYNTH_ASKCOS_URL must agree")
            raw = alias.url
        result[name] = _endpoint(raw, managed=managed)
    if managed and len({endpoint.port for endpoint in result.values()}) != len(result):
        raise ValueError("Managed native endpoints must have distinct ports")
    return result


def endpoint_environment(endpoints: Mapping[str, NativeEndpoint]) -> dict[str, str]:
    return {ENDPOINTS[name].variable: endpoint.url for name, endpoint in endpoints.items()} | {
        "GATEWAY_URL": endpoints["gateway"].url,
    }


def module_deployment_endpoints(environment: Mapping[str, str] | None = None) -> dict[str, dict]:
    endpoints = resolve_native_endpoints(environment)
    return {
        spec.module_config_key: {
            "default_prediction_url": endpoints[name].url + spec.prediction_path,
            "custom_prediction_url": "",
            "ports_to_expose": [endpoints[name].port],
        }
        for name, spec in ENDPOINTS.items() if spec.module_config_key
    }


def require_search_key(environment: Mapping[str, str], services: list[str]) -> None:
    key = environment.get(SEARCH_KEY_VARIABLE, "")
    if {"mcts", "retro_star"}.intersection(services) and (
        not 32 <= len(key) <= 256 or not key.isascii() or any(character.isspace() for character in key)
    ):
        raise ValueError("Managed native search requires X_SYNTH_NATIVE_SEARCH_KEY; use serve_platform or provide an explicit ephemeral key")
