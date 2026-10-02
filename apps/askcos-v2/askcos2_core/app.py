import os
import sys
import uvicorn
from adapters.registry import get_adapter_registry
from configs.mcp_config import INCLUDE_OPERATIONS, OPERATION_IDS
from fastapi import APIRouter as FastAPIRouter
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from packages.adapters.askcos.native_http import NativeProtocolError
from requests.exceptions import RequestException
from pymongo import timeout as mongo_timeout
from pymongo.errors import PyMongoError
from fastapi.middleware.cors import CORSMiddleware
from tooltips import TOOLTIPS
from typing import Any, Callable
from runtime.capabilities import get_runtime_capabilities, get_runtime_services
from utils import oauth2
from utils.registry import get_util_registry
from wrappers.registry import get_wrapper_registry

adapter_registry = get_adapter_registry()
util_registry = get_util_registry()
wrapper_registry = get_wrapper_registry()


class APIRouter(FastAPIRouter):
    def add_api_route(
        self,
        path: str,
        endpoint: Callable,
        *,
        include_in_schema: bool = True,
        **kwargs: Any
    ) -> None:
        if path.endswith("/"):
            path = path[:-1]

        super().add_api_route(
            path=path,
            endpoint=endpoint,
            include_in_schema=include_in_schema,
            **kwargs
        )

        alternate_path = path + "/"
        super().add_api_route(
            path=alternate_path,
            endpoint=endpoint,
            include_in_schema=False,
            **kwargs
        )


app = FastAPI(
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    swagger_ui_parameters={
        "docExpansion": None,
        "filter": True,
        "tagsSorter": "alpha"
    }
)

allow_origins = os.environ.get("ALLOW_ORIGINS")
allow_methods = os.environ.get("ALLOW_METHODS")
allow_headers = os.environ.get("ALLOW_HEADERS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins.split(",") if allow_origins else [],
    allow_credentials=True,
    allow_methods=allow_methods.split(",") if allow_methods else ["*"],
    allow_headers=allow_headers.split(",") if allow_headers else ["*"],
)


@app.get("/health/ready")
def ready():
    try:
        with mongo_timeout(1):
            pricer = util_registry.get_util("pricer")
            pricer._pricer.client.admin.command("ping")
    except PyMongoError:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "disconnected"})
    snapshot = pricer.catalog.index.summary if pricer.catalog is not None else None
    return {"status": "ready", "database": "connected", "stock_snapshot": snapshot}


@app.exception_handler(NativeProtocolError)
@app.exception_handler(RequestException)
async def native_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Native dependency unavailable"})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=jsonable_encoder({
            "detail": [{"loc": error["loc"], "type": error["type"], "msg": error["msg"]}
                       for error in exc.errors()]
        }),
    )

router = APIRouter(prefix="/api/admin")
router.add_api_route(
    path="/get-backend-status",
    endpoint=wrapper_registry.get_backend_status,
    methods=["GET"],
    tags=["admin"]
)
router.add_api_route(
    path="/token",
    endpoint=oauth2.login_for_access_token,
    methods=["POST"],
    response_model=oauth2.Token,
    tags=["admin"]
)
router.add_api_route(
    path="/mcp-login",
    endpoint=oauth2.mcp_login,
    methods=["POST"],
    response_model=oauth2.Token,
    tags=["admin"],
    operation_id=OPERATION_IDS.get(("/api/admin/mcp-login", "POST"))
)
router.add_api_route(
    path="/logout",
    endpoint=oauth2.logout,
    methods=["POST"],
    tags=["admin"],
    operation_id=OPERATION_IDS.get(("/api/admin/logout", "POST"))
)
app.include_router(router)

for wrapper in wrapper_registry:
    for i, prefix in enumerate(wrapper.prefixes):
        # use hyphens which is the standard
        prefix_with_hyphen = prefix.replace("_", "-")
        router = APIRouter(prefix=f"/api/{prefix_with_hyphen}")
        # Bind specified wrapper.method to urls /{wrapper.prefixes}/method_name
        for method_name, bind_types in wrapper.methods_to_bind.items():
            # Only include the first prefix, and methods call_sync/async in the schema
            # Exclude the schema for context_recommender, which are a bit messy now
            include_in_schema = (
                i == 0 and method_name in
                ["call_sync", "call_async", "call_sync_without_token"]
                and "context_recommender" not in prefix
                and "count_analogs" not in prefix
                and not "descriptors" == prefix
                and "fast_filter/with_threshold" not in prefix
                and "general_selectivity/gnn" not in prefix
                and "general_selectivity/qm_gnn" not in prefix
                and "general_selectivity/qm_gnn_no_reagent" not in prefix
                and "get_top_class_batch" not in prefix
                and "pmi_calculator" not in prefix
            )
            method_name_with_hyphen = method_name.replace("_", "-")
            full_api_path = f"/api/{prefix_with_hyphen}/{method_name_with_hyphen}"
            operation_key = (full_api_path.rstrip("/"), bind_types[0])
            operation_id = OPERATION_IDS.get(operation_key)
            router.add_api_route(
                path=f"/{method_name_with_hyphen}",
                endpoint=getattr(wrapper, method_name),
                methods=bind_types,
                include_in_schema=include_in_schema,
                response_model_by_alias="retro" not in prefix,
                tags=[prefix_with_hyphen.split("/")[0]],
                operation_id=operation_id
            )
        app.include_router(router)

