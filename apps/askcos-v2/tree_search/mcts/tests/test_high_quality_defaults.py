from options import BuildTreeOptions, EnumeratePathsOptions, ExpandOneOptions


def test_enumeration_defaults_select_scored_clustered_routes():
    options = EnumeratePathsOptions()

    assert options.sorting_metric == "score"
    assert options.validate_paths is True
    assert options.score_trees is True
    assert options.cluster_trees is True
    assert options.cluster_method == "hdbscan"
    assert options.min_samples == 5
    assert options.min_cluster_size == 5
    assert options.max_paths == 10


def test_search_defaults_use_high_quality_candidate_pool():
    expand_options = ExpandOneOptions()
    build_options = BuildTreeOptions()

    assert expand_options.template_max_count == 1000
    assert expand_options.template_max_cum_prob == 0.999
    assert expand_options.retro_backend_options[0].max_num_templates == 1000
    assert expand_options.retro_backend_options[0].max_cum_prob == 0.999
    assert expand_options.use_fast_filter is True
    assert expand_options.filter_threshold == 0.75
    assert expand_options.cluster_precursors is True
    assert build_options.expansion_time == 1200
    assert build_options.max_branching == 50
    assert build_options.max_depth == 12
    assert build_options.return_first is False
    assert build_options.max_trees == 200
