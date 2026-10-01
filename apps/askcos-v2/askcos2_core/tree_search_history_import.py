import uuid
from datetime import datetime
from typing import Any


def route_count_from_mcts_response(response: dict[str, Any]) -> int:
    results = response.get("results") if isinstance(response, dict) else None
    if not isinstance(results, dict):
        return 0

    stats = results.get("stats")
    if isinstance(stats, dict) and isinstance(stats.get("total_paths"), int):
        return stats["total_paths"]

    uds = results.get("uds")
    if isinstance(uds, dict) and isinstance(uds.get("pathways"), list):
        return len(uds["pathways"])

    return 0


def result_payload_from_mcts_response(response: dict[str, Any], result_id: str) -> dict[str, Any] | None:
    results = response.get("results") if isinstance(response, dict) else None
    if not isinstance(results, dict):
        return None

    payload = dict(results)
    payload["result_id"] = result_id
    return payload


def build_saved_result_document_from_mcts_response(
    *,
    response: dict[str, Any],
    user: str,
    target_smiles: str,
    description: str,
    source: str,
    tags: list[str] | None = None,
    settings: dict[str, Any] | None = None,
    result_id: str | None = None,
) -> dict[str, Any]:
    result_id = result_id or str(uuid.uuid4())
    now = datetime.now()
    route_count = route_count_from_mcts_response(response)
    status = str(response.get("status") or "").upper()
    error = str(response.get("error") or "")

    saved_settings = dict(settings or {})
    import_settings = dict(saved_settings.get("history_import") or {})
    import_settings.update({
        "source": source,
        "imported_at": now.isoformat(timespec="seconds"),
        "backend_status": status,
        "backend_error": error,
    })
    saved_settings["history_import"] = import_settings

    return {
        "user": user,
        "description": description,
        "created": now,
        "modified": now,
        "dt": None,
        "result_id": result_id,
        "result": result_payload_from_mcts_response(response, result_id),
        "settings": saved_settings,
        "tags": tags or ["direct_mcts_import"],
        "check_date": None,
        "result_state": "completed" if status == "SUCCESS" else "failed",
        "result_type": "tree_builder",
        "revision": 0,
        "target_smiles": target_smiles,
        "num_trees": route_count,
        "public": False,
        "shared_with": [user],
    }
