"""Native cumulative search duration, using real checkpoint serialization."""

import ast
import time
from pathlib import Path
from types import SimpleNamespace

import networkx as nx
import pytest

from packages.adapters.askcos.search_checkpoint import SearchCheckpoint


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_completed_checkpoint_retains_duration_in_native_result(strategy, tmp_path):
    source = (
        Path(__file__).resolve().parents[2]
        / f"apps/askcos-v2/tree_search/{strategy}/{strategy}_controller.py"
    )
    tree = ast.parse(source.read_text())
    controller_class = next(node for node in tree.body if isinstance(node, ast.ClassDef))
    method = next(
        node for node in controller_class.body
        if isinstance(node, ast.FunctionDef) and node.name == "build_tree"
    )
    namespace = {"time": time}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)

    graph = nx.DiGraph()
    graph.add_node("CCO", type="chemical", solved=False)
    controller = SimpleNamespace(
        tree=graph, target="CCO", chemicals={"CCO"}, reactions=set(),
        iterations=7, time_to_solve=0, done=False,
        build_tree_options=SimpleNamespace(expansion_time=0),
        print_stats=lambda: None,
    )
    checkpoint = SearchCheckpoint(tmp_path / "checkpoint.json")
    checkpoint.save(controller, 61.0, force=True)
    controller.checkpoint = checkpoint
    elapsed = namespace["build_tree"](controller, "CCO")
    assert 61.0 <= elapsed < 62.0
    assert checkpoint.restore(controller, "CCO") == elapsed
    assert controller.iterations == 7

    # Statistics must consume the cumulative result, not a fresh wall clock.
    call = next(
        node for node in controller_class.body
        if isinstance(node, ast.FunctionDef) and node.name == "get_buyable_paths"
    )
    assignments = [
        node for node in ast.walk(call)
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "build_time"
            for target in node.targets
        )
    ]
    assert len(assignments) == 1
    value = assignments[0].value
    assert isinstance(value, ast.Call)
    assert isinstance(value.func, ast.Attribute) and value.func.attr == "build_tree"
