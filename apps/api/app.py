from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from rdkit import rdBase

from packages.adapters.askcos.engine import AskcosEngine
from packages.adapters.askcos.transport import AskcosTransport
from packages.adapters.optimization.runtime import OptimizationRuntime
from packages.adapters.stock.stock_index import StockIndex, StockIndexError
from packages.chemistry.assessment import AssessmentUnavailable, assess_molecule
from packages.orchestrator.job_repository import JobRepository
from packages.orchestrator.pipeline import RoutePipeline
from packages.orchestrator.route_request import RouteJobRequest
from packages.orchestrator.runtime_health import route_runtime_status
from packages.platform.performance import PerformanceBudget, PerformanceTargets
from packages.platform.resource_metrics import runtime_resources
from packages.platform.version import product_version, source_build
from packages.workspace.analysis_repository import AnalysisRepository
from packages.workspace.route_repository import RouteDocumentRepository

from .analysis_routes import analysis_router, analysis_runner
from .assessment_routes import assessment_router, process_router
from .condition_routes import condition_router
from .data_routes import data_router
from .document_routes import document_router
from .environment_routes import environment_router
from .impurity_routes import impurity_router
from .job_routes import job_router
from .job_views import route_result
from .native_routes import native_router
from .optimization_routes import optimization_router
from .reaction_routes import reaction_router
from .request_limits import RequestLimitMiddleware
from .result_routes import result_router
from .security import authenticate
from .stock_routes import stock_router
from .structure_routes import structure_router
from .web_assets import WorkbenchAssets

REPO_ROOT = Path(__file__).resolve().parents[2]


