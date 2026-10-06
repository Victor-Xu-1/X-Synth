"""Reviewed workspace allowlist and narrow, fail-closed test selection rules."""

from __future__ import annotations

import json
import tomllib
from collections import defaultdict
from pathlib import PurePosixPath

from . import ci_scope_dependencies as analysis
from . import ci_scope_architecture as architecture

WEB = analysis.WEB
SOURCE = analysis.SOURCE
WORKSPACE_TESTS = {
    "tests/unit/test_route_documents.py",
    "tests/unit/test_route_document_api.py",
}
SCOPE_TEST = "tests/unit/test_ci_scope.py"
CONTRACT_TEST = "tests/unit/test_frontend_backend_contract.py"
VERSION_TEST = "tests/unit/test_product_version.py"
MANIFESTS = {"pyproject.toml", WEB + "package.json", WEB + "package-lock.json"}
PYTHON_LOCK = "requirements/orchestrator-linux-py312.lock"
CI_FILES = {
    ".github/workflows/ci.yml",
    "scripts/diagnostics/ci_scope.py",
    "scripts/diagnostics/ci_scope_profile.py",
    "scripts/diagnostics/ci_scope_dependencies.py",
    "scripts/diagnostics/ci_scope_architecture.py",
    SCOPE_TEST,
}
CI_SAFETY_TESTS = {
    SCOPE_TEST,
    "tests/unit/test_operations_scripts.py",
    "tests/unit/test_public_source_export.py",
}
DOCS = {
    "README.md",
    "docs/current-architecture.md",
    "docs/operations.md",
    "docs/real-case-testing.md",
    "docs/workspace-workflows.md",
    "NOTICE",
}
API_FILES = {
    "apps/api/stock_routes.py",
    "apps/api/app.py",
    "apps/api/document_routes.py",
    "apps/api/structure_routes.py",
    "apps/api/environment_routes.py",
    "apps/api/native_routes.py",
    "apps/api/data_routes.py",
    "apps/api/job_views.py",
    "apps/api/job_routes.py",
    "apps/api/analysis_routes.py",
    "apps/api/assessment_routes.py",
    "apps/api/condition_routes.py",
    "apps/api/reaction_routes.py",
    "apps/api/optimization_routes.py",
    "apps/api/impurity_routes.py",
    "apps/api/result_routes.py",
    "apps/api/reference_routes.py",
}
SCIENTIFIC_FILES = {
    "packages/adapters/askcos/native_models.py",
    "packages/adapters/askcos/conditions.py",
    "packages/adapters/askcos/forward.py",
    "packages/chemistry/forward_evaluation.py",
    "packages/adapters/askcos/impurities.py",
    "apps/api/impurity_routes.py",
    "packages/chemistry/assessment.py",
    "packages/chemistry/process_metrics.py",
    *{
        path
        for path in API_FILES
        if any(
            word in path
            for word in (
                "analysis_",
                "assessment_",
                "condition_",
                "reaction_",
                "optimization_",
            )
        )
    },
}
RUNTIME_FILES = {
    ".gitignore",
    ".env.example",
    "packages/platform/native_runtime.py",
    "packages/platform/resource_metrics.py",
    "packages/orchestrator/runtime_health.py",
    "scripts/operations/serve_platform.py",
    "scripts/data_import/install_askcos_model.py",
    "apps/askcos-v2/askcos2_core/configs/module_config_x_synth.py",
    "apps/askcos-v2/context_recommender/app/v1/services/predictor.py",
    "apps/askcos-v2/context_recommender/app/common/services/model_assets.py",
    "apps/askcos-v2/context_recommender/condition_server.py",
    "apps/askcos-v2/forward_predictor/graph2smiles/forward_server.py",
    "apps/askcos-v2/forward_predictor/graph2smiles/model_runtime.py",
    "apps/askcos-v2/forward_predictor/graph2smiles/utils/ctypes_calculator.py",
    "apps/askcos-v2/impurity_predictor/native_server.py",
    "apps/askcos-v2/impurity_predictor/native_mapper.py",
    "apps/askcos-v2/impurity_predictor/native_session.py",
    "apps/askcos-v2/impurity_predictor/native_runtime.py",
    "requirements/askcos-runtime.in",
    "requirements/askcos-runtime-linux-py312.lock",
    "requirements/context-runtime.in",
    "requirements/context-runtime-linux-py312.lock",
    "requirements/optimization-runtime.in",
    "requirements/optimization-runtime-linux-py312.lock",
    "requirements/impurity-runtime.in",
    "requirements/impurity-runtime-linux-py312.lock",
    *{
        "apps/askcos-v2/forward_predictor/graph2smiles/models/" + file
        for file in (
            "attention_xl.py",
            "dgat.py",
            "dgcn.py",
            "graph2smiles.py",
            "graphfeat.py",
            "model_utils.py",
            "transformer_decoder.py",
        )
    },
}
SCIENTIFIC_TESTS = {
    "tests/unit/test_native_scientific_boundaries.py",
    "tests/unit/test_analysis_records.py",
    "tests/unit/test_molecular_assessment.py",
    "tests/unit/test_process_metrics.py",
    "tests/unit/test_assessment_routes.py",
    "tests/unit/test_optimization_api.py",
    "tests/unit/test_optimization_tables.py",
    "tests/unit/test_optimization_runtime.py",
    "tests/unit/test_impurity_boundaries.py",
}
ENVIRONMENT_FILES = {
    "packages/platform/environments.py",
    "apps/api/environment_routes.py",
}
NATIVE_CAPABILITY_FILES = {
    "apps/api/native_routes.py",
    "packages/platform/native_capabilities.py",
    "packages/platform/native_capability_catalog.py",
    "packages/platform/environment_dependencies.py",
}
TEMPLATE_FILES = {
    "apps/api/data_routes.py",
    "packages/knowledge_base/template_library.py",
}
HISTORY_FILES = {
    "apps/api/job_views.py",
    "apps/api/result_routes.py",
    "packages/workspace/history_projection.py",
    "packages/orchestrator/job_repository.py",
    "packages/orchestrator/job_history.py",
    "packages/orchestrator/job_history_schema.py",
}
SEARCH_ROUND_FILES = {
    "packages/route_pool/__init__.py",
    "packages/orchestrator/job_commands.py",
    "packages/orchestrator/route_artifacts.py",
    "packages/orchestrator/route_artifact_manifest.py",
    "packages/orchestrator/review_execution.py",
    "packages/orchestrator/review_worker.py",
    "packages/orchestrator/review_policy.py",
    "packages/orchestrator/route_verification.py",
    "packages/orchestrator/verification_cache.py",
    "packages/route_pool/workflow.py",
    "packages/orchestrator/pipeline.py",
    "packages/orchestrator/search_progress.py",
    "packages/orchestrator/route_request.py",
    "packages/adapters/askcos/engine.py",
    "packages/chemistry/material_scope.py",
    "packages/validation/route_quality.py",
}
ARCHITECTURE_FILES = {
    "packages/platform/atomic_file.py",
    "scripts/diagnostics/run_unified_route_case.py",
    "scripts/diagnostics/run_real_route_case.py",
    "scripts/diagnostics/build_unified_route_pool.py",
    "scripts/diagnostics/run_unified_route_batch.py",
    "scripts/diagnostics/run_aizynthfinder_case.py",
}
ANALYSIS_EXECUTION_FILES = {"packages/workspace/analysis_execution.py"}
PERFORMANCE_FILES = {"packages/platform/performance.py"}
SEARCH_PROJECTION_FILES = {
    "packages/adapters/askcos/route_reachability.py",
    "packages/adapters/askcos/route_enumeration.py",
    "apps/askcos-v2/retro/template_relevance/templ_rel_handler.py",
    "apps/askcos-v2/retro/template_relevance/template_recall.py",
    "packages/adapters/askcos/retro_star_values.py",
    "packages/adapters/askcos/projection_compatibility.py",
    "packages/adapters/askcos/projection_recovery.py",
    "packages/platform/asset_identity.py",
    "packages/platform/cgroup_metrics.py",
    "scripts/operations/recover_native_projection.py",
    "scripts/operations/systemd/x-synth@.service",
    "apps/askcos-v2/tree_search/mcts/utils.py",
    "apps/askcos-v2/tree_search/mcts/mcts_controller.py",
    "apps/askcos-v2/tree_search/expand_one/expand_one_controller.py",
    "apps/askcos-v2/tree_search/retro_star/utils.py",
    "apps/askcos-v2/tree_search/retro_star/retro_star_controller.py",
}
REFERENCE_FILES = {
    "apps/api/reference_routes.py",
    "packages/adapters/askcos/references.py",
    "packages/adapters/askcos/reference_models.py",
    "packages/adapters/askcos/reference_identity.py",
    "apps/askcos-v2/askcos2_core/utils/reactions.py",
    "apps/askcos-v2/askcos2_core/app.py",
    "packages/knowledge_base/reaction_models.py",
    "packages/knowledge_base/reaction_library.py",
    "packages/knowledge_base/reaction_evidence.py",
    "apps/askcos-v2/askcos2_core/utils/reaction_drawing.py",
    "apps/askcos-v2/askcos2_core/utils/draw_impl.py",
}
REACTION_FIXTURES = {
    "tests/fixtures/askcos/forward_sorafenib_result.json",
    "tests/fixtures/reactions/ord-astra-zeneca.json",
    "tests/fixtures/reactions/ord-inchi-tautomer.json",
    "tests/fixtures/reactions/README.md",
}
ORD_FILES = {
    "packages/knowledge_base/ord_reader.py",
    "packages/knowledge_base/ord_structures.py",
    "packages/knowledge_base/ord_identifiers.py",
    "packages/knowledge_base/ord_incremental.py",
    "packages/knowledge_base/ord_extract.py",
    "packages/knowledge_base/ord_measurements.py",
    "packages/knowledge_base/ord_import.py",
    "scripts/data_import/compile_reaction_library.py",
    "requirements/reaction-data.in",
    "requirements/reaction-data-linux-py312.lock",
}
ORD_TESTS = {
    "tests/unit/test_ord_extraction.py",
    "tests/unit/test_ord_identifiers.py",
    "tests/unit/test_ord_incremental.py",
}
PRICING_FILES = {
    "apps/api/stock_routes.py",
    "packages/adapters/stock/catalog_pricing.py",
}
CHEMICAL_FILE_FILES = {
    "apps/api/structure_routes.py",
    "packages/workspace/chemical_files.py",
    "packages/workspace/chemical_reactions.py",
    "packages/workspace/reaction_input.py",
}
CHEMICAL_FILE_TESTS = {
    "tests/unit/test_chemical_files.py",
    "tests/unit/test_reaction_export.py",
    "tests/unit/test_reaction_input.py",
    "tests/unit/test_reaction_compounds.py",
}
WEB_BUILD_FILES = {WEB + name for name in ("index.html", "vite.config.js")}
WEB_TEST_TOOLING = {WEB + "jest.config.js"}
FRONTEND_API_TESTS = {
    SOURCE + "composables/useTemplateSearch.test.js",
    SOURCE + "views/assessment/Assessment.test.js",
    SOURCE + "views/process/Process.test.js",
}
SOURCE_EXTENSIONS = analysis.SOURCE_EXTENSIONS
ASSET_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"}
# These tests scan source without importing it; other literal file reads are
# resolved from their AST. Prefixes deliberately include deleted source paths.
SOURCE_READERS = {SOURCE + "common/source-boundary.test.js": (SOURCE,)}
PYTHON_DEPENDENCIES = {"networkx": "networkx"}


