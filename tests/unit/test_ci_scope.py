"""Focused regression for diff selection, dependency scope, and CI invocation."""

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from scripts.diagnostics import ci_scope as scope
from scripts.diagnostics import ci_scope_dependencies as dependencies
from scripts.diagnostics import ci_scope_profile as profile


def snapshot(tmp_path, content):
    return SimpleNamespace(root=tmp_path, files=set(content), text=content.__getitem__)


def manifest(dependencies=None, **extra):
    return {
        "name": "x-synth-web",
        "version": "0.1.0",
        "dependencies": dependencies or {},
        **extra,
    }


def npm_snapshot(tmp_path, package, entries=None):
    content = {profile.WEB + "package.json": json.dumps(package)}
    if entries is not None:
        lock = {
            "name": "x-synth-web",
            "version": "0.1.0",
            "lockfileVersion": 3,
            "packages": {
                "": {"version": "0.1.0", "dependencies": package["dependencies"]},
                **entries,
            },
        }
        content[profile.WEB + "package-lock.json"] = json.dumps(lock)
    return snapshot(tmp_path, content)


def record(imports=(), files=(), dynamic=False):
    return {"imports": list(imports), "files": list(files), "dynamic": dynamic}


def mock_frontend(monkeypatch, before, after, old_records, new_records):
    monkeypatch.setattr(
        dependencies,
        "parse_frontend",
        lambda item: old_records if item is before else new_records,
    )
    return profile.frontend_tests(
        before, after, {profile.SOURCE + "common/route-graph.js"}
    )


@pytest.mark.parametrize(
    "path",
    [
        ".github/workflows/ci.yml",
        "scripts/diagnostics/ci_scope.py",
        "tests/unit/test_ci_scope.py",
        "scripts/diagnostics/ci_scope_profile.py",
        "scripts/diagnostics/ci_scope_dependencies.py",
        "apps/api/document_routes.py",
        "apps/api/environment_routes.py",
        "packages/platform/environments.py",
        "packages/workspace/new_document_module.py",
        "apps/web/src/views/workspace/NewView.vue",
        "apps/web/src/common/unified-route.js",
        "apps/web/src/styles/workbench.css",
        "apps/web/src/assets/logo.png",
        "README.md",
        "NOTICE",
        "requirements/orchestrator-linux-py312.lock",
    ],
)
def test_workspace_profile_accepts_explicitly_scoped_paths(path):
    profile.guard_paths({path})


@pytest.mark.parametrize(
    "path",
    [
        "packages/orchestrator/pipeline.py",
        "apps/askcos-v2/askcos2_core/api.py",
        "scripts/operations/serve_platform.py",
        "requirements/askcos-runtime-linux-py312.lock",
        ".github/workflows/deploy.yml",
        "tests/unit/conftest.py",
        "apps/web/jest.config.js",
        "apps/web/src/unknown.wasm",
        "private/runtime.json",
    ],
)
def test_unknown_changes_fail_instead_of_skip_or_global_fallback(path):
    with pytest.raises(dependencies.ScopeError, match="Unmapped changes"):
        profile.guard_paths({path})


def test_python_workspace_maps_document_contracts_not_native_engine_suite(tmp_path):
    files = {path: "pass" for path in profile.WORKSPACE_TESTS}
    before = snapshot(tmp_path, files)
    after = snapshot(tmp_path, {**files, "packages/workspace/route_graph.py": "pass"})
    assert profile.python_tests(
        before, after, {"packages/workspace/route_graph.py"}
    ) == sorted(profile.WORKSPACE_TESTS)


def test_environment_changes_select_only_environment_contracts(tmp_path):
    files = {
        "tests/unit/test_environment_api.py": "pass",
        **{path: "pass" for path in profile.WORKSPACE_TESTS},
        "tests/unit/test_askcos_adapter.py": "pass",
    }
    item = snapshot(tmp_path, files)
    assert profile.python_tests(item, item, profile.ENVIRONMENT_FILES) == [
        "tests/unit/test_environment_api.py"
    ]


