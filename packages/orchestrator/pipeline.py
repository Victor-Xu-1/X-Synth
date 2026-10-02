from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from multiprocessing import get_context
from pathlib import Path
from threading import Event, Lock, Thread

from packages.adapters.askcos.engine import AskcosEngine
from packages.adapters.askcos.transport import EngineUnavailable
from packages.adapters.stock.stock_index import (
    StockIndex,
)
from packages.platform.atomic_file import write_json
from packages.platform.leader_lock import LeaderLock
from packages.platform.performance import PerformanceBudget
from packages.route_pool.workflow import (
    AskcosRouteSource,
)

from .job_repository import ACTIVE_STATES, JobConflict, JobRepository
from .review_worker import review_job
from .route_request import RouteJobRequest
from .runtime_health import route_runtime_status


class RoutePipeline:
    def __init__(
        self,
        *,
        repository: JobRepository,
        engine: AskcosEngine,
        stock: StockIndex,
        artifact_root: Path,
        models: list[str],
        budget: PerformanceBudget,
    ):
        self.repository, self.engine, self.stock = repository, engine, stock
        self.artifact_root, self.models, self.budget = (
            artifact_root.resolve(),
            models,
            budget,
        )
        self.stop_event = Event()
        self.thread = None
        self.leader = None
        self.state_lock = Lock()
        self.review_executor = None

    def start(self):
        if self.thread is not None and self.thread.is_alive():
            return
        self.leader = LeaderLock(self.repository.path.with_suffix(".worker.lock"))
        if not self.leader.acquire():
            self.leader.close()
            self.leader = None
            return
        self.stop_event.clear()
        self.repository.recover_interrupted()
        self.review_executor = ProcessPoolExecutor(
            max_workers=self.budget.review_parallelism, mp_context=get_context("spawn")
        )
        self.thread = Thread(
            target=self._schedule, name="x-synth-route-scheduler", daemon=True
        )
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=45)
            if self.thread.is_alive():
                raise RuntimeError(
                    "Product worker did not stop within its lifecycle budget"
                )
        if self.leader is not None:
            self.leader.close()
            self.leader = None
        if self.review_executor is not None:
            self.review_executor.shutdown(wait=True, cancel_futures=True)
            self.review_executor = None

    def _schedule(self):
        admission_errors = 0
        while not self.stop_event.is_set():
            try:
                if not route_runtime_status(Path(__file__).resolve().parents[2])[
                    "route_search_ready"
                ]:
                    self.stop_event.wait(2)
                    continue
                job = self.repository.claim_next(active_limit=self.budget.active_jobs)
                admission_errors = 0
            except (sqlite3.Error, OSError):
                admission_errors += 1
                logging.getLogger(__name__).exception(
                    "Task admission unavailable (attempt %s/3)", admission_errors
                )
                if admission_errors >= 3:
                    return
                self.stop_event.wait(2**admission_errors)
                continue
            if job is None:
                self.stop_event.wait(1)
                continue
            try:
                self.run(job)
            except JobConflict:
                logging.getLogger(__name__).info(
                    "Job changed while its native search was running"
                )
            except EngineUnavailable as exc:
                self._record_failure(
                    job["id"],
                    "waiting_for_engine" if exc.recoverable else "failed",
                    exc.code,
                )
            except Exception:
                logging.getLogger(__name__).exception(
                    "Route pipeline failed for job %s", job["id"]
                )
                self._record_failure(job["id"], "failed", "pipeline_error")

    def _record_failure(self, job_id, status, code):
        try:
            self._transition(job_id, status, error_code=code)
        except JobConflict:
            logging.getLogger(__name__).info(
                "Task %s changed before recording its engine failure", job_id
            )

    def _progress(self, job_id, strategy, value):
        with self.state_lock:
            current = self.repository.get(job_id)
            if current["status"] != "searching":
                return
            checkpoint = current["checkpoint"]
            checkpoint.setdefault("native_progress", {})[strategy] = value
            try:
                self.repository.transition(
                    job_id,
                    "searching",
                    expected_revision=current["revision"],
                    checkpoint=checkpoint,
                )
            except JobConflict:
                logging.getLogger(__name__).info(
                    "Progress arrived after task %s changed", job_id
                )

    def _transition(self, job_id, status, **values):
        with self.state_lock:
            current = self.repository.get(job_id)
            if current["status"] not in ACTIVE_STATES:
                raise JobConflict("Task is no longer active")
            values.pop("expected_revision", None)
            if "checkpoint" in values:
                values["checkpoint"] = {**current["checkpoint"], **values["checkpoint"]}
                if "native_progress" in current["checkpoint"]:
                    values["checkpoint"]["native_progress"] = current["checkpoint"][
                        "native_progress"
                    ]
            return self.repository.transition(
                job_id, status, expected_revision=current["revision"], **values
            )

    def run(self, job: dict):
        request = RouteJobRequest(**job["request"])
        directory = self.artifact_root / job["id"]
        directory.mkdir(parents=True, exist_ok=True)
        sources = []
        checkpoint = job["checkpoint"] or {}
        identity = {
            "stock_snapshot": self.stock.summary["source_sha256"],
            "models": self.models,
            "catalog_sha256": self.stock.summary["catalog_sha256"],
            "review_policy": "exact_stock_template_reconstruction_target_bond_families_v1",
        }
        if checkpoint and any(
            checkpoint.get(key) != value for key, value in identity.items()
        ):
            raise EngineUnavailable(
                "checkpoint_asset_identity_changed", recoverable=False
            )
        checkpoint = {**identity, **checkpoint}
        completed = set(checkpoint.get("completed_searches", []))
        for file in sorted(directory.glob("native-*.json")):
            data = json.loads(file.read_text(encoding="utf-8"))
            sources.append(
                AskcosRouteSource(
                    source=file.stem,
                    payload=data["payload"],
                    engine="askcos_" + data["strategy"],
                )
            )
            completed.add(file.stem.removeprefix("native-").replace("-", ":", 1))
        for pass_number in range(1, request.repair_attempts + 2):
            current = self.repository.get(job["id"])
            if current["status"] not in ACTIVE_STATES:
                return
            children = checkpoint.setdefault("children", {})
            failures = []
            searches = [
                strategy
                for strategy in request.strategies
                if f"{pass_number}:{strategy}" not in completed
            ]
            for strategy in searches:
                key = f"{pass_number}:{strategy}"
                children.setdefault(
                    key, hashlib.sha256(f"{job['id']}:{key}".encode()).hexdigest()[:32]
                )
            current = self._transition(job["id"], "searching", checkpoint=checkpoint)
            cancelled = lambda: self.repository.get(job["id"])["status"] == "cancelled"
            with ThreadPoolExecutor(
                max_workers=self.budget.search_parallelism
            ) as executor:
                futures = {
                    executor.submit(
                        self.engine.search,
                        request,
                        strategy=strategy,
                        models=self.models,
                        child_id=children[f"{pass_number}:{strategy}"],
                        pass_number=pass_number,
                        cancelled=cancelled,
                        interrupted=self.stop_event,
                        progress=lambda value, key=strategy: self._progress(
                            job["id"], key, value
                        ),
                    ): strategy
                    for strategy in searches
                }
                for future in as_completed(futures):
                    strategy = futures[future]
                    try:
                        result = future.result()
                    except EngineUnavailable as exc:
                        failures.append(exc)
                        continue
                    filename = directory / f"native-{pass_number}-{strategy}.json"
                    write_json(
                        filename, {"strategy": strategy, "payload": result.payload}
                    )
                    sources.append(
                        AskcosRouteSource(
                            source=filename.stem,
                            payload=result.payload,
                            engine="askcos_" + strategy,
                        )
                    )
                    completed.add(f"{pass_number}:{strategy}")
                    checkpoint.update(
                        completed_searches=sorted(completed), pass_number=pass_number
                    )
                    current = self.repository.get(job["id"])
                    if current["status"] in ACTIVE_STATES:
                        self._transition(job["id"], "searching", checkpoint=checkpoint)
            current = self.repository.get(job["id"])
            if current["status"] not in ACTIVE_STATES:
                return
            current = self._transition(job["id"], "evaluating", checkpoint=checkpoint)
            pool = self.review_executor.submit(
                review_job,
                job["id"],
                str(directory),
                str(self.stock.path),
                request.min_routes,
                request.max_routes,
            ).result()
            summary = {
                **pool.summary,
                "stock_snapshot": self.stock.summary,
                "pass_number": pass_number,
                "native_runs": [
                    {
                        "source": source.source,
                        "engine": source.engine,
                        "stats": source.payload.get("result", {}).get("stats", {}),
                    }
                    for source in sources
                ],
                "review_policy": "exact_stock_template_reconstruction_target_bond_families_v1",
                "strategy_errors": [error.code for error in failures],
            }
            if summary["meets_min_routes"]:
                return self._transition(
                    job["id"], "completed", summary=summary, checkpoint=checkpoint
                )
            if failures and any(error.recoverable for error in failures):
                return self._transition(
                    job["id"],
                    "waiting_for_engine",
                    summary=summary,
                    checkpoint=checkpoint,
                    error_code=failures[0].code,
                )
            if pass_number == request.repair_attempts + 1:
                status = (
                    "completed_not_enough_routes"
                    if pool.selected_routes
                    else "failed"
                    if failures and not sources
                    else "failed_unclosed"
                )
                return self._transition(
                    job["id"],
                    status,
                    summary=summary,
                    checkpoint=checkpoint,
                    error_code=failures[0].code if status == "failed" else None,
                )