def guard_paths(paths: set[str]) -> None:
    unknown = []
    for path in sorted(paths):
        suffix = PurePosixPath(path).suffix
        known = (
            path
            in CI_FILES
            | DOCS
            | MANIFESTS
            | API_FILES
            | SCIENTIFIC_FILES
            | RUNTIME_FILES
            | WEB_BUILD_FILES
            | WEB_TEST_TOOLING
            | ENVIRONMENT_FILES
            | NATIVE_CAPABILITY_FILES
            | TEMPLATE_FILES
            | HISTORY_FILES
            | REFERENCE_FILES
            | REACTION_FIXTURES
            | ORD_FILES
            | PRICING_FILES
            | PERFORMANCE_FILES
            | SEARCH_PROJECTION_FILES
            | SEARCH_ROUND_FILES
            | ARCHITECTURE_FILES
            | architecture.FILES
            | {
                PYTHON_LOCK,
                "VERSION",
            }
        )
        known |= path.startswith("packages/workspace/") and suffix == ".py"
        known |= path.startswith("packages/adapters/optimization/") and suffix == ".py"
        known |= path in {
            "tests/integration/test_optimization_published.py",
            "tests/integration/optimization_browser.mjs",
            "tests/integration/forward_browser.mjs",
            "tests/integration/analysis_browser.mjs",
            "tests/integration/task_workspace_browser.mjs",
            "tests/integration/reaction_evidence_browser.mjs",
            "tests/integration/structure_input_browser.mjs",
            "tests/integration/reaction_canvas_browser.mjs",
            "tests/integration/reaction_canvas_review_browser.mjs",
            "tests/integration/reaction_browser_support.mjs",
            "tests/integration/reference_reuse_browser.mjs",
            "tests/integration/workbench_shell_browser.mjs",
            "tests/integration/workbench_form_browser.mjs",
            "tests/integration/test_impurity_native.py",
            "tests/integration/test_impurity_mapper.py",
            "tests/integration/test_impurity_assets.py",
            "tests/focused/assessment_process_browser.cjs",
            "tests/focused/impurity_workspace_browser.mjs",
        }
        known |= path.startswith("tests/unit/test_") and suffix == ".py"
        known |= path.startswith(SOURCE) and suffix in SOURCE_EXTENSIONS
        known |= path.startswith(SOURCE + "assets/") and suffix in ASSET_EXTENSIONS
        if not known:
            unknown.append(path)
    if unknown:
        raise analysis.ScopeError(
            "Unmapped changes; add an explicit reviewed scope (no full-test fallback): "
            + ", ".join(unknown)
        )


