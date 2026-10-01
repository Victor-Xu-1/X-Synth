from packages.knowledge_base.runtime_index_gateway import RuntimeIndex, RuntimeIndexGateway


def test_runtime_index_gateway_returns_indexes_by_engine_and_kind():
    gateway = RuntimeIndexGateway([
        RuntimeIndex(engine="askcos", kind="template_relevance", path="artifact_a"),
        RuntimeIndex(engine="aizynthfinder", kind="policy", path="artifact_b"),
    ])

    assert gateway.get("askcos", "template_relevance").path == "artifact_a"
    assert gateway.get("aizynthfinder", "policy").path == "artifact_b"


def test_runtime_index_gateway_rejects_missing_index():
    gateway = RuntimeIndexGateway([])

    try:
        gateway.get("askcos", "retrosim")
    except KeyError as exc:
        assert "askcos:retrosim" in str(exc)
    else:
        raise AssertionError("missing index should raise KeyError")
