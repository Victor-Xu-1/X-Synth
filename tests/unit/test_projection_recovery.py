import ast
from pathlib import Path

import pytest

from packages.adapters.askcos.projection_compatibility import (
    EXTERNAL_PROJECTION_FILES,
    EXTERNAL_SEARCH_FILES,
    NATIVE_DIRECTORIES,
    search_semantics,
    verify_projection_only,
)
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


@pytest.fixture
def projection_sources(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    sources = {
        "apps/askcos-v2/tree_search/mcts/utils.py":
            "def expand(): return []\ndef prune(tree, root): return tree\n",
        "packages/adapters/askcos/route_reachability.py":
            "def grounded_route_graph(tree, root): return tree\n",
        "packages/adapters/askcos/route_enumeration.py":
            "def enumerate_route_graphs(tree): return iter(tree)\n",
        "packages/adapters/askcos/retro_star_values.py":
            "def backup_search_values(tree, chemical, target): return []\n",
    }
    for root in (old, new):
        for name, source in sources.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source)
    return old, new


@pytest.mark.parametrize("change", ["modify", "add", "remove"])
def test_projection_proof_rejects_external_search_semantics_changes(
    projection_sources, change,
):
    old, new = projection_sources
    native = new / "apps/askcos-v2/tree_search/mcts/utils.py"
    native.write_text(native.read_text().replace("return tree", "return tree.copy()"))
    name = "packages/adapters/askcos/retro_star_values.py"
    if change == "modify":
        (new / name).write_text((new / name).read_text() + "\n")
    elif change == "add":
        (old / name).unlink()
    else:
        (new / name).unlink()
    before = {path: path.read_bytes() for root in (old, new) for path in root.rglob("*.py")}
    with pytest.raises(ValueError):
        verify_projection_only(old, new)
    assert {path: path.read_bytes() for path in before} == before


@pytest.mark.parametrize("helper", ["route_reachability", "route_enumeration"])
@pytest.mark.parametrize("added", [False, True])
def test_projection_proof_allows_reviewed_external_projection_helpers(
    projection_sources, helper, added,
):
    old, new = projection_sources
    name = f"packages/adapters/askcos/{helper}.py"
    if added:
        (old / name).unlink()
    else:
        (new / name).write_text((new / name).read_text() + "\n")
    assert verify_projection_only(old, new) == [name]


def test_projection_proof_covers_every_fingerprinted_code_boundary():
    from packages.platform import asset_identity

    module = ast.parse(Path(asset_identity.__file__).read_text())
    identity = next(node for node in module.body
                    if isinstance(node, ast.FunctionDef) and node.name == "native_asset_identity")
    external, native = set(), set()
    for loop in (node for node in identity.body if isinstance(node, ast.For)):
        strings = {node.value for node in ast.walk(loop)
                   if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        if "packages/adapters/askcos/" in strings:
            external.update(f"packages/adapters/askcos/{name}.py"
                            for name in ast.literal_eval(loop.iter))
        elif "apps/askcos-v2" in strings:
            native.update(ast.literal_eval(loop.iter))
    assert set(NATIVE_DIRECTORIES) == native
    assert EXTERNAL_SEARCH_FILES | EXTERNAL_PROJECTION_FILES == external


def test_projection_proof_still_rejects_native_search_changes(projection_sources):
    old, new = projection_sources
    path = new / "apps/askcos-v2/tree_search/mcts/utils.py"
    path.write_text(path.read_text().replace("def expand(): return []", "def expand(): return [1]"))
    helper = new / "packages/adapters/askcos/route_enumeration.py"
    helper.write_text(helper.read_text() + "\n")
    with pytest.raises(ValueError, match="Search semantics changed"):
        verify_projection_only(old, new)


def test_projection_proof_requires_an_actual_projection_change(projection_sources):
    with pytest.raises(ValueError, match="No reviewed native projection change"):
        verify_projection_only(*projection_sources)


@pytest.mark.parametrize("removed", [False, True])
def test_projection_proof_still_rejects_native_file_inventory_changes(
    projection_sources, removed,
):
    old, new = projection_sources
    path = (old if removed else new) / "apps/askcos-v2/askcos2_core/extra.py"
    path.parent.mkdir(parents=True)
    path.write_text("def expand(): return []\n")
    with pytest.raises(ValueError, match="search files were added or removed"):
        verify_projection_only(old, new)
