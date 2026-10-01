from __future__ import annotations

import datetime as dt
from dataclasses import asdict, replace
import json
import math
import os
import re
import signal
from pathlib import Path
import subprocess
import threading
from typing import Annotated, Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from packages.knowledge_base.template_library import TemplateLibraryService, TemplateRecord
from packages.adapters.stock.unified_stock_service import UnifiedStockService
from packages.orchestrator.runtime_health import route_runtime_status
from packages.orchestrator.unified_route_service import (
    DEFAULT_JOBS_ROOT,
    REPO_ROOT,
    UnifiedRouteJobWorkspace,
    UnifiedRouteRequest,
    build_runner_command,
    prepare_job_workspace,
    read_job_state,
    write_job_state,
)


class UnifiedRouteRequestBody(BaseModel):
    smiles: str
    description: str | None = None
    backend: str = "all"
    expansion_time: int = Field(default=1200, ge=1)
    max_paths: int = Field(default=200, ge=1)
    askcos_buyables_source: str = "unified_commercial"
    askcos_timeout_sec: int = Field(default=1500, ge=60, le=3600)
    askcos_stall_timeout_sec: int | None = Field(default=None, ge=60)
    poll_sec: int = Field(default=60, ge=1)
    aizynth_model: str = "USPTO"
    aizynth_stock: str = "unified"
    aizynth_timeout_sec: int = Field(default=1080, ge=60, le=3600)
    aizynth_iteration_limit: int = Field(default=2000, ge=100, le=10000)
    aizynth_max_transforms: int = Field(default=14, ge=1, le=30)
    aizynth_time_limit: int = Field(default=900, ge=60, le=3600)
    total_timeout_sec: int = Field(default=3600, ge=600, le=3600)
    recursive_leaf_depth: int = Field(default=64, ge=0, le=64)
    recursive_leaf_engines: str = "one_step,aizynthfinder,askcos"
    recursive_leaf_one_step_backends: str = "exact_match,retrosim"
    one_step_retro_backends: str = "template_relevance,exact_match,retrosim"
    recursive_leaf_limit: int = Field(default=2, ge=1, le=10)
    recursive_leaf_concurrency: int = Field(default=2, ge=1, le=2)
    recursive_leaf_timeout_sec: int = Field(default=600, ge=60, le=1800)
    min_routes: int = Field(default=3, ge=1)
    max_routes: int = Field(default=10, ge=1)
    repair_attempts: int = Field(default=0, ge=0, le=3)
    public: bool = True
    external_stock_paths: list[str] = Field(default_factory=list)

    def to_service_request(self) -> UnifiedRouteRequest:
        return UnifiedRouteRequest(
            smiles=self.smiles,
            description=self.description,
            backend=self.backend,
            expansion_time=self.expansion_time,
            max_paths=self.max_paths,
            askcos_buyables_source=self.askcos_buyables_source,
            askcos_timeout_sec=self.askcos_timeout_sec,
            askcos_stall_timeout_sec=self.askcos_stall_timeout_sec,
            poll_sec=self.poll_sec,
            aizynth_model=self.aizynth_model,
            aizynth_stock=self.aizynth_stock,
            aizynth_timeout_sec=self.aizynth_timeout_sec,
            aizynth_iteration_limit=self.aizynth_iteration_limit,
            aizynth_max_transforms=self.aizynth_max_transforms,
            aizynth_time_limit=self.aizynth_time_limit,
            total_timeout_sec=self.total_timeout_sec,
            recursive_leaf_depth=self.recursive_leaf_depth,
            recursive_leaf_engines=self.recursive_leaf_engines,
            recursive_leaf_one_step_backends=self.recursive_leaf_one_step_backends,
            one_step_retro_backends=self.one_step_retro_backends,
            recursive_leaf_limit=self.recursive_leaf_limit,
            recursive_leaf_concurrency=self.recursive_leaf_concurrency,
            recursive_leaf_timeout_sec=self.recursive_leaf_timeout_sec,
            min_routes=self.min_routes,
            max_routes=self.max_routes,
            repair_attempts=self.repair_attempts,
            public=self.public,
            external_stock_paths=self.external_stock_paths,
        )


