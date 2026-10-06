"""Safe environment projection and real product-route security contracts."""

import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from apps.api.app import create_app
from packages.platform import (
    environment_dependencies,
    native_capabilities,
    native_capability_catalog,
)
from packages.platform.environments import ENGINE_SERVICES, environment_snapshot


def snapshot(health, runtime=None, models="pistachio,pistachio_ringbreaker"):
    return environment_snapshot(
        health=health, runtime=runtime or {}, configured_models=models
    )


@pytest.mark.parametrize(
    ("health", "expected"),
    [
        ({"backends": {"askcos_v2": True}}, "ready"),
        ({"service_checks": {"gateway": True}}, "degraded"),
        ({"service_checks": {"commercial_stock": True}}, "unavailable"),
        ({}, "unavailable"),
    ],
)
def test_engine_status_requires_actual_backend_probes(health, expected):
    assert snapshot(health)["engines"][0]["status"] == expected


def test_running_processes_do_not_claim_model_or_worker_readiness():
    health = {"backends": {"askcos_v2": False}, "worker_ready": False}
    runtime = {"resources": {"services": {"mcts": {"status": "running"}}}}
    result = snapshot(health, runtime)
    assert result["engines"][0]["runtime_mode"] == "supervised_native"
    assert result["engines"][0]["status"] == "unavailable"
    assert result["engines"][0]["models_verified"] is False
    assert result["health"]["worker_ready"] is False


def test_config_projection_lists_only_known_models_without_leaking_unknown_values():
    secret = "invalid-private-configuration-value"
    result = snapshot(
        {"version": "0.1.0", "auth_mode": "local"},
        models=f" pistachio, {secret}, pistachio, ",
    )
    engine = result["engines"][0]
    assert engine["configured_models"] == ["pistachio"]
    assert engine["unrecognized_model_count"] == 1
    assert secret not in json.dumps(result)
    assert result["platform"]["access_mode"] == "local"
    assert result["platform"]["name"] == "X-Synth"
    assert result["platform"]["entrypoint"] == "scripts.operations.serve_platform"


def test_projection_reuses_authoritative_health_and_runtime_without_mutation():
    health = {
        "backends": {"askcos_v2": True},
        "worker_ready": False,
        "service_checks": {"configured_models_loaded": True},
        "available_strategies": ["retro_star"],
        "stock_snapshot": {"catalog_sha256": "a" * 64},
    }
    runtime = {"budget": {"active_jobs": 1}, "resources": {"rss_bytes": 123}}
    before = json.dumps([health, runtime])
    result = snapshot(health, runtime)
    assert result["schema_version"] == 1
    assert result["health"] is health
    assert result["runtime"] is runtime
    assert result["engines"][0]["models_verified"] is True
    assert result["engines"][0]["available_strategies"] == ["retro_star"]
    assert result["engines"][0]["service_ids"] == list(ENGINE_SERVICES)
    assert json.dumps([health, runtime]) == before


