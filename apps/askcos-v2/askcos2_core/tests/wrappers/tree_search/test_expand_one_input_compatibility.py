from wrappers.tree_search.expand_one import ExpandOneInput


def test_expand_one_input_accepts_route_search_legacy_threshold_fields():
    request = ExpandOneInput(
        smiles="CCO",
        template_max_count=1000,
        template_max_cum_prob=0.999,
        filter_threshold=0.61,
    )

    assert request.fast_filter_threshold == 0.61


def test_direct_expand_one_retains_supplemental_one_step_sources():
    request = ExpandOneInput(smiles="CCO")

    observed_sources = [
        (source.retro_backend, source.retro_model_name)
        for source in request.retro_backend_options
    ]
    assert observed_sources == [
        ("template_relevance", "reaxys"),
        ("template_relevance", "pistachio"),
        ("template_relevance", "uspto_higher_level"),
        ("exact_match", "USPTO_FULL"),
        ("retrosim", "USPTO_FULL"),
    ]
