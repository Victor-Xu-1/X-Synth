from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.scoring.route_scoring import score_route


def test_scoring_prefers_closed_routes_with_evidence():
    closed = RouteCandidate(
        route_id="closed",
        engine="askcos_mcts",
        target_smiles="CCO",
        closed=True,
        steps=[RouteStep("s1", "CC.O>>CCO", ["CC", "O"], "CCO", "exact_match:USPTO_FULL")],
        closure_sources=["chemicalbook_cn"],
        evidence_refs=["exact:USPTO_FULL"],
    )
    unclosed = RouteCandidate(
        route_id="unclosed",
        engine="askcos_mcts",
        target_smiles="CCO",
        closed=False,
        steps=[RouteStep("s1", "CC.O>>CCO", ["CC", "O"], "CCO", "template_relevance:reaxys")],
    )

    assert score_route(closed) > score_route(unclosed)


def test_scoring_prefers_high_confidence_askcos_over_low_confidence_supplemental_route():
    askcos_route = RouteCandidate(
        route_id="askcos",
        engine="askcos_retro_star",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                "s1",
                "CC.O>>CCO",
                ["CC", "O"],
                "CCO",
                "askcos:Reaction Cluster #4",
                confidence=0.95,
            )
        ],
        closure_sources=["askcos_buyables"],
    )
    low_confidence_aizynth_route = RouteCandidate(
        route_id="aizynth",
        engine="aizynthfinder",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                "s1",
                "CC.O>>CCO",
                ["CC", "O"],
                "CCO",
                "aizynthfinder:uspto",
                confidence=0.001,
                metadata={"classification": "0.0 Unrecognized"},
            )
        ],
        closure_sources=["zinc"],
    )

    assert score_route(askcos_route) > score_route(low_confidence_aizynth_route)


def test_scoring_applies_unbounded_penalty_to_overlong_closed_route():
    short_route = RouteCandidate(
        route_id="short",
        engine="aizynthfinder",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                "s1",
                "CC>>CCO",
                ["CC"],
                "CCO",
                "aizynthfinder:uspto",
                confidence=0.8,
            )
        ],
    )
    long_route = RouteCandidate(
        route_id="long",
        engine="aizynthfinder",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                f"s{index}",
                f"R{index}",
                [f"P{index}"],
                f"P{index - 1}",
                "aizynthfinder:uspto",
                confidence=0.8,
            )
            for index in range(1, 46)
        ],
    )

    assert score_route(short_route) > score_route(long_route)
    assert score_route(long_route) < 50


def test_scoring_does_not_cap_ultra_low_confidence_penalty():
    high = RouteCandidate(
        route_id="high",
        engine="aizynthfinder",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                f"s{index}",
                f"H{index}",
                [f"P{index}"],
                f"P{index - 1}",
                "aizynthfinder:uspto",
                confidence=0.5,
            )
            for index in range(1, 11)
        ],
    )
    low = RouteCandidate(
        route_id="low",
        engine="aizynthfinder",
        target_smiles="CCO",
        closed=True,
        steps=[
            RouteStep(
                f"s{index}",
                f"L{index}",
                [f"P{index}"],
                f"P{index - 1}",
                "aizynthfinder:uspto",
                confidence=0.001,
            )
            for index in range(1, 11)
        ],
    )

    assert score_route(high) - score_route(low) > 20