def python_dependency_roots(before, after, paths: set[str]) -> set[str]:
    dependencies = set()
    if "pyproject.toml" in paths:
        old, new = (
            tomllib.loads(snapshot.text("pyproject.toml"))
            for snapshot in (before, after)
        )
        dependencies |= analysis.differing(
            analysis.pinned_requirements(old["project"].pop("dependencies")),
            analysis.pinned_requirements(new["project"].pop("dependencies")),
        )
        if old != new:
            raise analysis.ScopeError(
                "Unmapped pyproject metadata/tool/test dependency changes; extend the scope mapping."
            )
    if PYTHON_LOCK in paths:
        dependencies |= analysis.differing(
            *(
                analysis.lock_requirements(snapshot.text(PYTHON_LOCK))
                for snapshot in (before, after)
            )
        )
    unknown = dependencies - PYTHON_DEPENDENCIES.keys()
    if unknown:
        raise analysis.ScopeError(
            "Unmapped Python dependency changes: " + ", ".join(sorted(unknown))
        )
    roots = set()
    for dependency in dependencies:
        for snapshot in (before, after):
            for path in snapshot.files:
                if path.startswith("packages/workspace/") and path.endswith(".py"):
                    imports = analysis.python_imports(snapshot.text(path))
                    if PYTHON_DEPENDENCIES[dependency] in imports:
                        roots.add(path)
        if not roots:
            raise analysis.ScopeError(
                f"No production importer mapped for Python dependency {dependency}"
            )
    return roots


