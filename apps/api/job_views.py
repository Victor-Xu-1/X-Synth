import json

from fastapi import HTTPException


def job_response(job: dict) -> dict:
    summary = public_summary(job.get("summary") or {})
    request = job["request"]
    return {
        "job_id": job["id"],
        "status": job["status"],
        "revision": job["revision"],
        "target_smiles": request["smiles"],
        "description": request.get("description") or request["smiles"],
        "created_at": job["created"],
        "modified": job["modified"],
        "selected_route_count": summary.get("selected_route_count", 0),
        "closed_route_count": summary.get("closed_route_count", 0),
        "meets_min_routes": summary.get("meets_min_routes", False),
        "summary": summary,
        "progress": {"phase": job["status"], **job["checkpoint"]},
        "error_code": job["error_code"],
        "public": False,
        "origin": summary.get("origin", "x_synth"),
        "stored_route_count": summary.get("stored_route_count", 0),
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


def route_result(job, *, artifacts, budget):
    if (job.get("summary") or {}).get("origin") == "askcos_history":
        path = artifacts / job["id"] / "native-history.json"
        if not path.exists():
            raise HTTPException(404, "Historical artifact is unavailable")
        if path.stat().st_size > budget.response_bytes:
            raise HTTPException(413, "Historical artifact exceeds the response budget")
        document = json.loads(path.read_text(encoding="utf-8"))
        document["history_provenance"] = public_summary(job["summary"])
        return document
    path = artifacts / job["id"] / "selected_routes.json"
    selected = []
    if path.is_file():
        if path.stat().st_size > budget.response_bytes:
            raise HTTPException(413, "Route data exceeds the response budget")
        selected = json.loads(path.read_text(encoding="utf-8"))
    return {
        "result_id": job["id"],
        "target_smiles": job["request"]["smiles"],
        "description": job["request"].get("description") or job["request"]["smiles"],
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
