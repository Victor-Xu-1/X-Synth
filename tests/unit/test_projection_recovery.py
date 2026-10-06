import ast
from pathlib import Path

from packages.adapters.askcos.projection_compatibility import search_semantics
from packages.adapters.askcos.projection_recovery import digest, read_waiting_job


def test_projection_changes_do_not_invalidate_search_semantics():
    before = "def expand():\n    return ['candidate']\ndef prune(tree, root):\n    return tree\n"
    after = "from packages.adapters.askcos.route_reachability import grounded_route_graph\ndef expand():\n    return ['candidate']\ndef prune(tree, root):\n    return grounded_route_graph(tree, root)\n"
    assert search_semantics(before, {"prune"}) == search_semantics(after, {"prune"})
    assert search_semantics(before, {"prune"}) != search_semantics(after.replace("candidate", "other"), {"prune"})


def test_class_projection_is_separate_from_build_and_terminal_logic():
    before = "class Search:\n    def build(self): return 1\n    def enumerate_paths(self): return []\n"
    after = before.replace("return []", "return ['path']")
    assert search_semantics(before, {"Search.enumerate_paths"}) == search_semantics(after, {"Search.enumerate_paths"})
    assert search_semantics(before, {"Search.enumerate_paths"}) != search_semantics(after.replace("return 1", "return 2"), {"Search.enumerate_paths"})


def test_graph_digest_includes_search_progress_and_all_nodes():
    graph = {"elapsed": 1800.1, "iterations": 592, "graph": {"nodes": [{"id": "target", "solved": False}]}}
    assert digest(graph) == digest(dict(reversed(list(graph.items()))))
    assert digest(graph) != digest({**graph, "iterations": 593})
    assert digest(graph) != digest({**graph, "graph": {"nodes": []}})


def test_recovery_rejects_untrusted_job_ids_without_creating_a_database(tmp_path):
    import pytest

    with pytest.raises(ValueError, match="Invalid job"):
        read_waiting_job(tmp_path, "../other")
    assert not list(tmp_path.iterdir())


def test_operator_recovery_is_dry_run_by_default_and_does_not_mutate_job_status():
    source = Path(__file__).resolve().parents[2] / "scripts/operations/recover_native_projection.py"
    module = ast.parse(source.read_text())
    assert "action=\"store_true\"" in source.read_text()
    assert not any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {"transition", "update", "cancel"} for node in ast.walk(module))