def create_app(
    *,
    jobs_root: Path | None = None,
    template_library_path=None,
    repo_root: Path = REPO_ROOT,
) -> FastAPI:
    state_root = Path(
        os.environ.get("X_SYNTH_STATE_DIR", str(Path.home() / ".local/state/x-synth"))
    )
    state_root = Path(jobs_root) if jobs_root is not None else state_root
    budget = PerformanceBudget.from_environment()
    repository = JobRepository(state_root / "jobs.sqlite")
    documents = RouteDocumentRepository(state_root / "workspace.sqlite")
    analyses = AnalysisRepository(state_root / "analyses.sqlite")
    run_analysis = analysis_runner(analyses)
    optimizer = OptimizationRuntime()
    try:
        assess_molecule("CCO")
        assessment_ready = True
    except (ValueError, AssessmentUnavailable):
        assessment_ready = False
    build = source_build(repo_root)
    transport = AskcosTransport(
        os.environ.get("X_SYNTH_ASKCOS_URL", "http://127.0.0.1:9100"), budget=budget
    )
    artifacts = state_root / "routes"
    pipeline = None
    try:
        stock = StockIndex(os.environ["X_SYNTH_STOCK_INDEX"])
        models = [
            value.strip()
            for value in os.environ.get(
                "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
            ).split(",")
            if value.strip()
        ]
        pipeline = RoutePipeline(
            repository=repository,
            engine=AskcosEngine(transport),
            stock=stock,
            artifact_root=artifacts,
            models=models,
            budget=budget,
        )
    except (KeyError, StockIndexError):
        stock = None

    @asynccontextmanager
    async def lifespan(app):
        optimizer.health()
        if pipeline is not None:
            pipeline.start()
        yield
        if pipeline is not None:
            pipeline.stop()

    app = FastAPI(
        title="X-Synth",
        version=product_version(),
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(RequestLimitMiddleware, limit=budget.request_bytes)
    app.state.repository = repository
    app.state.documents = documents
    app.state.pipeline = pipeline

    def readiness():
        result = route_runtime_status(repo_root)
        worker_ready = (
            pipeline is not None
            and pipeline.thread is not None
            and pipeline.thread.is_alive()
        )
        return {
            **result,
            "worker_ready": worker_ready,
            "route_search_ready": result["route_search_ready"] and worker_ready,
        }

    @app.get("/api/v1/health")
    def health():
        ready = readiness()
        worker_ready = (
            pipeline is not None
            and pipeline.thread is not None
            and pipeline.thread.is_alive()
        )
        return {
            "service": "x-synth",
            "status": "running",
            "version": product_version(),
            "build": build,
            "auth_mode": os.environ.get("X_SYNTH_AUTH_MODE", "local"),
            "scientific_tools": {"assessment": assessment_ready, "process": True},
            "scientific_engines": {
                "optimization": optimizer.health_snapshot().model_dump(mode="json"),
                "assessment": {
                    "ready": assessment_ready,
                    "engine": "RDKit",
                    "versions": {"rdkit": rdBase.rdkitVersion},
                },
                "process": {
                    "ready": True,
                    "engine": "RDKit / deterministic mass accounting",
                    "versions": {"rdkit": rdBase.rdkitVersion},
                },
            },
            **ready,
            "worker_ready": worker_ready,
            "route_search_ready": ready["route_search_ready"] and worker_ready,
        }

    @app.get("/api/v1/stock-sources/summary")
    def stock_summary():
        return {
            "snapshot": stock.summary if stock is not None else None,
            "status": "ready" if stock is not None else "unavailable",
        }

    @app.get("/api/v1/session")
    def session(request: Request):
        principal = authenticate(request, transport)
        return {
            "mode": os.environ.get("X_SYNTH_AUTH_MODE", "local"),
            "owner": principal.owner,
            "administrator": principal.administrator,
            "workspace_access": True,
        }

    @app.get("/api/v1/runtime")
    def runtime(request: Request):
        authenticate(request, transport)
        return runtime_snapshot()

    def runtime_snapshot():
        metrics = runtime_resources(state_root / "native/runtime.json")
        return {
            "budget": budget.summary(),
            "resources": metrics,
            "memory_warning": metrics["rss_bytes"]
            > PerformanceTargets().native_rss_warning_bytes,
        }

    app.include_router(
        environment_router(
            transport=transport, read_health=health, read_runtime=runtime_snapshot
        ),
        prefix="/api/v1",
    )

    router = job_router(
        repository=repository,
        transport=transport,
        readiness=readiness,
        artifacts=artifacts,
        budget=budget,
    )
    app.include_router(router, prefix="/api/v1")
    app.include_router(
        document_router(
            documents=documents,
            repository=repository,
            transport=transport,
            artifacts=artifacts,
            budget=budget,
        ),
        prefix="/api/v1",
    )
    data = data_router(
        template_path=template_library_path
        or os.environ.get("X_SYNTH_TEMPLATE_LIBRARY_DB"),
        transport=transport,
    )
    app.include_router(data, prefix="/api/v1")
    app.include_router(stock_router(stock=stock, transport=transport), prefix="/api/v1")
    app.include_router(
        condition_router(
            transport=transport,
            budget=budget,
            read_health=health,
            run_analysis=run_analysis,
        ),
        prefix="/api/v1",
    )
    app.include_router(
        reaction_router(
            transport=transport,
            budget=budget,
            read_health=health,
            run_analysis=run_analysis,
        ),
        prefix="/api/v1",
    )
    app.include_router(
        analysis_router(repository=analyses, transport=transport),
        prefix="/api/v1",
    )
    app.include_router(
        assessment_router(
            transport=transport, budget=budget, run_analysis=run_analysis
        ),
        prefix="/api/v1",
    )
    app.include_router(
        process_router(transport=transport, budget=budget, run_analysis=run_analysis),
        prefix="/api/v1",
    )
    app.include_router(
        optimization_router(
            transport=transport, runtime=optimizer, run_analysis=run_analysis
        ),
        prefix="/api/v1",
    )
    app.include_router(
        impurity_router(
            transport=transport,
            budget=budget,
            read_health=health,
            run_analysis=run_analysis,
        ),
        prefix="/api/v1",
    )
    app.include_router(
        structure_router(transport=transport, budget=budget), prefix="/api/v1"
    )
    app.include_router(
        result_router(repository=repository, transport=transport), prefix="/api"
    )

    @app.get("/api/results/retrieve")
    def retrieve_result(result_id: str, request: Request):
        principal = authenticate(request, transport)
        job = repository.get(result_id, owner=principal.owner)
        if job is None:
            raise HTTPException(404, "Task does not exist")
        return route_result(job, artifacts=artifacts, budget=budget)

    app.include_router(native_router(transport=transport, budget=budget), prefix="/api")
    web_directory = os.environ.get("X_SYNTH_WEB_DIST")
    if web_directory:
        path = Path(web_directory).resolve()
        if not (path / "index.html").is_file():
            raise RuntimeError("Build the workbench before starting the product host")
        app.mount("/", WorkbenchAssets(directory=path, html=True), name="workbench")
    return app


UnifiedRouteRequestBody = RouteJobRequest
app = create_app()
