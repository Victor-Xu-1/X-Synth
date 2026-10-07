"""Candidate ordering contracts using captured native pathways, not inference mocks."""

import ast
import json
from math import prod
from pathlib import Path
from types import SimpleNamespace
from typing import List, Tuple

import networkx as nx
import numpy as np
import pytest
from rdkit import Chem

from packages.adapters.askcos import route_enumeration
from packages.route_pool.askcos import normalize_askcos_tree_result
from packages.route_pool.workflow import _askcos_frontier_summary
from scripts.diagnostics import ci_scope_profile

ROOT = Path(__file__).resolve().parents[2]


def captured_paths():
    payload = json.loads((ROOT / "tests/fixtures/askcos/diphenhydramine_retrostar_result.json").read_text())["result"]["uds"]
    paths = []
    for edges, properties in zip(payload["pathways"], payload["pathways_properties"], strict=True):
        path = nx.DiGraph()
        path.add_edges_from((edge["source"], edge["target"]) for edge in edges)
        for identifier in path:
            smiles = payload["uuid2smiles"][identifier]
            path.nodes[identifier].update(payload["node_dict"][smiles])
        path.graph.update(properties)
        paths.append(path)
    return paths


def native_helpers(strategy):
    path = ROOT / "apps/askcos-v2/tree_search" / strategy / "utils.py"
    names = {"_node_smiles", "_reaction_signature", "_route_family_key", "select_diverse_paths",
             "_overall_plausibility", "_reaction_count", "_number_of_starting_materials",
             "_terminal_leaf_smiles", "_leaf_sanity_penalty", "_path_quality_tiebreaker", "sort_paths"}
    definitions = [node for node in ast.parse(path.read_text()).body
                   if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {"nx": nx, "np": np, "Chem": Chem, "List": List, "Tuple": Tuple,
                 "prioritize_candidate_paths": route_enumeration.prioritize_candidate_paths}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_native_cluster_does_not_discard_available_alternatives(strategy):
    paths = captured_paths()[:5]
    # Controlled cluster metadata on real captured pathways; no chemical outcome is changed.
    for path in paths:
        path.graph["cluster_id"] = 0
    selected = native_helpers(strategy)["select_diverse_paths"](paths, max_paths=10)
    assert selected == paths


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_native_candidate_limit_keeps_representatives_then_ranked_alternatives(strategy):
    paths = captured_paths()[:5]
    for path, cluster in zip(paths, [0, 0, 0, 1, 2], strict=True):
        path.graph["cluster_id"] = cluster
    selected = native_helpers(strategy)["select_diverse_paths"](paths, max_paths=4)
    assert selected == [paths[0], paths[3], paths[4], paths[1]]


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_native_candidate_limit_and_unbounded_ordering(strategy):
    paths = captured_paths()[:5]
    selector = native_helpers(strategy)["select_diverse_paths"]
    assert selector(paths, max_paths=None) == paths
    assert selector(paths, max_paths=0) == []


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_fallback_scores_use_the_same_higher_is_better_contract(strategy):
    paths = captured_paths()
    expected = {id(path): float(prod(data["plausibility"] for _, data in path.nodes(data=True)
                                   if data.get("type") == "reaction")) for path in paths}
    route_enumeration.rank_paths_by_plausibility(paths, cluster_trees=True, error_type="ConnectionError")
    assert all(path.graph["score"] == expected[id(path)] for path in paths)
    assert all(path.graph["score_fallback"] == "overall_plausibility" and
               path.graph["ranking_warning"] == "pathway_ranker_failed: ConnectionError" and
               path.graph["cluster_id"] is None for path in paths)
    ordered = native_helpers(strategy)["sort_paths"](paths, "score")
    assert [expected[id(path)] for path in ordered] == sorted(expected.values(), reverse=True)


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_native_ranker_failure_uses_the_shared_explicit_fallback(strategy):
    path = ROOT / "apps/askcos-v2/tree_search" / strategy / "utils.py"
    score = next(node for node in ast.parse(path.read_text()).body
                 if isinstance(node, ast.FunctionDef) and node.name == "score_paths")
    handlers = [handler for node in ast.walk(score) if isinstance(node, ast.Try) for handler in node.handlers]
    assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
               and node.func.id == "rank_paths_by_plausibility" for handler in handlers for node in ast.walk(handler))


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_upstream_selector_changes_select_the_captured_path_contract(strategy):
    changed = f"apps/askcos-v2/tree_search/{strategy}/tests/test_diverse_path_selection.py"
    ci_scope_profile.guard_paths({changed})
    snapshot = SimpleNamespace(
        files={path.relative_to(ROOT).as_posix() for path in (ROOT / "tests/unit").glob("test_*.py")},
        text=lambda name: (ROOT / name).read_text(),
    )
    assert "tests/unit/test_candidate_retention.py" in ci_scope_profile.python_tests(snapshot, snapshot, {changed})


def test_candidate_selection_statistics_survive_product_projections():
    payload = json.loads((ROOT / "tests/fixtures/askcos/diphenhydramine_retrostar_result.json").read_text())
    statistics = {"enumerated_paths": 200, "candidate_path_limit": 200,
                  "candidate_selection": "cluster_priority_then_ranked_variants"}
    payload["result"]["stats"].update(statistics)
    candidates = normalize_askcos_tree_result(payload)
    assert candidates
    assert all({key: row.metadata["stats"][key] for key in statistics} == statistics for row in candidates)
    assert {key: _askcos_frontier_summary(payload)["search_stats"][key] for key in statistics} == statistics
