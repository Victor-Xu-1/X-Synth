"""Reviewed workspace allowlist and narrow, fail-closed test selection rules."""

from __future__ import annotations

import json
import tomllib
from collections import defaultdict
from pathlib import PurePosixPath

from . import ci_scope_dependencies as analysis

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
    "apps/api/app.py",
    "apps/api/document_routes.py",
    "apps/api/structure_routes.py",
    "apps/api/environment_routes.py",
    "apps/api/native_routes.py",
    "apps/api/data_routes.py",
    "apps/api/job_views.py",
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
HISTORY_FILES = {"apps/api/job_views.py", "packages/workspace/history_projection.py"}
WEB_BUILD_FILES = {WEB + name for name in ("index.html", "vite.config.js")}
WEB_TEST_TOOLING = {WEB + "jest.config.js"}
FRONTEND_API_TESTS = {SOURCE + "composables/useTemplateSearch.test.js"}
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
            | WEB_BUILD_FILES
            | WEB_TEST_TOOLING
            | ENVIRONMENT_FILES
            | NATIVE_CAPABILITY_FILES
            | TEMPLATE_FILES
            | HISTORY_FILES
            | {
                PYTHON_LOCK,
                "VERSION",
            }
        )
        known |= path.startswith("packages/workspace/") and suffix == ".py"
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
    if roots & ENVIRONMENT_FILES:
        selected.add("tests/unit/test_environment_api.py")
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
            }
        )
    if roots & CI_FILES:
        selected.update(CI_SAFETY_TESTS)
    if any(path.startswith("packages/workspace/") for path in roots) or roots & (
        {"apps/api/document_routes.py", "apps/api/structure_routes.py"}
    ):
        selected.update(WORKSPACE_TESTS)
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
    return sorted(selected)


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
    # One direct production dependency layer, not the entire downstream tree.
    # Reverse traversal below still covers indirect consumers of changed code.
    direct = {
        dependency
        for owner in roots
        if not owner.endswith(".test.js")
        for dependency in current_graph.get(owner, ())
    }
    roots.update(direct)
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
    for test, prefixes in SOURCE_READERS.items():
        if test in after.files and any(root.startswith(prefixes) for root in roots):
            selected.add(test)
    return sorted(selected), {
        name: sorted(owners) for name, owners in sorted(importers.items())
    }