for adapter in adapter_registry:
    # Adapter should have a single prefix, by design
    # use hyphens which is the standard
    prefix_with_hyphen = adapter.prefix.replace("_", "-")
    router = APIRouter(prefix=f"/api/{prefix_with_hyphen}")
    if adapter.name in ["v1_celery_task"]:
        path = "/{task_id}/"
    else:
        path = "/"
    router.add_api_route(
        path=path,
        endpoint=adapter.__call__,
        methods=adapter.methods,
        tags=["legacy"],
        deprecated=True
    )
    app.include_router(router)

for util in util_registry:
    for prefix in util.prefixes:
        # use hyphens which is the standard
        prefix_with_hyphen = prefix.replace("_", "-")
        router = APIRouter(prefix=f"/api/{prefix_with_hyphen}")
        # Bind specified util.method to urls /{util.prefixes}/method_name
        for method_name, bind_types in util.methods_to_bind.items():
            if util.name in ["draw"]:
                # hardcode for some util for legacy convention
                path = "/"
            elif util.name in ["selectivity_refs"]:
                # hardcode for some util for legacy convention
                path = "/{pk}"
            elif method_name == "__call__":
                path = "/"
            else:
                method_name_with_hyphen = method_name.replace("_", "-")
                path = f"/{method_name_with_hyphen}"

            tag = prefix_with_hyphen.split("/")[0]
            if tag in ["user", "status", "frontend-config"]:
                tag = "admin"
            else:
                tag = f"utils/{tag}"

            full_api_path = f"/api/{prefix_with_hyphen}{path}"
            operation_key = (full_api_path.rstrip("/"), bind_types[0])
            operation_id = OPERATION_IDS.get(operation_key)
            router.add_api_route(
                path=path,
                endpoint=getattr(util, method_name),
                methods=bind_types,
                tags=[tag],
                operation_id=operation_id
            )
        app.include_router(router)

tooltip_router = APIRouter(prefix="/api/tooltip")

for tooltip_category, content in TOOLTIPS.items():
    tooltip_category_with_hyphen = tooltip_category.replace("_", "-")
    for tooltip_name, tooltip_data in content.items():
        tooltip_name_with_hyphen = tooltip_name.replace("_", "-")
        path = f"/{tooltip_category_with_hyphen}/{tooltip_name_with_hyphen}"
        full_api_path = f"/api/tooltip{path}"
        operation_key = (full_api_path.rstrip("/"), "GET")
        operation_id = OPERATION_IDS.get(operation_key)
        tooltip_router.add_api_route(
            path=path,
            endpoint=lambda d=tooltip_data: d,  # magic; DO NOT CHANGE
            methods=["GET"],
            tags=["tooltip", tooltip_category_with_hyphen],
            operation_id=operation_id
        )
app.include_router(tooltip_router)

runtime_router = APIRouter(prefix="/api/runtime")
runtime_router.add_api_route(
    path="/capabilities",
    endpoint=get_runtime_capabilities,
    methods=["GET"],
    tags=["runtime"],
    operation_id=OPERATION_IDS.get(("/api/runtime/capabilities", "GET"))
)
runtime_router.add_api_route(
    path="/services",
    endpoint=get_runtime_services,
    methods=["GET"],
    tags=["runtime"],
    operation_id=OPERATION_IDS.get(("/api/runtime/services", "GET"))
)
app.include_router(runtime_router)

if os.environ.get("ASKCOS_ENABLE_MCP", "0") == "1":
    from fastapi_mcp import FastApiMCP
    mcp = FastApiMCP(app, include_operations=INCLUDE_OPERATIONS)
    mcp.mount_http(app)


def get_api_worker_count() -> int:
    workers = int(os.environ.get("ASKCOS_API_WORKERS", "1"))
    if not 1 <= workers <= 8:
        raise ValueError("ASKCOS_API_WORKERS must be between 1 and 8")
    return workers


if __name__ == "__main__":
    uvicorn_kwargs = {
        "host": os.environ.get("ASKCOS_BIND_HOST", "127.0.0.1"),
        "port": 9100,
        "ssl_certfile": os.environ.get("ASKCOS_SSL_CERT_FILE"),
        "ssl_keyfile": os.environ.get("ASKCOS_SSL_KEY_FILE"),
    }
    workers = get_api_worker_count()

    if workers > 1:
        uvicorn.run("app:app", workers=workers, **uvicorn_kwargs)
    else:
        uvicorn.run(app, **uvicorn_kwargs)