class TemplateQueryBody(BaseModel):
    strategy: str | None = None
    sources: list[str] = Field(default_factory=list)
    domain: str | None = None
    min_count: int | None = Field(default=None, ge=0)
    limit: int = Field(default=100, ge=1, le=1000)
    direction: str | None = None


class UnifiedRouteResumeBody(BaseModel):
    recursive_leaf_depth: int | None = Field(default=None, ge=1, le=64)


def create_app(
    *,
    jobs_root: Path = DEFAULT_JOBS_ROOT,
    template_library_path: Path | str | None = None,
    repo_root: Path = REPO_ROOT,
) -> FastAPI:
    app = FastAPI(title="Synon unified route orchestrator", docs_url=None, redoc_url=None, openapi_url=None)
    if _env_flag("SYNON_AUTO_RESUME_INTERRUPTED_JOBS"):
        app.router.add_event_handler(
            "startup",
            lambda: _recover_interrupted_jobs(jobs_root),
        )

    def template_service() -> TemplateLibraryService:
        configured_path = template_library_path or os.getenv("SYNON_TEMPLATE_LIBRARY_DB")
        if not configured_path:
            raise HTTPException(status_code=503, detail="template library database is not configured")
        try:
            return TemplateLibraryService(configured_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def stock_service() -> UnifiedStockService:
        return UnifiedStockService(repo_root=repo_root)

    @app.get("/synon-api/health")
    def health() -> dict[str, Any]:
        return {
            "service": "synon-unified-route-orchestrator",
            "status": "running",
            "repo_root": str(REPO_ROOT),
            "jobs_root": str(jobs_root),
            **route_runtime_status(repo_root),
        }

    @app.get("/synon-api/template-library/health")
    def template_library_health() -> dict[str, Any]:
        summary = template_service().summary()
        return {
            "service": "synon-template-library",
            "status": "ready",
            **summary,
        }

    @app.get("/synon-api/stock-sources/summary")
    def stock_sources_summary() -> dict[str, Any]:
        return stock_service().summary()

    @app.post("/synon-api/template-library/query")
    def query_template_library(body: TemplateQueryBody) -> dict[str, Any]:
        templates = template_service().query_templates(
            strategy=body.strategy,
            sources=body.sources or None,
            domain=body.domain,
            min_count=body.min_count,
            limit=body.limit,
            direction=body.direction,
        )
        return {
            "count": len(templates),
            "templates": [_template_record_response(template) for template in templates],
        }

    @app.post("/synon-api/unified-route/call-async")
    def submit_unified_route(
        body: UnifiedRouteRequestBody,
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        if not route_runtime_status(repo_root)["route_search_ready"]:
            raise HTTPException(status_code=503, detail="搜索后端尚未就绪，未创建任务。请检查 ASKCOS 服务、引擎环境和商业库存索引。")
        request = body.to_service_request()
        workspace = prepare_job_workspace(root_dir=jobs_root, request=request)
        state = _start_or_resume_job_process(
            workspace=workspace,
            request=request,
            authorization=authorization,
            append_logs=False,
        )
        return {
            "job_id": workspace.job_id,
            "task_id": workspace.job_id,
            "status": state["status"],
            "status_url": f"/synon-api/unified-route/jobs/{workspace.job_id}",
            "run_dir": str(workspace.run_dir),
        }

    @app.post("/synon-api/unified-route/jobs/{job_id}/resume")
    def resume_unified_route_job(
        job_id: str,
        body: UnifiedRouteResumeBody | None = None,
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        state_path = jobs_root / job_id / "job_state.json"
        if not state_path.is_file():
            raise HTTPException(status_code=404, detail="job not found")
        state = read_job_state(state_path)
        if not _state_process_is_dead(state):
            raise HTTPException(status_code=409, detail="job is already running")
        request = _request_from_state(state)
        if body is not None and body.recursive_leaf_depth is not None:
            request = replace(
                request,
                recursive_leaf_depth=body.recursive_leaf_depth,
            )
            state["request"] = asdict(request)
            state_path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        workspace = _workspace_from_state_path(state_path, state)
        state = _start_or_resume_job_process(
            workspace=workspace,
            request=request,
            authorization=authorization,
            append_logs=True,
        )
        return {
            "job_id": workspace.job_id,
            "task_id": workspace.job_id,
            "status": state["status"],
            "status_url": f"/synon-api/unified-route/jobs/{workspace.job_id}",
            "run_dir": str(workspace.run_dir),
            "resumed": True,
        }

    @app.get("/synon-api/unified-route/jobs/{job_id}")
    def get_unified_route_job(job_id: str) -> dict[str, Any]:
        state_path = jobs_root / job_id / "job_state.json"
        if not state_path.is_file():
            raise HTTPException(status_code=404, detail="job not found")
        return _job_response_from_state_path(state_path)

    @app.get("/synon-api/unified-route/jobs")
    def list_unified_route_jobs(limit: int = 100) -> dict[str, Any]:
        state_paths = sorted(
            jobs_root.glob("*/job_state.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        jobs = []
        for state_path in state_paths[: max(1, min(limit, 500))]:
            try:
                jobs.append(_compact_job_response(_job_response_from_state_path(state_path), state_path))
            except (OSError, json.JSONDecodeError, ValueError):
                continue
        return {"count": len(jobs), "jobs": jobs}

    return app


def _template_record_response(record: TemplateRecord) -> dict[str, Any]:
    return {
        "template_id": record.template_id,
        "source": record.source,
        "template_set": record.template_set,
        "direction": record.direction,
        "domain": record.domain,
        "reaction_smarts": record.reaction_smarts,
        "count": record.count,
        "necessary_reagent": record.necessary_reagent,
        "ring_delta": record.ring_delta,
        "chiral_delta": record.chiral_delta,
        "references": record.references,
    }


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    token = authorization[len(prefix):].strip()
    return token or None


def _runtime_progress_from_run_dir(run_dir: Path) -> dict[str, Any] | None:
    recursive_dir = run_dir / "recursive_leaf_search"
    depth_targets = list(recursive_dir.glob("depth_*_targets.json"))
    if depth_targets:
        latest = max(depth_targets, key=lambda path: path.stat().st_mtime_ns)
        match = re.search(r"depth_(\d+)_targets", latest.name)
        try:
            payload = json.loads(latest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        targets = payload.get("targets") if isinstance(payload.get("targets"), list) else []
        return {
            "phase": "recursive_closure",
            "depth": int(match.group(1)) if match else None,
            "leaf_count": len(targets),
        }

    engines: list[str] = []
    engine_statuses: list[dict[str, Any]] = []
    if (run_dir / "request.json").is_file():
        engines.append("aizynthfinder")
        aizynth_status: dict[str, Any] = {
            "engine": "aizynthfinder",
            "state": "running",
        }
        if (run_dir / "aizynthfinder_result.json").is_file():
            aizynth_status["state"] = "completed"
        elif (run_dir / "aizynthfinder_error.json").is_file():
            aizynth_status["state"] = "failed"
        engine_statuses.append(aizynth_status)
    for task_path in sorted(run_dir.glob("askcos_*_task_id.txt")):
        engine = task_path.name.removesuffix("_task_id.txt")
        engines.append(engine)
        status: dict[str, Any] = {
            "engine": engine,
            "state": "submitted",
            "task_id": task_path.read_text(encoding="utf-8").strip() or None,
        }
        poll_path = run_dir / f"{engine}_poll_summary.json"
        if poll_path.is_file():
            try:
                poll = json.loads(poll_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                poll = {}
            status["state"] = poll.get("result_state") or status["state"]
            status["route_count"] = poll.get("num_trees")
            if isinstance(poll.get("stats"), dict):
                status["stats"] = poll["stats"]
        if (run_dir / f"{engine}_result.json").is_file():
            status["state"] = "completed"
        elif (run_dir / f"{engine}_error.json").is_file():
            status["state"] = "failed"
        elif (run_dir / f"{engine}_timeout.json").is_file():
            status["state"] = "timed_out_recoverable"
        engine_statuses.append(status)
    if engines:
        return {
            "phase": "primary_search",
            "engines": sorted(set(engines)),
            "engine_statuses": engine_statuses,
        }
    return None

def _job_response_from_state_path(state_path: Path) -> dict[str, Any]:
    state = read_job_state(state_path)
    run_dir = Path(state.get("run_dir", ""))
    runtime_progress = _runtime_progress_from_run_dir(run_dir)
    summary_path = run_dir / "summary.json"
    interim_summary_path = run_dir / "interim_summary.json"
    pid = state.get("pid")
    process_running = (
        state.get("status") == "running"
        and isinstance(pid, int)
        and _process_exists(pid)
        and not _state_has_process_failure(state)
    )
    if process_running:
        request_payload = state.get("request")
        request = None
        if isinstance(request_payload, dict) and request_payload.get("smiles"):
            try:
                request = _request_from_state(state)
            except (TypeError, ValueError):
                request = None
        if request is not None:
            state["runtime_consumed_seconds"] = round(
                _runtime_consumed_seconds(state),
                1,
            )
            state["runtime_budget_remaining_seconds"] = _remaining_runtime_seconds(
                state,
                request,
            )
        active_summary_path = (
            interim_summary_path if interim_summary_path.is_file() else summary_path
        )
        if active_summary_path.is_file():
            summary = json.loads(active_summary_path.read_text(encoding="utf-8"))
            state["summary"] = summary
            state["selected_route_count"] = summary.get("selected_route_count")
            state["closed_route_count"] = summary.get("closed_route_count")
            state["askcos_task_id"] = summary.get("askcos_task_id")
            selected_count = summary.get("selected_route_count")
            state["status"] = (
                "partial_ready"
                if summary.get("meets_min_routes")
                or (isinstance(selected_count, int) and selected_count > 0)
                else "running"
            )
        state["progress"] = runtime_progress or state.get("progress")
        return state
    if summary_path.is_file():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        state["summary"] = summary
        state["progress"] = summary.get("progress") or runtime_progress
        runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
        if _state_has_process_failure(state) or summary.get("write_back_error"):
            state["status"] = "failed"
        elif summary.get("meets_min_routes"):
            state["status"] = "completed"
        elif state.get("status") == "time_budget_exhausted" or runtime.get("budget_exhausted"):
            state["status"] = "time_budget_exhausted"
        else:
            state["status"] = "completed_not_enough_routes"
        state["selected_route_count"] = summary.get("selected_route_count")
        state["closed_route_count"] = summary.get("closed_route_count")
        state["askcos_task_id"] = summary.get("askcos_task_id")
        return state
    if interim_summary_path.is_file():
        summary = json.loads(interim_summary_path.read_text(encoding="utf-8"))
        state["summary"] = summary
        state["progress"] = summary.get("progress") or runtime_progress
        if state.get("status") != "running":
            # Persisted terminal/recovery states outrank stale progress files.
            # An interrupted task may legitimately have an interim summary,
            # but that must never make the API report it as active again.
            pass
        elif summary.get("meets_min_routes"):
            state["status"] = "partial_ready"
        elif _state_has_process_failure(state):
            state["status"] = "failed"
        elif _state_process_is_dead(state):
            state["status"] = "interrupted_recoverable"
        else:
            state["status"] = "running"
        state["selected_route_count"] = summary.get("selected_route_count")
        state["closed_route_count"] = summary.get("closed_route_count")
        state["askcos_task_id"] = summary.get("askcos_task_id")
        return state
    if runtime_progress:
        state["progress"] = runtime_progress
    if _state_has_process_failure(state):
        state["status"] = "failed"
    elif _state_process_is_dead(state):
        state["status"] = "interrupted_recoverable"
    return state


def _compact_job_response(state: dict[str, Any], state_path: Path) -> dict[str, Any]:
    summary = state.get("summary") if isinstance(state.get("summary"), dict) else {}
    request = state.get("request") if isinstance(state.get("request"), dict) else {}
    return {
        "job_id": state.get("job_id") or state_path.parent.name,
        "status": state.get("status"),
        "target_smiles": summary.get("smiles") or request.get("smiles"),
        "description": summary.get("description") or request.get("description"),
        "created_at": state.get("created_at"),
        "modified": _iso_from_mtime(state_path),
        "run_dir": state.get("run_dir"),
        "selected_route_count": summary.get("selected_route_count", state.get("selected_route_count")),
        "closed_route_count": summary.get("closed_route_count", state.get("closed_route_count")),
        "meets_min_routes": summary.get("meets_min_routes"),
        "askcos_task_id": state.get("askcos_task_id") or summary.get("askcos_task_id"),
        "summary": summary or None,
        "progress": state.get("progress"),
    }


def _iso_from_mtime(path: Path) -> str:
    return dt.datetime.fromtimestamp(path.stat().st_mtime).isoformat()


def _state_process_is_dead(state: dict[str, Any]) -> bool:
    pid = state.get("pid")
    return isinstance(pid, int) and not _process_exists(pid)


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _runtime_consumed_seconds(
    state: dict[str, Any],
    *,
    now: dt.datetime | None = None,
) -> float:
    raw_consumed = state.get("runtime_consumed_seconds", 0)
    try:
        consumed = max(0.0, float(raw_consumed))
    except (TypeError, ValueError):
        consumed = 0.0
    started_at = state.get("attempt_started_at")
    if state.get("status") != "running" or not isinstance(started_at, str):
        return consumed
    try:
        started = dt.datetime.fromisoformat(started_at)
    except ValueError:
        return consumed
    current = now or dt.datetime.now(tz=started.tzinfo)
    if current.tzinfo != started.tzinfo:
        current = current.replace(tzinfo=started.tzinfo)
    return consumed + max(0.0, (current - started).total_seconds())


def _remaining_runtime_seconds(
    state: dict[str, Any],
    request: UnifiedRouteRequest,
    *,
    now: dt.datetime | None = None,
) -> int:
    consumed = _runtime_consumed_seconds(state, now=now)
    return max(0, math.ceil(request.total_timeout_sec - consumed))


def _recover_interrupted_jobs(
    jobs_root: Path,
    *,
    now: dt.datetime | None = None,
) -> dict[str, int]:
    counts = {"resumed": 0, "budget_exhausted": 0, "failed": 0}
    for state_path in sorted(jobs_root.glob("*/job_state.json")):
        try:
            state = read_job_state(state_path)
        except (OSError, json.JSONDecodeError):
            counts["failed"] += 1
            continue
        if state.get("status") != "running" or not _state_process_is_dead(state):
            continue
        if not isinstance(state.get("attempt_started_at"), str):
            state["status"] = "interrupted_recoverable"
            state["recovery_error"] = "missing persisted attempt start time"
            state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            counts["failed"] += 1
            continue
        try:
            request = _request_from_state(state)
            consumed = _runtime_consumed_seconds(state, now=now)
            state["runtime_consumed_seconds"] = consumed
            state.pop("attempt_started_at", None)
            state.pop("pid", None)
            if consumed >= request.total_timeout_sec:
                state["status"] = "time_budget_exhausted"
                state["runtime_budget_sec"] = request.total_timeout_sec
                state["finished_at"] = (now or dt.datetime.now()).isoformat()
                state_path.write_text(
                    json.dumps(state, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                counts["budget_exhausted"] += 1
                continue
            state_path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            workspace = _workspace_from_state_path(state_path, state)
            _start_or_resume_job_process(
                workspace=workspace,
                request=request,
                authorization=None,
                append_logs=True,
            )
            counts["resumed"] += 1
        except Exception as exc:  # noqa: BLE001 - preserve recoverable state and continue other jobs.
            state["status"] = "interrupted_recoverable"
            state["recovery_error"] = str(exc)
            state_path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            counts["failed"] += 1
    return counts


def _state_has_process_failure(state: dict[str, Any]) -> bool:
    exit_code = state.get("exit_code")
    return isinstance(exit_code, int) and exit_code != 0


def _process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _watch_job_process(
    state_path: Path,
    process: subprocess.Popen,
    *,
    total_timeout_sec: int,
) -> None:
    timed_out = False
    try:
        try:
            exit_code = process.wait(timeout=max(1, total_timeout_sec))
        except TypeError:
            # Small test doubles and legacy process wrappers may not accept timeout.
            exit_code = process.wait()
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            exit_code = process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            exit_code = process.wait()

    try:
        state = read_job_state(state_path)
    except (OSError, json.JSONDecodeError):
        return
    finished_at = dt.datetime.now()
    state["runtime_consumed_seconds"] = _runtime_consumed_seconds(
        state,
        now=finished_at,
    )
    request_payload = state.get("request") if isinstance(state.get("request"), dict) else {}
    original_budget = request_payload.get("total_timeout_sec", total_timeout_sec)
    try:
        original_budget = max(1, int(original_budget))
    except (TypeError, ValueError):
        original_budget = total_timeout_sec
    state["runtime_budget_remaining_seconds"] = max(
        0,
        math.ceil(original_budget - state["runtime_consumed_seconds"]),
    )
    state.pop("attempt_started_at", None)
    state["exit_code"] = exit_code
    state["finished_at"] = finished_at.isoformat()
    if timed_out:
        state["status"] = "time_budget_exhausted"
        state["runtime_budget_sec"] = original_budget
    elif state.get("status") == "running":
        state["status"] = "exited" if exit_code == 0 else "failed"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _start_or_resume_job_process(
    *,
    workspace: UnifiedRouteJobWorkspace,
    request: UnifiedRouteRequest,
    authorization: str | None,
    append_logs: bool,
) -> dict[str, Any]:
    state = read_job_state(workspace.state_path)
    consumed = _runtime_consumed_seconds(state)
    state["runtime_consumed_seconds"] = consumed
    state.pop("attempt_started_at", None)
    remaining_runtime = _remaining_runtime_seconds(state, request)
    if remaining_runtime <= 0:
        raise HTTPException(status_code=409, detail="job runtime budget is exhausted")
    effective_request = replace(request, total_timeout_sec=remaining_runtime)
    command = build_runner_command(request=effective_request, workspace=workspace)
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{REPO_ROOT}:{env.get('PYTHONPATH', '')}".rstrip(":")
    token = _bearer_token(authorization)
    if token:
        env["SYNON_ASKCOS_TOKEN"] = token

    log_mode = "a" if append_logs else "w"
    stdout = workspace.stdout_path.open(log_mode, encoding="utf-8")
    stderr = workspace.stderr_path.open(log_mode, encoding="utf-8")
    if append_logs:
        marker = f"\n--- resumed {dt.datetime.now().isoformat()} ---\n"
        stdout.write(marker)
        stderr.write(marker)
        stdout.flush()
        stderr.flush()
    try:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            env=env,
            stdout=stdout,
            stderr=stderr,
            text=True,
            start_new_session=True,
        )
    except Exception:
        stdout.close()
        stderr.close()
        raise

    attempt_started_at = dt.datetime.now().isoformat()
    state.update(
        {
            "status": "running",
            "pid": process.pid,
            "command": command,
            "attempt_started_at": attempt_started_at,
            "runtime_budget_remaining_seconds": remaining_runtime,
            "stdout_path": str(workspace.stdout_path),
            "stderr_path": str(workspace.stderr_path),
        }
    )
    if append_logs:
        state["resumed_at"] = dt.datetime.now().isoformat()
        state.pop("exit_code", None)
        state.pop("finished_at", None)
    write_job_state(workspace, state)
    threading.Thread(
        target=_watch_job_process,
        args=(workspace.state_path, process),
        kwargs={"total_timeout_sec": remaining_runtime},
        daemon=True,
    ).start()
    return state


def _request_from_state(state: dict[str, Any]) -> UnifiedRouteRequest:
    payload = state.get("request")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="job has no resumable request")
    return UnifiedRouteRequest(**payload)


def _workspace_from_state_path(state_path: Path, state: dict[str, Any]) -> UnifiedRouteJobWorkspace:
    job_dir = state_path.parent
    run_dir = Path(state.get("run_dir") or job_dir / "run")
    smiles_path = Path(state.get("smiles_path") or job_dir / "target.smi")
    return UnifiedRouteJobWorkspace(
        job_id=job_dir.name,
        job_dir=job_dir,
        run_dir=run_dir,
        smiles_path=smiles_path,
        state_path=state_path,
        stdout_path=Path(state.get("stdout_path") or job_dir / "stdout.log"),
        stderr_path=Path(state.get("stderr_path") or job_dir / "stderr.log"),
    )


app = create_app()
