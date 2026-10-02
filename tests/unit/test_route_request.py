import pytest
from pydantic import ValidationError

from packages.orchestrator.route_request import RouteJobRequest


def test_route_request_only_integrates_askcos_and_is_private():
    request = RouteJobRequest(smiles="OCC")
    assert request.smiles == "CCO"
    assert request.backend == "askcos"
    assert request.strategies == ["mcts", "retro_star"]
    assert request.public is False
    assert (request.min_routes, request.max_routes) == (3, 10)


def test_invalid_structure_and_competing_engine_or_disk_path_are_rejected():
    for payload in [
        {"smiles": "invalid"}, {"smiles": "CCO", "backend": "aizynthfinder"},
        {"smiles": "CCO", "external_stock_paths": ["/etc/passwd"]},
        {"smiles": "CCO", "public": True}, {"smiles": "CCO", "min_routes": 8, "max_routes": 3},
    ]:
        with pytest.raises(ValidationError):
            RouteJobRequest(**payload)


def test_large_molecular_input_is_rejected_before_expensive_canonicalization():
    with pytest.raises(ValidationError, match="atom budget"):
        RouteJobRequest(smiles="C" * 1025)
