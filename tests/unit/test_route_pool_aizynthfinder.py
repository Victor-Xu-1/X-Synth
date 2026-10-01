from __future__ import annotations

import json
from pathlib import Path

from packages.route_pool import UnifiedRoutePool, normalize_aizynthfinder_payload
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy


FIXTURE = Path("tests/fixtures/aizynthfinder/ethyl_benzoate_result.json")


def test_normalizes_real_aizynthfinder_payload_to_route_candidates():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    routes = normalize_aizynthfinder_payload(payload)

    assert len(routes) == 17
    first = routes[0]
    assert first.engine == "aizynthfinder"
    assert first.target_smiles == "CCOC(=O)c1ccccc1"
    assert first.closed is True
    assert first.closure_sources == ["zinc"]
    assert first.starting_materials == ["CCOC(=O)c1cccc(N)c1"]
    assert first.steps[0].product == "CCOC(=O)c1ccccc1"
    assert first.steps[0].reaction_smiles == (
        "CCOC(=O)c1cccc(N)c1>>CCOC(=O)c1ccccc1"
    )
    assert first.steps[0].metadata["template_smarts"] == (
        "[c:1]([cH2:2])[cH2:3]>>N[c:1]([cH2:2])[cH2:3]"
    )
    assert first.steps[0].source == "aizynthfinder:uspto"
    assert first.family_key and first.family_key.startswith("route-family:first-reaction:")
    assert any(ref.startswith("template_hash:") for ref in first.evidence_refs)


def test_unified_route_pool_ranks_and_deduplicates_real_aizynthfinder_routes():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    routes = normalize_aizynthfinder_payload(payload)
    pool = UnifiedRoutePool(min_routes=3, max_routes=10)

    pool.add_routes(routes)
    selected = pool.final_candidates()

    assert pool.closed_route_count() == 17
    assert pool.engine_counts() == {"aizynthfinder": 17}
    assert 3 <= len(selected) <= 10
    assert all(route.closed for route in selected)
    assert len({route.family_key for route in selected}) == len(selected)


def test_unified_route_pool_outputs_ranked_draft_routes_when_no_closed_routes_exist():
    pool = UnifiedRoutePool(min_routes=3, max_routes=10)
    pool.add_routes(
        [
            RouteCandidate(
                route_id=f"unclosed-{index}",
                engine="aizynthfinder",
                target_smiles="CCO",
                steps=[
                    RouteStep(
                        step_id="s1",
                        reaction_smiles="CC>>CCO",
                        precursors=["CC"],
                        product="CCO",
                        source="aizynthfinder:uspto",
                    )
                ],
                starting_materials=["CC"],
                closed=False,
                family_key=f"family-{index}",
            )
            for index in range(4)
        ]
    )

    assert pool.closed_route_count() == 0
    selected = pool.final_candidates()
    assert len(selected) == 4
    assert all(route.closed is False for route in selected)
    assert all(route.metadata["output_mode"] == "draft_unclosed" for route in selected)


def test_unified_route_pool_backfills_draft_routes_when_family_diversity_is_low():
    pool = UnifiedRoutePool(min_routes=3, max_routes=10)
    pool.add_routes(
        [
            RouteCandidate(
                route_id=f"similar-unclosed-{index}",
                engine="aizynthfinder",
                target_smiles="CCO",
                steps=[
                    RouteStep(
                        step_id="s1",
                        reaction_smiles="CC>>CCO",
                        precursors=["CC"],
                        product="CCO",
                        source="aizynthfinder:uspto",
                    )
                ],
                starting_materials=["CC"],
                closed=False,
                family_key="same-family",
            )
            for index in range(5)
        ]
    )

    selected = pool.final_candidates()

    assert len(selected) == 3
    assert {route.family_key for route in selected} == {"same-family"}
    assert all(route.metadata["output_mode"] == "draft_unclosed" for route in selected)


def test_unified_route_pool_quality_policy_excludes_overlong_closed_route():
    good = RouteCandidate(
        route_id="good",
        engine="aizynthfinder",
        target_smiles="CCO",
        steps=[
            RouteStep(
                step_id="s1",
                reaction_smiles="CC>>CCO",
                precursors=["CC"],
                product="CCO",
                source="aizynthfinder:uspto",
                confidence=0.8,
            )
        ],
        starting_materials=["CC"],
        closed=True,
        family_key="good-family",
    )
    long_route = RouteCandidate(
        route_id="long",
        engine="recursive_grafted",
        target_smiles="CCO",
        steps=[
            RouteStep(
                step_id=f"s{index}",
                reaction_smiles=f"R{index}",
                precursors=[f"P{index}"],
                product=f"P{index - 1}",
                source="aizynthfinder:uspto",
                confidence=0.8,
            )
            for index in range(1, 26)
        ],
        starting_materials=["P25"],
        closed=True,
        family_key="long-family",
    )
    pool = UnifiedRoutePool(
        min_routes=1,
        max_routes=10,
        quality_policy=RouteQualityPolicy(),
    )

    pool.add_routes([long_route, good])

    assert pool.ranked_routes()[0].closed is True
    assert [route.route_id for route in pool.final_candidates()] == ["good"]
