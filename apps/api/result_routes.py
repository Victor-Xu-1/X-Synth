from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from packages.orchestrator.job_history import (
    MAX_BATCH,
    MAX_GROUP_NAME,
    MAX_OFFSET,
    MAX_QUERY,
    MAX_TITLE,
    HistoryQueryUnavailable,
)
from packages.orchestrator.job_repository import JobConflict

from .job_views import result_record
from .security import authenticate

Revision = Annotated[int, Field(strict=True, ge=0)]
Identifier = Annotated[
    str, StringConstraints(strict=True, min_length=1, max_length=128)
]
GroupName = Annotated[
    str,
    StringConstraints(
        strict=True,
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_GROUP_NAME,
    ),
]
Title = Annotated[
    str,
    StringConstraints(
        strict=True,
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_TITLE,
    ),
]


class HistoryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DescriptionUpdate(HistoryModel):
    description: Title
    revision: Revision
    history_revision: Revision | None = None


class GroupCreate(HistoryModel):
    name: GroupName


class GroupUpdate(GroupCreate):
    revision: Revision


class HistoryItem(HistoryModel):
    id: Identifier
    revision: Revision


class HistoryBatch(HistoryModel):
    action: Literal["group", "archive", "restore"]
    items: list[HistoryItem] = Field(min_length=1, max_length=MAX_BATCH)
    group_id: Identifier | None = None


def result_router(*, repository, transport):
    router = APIRouter()

    def owned_operation(request, operation):
        principal = authenticate(request, transport)
        try:
            return operation(principal.owner)
        except HistoryQueryUnavailable as exc:
            raise HTTPException(
                503,
                {"code": exc.code, "message": str(exc)},
            ) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc.args[0])) from exc
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.get("/v1/results/page")
    def result_page(
        request: Request,
        limit: int = Query(24, ge=1, le=100),
        offset: int = Query(0, ge=0, le=MAX_OFFSET),
        query: str = Query("", max_length=MAX_QUERY),
        status: str = Query("all", max_length=64),
        group: str = Query("all", min_length=1, max_length=128),
        archived: bool = False,
    ):
        page = owned_operation(
            request,
            lambda owner: repository.history_page(
                owner,
                limit=limit,
                offset=offset,
                query=query,
                status=status,
                group=group,
                archived=archived,
            ),
        )
        return {**page, "results": [result_record(job) for job in page["results"]]}

    @router.get("/v1/results/list")
    @router.get("/results/list")
    def list_results(
        request: Request,
        limit: int = Query(100, ge=1, le=100),
        offset: int = Query(0, ge=0, le=MAX_OFFSET),
    ):
        jobs = owned_operation(
            request, lambda owner: repository.list(owner, limit=limit, offset=offset)
        )
        return [result_record(job) for job in jobs]

    @router.get("/v1/results/groups")
    def list_groups(request: Request):
        return owned_operation(request, repository.list_groups)

    @router.post("/v1/results/groups")
    def create_group(body: GroupCreate, request: Request):
        return owned_operation(
            request, lambda owner: repository.create_group(owner, body.name)
        )

    @router.put("/v1/results/groups/{group_id}")
    def update_group(
        body: GroupUpdate,
        request: Request,
        group_id: str = Path(min_length=1, max_length=128),
    ):
        return owned_operation(
            request,
            lambda owner: repository.update_group(
                owner,
                group_id,
                name=body.name,
                expected_revision=body.revision,
            ),
        )

    @router.delete("/v1/results/groups/{group_id}")
    def delete_group(
        request: Request,
        group_id: str = Path(min_length=1, max_length=128),
        revision: int = Query(ge=0),
    ):
        owned_operation(
            request,
            lambda owner: repository.delete_group(
                owner, group_id, expected_revision=revision
            ),
        )
        return {"success": True}

    @router.post("/v1/results/batch")
    def batch(body: HistoryBatch, request: Request):
        count = owned_operation(
            request,
            lambda owner: repository.batch_history(
                owner,
                action=body.action,
                items=[item.model_dump() for item in body.items],
                group_id=body.group_id,
            ),
        )
        return {"success": True, "count": count}

    @router.put("/v1/results/update")
    @router.put("/results/update")
    def update_description(result_id: str, body: DescriptionUpdate, request: Request):
        job = owned_operation(
            request,
            lambda owner: repository.edit_history(
                result_id,
                owner=owner,
                expected_revision=body.revision,
                expected_history_revision=body.history_revision,
                description=body.description,
            ),
        )
        return {
            "success": True,
            "revision": job["revision"],
            "history_revision": job["history_revision"],
        }

    @router.delete("/v1/results/destroy")
    @router.delete("/results/destroy")
    def archive_result(result_id: str, request: Request):
        owned_operation(
            request,
            lambda owner: repository.edit_history(result_id, owner=owner, archive=True),
        )
        return {"success": True, "archived": True}

    return router
