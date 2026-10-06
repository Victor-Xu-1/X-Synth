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


def test_repair_really_broadens_overconfident_template_recall_without_relaxing_quality():
    request = RouteJobRequest(smiles="CCO")
    first = build_search_options(request, strategy="mcts", models=["pistachio"])
    second = build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2)
    assert first["expand_one_options"]["retro_backend_options"][0]["max_cum_prob"] == 0.999
    options = second["expand_one_options"]["retro_backend_options"][0]
    assert options["max_cum_prob"] == 1.0
    assert options["max_num_templates"] == 2000
    assert second["expand_one_options"]["filter_threshold"] == first["expand_one_options"]["filter_threshold"]
    assert second["build_tree_options"]["termination_logic"] == {"and": ["buyable"]}
    assert second["enumerate_paths_options"]["validate_paths"] is True


def test_old_persisted_searches_keep_exact_original_options_on_resume():
    request = RouteJobRequest.from_persisted({"smiles": "CCO"})
    assert request.search_policy_version == 1
    options = build_search_options(request, strategy="mcts", models=["pistachio"], pass_number=2)
    assert options["expand_one_options"]["retro_backend_options"][0]["max_cum_prob"] == 0.999
    assert RouteJobRequest.from_persisted(RouteJobRequest(smiles="CCO").model_dump()).search_policy_version == 2


@pytest.mark.parametrize("version", [0, 3, True])
def test_unknown_policy_versions_cannot_silently_change_search_semantics(version):
    with pytest.raises(ValueError):
        RouteJobRequest(smiles="CCO", search_policy_version=version)
