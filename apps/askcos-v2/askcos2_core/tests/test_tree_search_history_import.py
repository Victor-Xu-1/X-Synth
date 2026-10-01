from tree_search_history_import import build_saved_result_document_from_mcts_response


def test_build_saved_result_document_from_mcts_response_preserves_route_history_metadata():
    response = {
        "status": "SUCCESS",
        "error": "",
        "results": {
            "result_id": "",
            "stats": {"total_paths": 2},
            "uds": {
                "node_dict": {
                    "CCO": {"id": "CCO", "type": "chemical", "smiles": "CCO"},
                },
                "uuid2smiles": {},
                "graph": [],
                "pathways": [[], []],
                "pathways_properties": [{}, {}],
            },
            "version": 2,
        },
    }

    saved = build_saved_result_document_from_mcts_response(
        response=response,
        user="guest_ttjori",
        target_smiles="CCO",
        description="真实 MCTS 直连结果导入",
        source="direct_mcts",
    )

    assert saved["user"] == "guest_ttjori"
    assert saved["target_smiles"] == "CCO"
    assert saved["result_state"] == "completed"
    assert saved["result_type"] == "tree_builder"
    assert saved["num_trees"] == 2
    assert saved["result"]["stats"]["total_paths"] == 2
    assert saved["settings"]["history_import"]["source"] == "direct_mcts"
    assert "guest_ttjori" in saved["shared_with"]


def test_build_saved_result_document_from_mcts_response_preserves_import_settings():
    saved = build_saved_result_document_from_mcts_response(
        response={"status": "FAIL", "error": "service unavailable", "results": {}},
        user="guest_ttjori",
        target_smiles="CCO",
        description="失败任务也要进历史",
        source="direct_mcts",
        settings={"history_import": {"source_file": "/tmp/raw.json"}},
    )

    assert saved["result_state"] == "failed"
    assert saved["settings"]["history_import"]["source"] == "direct_mcts"
    assert saved["settings"]["history_import"]["source_file"] == "/tmp/raw.json"
    assert saved["settings"]["history_import"]["backend_error"] == "service unavailable"
