import re
from urllib import error
from urllib import request as urllib_request

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from packages.adapters.askcos.transport import NoRedirect

from .security import authenticate

NATIVE_GROUPS = frozenset(
    {
        "admin",
        "user",
        "frontend-config",
        "runtime",
        "rdkit",
        "banlist",
        "buyables",
        "pricer",
        "historian",
        "retro",
        "forward",
        "atom-map",
        "cluster",
        "scscore",
        "context-recommender",
        "condition-recommendation",
        "fast-filter",
        "tree-analysis",
        "molecular-complexity",
        "qm-descriptors",
        "solubility",
        "solprop",
        "general-selectivity",
        "site-selectivity",
        "regioselectivity",
        "impurity-predictor",
        "descriptors",
        "draw",
        "templates",
        "template",
        "reaction-classification",
        "pmi-calculator",
        "tree-search",
        "pathway-ranker",
        "get-top-class-batch",
    }
)


def native_router(*, transport, budget):
    router = APIRouter()
    opener = urllib_request.build_opener(urllib_request.ProxyHandler({}), NoRedirect())

    @router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def native(path: str, request: Request):
        authenticate(request, transport)
        parts = (path.removesuffix("/")).split("/")
        if (
            not parts
            or parts[0] not in NATIVE_GROUPS
            or any(not re.fullmatch(r"[a-zA-Z0-9_-]+", part) for part in parts)
        ):
            raise HTTPException(404, "Native capability is not supported")
        if parts[0] == "tree-search" and not path.startswith("tree-search/expand-one/"):
            raise HTTPException(409, "路线任务必须通过 X-Synth 任务入口提交。")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > budget.request_bytes:
                raise HTTPException(413, "Input exceeds the request budget")
        headers = {}
        for key in ("authorization", "content-type", "accept"):
            if request.headers.get(key):
                headers[key] = request.headers[key]
        url = transport.base_url + "/api/" + path
        if request.url.query:
            url += "?" + request.url.query
        native_request = urllib_request.Request(
            url,
            data=bytes(data) if data else None,
            headers=headers,
            method=request.method,
        )

        def forward():
            with opener.open(native_request, timeout=90) as response:
                payload = response.read(budget.response_bytes + 1)
                if len(payload) > budget.response_bytes:
                    raise HTTPException(
                        413, "Native response exceeds the response budget"
                    )
                return Response(
                    payload,
                    status_code=response.status,
                    media_type=response.headers.get("Content-Type", "application/json"),
                )

        try:
            return await run_in_threadpool(forward)
        except error.HTTPError as exc:
            raise HTTPException(
                exc.code, "ASKCOS 请求未被接受，请检查输入、权限或服务状态。"
            ) from exc
        except OSError as exc:
            raise HTTPException(503, "ASKCOS 功能服务暂时不可用。") from exc

    return router
