"""Exact source boundaries for immutable assets and owned native execution."""

STOCK_FILES = {
    "packages/adapters/stock/askcos_buyables.py",
    "packages/adapters/stock/commercial_stock.py",
    "packages/adapters/stock/route_pruning.py",
    "packages/adapters/stock/stock_merge.py",
    "packages/chemistry/precursor_occurrences.py",
    "scripts/data_import/compile_stock_index.py",
    "packages/adapters/stock/domestic_artifacts.py",
    "packages/adapters/stock/pubchem_suppliers.py",
    "packages/adapters/stock/stock_index.py",
    "packages/adapters/stock/stock_snapshot.py",
    "packages/adapters/stock/supplier_evidence.py",
    "packages/adapters/stock/unified_aizynth_stock.py",
}
TEMPLATE_FILES = {
    "packages/knowledge_base/" + name + ".py" for name in (
        "template_build", "template_export", "template_models", "template_query",
        "template_schema", "template_sources", "template_statistics", "template_export_publication",
    )
} | {"packages/knowledge_base/template_library.py", "scripts/data_import/compile_template_library.py"}
REACTION_FILES = {
    "packages/knowledge_base/reaction_library.py",
    "packages/knowledge_base/reaction_compile.py",
    "packages/knowledge_base/reaction_snapshot.py",
}
SQLITE_FILES = {"packages/platform/immutable_sqlite.py"}
RUNTIME_FILES = {
    "packages/platform/native_runtime.py",
    "packages/platform/resource_metrics.py",
    "packages/orchestrator/runtime_health.py",
    "scripts/operations/serve_platform.py",
    "apps/askcos-v2/askcos2_core/configs/module_config_x_synth.py",
    "packages/platform/native_endpoints.py",
    "packages/platform/native_runtime_ownership.py",
    "packages/platform/native_search_contract.py",
    "packages/platform/runtime_logging.py",
    "scripts/operations/serve_native.py",
}
RPC_FILES = {
    "packages/adapters/askcos/engine.py",
    "packages/adapters/askcos/search_connection.py",
    "packages/adapters/askcos/transport.py",
    "packages/adapters/askcos/native_http.py",
    "packages/adapters/askcos/native_failure_diagnostics.py",
    "packages/adapters/askcos/native_search_jobs.py",
    "packages/adapters/askcos/native_search_protocol.py",
    "packages/adapters/askcos/native_service_limits.py",
    "tests/unit/native_rpc_helpers.py",
    *{
        "apps/askcos-v2/" + name for name in (
            "fast_filter/fast_filter.py", "fast_filter/fast_filter_server.py",
            "retro/template_relevance/template_relevance_server.py",
            "askcos2_core/app.py",
            "askcos2_core/wrappers/retro/controller.py", "askcos2_core/utils/cache.py",
            "tree_search/retro_star/api/value_fn_api.py",
            "pathway_ranker/pathway_ranker.py", "pathway_ranker/pathway_ranker_server.py",
            "tree_search/expand_one/api/fast_filter_batch_api.py",
            "tree_search/expand_one/api/pricer_api.py",
            "tree_search/expand_one/api/retro_api.py",
            "tree_search/expand_one/tests/test_pricer_batch.py",
            "tree_search/expand_one/tests/test_failure_and_stock_ranking.py",
            "tree_search/mcts/api/expand_one_api.py", "tree_search/mcts/mcts_server.py",
            "tree_search/mcts/mcts_controller.py",
            "tree_search/retro_star/api/expand_one_api.py",
            "tree_search/retro_star/retro_star_server.py",
            "tree_search/retro_star/retro_star_controller.py",
            "tree_search/mcts/tests/test_expand_one_api_retry.py",
            "tree_search/retro_star/tests/test_expand_one_api_retry.py",
        )
    },
}
FILES = STOCK_FILES | TEMPLATE_FILES | REACTION_FILES | SQLITE_FILES | RUNTIME_FILES | RPC_FILES


def related_tests(paths):
    selected = set()
    if paths & (STOCK_FILES | SQLITE_FILES):
        selected.update({
            "tests/unit/test_immutable_sqlite.py", "tests/unit/test_evidence_snapshots.py",
            "tests/unit/test_supplier_import_gate.py", "tests/unit/test_stock_index.py",
            "tests/unit/test_commercial_stock_registry.py",
            "tests/unit/test_domestic_stock_artifacts.py", "tests/unit/test_pubchem_suppliers.py",
            "tests/unit/test_unified_aizynth_stock_artifacts.py",
            "tests/unit/test_unified_stock_service.py", "tests/unit/test_catalog_pricing.py",
            "tests/unit/test_stock_snapshot_merge.py", "tests/unit/test_stock_route_projection.py",
        })
    if paths & (TEMPLATE_FILES | SQLITE_FILES):
        selected.update({
            "tests/unit/test_template_compilation.py", "tests/unit/test_template_library_api.py",
            "tests/unit/test_template_contract_data.py", "tests/unit/test_template_export.py",
            "tests/unit/test_native_template_namespaces.py",
        })
    if paths & (REACTION_FILES | SQLITE_FILES):
        selected.update({"tests/unit/test_reaction_library.py", "tests/unit/test_evidence_snapshots.py"})
    if paths & RUNTIME_FILES:
        selected.update({
            "tests/unit/test_native_runtime_health.py", "tests/unit/test_native_runtime_launchers.py",
            "tests/unit/test_native_runtime_ownership.py", "tests/unit/test_native_search_readiness.py",
            "tests/unit/test_runtime_logging.py", "tests/unit/test_native_ports.py",
            "tests/unit/test_resource_metrics.py", "tests/unit/test_operations_scripts.py",
        })
    if paths & (RPC_FILES | {"packages/platform/native_search_contract.py"}):
        selected.update({
            "tests/unit/test_native_model_limits.py", "tests/unit/test_native_request_bounds.py",
            "tests/unit/test_native_search_protocol.py", "tests/unit/test_native_server_binding.py",
            "tests/unit/test_native_failure_details.py", "tests/unit/test_native_timeout_contract.py",
            "tests/unit/test_native_operation_diagnostics.py", "tests/unit/test_retro_operation_boundaries.py",
            "tests/unit/test_engine_reconnect.py",
            "tests/unit/test_native_lifecycle.py", "tests/unit/test_askcos_adapter.py",
        })
    return selected