def test_api_selects_actual_direct_consumers_including_nested_imports(tmp_path):
    files = {
        "tests/unit/test_product_api_security.py": "from apps.api.app import create_app",
        profile.VERSION_TEST: "def test_version():\n    from apps.api.app import create_app",
        "tests/unit/test_native_drawing_proxy.py": "from apps.api.app import create_app",
        "tests/unit/test_askcos_adapter.py": "from packages.adapters.askcos import Client",
    }
    item = snapshot(tmp_path, files)
    selected = profile.python_tests(item, item, {"apps/api/app.py"})
    assert selected == sorted(set(files) - {"tests/unit/test_askcos_adapter.py"})


def test_frontend_contract_and_product_metadata_have_explicit_python_scopes(tmp_path):
    files = {profile.CONTRACT_TEST: "pass", profile.VERSION_TEST: "pass"}
    item = snapshot(tmp_path, files)
    assert profile.python_tests(
        item, item, {profile.SOURCE + "common/unified-route.js"}
    ) == [profile.CONTRACT_TEST]
    assert profile.python_tests(item, item, {profile.WEB + "package.json"}) == [
        profile.VERSION_TEST
    ]
    assert (
        profile.python_tests(
            item, item, {profile.SOURCE + "common/route-graph.test.js"}
        )
        == []
    )


def test_ci_changes_select_selector_and_source_safety_without_global_tests(tmp_path):
    item = snapshot(tmp_path, {path: "pass" for path in profile.CI_SAFETY_TESTS})
    assert profile.python_tests(item, item, profile.CI_FILES) == sorted(
        profile.CI_SAFETY_TESTS
    )
    with pytest.raises(dependencies.ScopeError, match="Mapped tests are missing"):
        profile.python_tests(item, item, {"packages/workspace/route_repository.py"})


def test_selector_source_is_allowed_in_public_export():
    from scripts.operations.export_public_source import is_public_source

    assert is_public_source("scripts/diagnostics/ci_scope.py")
    assert is_public_source("tests/unit/test_ci_scope.py")
    assert is_public_source("scripts/diagnostics/ci_scope_profile.py")
    assert is_public_source("scripts/diagnostics/ci_scope_dependencies.py")


def test_notice_changes_select_source_publication_check_only(tmp_path):
    item = snapshot(tmp_path, {"tests/unit/test_public_source_export.py": "pass"})
    assert profile.python_tests(item, item, {"NOTICE"}) == [
        "tests/unit/test_public_source_export.py"
    ]


def test_changed_python_test_is_explicit_and_deleted_test_is_not_run(tmp_path):
    path = "tests/unit/test_route_documents.py"
    before = snapshot(tmp_path, {path: "pass"})
    after = snapshot(tmp_path, {})
    assert profile.python_tests(before, before, {path}) == [path]
    assert profile.python_tests(before, after, {path}) == []


def test_networkx_changes_select_real_workspace_importers(tmp_path):
    project = "[project]\ndependencies = {}\n"
    old = {"pyproject.toml": project.format("[]"), profile.PYTHON_LOCK: "# empty\n"}
    new = {
        "pyproject.toml": project.format('["networkx==3.6.1"]'),
        profile.PYTHON_LOCK: "networkx==3.6.1 \\\n    --hash=sha256:abc\n    # via x-synth\n",
        "packages/workspace/route_graph.py": "import networkx as nx",
    }
    before, after = snapshot(tmp_path, old), snapshot(tmp_path, new)
    assert profile.python_dependency_roots(
        before, after, {"pyproject.toml", profile.PYTHON_LOCK}
    ) == {"packages/workspace/route_graph.py"}


