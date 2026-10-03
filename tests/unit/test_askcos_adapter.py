import pytest

from packages.adapters.askcos.engine import build_search_options
from packages.orchestrator.route_request import RouteJobRequest


def test_real_native_payload_preserves_quality_and_stock_authority():
    request = RouteJobRequest(smiles="CCOC(=O)c1ccccc1")
    options = build_search_options(request, strategy="retro_star", models=["pistachio", "pistachio_ringbreaker"])
    assert options["build_tree_options"]["buyables_source"] == "unified_commercial"
    assert options["build_tree_options"]["termination_logic"] == {"and": ["buyable"]}
    assert options["build_tree_options"]["use_value_network"] is True
    assert options["expand_one_options"]["use_fast_filter"] is True
    assert options["enumerate_paths_options"]["validate_paths"] is True
    repaired = build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2)
    assert repaired["build_tree_options"]["max_depth"] == request.tuning.max_depth + 4
    assert repaired["expand_one_options"]["filter_threshold"] == request.tuning.minimum_plausibility


def test_invalid_engine_configuration_cannot_become_a_placeholder():
    with pytest.raises(ValueError):
        build_search_options(RouteJobRequest(smiles="CCO"), strategy="mock", models=["pistachio"])
