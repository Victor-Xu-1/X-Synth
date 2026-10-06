"""Load actual server bindings in isolated processes with non-scientific controllers."""

import os
import subprocess
import sys

import pytest

from native_rpc_helpers import ROOT, expansion_client, load_source
from packages.adapters.askcos.native_http import NativeCallCancelled
from packages.platform import native_search_contract
from pathlib import Path


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
@pytest.mark.parametrize("profile", ["managed_missing", "managed_key", "standalone"])
def test_actual_native_binding_profile_and_authenticated_readiness(strategy, profile, tmp_path):
    script = """
import importlib, json, sys
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
import packages.platform
strategy, profile, source, contract_source = sys.argv[1:]
packages.platform.__path__.append(contract_source)
from packages.adapters.askcos.native_search_protocol import NATIVE_SEARCH_HEADER, NATIVE_SEARCH_READY_PATH
sys.path.insert(0, source + '/apps/askcos-v2/tree_search/' + strategy)
calls = []
class ControlledController:
    def __init__(self):
        calls.append('created')
sys.modules[strategy + '_controller'] = SimpleNamespace(**{'MCTS' if strategy == 'mcts' else 'RetroStar': ControlledController})
sys.modules['prometheus_client'] = SimpleNamespace(
    Histogram=lambda *a, **k: SimpleNamespace(observe=lambda *a: None), make_asgi_app=FastAPI,
    CollectorRegistry=object, multiprocess=None)
module = importlib.import_module(strategy + '_server')
with TestClient(module.app) as client:
    assert client.post('/get_buyable_paths', json={}).status_code == (422 if profile == 'standalone' else 404)
    assert client.get('/health/ready').status_code == 200
    if profile == 'managed_key':
        assert client.get(NATIVE_SEARCH_READY_PATH, headers={NATIVE_SEARCH_HEADER: 'wrong'}).status_code == 403
        result = client.get(NATIVE_SEARCH_READY_PATH, headers={NATIVE_SEARCH_HEADER: 'unit-server-key'})
        assert result.status_code == 200 and result.json()['strategy'] == strategy
    else:
        assert client.get(NATIVE_SEARCH_READY_PATH).status_code == 503
    assert calls == []
print(json.dumps({'strategy': strategy, 'profile': profile, 'checked': True}))
"""
    env = {"HOME": str(tmp_path), "PATH": os.defpath, "PYTHONPATH": str(ROOT),
           "PYTHONDONTWRITEBYTECODE": "1", "X_SYNTH_STATE_DIR": str(tmp_path),
           "MODULE_CONFIG_PATH": "configs.module_config_full" if profile == "standalone" else "configs.module_config_x_synth"}
    if profile == "managed_key":
        env["X_SYNTH_NATIVE_SEARCH_KEY"] = "unit-server-key"
    result = subprocess.run([sys.executable, "-c", script, strategy, profile, str(ROOT), str(Path(native_search_contract.__file__).parent)],
                            cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert '"checked": true' in result.stdout


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_actual_controller_passes_cancellation_and_deadline_to_expansion(strategy, monkeypatch):
    from types import SimpleNamespace
    import networkx as nx
    import threading

    expansion_client(strategy, monkeypatch)
    names = ["get_graph_from_tree", "is_terminal", "nx_graph_to_paths", "nx_paths_to_json",
             "select_diverse_paths", "collapse_tree"]
    monkeypatch.setitem(sys.modules, "utils", SimpleNamespace(**{name: None for name in names}))
    # These are real protocol clients; importing them does not submit requests.
    for name in ["api", "api.expand_one_api", "api.pathway_ranker_api", "api.pricer_api", "api.scscorer_api",
                 "api.historian_api", "api.reaction_classification_api", "api.value_fn_api"]:
        if name in sys.modules:
            monkeypatch.delitem(sys.modules, name)
    module = load_source(f"apps/askcos-v2/tree_search/{strategy}/{strategy}_controller.py", f"unit_{strategy}_controller", monkeypatch)
    controller = (module.MCTS if strategy == "mcts" else module.RetroStar).__new__(module.MCTS if strategy == "mcts" else module.RetroStar)
    controller.cancel_event, controller.rpc_deadline = threading.Event(), 12345
    controller.expand_one_options = SimpleNamespace()
    controller.target = "CCO"
    controller.tree = nx.DiGraph()
    controller.tree.add_node("CCO", smiles="CCO")

    def controlled(**kwargs):
        assert kwargs["cancel_event"] is controller.cancel_event
        assert kwargs["deadline"] == controller.rpc_deadline
        raise NativeCallCancelled()

    controller.expand_one = controlled
    with pytest.raises(NativeCallCancelled):
        controller._expand(["CCO"] if strategy == "mcts" else "CCO")
