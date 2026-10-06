"""Durable single-authority boundaries, not a repository-wide functional suite."""

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_scientific_execution_is_framework_independent():
    path = ROOT / "packages/workspace/analysis_execution.py"
    imports = [node.module for node in ast.walk(ast.parse(path.read_text()))
               if isinstance(node, ast.ImportFrom)]
    assert not any(value and value.startswith(("apps.api", "fastapi")) for value in imports)
    router = ast.parse((ROOT / "apps/api/analysis_routes.py").read_text())
    assert not any(isinstance(node, ast.FunctionDef) and node.name == "analysis_runner"
                   for node in ast.walk(router))


def test_importing_the_api_factory_does_not_construct_a_default_application():
    module = ast.parse((ROOT / "apps/api/app.py").read_text())
    assert not any(
        isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name) and node.value.func.id == "create_app"
        for node in module.body
    )


def test_route_pool_computation_cannot_publish_delivery_artifacts():
    paths = ("packages/route_pool/workflow.py", "packages/orchestrator/route_verification.py")
    for relative in paths:
        tree = ast.parse((ROOT / relative).read_text())
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        assert "write_json" not in names
        assert "publish_route_pool_artifacts" not in names


def test_retired_direct_generators_cannot_compete_with_product_jobs():
    for filename in ("run_real_route_case.py", "build_unified_route_pool.py",
                     "run_unified_route_batch.py", "run_aizynthfinder_case.py"):
        assert not (ROOT / "scripts/diagnostics" / filename).exists()
    cli = (ROOT / "scripts/diagnostics/run_unified_route_case.py").read_text()
    assert "/api/v1/unified-route/call-async" in cli
    assert "/network?" not in cli
