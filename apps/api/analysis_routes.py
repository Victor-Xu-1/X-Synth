"""Scientific execution records share one authenticated history boundary."""

from fastapi import APIRouter, HTTPException, Query, Request

from packages.workspace.http_validation import WorkspaceRoute

from .security import authenticate


def analysis_runner(repository):
    def run(*, owner, kind, inputs, execute):
        identifier = repository.start(owner, kind, inputs)
        try:
            output = execute()
            result = (
                output.model_dump(mode="json")
                if hasattr(output, "model_dump")
                else output
            )
            if not isinstance(result, dict):
                raise TypeError("Invalid scientific analysis output")
            repository.finish(identifier, owner, result=result)
        except Exception:
            repository.finish(
                identifier,
                owner,
                error="该次计算未完成，请在工作区检查输入或模型状态后重试。",
            )
            raise
        return {**result, "record_id": identifier}

    return run


def analysis_router(*, repository, transport):
    router = APIRouter(prefix="/analyses", route_class=WorkspaceRoute)

    @router.get("")
    def listing(
        request: Request,
        kind: str | None = None,
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ):
        principal = authenticate(request, transport)
        try:
            return repository.list(
                principal.owner, kind=kind, limit=limit, offset=offset
            )
        except ValueError as exc:
            raise HTTPException(422, "研究记录筛选参数无效。") from exc

    @router.get("/{identifier}")
    def detail(identifier: str, request: Request):
        principal = authenticate(request, transport)
        try:
            return repository.get(identifier, principal.owner)
        except KeyError as exc:
            raise HTTPException(404, "研究记录不存在。") from exc

    @router.delete("/{identifier}")
    def remove(identifier: str, request: Request):
        principal = authenticate(request, transport)
        try:
            repository.delete(identifier, principal.owner)
        except KeyError as exc:
            raise HTTPException(404, "记录不存在或仍在计算中。") from exc
        return {"deleted": True}

    return router