def test_python_lock_only_change_uses_actual_imports_not_all_tests(tmp_path):
    files = {
        profile.PYTHON_LOCK: "networkx==3.6.0 --hash=sha256:aaa\n",
        "packages/workspace/route_graph.py": "import networkx",
    }
    before = snapshot(tmp_path, files)
    after = snapshot(
        tmp_path, {**files, profile.PYTHON_LOCK: "networkx==3.6.1 --hash=sha256:bbb\n"}
    )
    assert profile.python_dependency_roots(before, after, {profile.PYTHON_LOCK}) == {
        "packages/workspace/route_graph.py"
    }


@pytest.mark.parametrize("change", ["dependency", "metadata", "missing_import"])
def test_unmapped_python_dependency_or_metadata_fails(tmp_path, change):
    old = {"pyproject.toml": '[project]\nname="x-synth"\ndependencies=[]\n'}
    text = old["pyproject.toml"]
    if change == "dependency":
        text = text.replace("[]", '["unknown==1.0"]')
    elif change == "metadata":
        text = text.replace("x-synth", "another-product")
    else:
        text = text.replace("[]", '["networkx==3.6.1"]')
    with pytest.raises(dependencies.ScopeError):
        profile.python_dependency_roots(
            snapshot(tmp_path, old),
            snapshot(tmp_path, {"pyproject.toml": text}),
            {"pyproject.toml"},
        )


@pytest.mark.parametrize(
    "entry", ["--index-url https://example.com", "thing>=1", "thing==1 --editable ."]
)
def test_unknown_python_lock_syntax_is_not_ignored(entry):
    with pytest.raises(dependencies.ScopeError):
        dependencies.lock_requirements(entry)


def test_frontend_graph_resolves_multilevel_imports_and_static_source_reads():
    module = profile.SOURCE + "common/route-graph.js"
    component = profile.SOURCE + "components/routes/RouteGraph.vue"
    test = profile.SOURCE + "components/routes/RouteGraph.test.js"
    files = {module, component, test}
    records = {
        component: record(["@/common/route-graph"]),
        test: record(files=["RouteGraph.vue"]),
    }
    graph = dependencies.frontend_graph(records, files)
    assert graph[component] == {module}
    assert graph[test] == {component}


def test_frontend_union_covers_deleted_modules_and_keeps_only_existing_tests(
    tmp_path, monkeypatch
):
    old_module = profile.SOURCE + "common/graph.js"
    test = profile.SOURCE + "common/route-graph.test.js"
    obsolete = profile.SOURCE + "components/home/Launchpad.test.js"
    before = snapshot(tmp_path, {old_module: "pass", test: "pass", obsolete: "pass"})
    after = snapshot(tmp_path, {test: "pass"})
    monkeypatch.setattr(
        dependencies,
        "parse_frontend",
        lambda item: (
            {test: record(["./graph.js"])} if item is before else {test: record()}
        ),
    )
    tests, _ = profile.frontend_tests(before, after, {old_module, obsolete})
    assert tests == [test]


def test_frontend_selects_direct_transitive_and_source_boundary_tests(
    tmp_path, monkeypatch
):
    module = profile.SOURCE + "common/route-graph.js"
    component = profile.SOURCE + "components/routes/RouteGraph.vue"
    test = profile.SOURCE + "components/routes/RouteGraph.test.js"
    unrelated = profile.SOURCE + "common/route-price.test.js"
    boundary = profile.SOURCE + "common/source-boundary.test.js"
    files = {path: "pass" for path in (module, component, test, unrelated, boundary)}
    before, after = snapshot(tmp_path, files), snapshot(tmp_path, files)
    records = {
        component: record(["@/common/route-graph"]),
        test: record(files=["RouteGraph.vue"]),
        unrelated: record(),
        boundary: record(),
    }
    tests, _ = mock_frontend(monkeypatch, before, after, records, records)
    assert tests == sorted([test, boundary])


