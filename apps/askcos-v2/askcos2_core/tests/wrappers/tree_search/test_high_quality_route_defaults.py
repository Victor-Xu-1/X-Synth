import os

os.environ["MODULE_CONFIG_PATH"] = "configs.module_config_smiles2route.py"

from wrappers.tree_search.mcts import (
    BuildTreeOptions as MctsBuildTreeOptions,
    EnumeratePathsOptions as MctsEnumeratePathsOptions,
    ExpandOneOptions as MctsExpandOneOptions,
    MCTSInput,
    MCTSWrapper,
)
from wrappers.tree_search.retro_star import (
    BuildTreeOptions as RetroStarBuildTreeOptions,
    EnumeratePathsOptions as RetroStarEnumeratePathsOptions,
    ExpandOneOptions as RetroStarExpandOneOptions,
    RetroStarInput,
    RetroStarWrapper,
)
from wrappers.tree_search.controller import TreeSearchInput
from configs.module_config_smiles2route import module_config


EXPECTED_TREE_RETRO_SOURCES = [
    ("template_relevance", "reaxys"),
    ("template_relevance", "pistachio"),
]


def assert_high_quality_defaults(options, expected_max_paths=10):
    assert options.sorting_metric == "score"
    assert options.validate_paths is True
    assert options.score_trees is True
    assert options.cluster_trees is True
    assert options.cluster_method == "hdbscan"
    assert options.min_samples == 5
    assert options.min_cluster_size == 5
    assert options.max_paths == expected_max_paths


def assert_high_quality_expand_one_defaults(options):
    assert options.template_max_count == 1000
    assert options.template_max_cum_prob == 0.999
    observed_sources = [
        (source.retro_backend, source.retro_model_name)
        for source in options.retro_backend_options
    ]
    assert observed_sources == EXPECTED_TREE_RETRO_SOURCES
    for source in options.retro_backend_options:
        assert source.max_num_templates == 1000
        assert source.max_cum_prob == 0.999
    assert options.use_fast_filter is True
    assert options.filter_threshold == 0.75
    assert options.cluster_precursors is True


def assert_high_quality_build_defaults(options):
    assert options.expansion_time == 1200
    assert options.max_branching == 50
    assert options.max_depth == 12
    assert options.return_first is False
    assert options.max_trees == 200
    assert options.buyables_source is None


def test_mcts_enumeration_defaults_select_scored_clustered_routes():
    assert_high_quality_defaults(MctsEnumeratePathsOptions())


def test_retro_star_enumeration_defaults_select_scored_clustered_routes():
    assert_high_quality_defaults(RetroStarEnumeratePathsOptions())


def test_mcts_search_defaults_use_high_quality_candidate_pool():
    assert_high_quality_expand_one_defaults(MctsExpandOneOptions())
    assert_high_quality_build_defaults(MctsBuildTreeOptions())


def test_retro_star_search_defaults_use_high_quality_candidate_pool():
    assert_high_quality_expand_one_defaults(RetroStarExpandOneOptions())
    assert_high_quality_build_defaults(RetroStarBuildTreeOptions())


def test_tree_search_controller_defaults_to_retro_star():
    request = TreeSearchInput(smiles="CCO")

    assert request.backend == "retro_star"


def test_retro_star_http_timeout_allows_post_expansion_route_enumeration():
    deployment_timeout = module_config["tree_search_retro_star"]["deployment"]["timeout"]
    expansion_time = RetroStarBuildTreeOptions().expansion_time

    assert deployment_timeout >= expansion_time + 900


def test_expand_one_http_timeout_covers_cold_multi_model_expansion():
    deployment_timeout = module_config["tree_search_expand_one"]["deployment"]["timeout"]

    assert deployment_timeout >= 300


def test_mcts_input_coerces_legacy_low_quality_options():
    request = MCTSInput(
        smiles="CCO",
        build_tree_options={
            "return_first": True,
            "max_trees": 4,
            "max_depth": 3,
            "max_branching": 5,
            "buyables_source": [],
        },
        enumerate_paths_options={
            "sorting_metric": "plausibility",
            "validate_paths": False,
            "score_trees": False,
            "cluster_trees": False,
            "max_paths": 200,
        },
        expand_one_options={
            "template_max_count": 10,
            "template_max_cum_prob": 0.5,
            "use_fast_filter": False,
            "filter_threshold": 0.1,
            "cluster_precursors": False,
        },
    )

    assert_high_quality_build_defaults(request.build_tree_options)
    assert_high_quality_defaults(request.enumerate_paths_options, expected_max_paths=10)
    assert_high_quality_expand_one_defaults(request.expand_one_options)


