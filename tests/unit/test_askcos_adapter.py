from packages.adapters.askcos.client import ASKCOSAdapter


def test_askcos_adapter_builds_tree_builder_payload():
    adapter = ASKCOSAdapter(base_url="http://127.0.0.1:9100")

    payload = adapter.build_tree_builder_payload("CCO", max_trees=10)

    assert payload["smiles"] == "CCO"
    assert payload["max_trees"] == 10
    assert payload["return_first"] is False