def test_direct_production_helpers_are_selected_but_not_their_entire_dependency_tree(
    tmp_path, monkeypatch
):
    component = profile.SOURCE + "components/KetcherModal.vue"
    helper = profile.SOURCE + "common/ketcher.js"
    grandchild = profile.SOURCE + "common/unrelated.js"
    helper_test = profile.SOURCE + "common/ketcher.test.js"
    unrelated_test = profile.SOURCE + "common/unrelated.test.js"
    files = {
        path: "pass"
        for path in (component, helper, grandchild, helper_test, unrelated_test)
    }
    item = snapshot(tmp_path, files)
    records = {
        component: record(["../common/ketcher"]),
        helper: record(["./unrelated"]),
        helper_test: record(["./ketcher"]),
        unrelated_test: record(["./unrelated"]),
    }
    monkeypatch.setattr(dependencies, "parse_frontend", lambda item: records)
    assert profile.frontend_tests(item, item, {component})[0] == [helper_test]


def test_deleted_component_does_not_expand_into_its_retired_helper_tree(
    tmp_path, monkeypatch
):
    component = profile.SOURCE + "components/home/Launchpad.vue"
    helper = profile.SOURCE + "common/ketcher.js"
    test = profile.SOURCE + "common/ketcher.test.js"
    before = snapshot(tmp_path, {component: "pass", helper: "pass", test: "pass"})
    after = snapshot(tmp_path, {helper: "pass", test: "pass"})
    old = {component: record(["@/common/ketcher"]), test: record(["./ketcher"])}
    new = {test: record(["./ketcher"])}
    monkeypatch.setattr(
        dependencies, "parse_frontend", lambda item: old if item is before else new
    )
    assert profile.frontend_tests(before, after, {component})[0] == []


def test_source_reader_literals_cover_auxiliary_views_and_nonpaired_store_tests():
    auxiliary = profile.SOURCE + "views/login/auxiliary-views.test.js"
    store_test = profile.SOURCE + "store/results-unified.test.js"
    view = profile.SOURCE + "views/admin/Admin.vue"
    store = profile.SOURCE + "store/results.js"
    files = {auxiliary, store_test, view, store}
    graph = dependencies.frontend_graph(
        {
            auxiliary: record(files=["admin/Admin.vue"]),
            store_test: record(files=["results.js"]),
        },
        files,
    )
    assert graph[auxiliary] == {view}
    assert graph[store_test] == {store}


def test_unresolved_frontend_import_fails_before_test_execution():
    with pytest.raises(dependencies.ScopeError, match="Unresolved local import"):
        dependencies.frontend_graph(
            {profile.SOURCE + "main.js": record(["@/missing"])}, set()
        )


def test_npm_direct_dependency_change_reaches_actual_production_imports(
    tmp_path, monkeypatch
):
    module = profile.SOURCE + "common/route-graph.js"
    test = profile.SOURCE + "common/route-graph.test.js"
    before = npm_snapshot(tmp_path, manifest())
    after = npm_snapshot(tmp_path, manifest({"@dagrejs/dagre": "3.1.1"}))
    before.files.update({module, test})
    after.files.update({module, test})
    records = {module: record(["@dagrejs/dagre"]), test: record(["./route-graph"])}
    monkeypatch.setattr(dependencies, "parse_frontend", lambda item: records)
    tests, imports = profile.frontend_tests(
        before, after, {profile.WEB + "package.json"}
    )
    assert tests == [test]
    assert imports == {"@dagrejs/dagre": [module]}


def test_npm_lock_only_transitive_changes_follow_production_roots(tmp_path):
    package = manifest({"@dagrejs/dagre": "3.1.1", "unrelated": "1"})
    entries = {
        "node_modules/@dagrejs/dagre": {
            "version": "3.1.1",
            "dependencies": {"graphlib": "1"},
        },
        "node_modules/graphlib": {"version": "1"},
        "node_modules/unrelated": {"version": "1"},
    }
    before = npm_snapshot(tmp_path, package, entries)
    after = npm_snapshot(
        tmp_path, package, {**entries, "node_modules/graphlib": {"version": "2"}}
    )
    assert profile.npm_dependency_changes(
        before, after, {profile.WEB + "package-lock.json"}
    ) == {"@dagrejs/dagre"}