def python_tests(before, after, paths: set[str]) -> list[str]:
    roots = paths | python_dependency_roots(before, after, paths)
    selected = {
        path
        for path in roots
        if path.startswith("tests/unit/test_")
        and path.endswith(".py")
        and path in after.files
    }
    selected.update(architecture.related_tests(roots))
    if roots & ENVIRONMENT_FILES:
        selected.add("tests/unit/test_environment_api.py")
    if roots & SCIENTIFIC_FILES or any(
        path.startswith("packages/adapters/optimization/") for path in roots
    ):
        selected.update(SCIENTIFIC_TESTS)
        selected.add("tests/unit/test_product_api_security.py")
    if roots & RUNTIME_FILES:
        selected.update(
            {
                "tests/unit/test_native_scientific_boundaries.py",
                "tests/unit/test_operations_scripts.py",
                "tests/unit/test_native_ports.py",
                "tests/unit/test_environment_api.py",
                "tests/unit/test_model_archive_installation.py",
                "tests/unit/test_public_source_export.py",
                "tests/unit/test_resource_metrics.py",
            }
        )
    if roots & NATIVE_CAPABILITY_FILES:
        selected.update(
            {
                "tests/unit/test_native_capability_boundary.py",
                "tests/unit/test_environment_api.py",
                "tests/unit/test_native_drawing_proxy.py",
                "tests/unit/test_product_api_security.py",
            }
        )
    if roots & TEMPLATE_FILES:
        selected.update(
            {
                "tests/unit/test_template_library_api.py",
                "tests/unit/test_product_api_security.py",
            }
        )
    if roots & HISTORY_FILES:
        selected.update(
            {
                "tests/unit/test_history_projection.py",
                "tests/unit/test_route_document_api.py",
                "tests/unit/test_product_api_security.py",
                "tests/unit/test_job_history.py",
                "tests/unit/test_job_repository.py",
                "tests/unit/test_route_lifecycle.py",
            }
        )
    if roots & REFERENCE_FILES:
        selected.update(
            {
                "tests/unit/test_reaction_references.py",
                "tests/unit/test_native_capability_boundary.py",
                "tests/unit/test_product_api_security.py",
            }
        )
    if roots & (REFERENCE_FILES | REACTION_FIXTURES):
        selected.add("tests/unit/test_reaction_library.py")
    if roots & {
        "apps/askcos-v2/askcos2_core/utils/reaction_drawing.py",
        "apps/askcos-v2/askcos2_core/utils/draw_impl.py",
    }:
        selected.add("tests/unit/test_reaction_drawing.py")
    if roots & PRICING_FILES:
        selected.update(
            {
                "tests/unit/test_catalog_pricing.py",
                "tests/unit/test_product_api_security.py",
            }
        )
    if roots & PERFORMANCE_FILES:
        selected.update(
            {
                "tests/unit/test_performance_budget.py",
                "tests/unit/test_job_history.py",
                "tests/unit/test_environment_api.py",
                "tests/unit/test_route_request.py",
            }
        )
    if roots & SEARCH_PROJECTION_FILES:
        selected.update({
            "tests/unit/test_route_reachability.py",
            "tests/unit/test_route_enumeration.py",
            "tests/unit/test_template_recall.py",
            "tests/unit/test_candidate_scope.py",
            "tests/unit/test_material_scope.py",
            "tests/unit/test_search_elapsed.py",
            "tests/unit/test_retrostar_values.py",
            "tests/unit/test_projection_recovery.py",
            "tests/unit/test_cgroup_metrics.py",
            "tests/unit/test_search_artifacts.py",
            "tests/unit/test_resource_metrics.py",
            "tests/unit/test_native_lifecycle.py",
            "tests/unit/test_askcos_adapter.py",
            "tests/unit/test_route_request.py",
            "tests/unit/test_route_lifecycle.py",
            "tests/unit/test_operations_scripts.py",
        })
    if roots & SEARCH_ROUND_FILES:
        selected.update({
            "tests/unit/test_review_execution.py",
            "tests/unit/test_unified_route_workflow.py",
            "tests/unit/test_route_artifacts.py",
            "tests/unit/test_job_commands.py",
            "tests/unit/test_route_verification.py",
            "tests/unit/test_search_progress.py",
            "tests/unit/test_job_repository.py",
            "tests/unit/test_route_lifecycle.py",
            "tests/unit/test_askcos_adapter.py",
            "tests/unit/test_material_scope.py",
            "tests/unit/test_route_quality.py",
        })
    if roots & ARCHITECTURE_FILES:
        selected.update({"tests/unit/test_architecture_boundaries.py", "tests/unit/test_route_artifacts.py"})
    if roots & ANALYSIS_EXECUTION_FILES:
        selected.update({
            "tests/unit/test_analysis_records.py", "tests/unit/test_route_verification.py",
            "tests/unit/test_assessment_routes.py", "tests/unit/test_optimization_api.py",
        })
    if roots & CHEMICAL_FILE_FILES:
        selected.update(CHEMICAL_FILE_TESTS)
    if roots & CI_FILES:
        selected.update(CI_SAFETY_TESTS)
    if any(path.startswith("packages/workspace/") for path in roots) or roots & (
        {"apps/api/document_routes.py", "apps/api/structure_routes.py"}
    ):
        selected.update(WORKSPACE_TESTS)
    if roots & {
        "packages/workspace/route_graph.py",
        "packages/workspace/route_repository.py",
        "packages/chemistry/material_scope.py",
        "apps/api/document_routes.py",
    }:
        selected.add("tests/unit/test_document_material_scope.py")
    if "apps/api/app.py" in roots:
        # Direct API consumers only, not the API's entire transitive engine tree.
        for snapshot in (before, after):
            for path in snapshot.files:
                if (
                    path.startswith("tests/unit/test_")
                    and path.endswith(".py")
                    and path in after.files
                    and "apps.api.app" in analysis.python_imports(snapshot.text(path))
                ):
                    selected.add(path)
    if (
        any(path.startswith(SOURCE) and not path.endswith(".test.js") for path in roots)
        or roots & WEB_BUILD_FILES
    ):
        selected.add(CONTRACT_TEST)
    if "NOTICE" in roots:
        selected.add("tests/unit/test_public_source_export.py")
    if roots & MANIFESTS or "VERSION" in roots:
        selected.add(VERSION_TEST)
    missing = selected - after.files
    if missing:
        raise analysis.ScopeError(
            "Mapped tests are missing; repair scope rather than skip: "
            + ", ".join(sorted(missing))
        )
    return sorted(selected - ORD_TESTS)


