import socket

import pytest

from packages.platform.native_runtime import SERVICES, ensure_port_available
from packages.platform.native_endpoints import (
    ENDPOINTS, endpoint_environment, module_deployment_endpoints,
    require_search_key, resolve_native_endpoints,
)
from packages.platform.native_search_contract import NATIVE_SEARCH_HEADER, NATIVE_SEARCH_KEY_ENV, SEARCH_KEY_VARIABLE


def test_preflight_rejects_a_real_listener_but_allows_closed_connections():
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.listen()
        with pytest.raises(OSError):
            ensure_port_available(port)
        with socket.create_connection(("127.0.0.1", port)) as client:
            peer, _ = listener.accept()
            with peer:
                peer.shutdown(socket.SHUT_WR)
                assert client.recv(1) == b""
    ensure_port_available(port)


def test_registry_preserves_actual_environment_names_and_default_ports():
    expected = {
        "template_relevance": ("X_SYNTH_TEMPLATE_URL", 19410),
        "fast_filter": ("X_SYNTH_FAST_FILTER_URL", 9611),
        "scscore": ("X_SYNTH_SCSCORE_URL", 9741),
        "pathway_ranker": ("X_SYNTH_PATHWAY_RANKER_URL", 9681),
        "value_network": ("X_SYNTH_VALUE_NETWORK_URL", 9350),
        "cluster": ("X_SYNTH_CLUSTER_URL", 9801),
        "gateway": ("X_SYNTH_ASKCOS_URL", 9100),
        "expand_one": ("X_SYNTH_EXPAND_ONE_URL", 9301),
        "mcts": ("X_SYNTH_MCTS_URL", 9311),
        "retro_star": ("X_SYNTH_RETRO_STAR_URL", 9321),
        "condition_recommender": ("X_SYNTH_CONDITION_URL", 9901),
        "forward_predictor": ("X_SYNTH_FORWARD_URL", 9911),
        "impurity": ("X_SYNTH_IMPURITY_URL", 9941),
    }
    assert {name: (spec.variable, spec.port) for name, spec in ENDPOINTS.items()} == expected
    assert {name: value.port for name, value in resolve_native_endpoints({}, managed=True).items()} == {
        name: value[1] for name, value in expected.items()
    }
    assert NATIVE_SEARCH_HEADER == "X-X-Synth-Native-Key"
    assert SEARCH_KEY_VARIABLE == "X_SYNTH_NATIVE_SEARCH_KEY"
    assert SEARCH_KEY_VARIABLE is NATIVE_SEARCH_KEY_ENV


def test_override_has_one_launch_environment_readiness_and_overlay_authority():
    environment = {"X_SYNTH_MCTS_URL": "http://localhost:18311/", "GATEWAY_URL": "http://127.0.0.1:18100"}
    endpoints = resolve_native_endpoints(environment, managed=True)
    assert endpoints["mcts"].host == "127.0.0.1"
    assert endpoints["mcts"].port == 18311
    assert endpoints["mcts"].readiness_url == "http://127.0.0.1:18311/health/ready"
    exported = endpoint_environment(endpoints)
    assert exported["X_SYNTH_ASKCOS_URL"] == exported["GATEWAY_URL"] == "http://127.0.0.1:18100"
    overlay = module_deployment_endpoints(exported)
    assert overlay["tree_search_mcts"] == {
        "default_prediction_url": "http://127.0.0.1:18311/get_buyable_paths",
        "custom_prediction_url": "", "ports_to_expose": [18311],
    }
    assert set(overlay) == {spec.module_config_key for spec in ENDPOINTS.values() if spec.module_config_key}
    assert overlay["forward_graph2smiles"]["default_prediction_url"] == "http://127.0.0.1:9911/predict"


def test_gateway_alias_conflict_is_rejected_without_echoing_values():
    with pytest.raises(ValueError, match="must agree"):
        resolve_native_endpoints({"GATEWAY_URL": "http://127.0.0.1:18100", "X_SYNTH_ASKCOS_URL": "http://127.0.0.1:18101"})


@pytest.mark.parametrize("url", [
    "http://remote.invalid:9000", "https://127.0.0.1:9000", "http://[::1]:9000",
    "file:///tmp/native", "http://fixture-user:fixture-password@127.0.0.1:9000",
    "http://127.0.0.1:9000/private", "http://127.0.0.1:9000?target=private",
    "http://127.0.0.1:9000#fragment", "http://127.0.0.1:0", "http://127.0.0.1:65536",
    "http://127.0.0.1:9000\n", "",
])
def test_managed_endpoint_rejects_unsupported_or_sensitive_channels(url):
    with pytest.raises(ValueError) as error:
        resolve_native_endpoints({"X_SYNTH_MCTS_URL": url}, managed=True)
    assert "fixture-password" not in str(error.value)


def test_port_collision_is_rejected_before_launch():
    with pytest.raises(ValueError, match="distinct ports"):
        resolve_native_endpoints({"X_SYNTH_MCTS_URL": "http://127.0.0.1:9321"}, managed=True)


def test_service_port_metadata_observes_the_same_registry_override(monkeypatch):
    monkeypatch.setenv("X_SYNTH_FAST_FILTER_URL", "http://127.0.0.1:18611")
    assert SERVICES["fast_filter"].port == 18611


@pytest.mark.parametrize("key", ["", "short", "x" * 257, "x" * 32 + "\n"])
def test_search_channel_fails_closed_for_missing_or_invalid_key(key):
    with pytest.raises(ValueError, match="ephemeral key"):
        require_search_key({"X_SYNTH_NATIVE_SEARCH_KEY": key}, ["mcts"])
    require_search_key({}, ["fast_filter"])
