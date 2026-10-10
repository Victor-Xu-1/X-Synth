from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from packages.orchestrator.job_repository import JobConflict
from packages.orchestrator.job_commands import RouteDependenciesUnavailable, RouteJobCommands
from packages.orchestrator.route_request import RouteJobRequest

from .job_views import job_response, original_search_settings, route_result, selected_routes_for_job
from .security import authenticate


def job_router(*, repository, transport, readiness, artifacts: Path, budget):
    router = APIRouter()
    commands = RouteJobCommands(repository=repository, readiness=readiness, budget=budget)

    def guarded(operation):
        try:
            return operation()
        except KeyError as exc:
            raise HTTPException(404, str(exc.args[0])) from exc
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except RouteDependenciesUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def owned(request, job_id):
        principal = authenticate(request, transport)
        job = repository.get(job_id, owner=principal.owner)
        if job is None:
            raise HTTPException(404, "Task does not exist")
        return job

    @router.post("/unified-route/call-async")
    def submit(body: RouteJobRequest, request: Request):
        principal = authenticate(request, transport)
        job = guarded(lambda: commands.submit(
            principal.owner, body.model_dump(), request_key=request.headers.get("idempotency-key"),
        ))
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
    def detail(job_id: str, request: Request, include_settings: bool = False):
        job = owned(request, job_id)
        response = job_response(job)
        if include_settings:
            response["settings"] = original_search_settings(job)
        return response

    @router.post("/unified-route/jobs/{job_id}/resume")
    def resume(job_id: str, request: Request):
        principal = authenticate(request, transport)
        updated = guarded(lambda: commands.resume(job_id, principal.owner))
        return job_response(updated)

    @router.post("/unified-route/jobs/{job_id}/cancel")
    def cancel(job_id: str, request: Request):
        principal = authenticate(request, transport)
        updated = guarded(lambda: commands.cancel(job_id, principal.owner))
        return job_response(updated)

    @router.get("/unified-route/jobs/{job_id}/routes")
    def routes(job_id: str, request: Request):
        job = owned(request, job_id)
        return {
            "routes": selected_routes_for_job(job, artifacts=artifacts, budget=budget),
            "status": job["status"],
        }

    @router.get("/unified-route/jobs/{job_id}/result")
    def result(job_id: str, request: Request):
        job = owned(request, job_id)
        return route_result(job, artifacts=artifacts, budget=budget)

    return router