def reaction_data_tests(paths: set[str]) -> list[str]:
    return (
        sorted(ORD_TESTS)
        if paths
        & (ORD_FILES | ORD_TESTS | REACTION_FIXTURES | REFERENCE_FILES | CI_FILES)
        else []
    )


def npm_dependency_changes(before, after, paths: set[str]) -> set[str]:
    if not paths & {WEB + "package.json", WEB + "package-lock.json"}:
        return set()
    old, new = (
        json.loads(snapshot.text(WEB + "package.json")) for snapshot in (before, after)
    )
    direct = analysis.differing(
        old.get("dependencies", {}), new.get("dependencies", {})
    )
    metadata = [
        {
            key: value
            for key, value in package.items()
            if key not in {"dependencies", "version"}
        }
        for package in (old, new)
    ]
    if metadata[0] != metadata[1]:
        raise analysis.ScopeError(
            "Unmapped npm scripts/tooling/dev dependency changes; extend the scope mapping."
        )
    if WEB + "package-lock.json" not in paths:
        return direct
    locks = [
        json.loads(snapshot.text(WEB + "package-lock.json"))
        for snapshot in (before, after)
    ]
    for manifest, lock in zip((old, new), locks):
        if lock.get("lockfileVersion") != 3 or lock["packages"][""].get(
            "dependencies", {}
        ) != manifest.get("dependencies", {}):
            raise analysis.ScopeError(
                "npm lock must use v3 and match its production manifest."
            )
        if lock["packages"][""].get("devDependencies", {}) != manifest.get(
            "devDependencies", {}
        ):
            raise analysis.ScopeError(
                "npm lock must match its dev dependency manifest."
            )
    root_metadata = [
        {
            key: value
            for key, value in lock["packages"][""].items()
            if key not in {"dependencies", "version"}
        }
        for lock in locks
    ]
    if root_metadata[0] != root_metadata[1]:
        raise analysis.ScopeError("Unmapped npm root lock metadata/tooling changes.")
    lock_metadata = [
        {
            key: value
            for key, value in lock.items()
            if key not in {"packages", "version"}
        }
        for lock in locks
    ]
    if lock_metadata[0] != lock_metadata[1]:
        raise analysis.ScopeError("Unmapped npm lock metadata changes.")
    entries = [lock["packages"] for lock in locks]
    changed = analysis.differing(*entries) - {""}
    covered = set()
    for name in old.get("dependencies", {}).keys() | new.get("dependencies", {}).keys():
        reachable = analysis.lock_closure(entries[0], name) | analysis.lock_closure(
            entries[1], name
        )
        if reachable & changed:
            direct.add(name)
            covered.update(reachable & changed)
    if changed - covered:
        raise analysis.ScopeError(
            "Unmapped dev-only npm lock entries; add a focused tooling scope: "
            + ", ".join(sorted(changed - covered))
        )
    return direct


