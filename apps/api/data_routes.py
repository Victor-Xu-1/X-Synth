import json
import sqlite3
from dataclasses import asdict
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.knowledge_base.template_library import TemplateLibraryService

from .job_views import public_summary
from .security import authenticate


class TemplateQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategy: str | None = Field(default=None, max_length=100)
    sources: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list, max_length=20
    )
    domain: str | None = Field(default=None, max_length=100)
    min_count: int | None = Field(default=None, ge=0, le=2147483647)
    limit: int = Field(default=100, ge=1, le=500)
    direction: Literal["retro", "forward"] | None = None


def data_router(*, template_path=None, transport):
    router = APIRouter()

    @lru_cache(maxsize=1)
    def service():
        if not template_path:
            raise HTTPException(503, "统一模板索引未配置。")
        try:
            return TemplateLibraryService(template_path)
        except (OSError, ValueError, sqlite3.Error) as exc:
            raise HTTPException(503, "统一模板索引不可用。") from exc

    @router.get("/template-library/health")
    def health(request: Request):
        authenticate(request, transport)
        try:
            return {"status": "ready", **public_summary(service().summary())}
        except (OSError, sqlite3.Error) as exc:
            raise HTTPException(503, "统一模板索引不可用。") from exc

    @router.get("/template-library/template")
    def template(
        request: Request,
        source: Annotated[str, Query(min_length=1, max_length=128)],
        template_id: Annotated[str, Query(min_length=1, max_length=256)],
    ):
        authenticate(request, transport)
        try:
            record = service().get_template(source=source, template_id=template_id)
        except (OSError, sqlite3.Error, json.JSONDecodeError) as exc:
            raise HTTPException(503, "统一模板索引不可用。") from exc
        except ValueError as exc:
            raise HTTPException(422, "模板标识必须包含匹配的来源命名空间。") from exc
        if record is None:
            raise HTTPException(404, "该来源中没有对应模板。")
        return {"template": public_summary(asdict(record))}

    @router.post("/template-library/query")
    def query(body: TemplateQuery, request: Request):
        authenticate(request, transport)
        try:
            records = service().query_templates(
                strategy=body.strategy,
                sources=body.sources or None,
                domain=body.domain,
                min_count=body.min_count,
                limit=body.limit,
                direction=body.direction,
            )
            return {
                "count": len(records),
                "templates": [public_summary(asdict(record)) for record in records],
            }
        except (OSError, sqlite3.Error, json.JSONDecodeError) as exc:
            raise HTTPException(503, "统一模板索引不可用。") from exc
        except ValueError as exc:
            raise HTTPException(422, "模板查询条件无效。") from exc

    return router
