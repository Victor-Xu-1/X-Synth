from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from packages.orchestrator.job_repository import JobConflict

from .job_views import job_response
from .security import authenticate


class DescriptionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=1, max_length=256)
    revision: int = Field(ge=0)


def result_router(*, repository, transport):
    router = APIRouter()

    @router.get("/results/list")
    def list_results(
        request: Request,
        limit: int = Query(100, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        principal = authenticate(request, transport)
        records = []
        for job in repository.list(principal.owner, limit=limit, offset=offset):
            data = job_response(job)
            records.append(
                {
                    "result_id": data["job_id"],
                    "description": data["description"],
                    "revision": data["revision"],
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
                    "unified_route_pool_summary": {
                        "id": data["job_id"],
                        **data["summary"],
                    },
                }
            )
        return JSONResponse(records)

    def edit(request, result_id, **changes):
        principal = authenticate(request, transport)
        try:
            return repository.edit_history(result_id, owner=principal.owner, **changes)
        except KeyError as exc:
            raise HTTPException(404, "Task does not exist") from exc
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.put("/results/update")
    def update_description(result_id: str, body: DescriptionUpdate, request: Request):
        job = edit(
            request,
            result_id,
            expected_revision=body.revision,
            description=body.description,
        )
        return {"success": True, "revision": job["revision"]}

    @router.delete("/results/destroy")
    def archive_result(result_id: str, request: Request):
        edit(request, result_id, archive=True)
        return {"success": True, "archived": True}

    return router