def test_real_environment_api_is_authenticated_read_only_and_shares_runtime(tmp_path):
    application = create_app(jobs_root=tmp_path)
    browser = TestClient(
        application, base_url="http://127.0.0.1", client=("127.0.0.1", 1234)
    )
    response = browser.get("/api/v1/environments")
    assert response.status_code == 200
    result = response.json()
    assert result["schema_version"] == 1
    assert result["platform"]["name"] == "X-Synth"
    assert result["platform"]["version"] == "0.1.0"
    assert len(result["engines"]) == 1
    assert result["engines"][0]["id"] == "askcos_v2"
    assert result["health"]["service"] == "x-synth"
    assert result["runtime"] == browser.get("/api/v1/runtime").json()
    assert application.state.repository.count("local_workspace") == 0
    assert (
        browser.post("/api/v1/environments", json={"command": "restart"}).status_code
        == 404
    )
    for headers in (
        {"Origin": "https://attacker.example"},
        {"Host": "attacker.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ):
        assert browser.get("/api/v1/environments", headers=headers).status_code == 403
    remote = TestClient(
        application, base_url="http://127.0.0.1", client=("192.0.2.1", 1234)
    )
    assert remote.get("/api/v1/environments").status_code == 403


def test_inventory_separates_source_modules_and_inactive_integrations():
    result = snapshot(
        {
            "service_checks": {
                "gateway": True,
                "template_relevance": True,
                "configured_models_loaded": True,
            }
        }
    )
    native = result["native"]
    assert native["catalog_status"] == "available"
    assert native["module_count"] == 34
    assert native["configured_module_count"] == 12
    modules = {module["id"]: module for module in native["modules"]}
    for identifier in ("tree_search_mcts", "tree_search_retro_star"):
        assert modules[identifier]["configured"] is True
        assert modules[identifier]["gateway_configured"] is False
        assert modules[identifier]["invocation_mode"] == "product_child"
    assert modules["retro_template_relevance"]["ready"] is True
    assert modules["forward_graph2smiles"]["status"] == "unavailable"
    assert modules["context_recommender"]["status"] == "unavailable"
    assert modules["impurity_predictor"]["status"] == "unavailable"
    assert modules["fastsolv"]["wrapper_present"] is True
    assert modules["count_analogs"]["wrapper_present"] is True
    assert (
        sum(module["status"] == "preserved_disabled" for module in modules.values())
        == 22
    )
    assert all(module["source_present"] for module in modules.values())
    integrations = {item["id"]: item for item in result["integrations"]}
    assert integrations["aizynthfinder"]["status"] == "adapter_unwired"
    assert integrations["llm"]["status"] == "deferred"
    assert integrations["codex"]["status"] == "not_integrated"
    assert integrations["deepretro"]["status"] == "not_integrated"
    assert all(
        not item["active"] and not item["runtime_verified"]
        for item in integrations.values()
    )
    assert len(result["engines"]) == 1
    assert result["operations"]["call_async"]["supported"] is False


def test_disabled_source_module_cannot_become_ready_from_a_stray_check():
    result = snapshot(
        {"service_checks": {"fastsolv": True, "forward_graph2smiles": True}}
    )
    disabled = [
        module for module in result["native"]["modules"] if not module["configured"]
    ]
    assert all(module["ready"] is False for module in disabled)


def test_unknown_model_configuration_cannot_claim_verification():
    result = snapshot(
        {
            "service_checks": {
                "configured_models_loaded": True,
                "template_relevance": True,
            }
        },
        models="pistachio,private-secret-value",
    )
    assert result["engines"][0]["models_verified"] is False
    assert result["native"]["models_verified"] is False
    assert "private-secret-value" not in json.dumps(result)


def test_missing_catalog_fails_closed_without_legacy_fallback(tmp_path, monkeypatch):
    with monkeypatch.context() as context:
        context.setattr(native_capability_catalog, "CORE", tmp_path)
        native_capabilities.source_catalog.cache_clear()
        result = snapshot({})
        assert result["native"]["catalog_status"] == "unavailable"
        assert result["native"]["module_count"] == 0
        assert result["engines"][0]["configured_models"] == []
        assert result["engines"][0]["models_verified"] is False
    native_capabilities.source_catalog.cache_clear()


def test_catalog_reads_literals_without_executing_source(tmp_path):
    path = tmp_path / "public_config.py"
    path.write_text("enabled = {'module'}\nraise RuntimeError('must not execute')\n")
    assert native_capability_catalog._literal_assignment(path, "enabled") == {"module"}


def test_dependencies_distinguish_probed_readiness_and_unobserved_stores():
    result = environment_snapshot(
        health={
            "service_checks": {
                "gateway": True,
                "commercial_stock": True,
                "inventory_consistent": False,
                "configured_models_loaded": True,
            },
            "stock_snapshot": {"catalog_sha256": "a" * 64},
        },
        runtime={},
        configured_models="pistachio",
        template_library={"status": "ready", "template_count": 12},
    )
    dependencies = result["dependencies"]
    assert dependencies["mongo"]["status"] == "ready"
    assert dependencies["mongo"]["direct_probe"] is False
    assert dependencies["sqlite_workspace"]["status"] == "not_probed"
    assert dependencies["commercial_stock"]["inventory_consistent"] is False
    assert dependencies["template_library"]["template_count"] == 12


def test_source_catalog_is_cached_without_executing_native_config(monkeypatch):
    native_capabilities.source_catalog()
    before = native_capabilities.source_catalog.cache_info()

    def forbidden(*args, **kwargs):
        raise AssertionError("Warm projection must not read source or private files")

    monkeypatch.setattr(native_capability_catalog.Path, "read_text", forbidden)
    start = time.perf_counter()
    for _ in range(50):
        snapshot({})
    elapsed = time.perf_counter() - start
    assert elapsed / 50 < 0.250
    assert native_capabilities.source_catalog.cache_info().misses == before.misses


def test_template_asset_uses_real_read_only_index_and_caches_summary(
    tmp_path, monkeypatch
):
    from pathlib import Path

    path = tmp_path / "templates.sqlite"
    from packages.knowledge_base.template_schema import _create_template_schema
    from packages.knowledge_base.template_models import _normalise_template_record
    from packages.knowledge_base.template_schema import _insert_template_record

    with sqlite3.connect(path) as connection:
        _create_template_schema(connection)
        connection.execute("INSERT INTO template_sources VALUES (?,?,?,?,?,?)", (
            "pistachio", "interface-fixture", 1, "0" * 64, "retro", "strict_synthesis",
        ))
        _insert_template_record(connection, _normalise_template_record(
            raw={"_id": "interface-example", "reaction_smarts": "[C:1]=[O:2]>>[C:1][O:2]", "count": 3},
            source="pistachio", source_path=Path("interface-fixture"),
            direction="retro", domain="strict_synthesis",
        ))
    original = environment_dependencies.TemplateLibraryService.summary
    calls = []

    def measured(service):
        calls.append(service.database_path)
        return original(service)

    monkeypatch.setattr(
        environment_dependencies.TemplateLibraryService, "summary", measured
    )
    first = native_capabilities.template_asset_status(str(path), cache_seconds=10)
    assert first["status"] == "ready"
    assert first["template_count"] == 1
    assert first["sources"] == ["pistachio"]
    assert "path" not in first
    first["sources"].append("mutated-client-copy")
    assert native_capabilities.template_asset_status(str(path), cache_seconds=10)[
        "sources"
    ] == ["pistachio"]
    assert len(calls) == 1


@pytest.mark.parametrize(
    "path,reason",
    [(None, "not_configured"), ("/private/native.env", "invalid_index_path")],
)
def test_template_asset_never_opens_private_environment_files(
    path, reason, monkeypatch
):
    def forbidden(*args, **kwargs):
        raise AssertionError("No private configuration file reads")

    monkeypatch.setattr(
        environment_dependencies.TemplateLibraryService, "summary", forbidden
    )
    assert native_capabilities.template_asset_status(path, cache_seconds=10) == {
        "status": "unavailable",
        "reason": reason,
    }


def test_public_exports_keep_single_catalog_and_dependency_implementations():
    assert (
        native_capabilities.source_catalog is native_capability_catalog.source_catalog
    )
    assert (
        native_capabilities.configured_model_names
        is native_capability_catalog.configured_model_names
    )
    assert (
        native_capabilities.dependency_inventory
        is environment_dependencies.dependency_inventory
    )
    assert (
        native_capabilities.inactive_integrations
        is environment_dependencies.inactive_integrations
    )
    assert (
        native_capabilities.template_asset_status
        is environment_dependencies.template_asset_status
    )


def test_parent_inventory_fields_remain_backward_compatible():
    result = snapshot({})
    assert result["schema_version"] == 1
    for module in result["native"]["modules"]:
        assert {
            "id",
            "configured",
            "ready",
            "status",
            "service_id",
            "api_prefixes",
        } <= module.keys()
    integrations = {entry["id"]: entry for entry in result["integrations"]}
    for name in ("aizynthfinder", "llm"):
        assert {"id", "status", "source_present", "runtime_verified"} <= integrations[
            name
        ].keys()
    for name in ("codex", "deepretro"):
        assert integrations[name]["status"] == "not_integrated"
        assert integrations[name]["runtime_verified"] is False
    assert {
        "mongo",
        "sqlite_workspace",
        "commercial_stock",
        "native_models",
        "template_library",
    } == result["dependencies"].keys()
    assert {"call_async", "unified_route", "expand_one", "scientific_tools"} == result["operations"].keys()
    assert result["operations"]["scientific_tools"]["managed"] is True
    assert result["operations"]["scientific_tools"]["endpoints"]["forward"] == "/api/v1/reactions/predict"