def test_tree_search_drops_root_only_sources_from_legacy_payloads():
    legacy_sources = [
        {
            "retro_backend": "template_relevance",
            "retro_model_name": "reaxys",
            "max_num_templates": 200,
            "max_cum_prob": 0.9,
        },
        {
            "retro_backend": "template_relevance",
            "retro_model_name": "pistachio",
            "max_num_templates": 200,
            "max_cum_prob": 0.9,
        },
        {
            "retro_backend": "template_relevance",
            "retro_model_name": "uspto_higher_level",
            "max_num_templates": 200,
            "max_cum_prob": 0.9,
        },
        {
            "retro_backend": "exact_match",
            "retro_model_name": "USPTO_FULL",
        },
        {
            "retro_backend": "retrosim",
            "retro_model_name": "USPTO_FULL",
        },
    ]

    for request in (
        MCTSInput(smiles="CCO", expand_one_options={"retro_backend_options": legacy_sources}),
        RetroStarInput(smiles="CCO", expand_one_options={"retro_backend_options": legacy_sources}),
    ):
        assert [
            (source.retro_backend, source.retro_model_name)
            for source in request.expand_one_options.retro_backend_options
        ] == EXPECTED_TREE_RETRO_SOURCES
        assert all(
            source.max_num_templates == 1000
            for source in request.expand_one_options.retro_backend_options
        )


def test_mcts_input_preserves_explicit_domestic_buyable_source_alias():
    request = MCTSInput(
        smiles="CCO",
        build_tree_options={
            "buyables_source": ["domestic", ""],
        },
    )

    assert request.build_tree_options.buyables_source == ["domestic"]


def test_mcts_minimum_route_repair_expands_search_without_low_quality_defaults():
    request = MCTSInput(smiles="CCO")

    repair_request = MCTSWrapper.build_minimum_route_count_repair_input(request)

    assert repair_request is not request
    assert repair_request.build_tree_options.expansion_time >= 1800
    assert repair_request.build_tree_options.max_depth >= 14
    assert repair_request.build_tree_options.max_branching >= 80
    assert repair_request.build_tree_options.max_trees >= 300
    assert repair_request.enumerate_paths_options.max_paths == 10
    assert repair_request.expand_one_options.filter_threshold <= 0.6
    assert repair_request.expand_one_options.template_max_count == 1000
    assert repair_request.expand_one_options.cluster_precursors is True


def test_retro_star_minimum_route_repair_expands_search_without_low_quality_defaults():
    request = RetroStarInput(smiles="CCO")

    repair_request = RetroStarWrapper.build_minimum_route_count_repair_input(request)

    assert repair_request is not request
    assert repair_request.build_tree_options.expansion_time >= 1800
    assert repair_request.build_tree_options.max_depth >= 14
    assert repair_request.build_tree_options.max_branching >= 80
    assert repair_request.build_tree_options.max_trees >= 300
    assert repair_request.enumerate_paths_options.max_paths == 10
    assert repair_request.expand_one_options.filter_threshold <= 0.6
    assert repair_request.expand_one_options.template_max_count == 1000
    assert repair_request.expand_one_options.cluster_precursors is True


def test_retro_star_input_coerces_legacy_low_quality_options():
    request = RetroStarInput(
        smiles="CCO",
        build_tree_options={
            "return_first": True,
            "max_trees": 4,
            "max_depth": 3,
            "max_branching": 5,
        },
        enumerate_paths_options={
            "sorting_metric": "plausibility",
            "validate_paths": False,
            "score_trees": False,
            "cluster_trees": False,
            "max_paths": 200,
        },
        expand_one_options={
            "template_max_count": 10,
            "template_max_cum_prob": 0.5,
            "use_fast_filter": False,
            "filter_threshold": 0.1,
            "cluster_precursors": False,
        },
    )

    assert_high_quality_build_defaults(request.build_tree_options)
    assert_high_quality_defaults(request.enumerate_paths_options, expected_max_paths=10)
    assert_high_quality_expand_one_defaults(request.expand_one_options)
