import json

from fastapi import HTTPException

from packages.workspace.history_projection import historical_routes
from packages.chemistry.material_scope import stored_route_scope_exclusions
from packages.orchestrator.review_policy import REVIEW_POLICY
from packages.orchestrator.route_artifacts import RouteArtifactError, RouteArtifactStore


def history_metadata(job: dict) -> dict:
    return {
        "group_id": job.get("group_id"),
        "history_revision": job.get("history_revision", 0),
        "archived": bool(job.get("archived", False)),
    }


def display_description(job: dict) -> str:
    request = job["request"]
    return job.get("history_title") or request.get("description") or request["smiles"]


def job_response(job: dict) -> dict:
    summary = public_summary(job.get("summary") or {})
    request = job["request"]
    return {
        "job_id": job["id"],
        "status": job["status"],
        "revision": job["revision"],
        "target_smiles": request["smiles"],
        "description": display_description(job),
        **history_metadata(job),
        "created_at": job["created"],
        "modified": job["modified"],
        "selected_route_count": summary.get("selected_route_count", 0),
        "closed_route_count": summary.get("closed_route_count", 0),
        "meets_min_routes": summary.get("meets_min_routes", False),
        "summary": summary,
        "progress": {"phase": job["status"], **job["checkpoint"]},
        "error_code": job["error_code"],
        "result_snapshot": result_snapshot_identifier(job.get("checkpoint")),
        "public": False,
        "origin": summary.get("origin", "x_synth"),
        "stored_route_count": summary.get("stored_route_count", 0),
    }


def result_record(job: dict) -> dict:
    data = job_response(job)
    return {
        "result_id": data["job_id"],
        "description": data["description"],
        "revision": data["revision"],
        **history_metadata(data),
        "progress": data["progress"],
        "created": data["created_at"],
        "modified": data["modified"],
        "result_type": "unified_route_job",
        "result_state": data["status"],
        "target_smiles": data["target_smiles"],
        "num_trees": data["stored_route_count"]
        if data["origin"] == "askcos_history"
        else data["selected_route_count"],
        "tags": ["ASKCOS"],
        "public": False,
        "unified_route_pool_summary": {"id": data["job_id"], **data["summary"]},
    }


def public_summary(value):
    if isinstance(value, dict):
        return {
            key: public_summary(item)
            for key, item in value.items()
            if key not in {"path", "repo_root", "run_dir"} and not key.endswith("_path")
        }
    if isinstance(value, list):
        return [public_summary(item) for item in value]
    return value


def result_snapshot_identifier(checkpoint):
    pointer = (checkpoint or {}).get("published_result")
    return pointer.get("snapshot_id") if isinstance(pointer, dict) else None


def selected_route_data(path, *, budget, job=None):
    if not path.is_file():
        return []
    if path.stat().st_size > budget.response_bytes:
        raise HTTPException(413, "Route data exceeds the response budget")
    try:
        selected = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(selected, list):
            raise ValueError("Invalid selected route collection")
        outside_scope = any(stored_route_scope_exclusions(route) for route in selected)
    except (ValueError, TypeError) as exc:
        raise HTTPException(409, "路线结果结构损坏，需要重新计算。") from exc
    if outside_scope:
        raise HTTPException(409, "旧候选超出当前物料范围，需要重新审查或搜索。")
    if job and (job.get("checkpoint") or {}).get("review_policy") == REVIEW_POLICY and any(
        route.get("metadata", {}).get("full_forward_prediction_validated") is not True
        for route in selected
    ):
        raise HTTPException(409, "独立正向核验尚未完成，路线不能作为已核验结果发布。")
    return selected


def selected_routes_for_job(job, *, artifacts, budget):
    try:
        selected = RouteArtifactStore(artifacts).read(job, limit=budget.response_bytes)
    except RouteArtifactError as exc:
        raise HTTPException(413 if exc.oversized else 409, "路线快照不可用或校验不一致，需要恢复原始结果。") from exc
    except OSError as exc:
        raise HTTPException(503, "路线快照暂时无法读取，请稍后重试。") from exc
    if selected is None:
        return selected_route_data(artifacts / job["id"] / "selected_routes.json", budget=budget, job=job)
    if any(stored_route_scope_exclusions(route) for route in selected):
        raise HTTPException(409, "候选超出当前物料范围，需要重新审查或搜索。")
    if (job.get("checkpoint") or {}).get("review_policy") == REVIEW_POLICY and any(
        route.get("metadata", {}).get("full_forward_prediction_validated") is not True for route in selected
    ):
        raise HTTPException(409, "独立正向核验尚未完成，路线不能作为已核验结果发布。")
    return selected


def route_result(job, *, artifacts, budget):
    if (job.get("summary") or {}).get("origin") == "askcos_history":
        path = artifacts / job["id"] / "native-history.json"
        if not path.exists():
            raise HTTPException(404, "Historical artifact is unavailable")
        if path.stat().st_size > budget.response_bytes:
            raise HTTPException(413, "Historical artifact exceeds the response budget")
        document = json.loads(path.read_text(encoding="utf-8"))
        document["history_provenance"] = public_summary(job["summary"])
        try:
            routes = public_summary(historical_routes(document))
        except (TypeError, ValueError, KeyError) as exc:
            raise HTTPException(
                409, "Historical route records cannot be projected"
            ) from exc
        if any(stored_route_scope_exclusions(route) for route in routes):
            raise HTTPException(409, "旧候选超出当前物料范围，需要重新审查或搜索。")
        result = document.get("result")
        if not isinstance(result, dict):
            raise HTTPException(409, "Historical result format is invalid")
        document["result_state"] = job["status"]
        document.update(history_metadata(job))
        if job.get("request"):
            document["description"] = display_description(job)
        result["unified_route_pool"] = {
            "summary": public_summary(job["summary"]),
            "selected_routes": routes,
        }
        if (
            len(json.dumps(document, ensure_ascii=False).encode("utf-8"))
            > budget.response_bytes
        ):
            raise HTTPException(
                413, "Historical route projection exceeds the response budget"
            )
        return document
    selected = selected_routes_for_job(job, artifacts=artifacts, budget=budget)
    return {
        "result_id": job["id"],
        "target_smiles": job["request"]["smiles"],
        "description": display_description(job),
        **history_metadata(job),
        "created": job["created"],
        "modified": job["modified"],
        "result_type": "tree_builder",
        "result_state": job["status"],
        "settings": job["request"],
        "public": False,
        "result": {
            "version": 2,
            "stats": public_summary(job["summary"] or {}),
            "unified_route_pool": {
                "summary": public_summary(job["summary"] or {}),
                "selected_routes": selected,
            },
            "uds": {
                "uuid2smiles": {
                    "00000000-0000-0000-0000-000000000000": job["request"]["smiles"]
                }
            },
        },
    }
