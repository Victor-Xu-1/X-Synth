"""Protective scope checks before native inference and candidate ranking."""

import ast
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from rdkit import Chem

from packages.chemistry.material_scope import material_scope_exclusion


def native_method():
    source = Path(__file__).resolve().parents[2] / (
        "apps/askcos-v2/tree_search/expand_one/expand_one_controller.py"
    )
    tree = ast.parse(source.read_text())
    return source, next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "get_outcomes"
    )


@pytest.mark.parametrize("structure", [
    "CCN(CCCl)CCCl", "CN(CCCl)CCCl", "ClCCN(CCCl)CCCl",
    "C[NH+](CCCl)CCCl.[Cl-]",
])
def test_out_of_scope_targets_do_not_reach_any_native_model(structure):
    source, method = native_method()
    method.returns = None
    for arg in (*method.args.posonlyargs, *method.args.args, *method.args.kwonlyargs):
        arg.annotation = None
    namespace = {
        "time": time, "material_scope_exclusion": material_scope_exclusion,
        "canonicalize_smiles": lambda value: Chem.MolToSmiles(
            Chem.MolFromSmiles(value), isomericSmiles=True
        ),
    }
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    # No provider or model response exists: the real guard must return first.
    assert namespace["get_outcomes"](SimpleNamespace(), structure, [object()]) == []


def test_candidate_scope_is_checked_before_result_mutation_pricing_or_ranking():
    _, method = native_method()
    loop = next(
        node for node in ast.walk(method)
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Name)
        and node.iter.id == "retro_results"
    )
    guards = [node for node in loop.body if isinstance(node, ast.If) and any(
        isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
        and call.func.id == "material_scope_exclusion"
        for call in ast.walk(node.test)
    )]
    assert len(guards) == 1
    assert any(isinstance(node, ast.Continue) for node in ast.walk(guards[0]))
    first_mutation = next(node for node in loop.body if isinstance(node, ast.Expr))
    assert guards[0].lineno < first_mutation.lineno
    assert material_scope_exclusion("CCO.CN(CCCl)CCCl") is not None
    assert material_scope_exclusion("CCO.CCN") is None