def test_lock_resolution_handles_scoped_nested_and_hoisted_modules():
    entries = {
        "node_modules/@vue-flow/core": {
            "dependencies": {"@vue-flow/shared": "1", "vue": "3"}
        },
        "node_modules/@vue-flow/core/node_modules/@vue-flow/shared": {
            "dependencies": {"vue": "3"}
        },
        "node_modules/vue": {"version": "3"},
    }
    assert dependencies.lock_closure(entries, "@vue-flow/core") == set(entries)


def test_lock_shared_production_dependency_selects_all_actual_direct_consumers(
    tmp_path,
):
    package = manifest({"left": "1", "right": "1"})
    entries = {
        "node_modules/left": {"dependencies": {"shared": "1"}},
        "node_modules/right": {"dependencies": {"shared": "1"}},
        "node_modules/shared": {"version": "1"},
    }
    before = npm_snapshot(tmp_path, package, entries)
    after = npm_snapshot(
        tmp_path, package, {**entries, "node_modules/shared": {"version": "2"}}
    )
    assert profile.npm_dependency_changes(
        before, after, {profile.WEB + "package-lock.json"}
    ) == {"left", "right"}


def test_unmapped_dev_only_lock_changes_fail_not_full_test(tmp_path):
    before = npm_snapshot(
        tmp_path, manifest(), {"node_modules/jest": {"version": "1", "dev": True}}
    )
    after = npm_snapshot(
        tmp_path, manifest(), {"node_modules/jest": {"version": "2", "dev": True}}
    )
    with pytest.raises(dependencies.ScopeError, match="dev-only"):
        profile.npm_dependency_changes(
            before, after, {profile.WEB + "package-lock.json"}
        )


@pytest.mark.parametrize(
    "extra", [{"scripts": {"test": "jest --all"}}, {"devDependencies": {"jest": "30"}}]
)
def test_npm_test_tooling_requires_explicit_scope(tmp_path, extra):
    with pytest.raises(dependencies.ScopeError, match="Unmapped npm"):
        profile.npm_dependency_changes(
            npm_snapshot(tmp_path, manifest()),
            npm_snapshot(tmp_path, manifest(**extra)),
            {profile.WEB + "package.json"},
        )


@pytest.mark.parametrize("dynamic", [False, True])
def test_untraceable_new_npm_dependency_fails(tmp_path, monkeypatch, dynamic):
    before, after = (
        npm_snapshot(tmp_path, manifest()),
        npm_snapshot(tmp_path, manifest({"html-to-image": "1"})),
    )
    monkeypatch.setattr(
        dependencies,
        "parse_frontend",
        lambda item: {profile.SOURCE + "main.js": record(dynamic=dynamic)},
    )
    with pytest.raises(dependencies.ScopeError, match="production imports"):
        profile.frontend_tests(before, after, {profile.WEB + "package.json"})


def test_removed_unused_dependency_keeps_build_audit_gate_without_fake_tests(
    tmp_path, monkeypatch
):
    before, after = (
        npm_snapshot(tmp_path, manifest({"unused": "1"})),
        npm_snapshot(tmp_path, manifest()),
    )
    monkeypatch.setattr(dependencies, "parse_frontend", lambda item: {})
    assert profile.frontend_tests(before, after, {profile.WEB + "package.json"}) == (
        [],
        {"unused": []},
    )


