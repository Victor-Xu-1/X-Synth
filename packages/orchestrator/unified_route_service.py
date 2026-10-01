from __future__ import annotations

from dataclasses import asdict, dataclass, field
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import uuid

from packages.adapters.stock.unified_stock_service import UnifiedStockService


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JOBS_ROOT = REPO_ROOT / "tests" / "real-cases" / "orchestrator-jobs"


@dataclass(frozen=True)
class UnifiedRouteRequest:
    smiles: str
    description: str | None = None
    backend: str = "all"
    expansion_time: int = 1200
    max_paths: int = 200
    askcos_buyables_source: str = "unified_commercial"
    askcos_timeout_sec: int = 1500
    askcos_stall_timeout_sec: int | None = None
    poll_sec: int = 60
    aizynth_model: str = "USPTO"
    aizynth_stock: str = "unified"
    aizynth_timeout_sec: int = 1080
    aizynth_iteration_limit: int = 2000
    aizynth_max_transforms: int = 14
    aizynth_time_limit: int = 900
    total_timeout_sec: int = 3600
    recursive_leaf_depth: int = 64
    recursive_leaf_engines: str = "one_step,aizynthfinder,askcos"
    recursive_leaf_one_step_backends: str = "exact_match,retrosim"
    one_step_retro_backends: str = "template_relevance,exact_match,retrosim"
    recursive_leaf_limit: int = 2
    recursive_leaf_concurrency: int = 2
    recursive_leaf_timeout_sec: int = 600
    min_routes: int = 3
    max_routes: int = 10
    repair_attempts: int = 0
    public: bool = True
    external_stock_paths: list[str] = field(default_factory=list)

    def normalized_smiles(self) -> str:
        value = self.smiles.strip().lstrip("\ufeff")
        if not value:
            raise ValueError("smiles is required")
        return value

    def normalized_description(self) -> str:
        return (self.description or self.normalized_smiles()).strip()

    def normalized_askcos_stall_timeout_sec(self) -> int:
        if self.askcos_stall_timeout_sec is not None and self.askcos_stall_timeout_sec > 0:
            return self.askcos_stall_timeout_sec
        return self.expansion_time + 300


@dataclass(frozen=True)
class UnifiedRouteJobWorkspace:
    job_id: str
    job_dir: Path
    run_dir: Path
    smiles_path: Path
    state_path: Path
    stdout_path: Path
    stderr_path: Path


def make_job_id(prefix: str = "unified") -> str:
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    return f"{prefix}_{timestamp}_{uuid.uuid4().hex[:8]}"


def prepare_job_workspace(
    *,
    root_dir: Path = DEFAULT_JOBS_ROOT,
    job_id: str | None = None,
    request: UnifiedRouteRequest,
) -> UnifiedRouteJobWorkspace:
    safe_job_id = _safe_job_id(job_id or make_job_id())
    job_dir = root_dir / safe_job_id
    run_dir = job_dir / "run"
    job_dir.mkdir(parents=True, exist_ok=False)
    run_dir.mkdir(parents=True, exist_ok=True)

    smiles_path = job_dir / "target.smi"
    smiles_path.write_text(f"{request.normalized_smiles()}\n", encoding="utf-8")

    workspace = UnifiedRouteJobWorkspace(
        job_id=safe_job_id,
        job_dir=job_dir,
        run_dir=run_dir,
        smiles_path=smiles_path,
        state_path=job_dir / "job_state.json",
        stdout_path=job_dir / "stdout.log",
        stderr_path=job_dir / "stderr.log",
    )
    write_job_state(
        workspace,
        {
            "job_id": workspace.job_id,
            "status": "created",
            "created_at": dt.datetime.now().isoformat(),
            "request": asdict(request),
            "run_dir": str(workspace.run_dir),
            "smiles_path": str(workspace.smiles_path),
        },
    )
    return workspace


def build_runner_command(
    *,
    request: UnifiedRouteRequest,
    workspace: UnifiedRouteJobWorkspace,
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    command = [
        sys.executable,
        str(repo_root / "scripts" / "diagnostics" / "run_unified_route_case.py"),
        "--smiles-file",
        str(workspace.smiles_path),
        "--id",
        workspace.job_id,
        "--description",
        request.normalized_description(),
        "--backend",
        request.backend,
        "--base-url",
        os.environ.get("SYNON_ASKCOS_BASE_URL", "http://127.0.0.1:9100"),
        "--expansion-time",
        str(request.expansion_time),
        "--max-paths",
        str(request.max_paths),
        "--askcos-buyables-source",
        request.askcos_buyables_source,
        "--askcos-timeout-sec",
        str(request.askcos_timeout_sec),
        "--askcos-stall-timeout-sec",
        str(request.normalized_askcos_stall_timeout_sec()),
        "--poll-sec",
        str(request.poll_sec),
        "--aizynth-model",
        request.aizynth_model,
        "--aizynth-stock",
        request.aizynth_stock,
        "--aizynth-timeout-sec",
        str(request.aizynth_timeout_sec),
        "--aizynth-iteration-limit",
        str(request.aizynth_iteration_limit),
        "--aizynth-max-transforms",
        str(request.aizynth_max_transforms),
        "--aizynth-time-limit",
        str(request.aizynth_time_limit),
        "--total-timeout-sec",
        str(request.total_timeout_sec),
        "--recursive-leaf-depth",
        str(request.recursive_leaf_depth),
        "--recursive-leaf-engines",
        request.recursive_leaf_engines,
        "--recursive-leaf-one-step-backends",
        request.recursive_leaf_one_step_backends,
        "--one-step-retro-backends",
        request.one_step_retro_backends,
        "--recursive-leaf-limit",
        str(request.recursive_leaf_limit),
        "--recursive-leaf-concurrency",
        str(request.recursive_leaf_concurrency),
        "--recursive-leaf-timeout-sec",
        str(request.recursive_leaf_timeout_sec),
        "--min-routes",
        str(request.min_routes),
        "--max-routes",
        str(request.max_routes),
        "--repair-attempts",
        str(request.repair_attempts),
        "--run-dir",
        str(workspace.run_dir),
    ]
    if request.public:
        command.append("--public")
    for stock_path in resolve_external_stock_paths(request):
        command.extend(["--external-stock", stock_path])
    for supplier in _default_online_suppliers():
        command.extend(["--online-supplier", supplier])
    if os.environ.get("SYNON_ONLINE_SUPPLIER_INSECURE_TLS", "").strip().lower() in {"1", "true", "yes"}:
        command.append("--online-supplier-insecure-tls")
    return command


def write_job_state(workspace: UnifiedRouteJobWorkspace, state: dict) -> None:
    workspace.state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def read_job_state(state_path: Path) -> dict:
    return json.loads(state_path.read_text(encoding="utf-8"))


def resolve_external_stock_paths(request: UnifiedRouteRequest) -> list[str]:
    """Return only usable commercial stock files for route closure.

    The route runner treats stock paths as evidence. Missing files and empty
    stock artifacts should not enter a real task because they make the runtime
    look configured while contributing no purchasable structures.
    """

    return UnifiedStockService(
        repo_root=REPO_ROOT,
        external_stock_paths=request.external_stock_paths,
    ).external_stock_paths()


def _default_online_suppliers() -> list[str]:
    return [
        supplier
        for supplier in UnifiedStockService(repo_root=REPO_ROOT).enabled_online_suppliers()
        if supplier == "pubchem"
    ]


def _safe_job_id(job_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", job_id.strip())
    if not safe:
        raise ValueError("job_id is empty after normalization")
    return safe[:120]
