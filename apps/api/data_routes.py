import json
import sqlite3
from dataclasses import asdict
from functools import lru_cache
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.knowledge_base.template_library import TemplateLibraryService
from packages.knowledge_base.template_paging import (
    MAX_TEMPLATE_CURSOR_LENGTH, StaleTemplateCursorError, TemplateCursorError,
)

from .job_views import public_summary
from .security import authenticate


class TemplateQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategy: str | None = Field(default=None, max_length=100)
    sources: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list, max_length=20
    )
    domain: str | None = Field(default=None, max_length=100)
    min_count: int | None = Field(default=None, ge=0, le=2147483647, strict=True)
    limit: int = Field(default=100, ge=1, le=500, strict=True)
    direction: Literal["retro", "forward"] | None = None
    cursor: str | None = Field(
        default=None, min_length=1, max_length=MAX_TEMPLATE_CURSOR_LENGTH, strict=True,
    )


class TemplateQueryResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    count: int = Field(ge=0, le=500)
    templates: list[dict[str, Any]]
    matched_count: int = Field(ge=0)
    next_cursor: str | None = Field(
        min_length=1, max_length=MAX_TEMPLATE_CURSOR_LENGTH,
    )
    has_more: bool


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

    @router.post("/template-library/query", response_model=TemplateQueryResult)
    def query(body: TemplateQuery, request: Request):
        authenticate(request, transport)
        try:
            page = service().query_template_page(
                strategy=body.strategy,
                sources=body.sources or None,
                domain=body.domain,
                min_count=body.min_count,
                limit=body.limit,
                direction=body.direction,
                cursor=body.cursor,
            )
            return {
                "count": len(page.templates),
                "templates": [public_summary(asdict(record)) for record in page.templates],
                "matched_count": page.matched_count,
                "next_cursor": page.next_cursor,
                "has_more": page.has_more,
            }
        except (OSError, sqlite3.Error, json.JSONDecodeError) as exc:
            raise HTTPException(503, "统一模板索引不可用。") from exc
        except StaleTemplateCursorError as exc:
            raise HTTPException(409, "模板索引快照已变更，请明确开始新的查询。") from exc
        except TemplateCursorError as exc:
            raise HTTPException(422, "模板分页游标无效或与筛选条件不匹配。") from exc
        except ValueError as exc:
            raise HTTPException(422, "模板查询条件无效。") from exc

    return router