def frontend_tests(before, after, paths: set[str]) -> tuple[list[str], dict]:
    dependencies = npm_dependency_changes(before, after, paths)
    roots = {path for path in paths if path.startswith(SOURCE)}
    if not roots and not dependencies:
        return [], {}
    graph = defaultdict(set)
    current_graph = {}
    importers = {name: set() for name in dependencies}
    for snapshot in (before, after):
        records = analysis.parse_frontend(snapshot)
        snapshot_graph = analysis.frontend_graph(records, snapshot.files)
        if snapshot is after:
            current_graph = snapshot_graph
        for owner, related in snapshot_graph.items():
            graph[owner].update(related)
        for owner, record in records.items():
            if owner.endswith(".test.js"):
                continue
            if record["dynamic"] and (dependencies or owner in paths):
                raise analysis.ScopeError(
                    f"Computed production imports require an explicit dependency mapping: {owner}"
                )
            for specifier in record["imports"]:
                name = analysis.npm_package(specifier)
                if name in importers:
                    importers[name].add(owner)
    # Test unchanged direct helpers without pulling in their sibling consumers.
    # Reverse traversal below covers all indirect consumers of actual changes.
    direct = {
        dependency
        for owner in roots
        if not owner.endswith(".test.js")
        for dependency in current_graph.get(owner, ())
    }
    old_manifest = (
        json.loads(before.text(WEB + "package.json"))["dependencies"]
        if dependencies
        else {}
    )
    new_manifest = (
        json.loads(after.text(WEB + "package.json"))["dependencies"]
        if dependencies
        else {}
    )
    for name, owners in importers.items():
        if not owners and (name not in old_manifest or name in new_manifest):
            raise analysis.ScopeError(
                f"No production imports found for changed npm dependency {name}; map its non-import consumer explicitly."
            )
        roots.update(owners)
    inverse = defaultdict(set)
    for owner, related in graph.items():
        for dependency in related:
            inverse[dependency].add(owner)
    pending, reached = list(roots), set(roots)
    while pending:
        for owner in inverse[pending.pop()] - reached:
            reached.add(owner)
            pending.append(owner)
    selected = {
        path for path in reached if path.endswith(".test.js") and path in after.files
    }
    for dependency in direct:
        paired_test = str(PurePosixPath(dependency).with_suffix(".test.js"))
        if paired_test in after.files and paired_test in inverse[dependency]:
            selected.add(paired_test)
    for test, prefixes in SOURCE_READERS.items():
        if test in after.files and any(root.startswith(prefixes) for root in roots):
            selected.add(test)
    return sorted(selected), {
        name: sorted(owners) for name, owners in sorted(importers.items())
    }
