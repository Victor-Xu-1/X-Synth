import json
from pathlib import Path

from packages.adapters.askcos.search_artifacts import SearchArtifacts, route_projection


def native_benchmark():
    path = Path(__file__).resolve().parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    data = json.loads(path.read_text())
    while "uds" not in data:
        data = data.get("result") or data.get("results") or data.get("payload")
    return data


def test_real_native_routes_survive_projection_and_full_graph_is_retained(tmp_path):
    payload = native_benchmark()
    target = "CN(C)CCOC(c1ccccc1)c1ccccc1"
    compact = route_projection(payload, target=target)
    assert compact["uds"]["pathways"] == payload["uds"]["pathways"]
    assert compact["uds"]["uuid2smiles"] == payload["uds"]["uuid2smiles"]
    assert compact["stats"] == payload["stats"]
    artifacts = SearchArtifacts(tmp_path)
    artifacts.save("a" * 32, payload, target=target)
    assert json.loads((tmp_path / ("a" * 32 + ".raw-result.json")).read_text()) == payload
    assert json.loads(artifacts.result_path("a" * 32).read_text()) == compact
