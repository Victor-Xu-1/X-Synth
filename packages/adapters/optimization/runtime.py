"""One bounded isolated computation, with no browser-facing model or shell loading."""

import json
import os
import subprocess
import threading
import time
from dataclasses import replace
from pathlib import Path

from pydantic import ValidationError

from packages.platform.performance import PerformanceBudget

from .contracts import (
    BAYBE_VERSION,
    MAX_CSV_BYTES,
    OptimizationRequest,
    OptimizationResult,
    RuntimeHealth,
)
from .prepare import prepare_experiment
from .process import WorkerOutputLimit, run_worker
from .tables import export_recommendations


class OptimizationError(RuntimeError):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


class OptimizationRuntime:
    def __init__(
        self,
        *,
        python: Path | None = None,
        timeout: float = 180,
        model_threads: int | None = None,
    ):
        budget = PerformanceBudget.from_environment()
        if model_threads is not None:
            if type(model_threads) is not int:
                raise ValueError("Model thread budget must be an integer.")
            budget = replace(budget, model_threads=model_threads)
        self.model_threads = budget.model_threads
        configured = python or os.environ.get("X_SYNTH_OPTIMIZATION_PYTHON")
        self.python = Path(configured).expanduser().absolute() if configured else None
        self.timeout = timeout
        self.source_root = Path(__file__).resolve().parents[3]
        self._admission = threading.BoundedSemaphore(1)
        self._computing = threading.Event()
        self._health_lock = threading.Lock()
        self._cached_health = None
        self._health_at = 0.0

    def _invoke(self, content: str = "", *, health: bool = False) -> dict:
        if self.python is None or not self.python.is_file():
            raise OptimizationError("BayBE 独立运行环境未配置，请查看环境部署。")
        environment = {
            key: os.environ[key]
            for key in ("HOME", "PATH", "TMPDIR", "SYSTEMROOT")
            if key in os.environ
        }
        environment.update(
            {
                "PYTHONPATH": str(self.source_root),
                "PYTHONNOUSERSITE": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
                "OMP_NUM_THREADS": str(self.model_threads),
                "MKL_NUM_THREADS": str(self.model_threads),
                "OPENBLAS_NUM_THREADS": str(self.model_threads),
                "CUDA_VISIBLE_DEVICES": "",
            }
        )
        command = [
            str(self.python),
            "-s",
            "-m",
            "packages.adapters.optimization.worker",
        ]
        if health:
            command.append("--health")
        try:
            process = run_worker(
                command,
                content=content,
                cwd=self.source_root,
                env=environment,
                timeout=20 if health else self.timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise OptimizationError(
                "BayBE 计算超时，未返回任何建议。请缩小候选或实测记录。", 504
            ) from exc
        except OSError as exc:
            raise OptimizationError("BayBE 独立运行环境无法启动。") from exc
        except (WorkerOutputLimit, UnicodeError) as exc:
            raise OptimizationError(
                "BayBE 输出超过安全上限或编码无效，未返回任何建议。", 502
            ) from exc
        if process.returncode or len(process.stdout.encode("utf-8")) > MAX_CSV_BYTES:
            raise OptimizationError("BayBE 真实计算失败；没有使用替代推荐或演示结果。")
        try:
            return json.loads(process.stdout)
        except (ValueError, TypeError) as exc:
            raise OptimizationError("BayBE 返回了无效的计算响应。", 502) from exc

    def _status(self, *, busy=None, checking=False):
        busy = self._computing.is_set() if busy is None else busy
        if self._cached_health is not None:
            return self._cached_health.model_copy(
                deep=True, update={"busy": busy, "checking": checking}
            )
        return RuntimeHealth(
            ready=False, reason="BayBE 正在核对运行环境。", busy=busy, checking=checking
        )

    def health_snapshot(self) -> RuntimeHealth:
        """Read cached verified readiness immediately, without imports or subprocesses."""
        if self._cached_health is None:
            return RuntimeHealth(
                ready=False,
                reason="not_probed",
                busy=self._computing.is_set(),
                checking=self._health_lock.locked(),
            )
        return self._status(checking=self._health_lock.locked())

    def health(self) -> RuntimeHealth:
        if not self._health_lock.acquire(blocking=False):
            return self._status(checking=True)
        try:
            now = time.monotonic()
            if self._cached_health is not None and now - self._health_at < 60:
                return self._status()
            try:
                if not self._admission.acquire(blocking=False):
                    return self._status(busy=True)
                try:
                    health = RuntimeHealth.model_validate(self._invoke(health=True))
                    if health.versions.get("baybe") != BAYBE_VERSION:
                        raise OptimizationError("BayBE 版本与已核验版本不一致。")
                finally:
                    self._admission.release()
            except (OptimizationError, ValidationError) as exc:
                reason = (
                    str(exc)
                    if isinstance(exc, OptimizationError)
                    else "BayBE 就绪响应无效。"
                )
                health = RuntimeHealth(ready=False, reason=reason)
            self._cached_health, self._health_at = health, now
            return self._status()
        finally:
            self._health_lock.release()

    def recommend(self, request: OptimizationRequest) -> OptimizationResult:
        try:
            prepared = prepare_experiment(request)
        except ValueError as exc:
            raise OptimizationError(str(exc), 422) from exc
        if not self._admission.acquire(blocking=False):
            raise OptimizationError("优化工作区已有一次计算进行中，请稍后再提交。", 429)
        self._computing.set()
        try:
            try:
                result = OptimizationResult.model_validate(
                    self._invoke(request.model_dump_json())
                )
            except ValidationError as exc:
                raise OptimizationError("BayBE 计算结果不符合产品契约。", 502) from exc
            names = [factor.name for factor in request.factors]
            seen = set()
            for row in result.recommendations:
                if set(row.conditions) != set(names):
                    raise OptimizationError("BayBE 返回的条件列不完整。", 502)
                for factor in request.factors:
                    if row.conditions[factor.name] not in factor.values:
                        raise OptimizationError("BayBE 返回了候选空间外的条件。", 502)
                key = tuple(row.conditions[name] for name in names)
                if key in seen or key in prepared.measured_keys:
                    raise OptimizationError("BayBE 返回了重复或已测条件。", 502)
                seen.add(key)
            if (
                result.request_sha256 != prepared.request_sha256
                or result.record_id is not None
                or result.table_sha256 != request.table_sha256
                or result.versions.get("baybe") != BAYBE_VERSION
                or len(result.recommendations) != request.batch_size
                or result.selected_rows != request.selected_rows
                or result.seed != request.seed
                or result.target != request.target
                or result.measurement_count != len(prepared.measurements)
                or result.unique_measured_conditions != len(prepared.measured_keys)
                or result.candidate_count != prepared.candidate_count
                or result.remaining_before_batch != prepared.remaining
                or result.best_observed != prepared.best_observed
            ):
                raise OptimizationError("BayBE 返回的输入快照或实验统计不一致。", 502)
            expected_csv = export_recommendations(
                names,
                request.target.name,
                result.recommendations,
                prepared.request_sha256,
            )
            if result.csv_content != expected_csv:
                raise OptimizationError("BayBE 导出与建议条件不一致。", 502)
            return result
        finally:
            self._computing.clear()
            self._admission.release()
