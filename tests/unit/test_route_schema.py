from packages.route_schema.route_schema import RouteCandidate, RouteStep


def test_route_candidate_requires_engine_and_steps():
    route = RouteCandidate(
        route_id="askcos-mcts-1",
        engine="askcos_mcts",
        target_smiles="CCO",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="CC.O>>CCO",
                precursors=["CC", "O"],
                product="CCO",
                source="template_relevance:reaxys",
            )
        ],
    )

    assert route.route_id == "askcos-mcts-1"
    assert route.steps[0].source == "template_relevance:reaxys"
    assert route.closed is False


def test_route_candidate_records_closure_evidence():
    route = RouteCandidate(
        route_id="aizynth-1",
        engine="aizynthfinder",
        target_smiles="CCO",
        starting_materials=["CC", "O"],
        closed=True,
        closure_sources=["zinc"],
    )

    assert route.closed is True
    assert route.closure_sources == ["zinc"]
