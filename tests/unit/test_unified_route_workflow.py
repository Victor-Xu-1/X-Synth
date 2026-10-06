from __future__ import annotations

from dataclasses import asdict, replace
import json
from pathlib import Path

from packages.route_pool.workflow import (
    AizynthFinderRouteSource,
    AskcosRouteSource,
    build_unified_route_pool,
)
from packages.route_schema.route_schema import RouteCandidate, RouteStep


FIXTURES = Path("tests/fixtures")


def test_builds_pure_unified_route_pool_from_real_engine_outputs(tmp_path):
    askcos_payload = json.loads(
        (FIXTURES / "askcos" / "diphenhydramine_retrostar_result.json").read_text(encoding="utf-8")
    )
    aizynth_payload = json.loads(
        (FIXTURES / "aizynthfinder" / "diphenhydramine_result.json").read_text(encoding="utf-8")
    )

    result = build_unified_route_pool(
        id="fixture_merge",
        askcos_sources=[
            AskcosRouteSource(
                source="askcos_fixture",
                payload=askcos_payload,
                engine="askcos_retro_star",
                task_id=askcos_payload["task_id"],
            )
        ],
        aizynthfinder_sources=[
            AizynthFinderRouteSource(
                source="aizynthfinder_fixture",
                payload=aizynth_payload,
                path="tests/fixtures/aizynthfinder/diphenhydramine_result.json",
            )
        ],
        min_routes=3,
        max_routes=10,
    )

    assert 3 <= result.summary["selected_route_count"] <= 10
    assert result.summary["closed_route_count"] == 28
    assert result.summary["meets_min_routes"] is True
    assert result.summary["engine_counts"] == {
        "askcos_retro_star": 20,
        "aizynthfinder": 8,
    }
    assert result.summary["selected_engine_counts"]["askcos_retro_star"] >= 1
    assert result.summary["selected_family_count"] == result.summary["selected_route_count"]
    assert result.summary["selected_first_step_source_count"] >= 1
    assert not list(tmp_path.iterdir())

    selected = [asdict(route) for route in result.selected_routes]
    assert 3 <= len(selected) <= 10
    assert "askcos_retro_star" in {route["engine"] for route in selected}


def test_unclosed_draft_routes_do_not_satisfy_min_routes(tmp_path):
    payload = json.loads(
        (FIXTURES / "aizynthfinder" / "diphenhydramine_result.json").read_text(encoding="utf-8")
    )

    def mark_unclosed(node):
        if isinstance(node, dict):
            if node.get("is_chemical"):
                node["in_stock"] = False
            if isinstance(node.get("metadata"), dict):
                node["metadata"]["is_solved"] = False
            for child in node.get("children", []) or []:
                mark_unclosed(child)

    payload["solved"] = False
    payload.setdefault("stats", {})["number_of_solved_routes"] = 0
    for route in payload["routes"]:
        mark_unclosed(route)

    result = build_unified_route_pool(
        id="unclosed_draft",
        aizynthfinder_sources=[
            AizynthFinderRouteSource(
                source="aizynthfinder_unclosed_fixture",
                payload=payload,
                path="tests/fixtures/aizynthfinder/diphenhydramine_result.json",
            )
        ],
        min_routes=3,
        max_routes=10,
    )

    assert result.summary["selected_route_count"] == 0
    assert result.summary["closed_route_count"] == 0
    assert result.summary["output_mode"] == "empty"
    assert result.summary["meets_min_routes"] is False
    diagnostics = result.summary["closure_diagnostics"]
    assert "minimum_closed_route_count_not_met" in diagnostics["blockers"]
    assert "no_closed_routes_after_stock_evidence_check" in diagnostics["blockers"]
    assert diagnostics["selected_unclosed_route_count"] == 0
    assert diagnostics["top_unclosed_precursors"]


def test_askcos_frontier_summary_is_preserved_when_no_closed_paths(tmp_path):
    payload = {
        "task_id": "task-1",
        "target_smiles": "CCOC(=O)N1CC1",
        "result": {
            "stats": {
                "total_iterations": 17,
                "total_chemicals": 240,
                "total_reactions": 310,
                "total_templates": 310,
                "total_paths": 0,
                "first_path_time": 0,
                "build_time": 75.5,
            },
            "storage": {
                "frontier_summary": {
                    "frontier_leaf_count": 2,
                    "reaction_node_count": 3,
                    "top_frontier_leaves": [
                        {"smiles": "CCOC(=O)N1CC1", "heavy_atom_count": 8, "score": 0.7},
                        {"smiles": "CCO", "heavy_atom_count": 3},
                    ],
                }
            },
        },
    }

    result = build_unified_route_pool(
        id="askcos_frontier",
        askcos_sources=[
            AskcosRouteSource(
                source="askcos_mcts",
                payload=payload,
                engine="askcos_mcts",
                task_id="task-1",
            )
        ],
        min_routes=1,
        max_routes=3,
    )

    source_summary = result.summary["source_summaries"][0]
    assert source_summary["route_count"] == 0
    assert source_summary["frontier_leaf_count"] == 2
    assert source_summary["frontier_reaction_node_count"] == 3
    assert source_summary["frontier_examples"][0]["smiles"] == "CCOC(=O)N1CC1"
    assert source_summary["search_stats"] == {
        "total_iterations": 17,
        "total_chemicals": 240,
        "total_reactions": 310,
        "total_templates": 310,
        "total_paths": 0,
        "first_path_time": 0,
        "build_time": 75.5,
    }


def test_workflow_keeps_rejected_candidates_but_not_selected_delivery_routes(tmp_path):
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

    result = build_unified_route_pool(
        id="quality-gate",
        extra_routes=[long_route, good],
        min_routes=1,
        max_routes=10,
    )

    assert {route.route_id for route in result.all_routes} == {"good", "long"}
    assert [route.route_id for route in result.selected_routes] == ["good"]
    assert result.summary["closed_route_count"] == 2
    assert result.summary["quality_rejected_route_count"] == 1
    assert result.summary["quality_rejection_counts"] == {"too_many_steps": 1}


def test_workflow_applies_route_transform_before_quality_selection(tmp_path):
    def candidate(route_id, family):
        return RouteCandidate(
            route_id=route_id,
            engine="aizynthfinder",
            target_smiles="CCO",
            steps=[
                RouteStep(
                    step_id="s1",
                    reaction_smiles=f"{route_id}>>CCO",
                    precursors=[route_id],
                    product="CCO",
                    source="aizynthfinder:uspto",
                    confidence=0.8,
                )
            ],
            starting_materials=[route_id],
            closed=True,
            family_key=family,
        )

    def forward_validate(routes):
        return [
            replace(
                route,
                metadata={
                    **route.metadata,
                    "forward_validation_passed": route.route_id == "good",
                    "forward_validation_min_score": (
                        0.99 if route.route_id == "good" else 0.43
                    ),
                },
            )
            for route in routes
        ]

    result = build_unified_route_pool(
        id="forward-quality-gate",
        extra_routes=[
            candidate("bad", "bad-family"),
            candidate("good", "good-family"),
        ],
        min_routes=1,
        max_routes=10,
        route_transform=forward_validate,
    )

    assert {route.route_id for route in result.all_routes} == {"bad", "good"}
    assert [route.route_id for route in result.selected_routes] == ["good"]
    assert result.summary["quality_rejection_counts"] == {
        "forward_validation_failed": 1
    }
