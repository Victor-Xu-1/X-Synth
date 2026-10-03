import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from packages.orchestrator.job_repository import JobConflict
from packages.orchestrator.route_request import RouteJobRequest

from .job_views import job_response, route_result
from .security import authenticate


def job_router(*, repository, transport, readiness, artifacts: Path, budget):
    router = APIRouter()

    def owned(request, job_id):
        principal = authenticate(request, transport)
        job = repository.get(job_id, owner=principal.owner)
        if job is None:
            raise HTTPException(404, "Task does not exist")
        return job

    @router.post("/unified-route/call-async")
    def submit(body: RouteJobRequest, request: Request):
        principal = authenticate(request, transport)
        health = readiness()
        if not health["route_search_ready"] or not set(body.strategies).intersection(
            health.get("available_strategies", [])
        ):
            raise HTTPException(
                503, "ASKCOS 模型、搜索或商业库存尚未就绪，未创建任务。"
            )
        key = request.headers.get("idempotency-key")
        if key is not None and not 1 <= len(key) <= 128:
            raise HTTPException(422, "Invalid idempotency key")
        try:
            job = repository.create(
                principal.owner,
                body.model_dump(),
                request_key=key,
                queue_limit=budget.queued_jobs,
            )
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "job_id": job["id"],
            "task_id": job["id"],
            "status": job["status"],
            "status_url": f"/api/v1/unified-route/jobs/{job['id']}",
        }

    @router.get("/unified-route/jobs")
    def history(
        request: Request,
        limit: int = Query(100, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        principal = authenticate(request, transport)
        jobs = [
            job_response(job)
            for job in repository.list(principal.owner, limit=limit, offset=offset)
        ]
        return {
            "count": len(jobs),
            "total": repository.count(principal.owner),
            "jobs": jobs,
        }

    @router.get("/unified-route/jobs/{job_id}")
    def detail(job_id: str, request: Request):
        return job_response(owned(request, job_id))

    @router.post("/unified-route/jobs/{job_id}/resume")
    def resume(job_id: str, request: Request):
        job = owned(request, job_id)
        if job["status"] == "queued":
            return job_response(job)
        if job["status"] != "waiting_for_engine":
            raise HTTPException(409, "Task is not awaiting engine recovery")
        if not readiness()["route_search_ready"]:
            raise HTTPException(503, "搜索依赖尚未恢复。")
        try:
            updated = repository.transition(
                job_id, "queued", expected_revision=job["revision"]
            )
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        return job_response(updated)

    @router.post("/unified-route/jobs/{job_id}/cancel")
    def cancel(job_id: str, request: Request):
        job = owned(request, job_id)
        if job["status"] == "cancelled":
            return job_response(job)
        try:
            updated = repository.transition(
                job_id, "cancelled", expected_revision=job["revision"]
            )
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        return job_response(updated)

    @router.get("/unified-route/jobs/{job_id}/routes")
    def routes(job_id: str, request: Request):
        job = owned(request, job_id)
        path = artifacts / job["id"] / "selected_routes.json"
        if not path.is_file():
            return {"routes": [], "status": job["status"]}
        if path.stat().st_size > budget.response_bytes:
            raise HTTPException(413, "Route data exceeds the response budget")
        return {
            "routes": json.loads(path.read_text(encoding="utf-8")),
            "status": job["status"],
        }

    @router.get("/unified-route/jobs/{job_id}/result")
    def result(job_id: str, request: Request):
        job = owned(request, job_id)
        return route_result(job, artifacts=artifacts, budget=budget)

    return router