def test_parser_uses_structured_existing_apis_and_propagates_failure(
    tmp_path, monkeypatch
):
    item = snapshot(
        tmp_path,
        {profile.SOURCE + "App.vue": "<script setup>import x from './x'</script>"},
    )
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            stdout=json.dumps({profile.SOURCE + "App.vue": record(["./x"])})
        )

    monkeypatch.setattr(scope.subprocess, "run", run)
    assert dependencies.parse_frontend(item)[profile.SOURCE + "App.vue"]["imports"] == [
        "./x"
    ]
    assert "@babel/parser" in calls[0][0][2] and "@vue/compiler-sfc" in calls[0][0][2]
    assert calls[0][1]["cwd"] == tmp_path / "apps/web"
    assert json.loads(calls[0][1]["input"]) == {
        profile.SOURCE + "App.vue": item.text(profile.SOURCE + "App.vue")
    }

    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "node", stderr="syntax error")

    monkeypatch.setattr(scope.subprocess, "run", fail)
    with pytest.raises(
        dependencies.ScopeError, match="Frontend AST parser failed: syntax error"
    ):
        dependencies.parse_frontend(item)


def repo_git(root, *args):
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def git_repo(tmp_path):
    repo_git(tmp_path, "init", "-b", "main")
    repo_git(tmp_path, "config", "user.email", "ci-scope@example.invalid")
    repo_git(tmp_path, "config", "user.name", "CI Scope Test")
    (tmp_path / "README.md").write_text("base", encoding="utf-8")
    repo_git(tmp_path, "add", ".")
    repo_git(tmp_path, "commit", "-m", "base")
    return tmp_path


def commit(root, path, text):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    repo_git(root, "add", ".")
    repo_git(root, "commit", "-m", path)
    return repo_git(root, "rev-parse", "HEAD")


