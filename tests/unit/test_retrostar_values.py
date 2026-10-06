import math

import networkx as nx
import pytest

from packages.adapters.askcos.retro_star_values import backup_search_values, propagate_priority


def native_tree():
    tree = nx.DiGraph([
        ("target", "r:target"), ("r:target", "a"), ("r:target", "sibling"),
        ("a", "r:a"), ("r:a", "stock"),
        ("sibling", "r:sibling"), ("r:sibling", "other"),
    ])
    for node in tree:
        tree.nodes[node].update(
            type="reaction" if node.startswith("r:") else "chemical",
            rn=1.0, Vt=3.0, rxn_score_from_model=1.0,
            solved=node in {"stock", "other"}, done=False,
        )
    tree.nodes["r:a"].update(rn=1.0, solved=True)
    tree.nodes["r:sibling"].update(rn=1.0, solved=True)
    tree.nodes["sibling"].update(solved=True)
    tree.nodes["r:target"]["rn"] = 2.0
    tree.nodes["target"]["rn"] = 2.0
    return tree


def test_zero_cost_change_still_propagates_success_to_target():
    tree = native_tree()
    ancestors = backup_search_values(tree, "a", "target")
    assert tree.nodes["a"]["solved"] is True
    assert tree.nodes["r:target"]["solved"] is True
    assert tree.nodes["target"]["solved"] is True
    assert tree.nodes["target"]["rn"] == 2.0
    assert ancestors == ["target"]


def test_increasing_cost_recomputes_or_minimum_and_can_switch_alternative():
    tree = native_tree()
    tree.nodes["r:a"]["rn"] = 4.0
    tree.add_node("r:alternative", type="reaction", rn=3.5, Vt=3.5, solved=False)
    tree.add_edge("target", "r:alternative")
    backup_search_values(tree, "a", "target")
    assert tree.nodes["r:target"]["rn"] == 5.0
    assert tree.nodes["target"]["rn"] == 3.5
    assert tree.nodes["sibling"]["rn"] == 1.0
    assert tree.nodes["r:sibling"]["rn"] == 1.0
    assert tree.nodes["r:sibling"]["Vt"] == 6.0


def test_sibling_priority_does_not_modify_local_cost_or_solved_flags():
    tree = native_tree()
    original = {node: dict(tree.nodes[node]) for node in ("sibling", "r:sibling", "other")}
    propagate_priority(tree, "sibling", 7.0)
    for node, data in original.items():
        assert tree.nodes[node]["rn"] == data["rn"]
        assert tree.nodes[node]["solved"] == data["solved"]
    assert tree.nodes["r:sibling"]["Vt"] == 10.0


def test_exhausted_leaf_blocks_and_branch_without_nan():
    tree = native_tree()
    tree.remove_edge("a", "r:a")
    backup_search_values(tree, "a", "target")
    assert tree.nodes["a"]["done"] is True
    assert tree.nodes["a"]["rn"] == math.inf
    assert tree.nodes["target"]["rn"] == math.inf
    assert tree.nodes["target"]["solved"] is False
    backup_search_values(tree, "a", "target")
    assert not math.isnan(tree.nodes["r:target"]["Vt"])


def test_invalid_parent_graph_is_not_silently_used():
    tree = native_tree()
    tree.add_edge("r:sibling", "a")
    with pytest.raises(ValueError, match="unique parent"):
        backup_search_values(tree, "a", "target")


def test_actual_native_controller_uses_the_reviewed_backup_and_done_logic():
    import ast
    from pathlib import Path
    from types import MethodType, SimpleNamespace

    source = Path(__file__).resolve().parents[2] / "apps/askcos-v2/tree_search/retro_star/retro_star_controller.py"
    module = ast.parse(source.read_text())
    controller = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "RetroStar")
    body = [node for node in module.body if isinstance(node, ast.ImportFrom) and node.module == "packages.adapters.askcos.retro_star_values"]
    body.extend(node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name in {"_update", "is_reaction_done"})
    namespace = {}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(source), "exec"), namespace)
    tree = native_tree()
    tree.nodes["target"]["min_depth"] = 1
    instance = SimpleNamespace(tree=tree, target="target", build_tree_options=SimpleNamespace(max_depth=12, max_branching=50))
    instance.is_reaction_done = MethodType(namespace["is_reaction_done"], instance)
    namespace["_update"](instance, "a")
    assert tree.nodes["target"]["solved"] is True
    assert tree.nodes["target"]["done"] is False


def test_projection_recovery_rejects_native_search_semantics_change():
    from packages.adapters.askcos.projection_compatibility import search_semantics

    before = "class RetroStar:\n    def _update(self): return 1\n    def enumerate_paths(self): return []\n"
    after = before.replace("return 1", "return 2")
    assert search_semantics(before, {"RetroStar.enumerate_paths"}) != search_semantics(after, {"RetroStar.enumerate_paths"})
