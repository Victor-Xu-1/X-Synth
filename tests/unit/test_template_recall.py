import ast
import importlib.util
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "apps/askcos-v2/retro/template_relevance/template_recall.py"
specification = importlib.util.spec_from_file_location("native_template_recall", PATH)
module = importlib.util.module_from_spec(specification)
specification.loader.exec_module(module)


def test_probability_one_does_not_reapply_softmax_mass_cutoff():
    scores = np.array([1.0, 1e-9, 1e-10], dtype=np.float32)
    indices, actual = module.truncate_templates(np.array([7, 3, 9]), scores, 3, 1.0)
    assert indices.tolist() == [7, 3, 9]
    assert actual.tolist() == scores.tolist()


def test_repair_remains_bounded_by_template_cap_and_preserves_ranking():
    scores = np.array([1.0, 1e-9, 1e-10], dtype=np.float32)
    indices, _ = module.truncate_templates(np.array([7, 3, 9]), scores, 2, 1.0)
    assert indices.tolist() == [7, 3]


def test_legacy_sub_one_cutoff_and_crossing_item_are_unchanged():
    indices, _ = module.truncate_templates(np.arange(4), np.array([0.6, 0.3, 0.08, 0.02]), 4, 0.8)
    assert indices.tolist() == [0, 1]
    indices, _ = module.truncate_templates(np.arange(3), np.array([1.0, 1e-9, 1e-10], dtype=np.float32), 3, 0.999)
    assert indices.tolist() == [0]


def test_actual_native_handler_delegates_to_the_reviewed_truncation():
    source = ast.parse((PATH.parent / "templ_rel_handler.py").read_text())
    imports = [node for node in ast.walk(source) if isinstance(node, ast.ImportFrom) and node.module == "template_recall"]
    assert any(alias.name == "truncate_templates" for node in imports for alias in node.names)
    assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "truncate_templates" for node in ast.walk(source))