def test_pr_uses_merge_base_excluding_main_only_changes(git_repo):
    common = repo_git(git_repo, "rev-parse", "HEAD")
    base = commit(git_repo, "main-only.md", "main")
    repo_git(git_repo, "checkout", "-b", "feature", common)
    head = commit(git_repo, "apps/web/src/App.vue", "feature")
    selected_base, selected_head = scope.event_revisions(
        git_repo, {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
    )
    assert (selected_base, selected_head) == (common, head)
    assert scope.changed_paths(git_repo, selected_base, selected_head) == {
        "apps/web/src/App.vue"
    }


def test_main_push_compares_before_after_across_all_pushed_commits(git_repo):
    before = repo_git(git_repo, "rev-parse", "HEAD")
    commit(git_repo, "apps/web/src/App.vue", "one")
    after = commit(git_repo, "apps/api/app.py", "two")
    assert scope.event_revisions(git_repo, {"before": before, "after": after}) == (
        before,
        after,
    )
    assert scope.changed_paths(git_repo, before, after) == {
        "apps/web/src/App.vue",
        "apps/api/app.py",
    }


def test_renames_are_old_and_new_paths_and_deleted_sources_survive_base_snapshot(
    git_repo,
):
    before = repo_git(git_repo, "rev-parse", "HEAD")
    repo_git(git_repo, "mv", "README.md", "renamed.md")
    repo_git(git_repo, "commit", "-m", "rename")
    after = repo_git(git_repo, "rev-parse", "HEAD")
    assert scope.changed_paths(git_repo, before, after) == {"README.md", "renamed.md"}
    assert scope.Snapshot(git_repo, before).text("README.md") == "base"
    assert "README.md" not in scope.Snapshot(git_repo, after).files


def test_worktree_preview_includes_staged_untracked_and_deleted_paths(git_repo):
    base = repo_git(git_repo, "rev-parse", "HEAD")
    (git_repo / "README.md").unlink()
    (git_repo / "new.md").write_text("new", encoding="utf-8")
    (git_repo / "staged.md").write_text("staged", encoding="utf-8")
    repo_git(git_repo, "add", "staged.md")
    assert scope.changed_paths(git_repo, base, None) == {
        "README.md",
        "new.md",
        "staged.md",
    }
    assert scope.Snapshot(git_repo, None).files == {"new.md", "staged.md"}


@pytest.mark.parametrize(
    "event",
    [
        {},
        {"before": "0" * 40, "after": "HEAD"},
        {"before": "missing-ref", "after": "HEAD"},
    ],
)
def test_missing_event_base_is_fatal(git_repo, event):
    with pytest.raises((dependencies.ScopeError, subprocess.CalledProcessError)):
        scope.event_revisions(git_repo, event)


def test_empty_scope_never_invokes_pytest_or_npm_and_exact_paths_are_used():
    assert scope.test_command("python", []) == []
    assert scope.test_command("frontend", []) == []
    assert scope.test_command("python", [profile.SCOPE_TEST])[-1] == profile.SCOPE_TEST
    command = scope.test_command(
        "frontend", [profile.SOURCE + "common/route-graph.test.js"]
    )
    assert "--runTestsByPath" in command and "--coverage=false" in command
    assert command[-1] == "src/common/route-graph.test.js"


def test_cli_unknown_change_fails_before_running_tests(git_repo, monkeypatch, capsys):
    (git_repo / "unknown.py").write_text("pass", encoding="utf-8")
    monkeypatch.chdir(git_repo)
    assert (
        scope.main(["--base", "HEAD", "--worktree", "--suite", "python", "--run"]) == 2
    )
    assert "Unmapped changes" in capsys.readouterr().err


def test_cli_empty_scope_run_does_not_spawn_test_process(git_repo, monkeypatch, capsys):
    monkeypatch.chdir(git_repo)
    assert (
        scope.main(["--base", "HEAD", "--worktree", "--suite", "frontend", "--run"])
        == 0
    )
    output = json.loads(capsys.readouterr().out)
    assert output == []


def test_cli_run_prints_only_test_list_and_propagates_test_failure(
    git_repo, monkeypatch, capsys
):
    for path in profile.CI_SAFETY_TESTS:
        target = git_repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("pass", encoding="utf-8")
    repo_git(git_repo, "add", ".")
    repo_git(git_repo, "commit", "-m", "source safety fixtures")
    (git_repo / profile.SCOPE_TEST).write_text(
        "# changed selector test\\npass", encoding="utf-8"
    )
    monkeypatch.chdir(git_repo)
    actual_run = subprocess.run
    invocations = []

    def run(args, **kwargs):
        if args[1:3] == ["-m", "pytest"]:
            invocations.append(args)
            return SimpleNamespace(returncode=7)
        return actual_run(args, **kwargs)

    monkeypatch.setattr(scope.subprocess, "run", run)
    assert (
        scope.main(["--base", "HEAD", "--worktree", "--suite", "python", "--run"]) == 7
    )
    assert json.loads(capsys.readouterr().out) == sorted(profile.CI_SAFETY_TESTS)
    assert invocations[0][-3:] == sorted(profile.CI_SAFETY_TESTS)


def test_workflow_preserves_mandatory_gates_and_only_runs_scoped_tests():
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load(
        (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    )
    jobs = workflow["jobs"]
    for name in ("python", "frontend"):
        steps = jobs[name]["steps"]
        checkout = next(
            step
            for step in steps
            if step.get("uses", "").startswith("actions/checkout@")
        )
        assert checkout["with"]["fetch-depth"] == 0
        assert "pull_request.head.sha" in checkout["with"]["ref"]
        runs = [step["run"] for step in steps if "run" in step]
        assert any(
            f"--suite {name} --run" in run
            and '--github-event "$GITHUB_EVENT_PATH"' in run
            for run in runs
        )
        assert not any(
            run.strip().startswith(("python -m pytest", "npm test")) for run in runs
        )
    python_runs = [step.get("run", "") for step in jobs["python"]["steps"]]
    web_runs = [step.get("run", "") for step in jobs["frontend"]["steps"]]
    assert "python -m pip check" in python_runs
    assert "npm run build" in web_runs
    assert "npm audit --omit=dev --audit-level=high" in web_runs
