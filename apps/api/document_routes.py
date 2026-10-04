from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from packages.orchestrator.job_repository import JobConflict
from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.route_graph import RouteGraph, graph_from_candidate
from packages.workspace.route_repository import UnsupportedRouteDocumentSchema

from .job_views import display_description, route_result
from .security import authenticate


class DocumentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    graph: RouteGraph

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("路线名称不能为空")
        return value


class DocumentUpdate(DocumentBody):
    revision: int = Field(ge=0, strict=True)


class SourceRouteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    route_index: int = Field(ge=0, le=9, strict=True)


def document_router(*, documents, repository, transport, artifacts, budget):
    router = APIRouter(prefix="/route-documents", route_class=WorkspaceRoute)

    def owned(request: Request):
        return authenticate(request, transport).owner

    def guarded(operation):
        try:
            return operation()
        except KeyError as exc:
            raise HTTPException(404, "路线文档不存在") from exc
        except JobConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except UnsupportedRouteDocumentSchema as exc:
            raise HTTPException(503, "路线文档存储格式不受支持。") from exc

    @router.get("")
    def list_documents(
        owner: str = Depends(owned),
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        return guarded(lambda: documents.list(owner, limit=limit, offset=offset))

    @router.post("")
    def create_document(body: DocumentBody, owner: str = Depends(owned)):
        return guarded(lambda: documents.create(owner, body.title.strip(), body.graph))

    @router.post("/from-task")
    def from_task(body: SourceRouteBody, owner: str = Depends(owned)):
        job = repository.get(body.job_id, owner=owner)
        if job is None:
            raise HTTPException(404, "任务不存在")
        try:
            payload = route_result(job, artifacts=artifacts, budget=budget)
            result = payload.get("result") if isinstance(payload, dict) else None
            pool = (
                result.get("unified_route_pool") if isinstance(result, dict) else None
            )
            candidates = pool.get("selected_routes") if isinstance(pool, dict) else None
            if not isinstance(candidates, list):
                raise TypeError("Invalid selected route collection")
            if body.route_index >= len(candidates):
                raise HTTPException(409, "该任务尚无对应路线结果")
            graph, source = graph_from_candidate(
                candidates[body.route_index], max_atoms=budget.max_structure_atoms
            )
        except (ValueError, TypeError, KeyError, OSError) as exc:
            raise HTTPException(
                409, "任务路线数据无效或不可用，无法创建路线文档。"
            ) from exc
        source.update(job_id=body.job_id, route_index=body.route_index)
        title = display_description(job)[:140]
        return guarded(
            lambda: documents.create(
                owner, f"{title} · 路线 {body.route_index + 1}", graph, source=source
            )
        )

    @router.get("/{identifier}")
    def get_document(identifier: str, owner: str = Depends(owned)):
        return guarded(lambda: documents.get(identifier, owner))

    @router.put("/{identifier}")
    def update_document(
        identifier: str, body: DocumentUpdate, owner: str = Depends(owned)
    ):
        return guarded(
            lambda: documents.update(
                identifier,
                owner,
                title=body.title.strip(),
                graph=body.graph,
                revision=body.revision,
            )
        )

    @router.delete("/{identifier}")
    def delete_document(identifier: str, owner: str = Depends(owned)):
        guarded(lambda: documents.delete(identifier, owner))
        return {"deleted": True}

    return router
