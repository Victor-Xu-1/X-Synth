"""Persistent child executions; the product repository remains the task owner."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from packages.platform.atomic_file import write_json
from packages.platform.leader_lock import LeaderLock
from packages.platform.performance import PerformanceBudget

from .native_http import NativeProtocolError
from .native_price_client import PriceServiceUnavailable
from .search_artifacts import SearchArtifacts


class SearchCancelled(RuntimeError):
    pass


class ChildSearchBody(BaseModel):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    input: dict


class NativeSearchJobs:
    def __init__(self, strategy: str, runner):
        self.root = (
            Path(
                os.environ.get(
                    "X_SYNTH_STATE_DIR", str(Path.home() / ".local/state/x-synth")
                )
            )
            / "native"
            / strategy
        )
        self.root.mkdir(parents=True, exist_ok=True)
        self.leader = LeaderLock(self.root / "worker.lock")
        if not self.leader.acquire():
            self.leader.close()
            raise RuntimeError("Only one native worker may own each search strategy")
        self.runner, self.lock, self.events = runner, Lock(), {}
        self.artifacts = SearchArtifacts(self.root)
        self.budget = PerformanceBudget.from_environment()
        self.stopping = False
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="native-" + strategy
        )
        for path in self.root.glob("*.json"):
            if not re.fullmatch(r"[a-f0-9]{32}", path.stem):
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            if "payload" in record:
                payload = record.pop("payload")
                target = next(
                    (
                        key
                        for key in payload["uds"]["node_dict"]
                        if ">>" not in key
                        and not any(
                            edge.get("target") == key
                            for edge in payload["uds"].get("graph", [])
                        )
                    ),
                    None,
                )
                if target is None:
                    raise ValueError("Legacy native output has no target node")
                self.artifacts.save(record["id"], payload, target=target)
                record["result_available"] = True
                write_json(path, record)
            if record["status"] in {"queued", "running", "cancelling"}:
                record.update(
                    status="interrupted", error_code="native_worker_restarted"
                )
                write_json(path, record)

    def path(self, identifier):
        if not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise HTTPException(422, "Invalid child search ID")
        return self.root / (identifier + ".json")

    def get(self, identifier):
        path = self.path(identifier)
        if not path.exists():
            raise HTTPException(404, "Native child search does not exist")
        return json.loads(path.read_text(encoding="utf-8"))

    def result_path(self, identifier):
        record = self.get(identifier)
        if record["status"] != "completed":
            raise HTTPException(409, "Native search has not completed")
        try:
            return self.artifacts.result_path(identifier)
        except ValueError as exc:
            raise HTTPException(503, "Native route artifact is unavailable") from exc

    def submit(self, request: ChildSearchBody):
        digest = hashlib.sha256(
            json.dumps(request.input, sort_keys=True, allow_nan=False).encode()
        ).hexdigest()
        path = self.path(request.id)
        with self.lock:
            if path.exists():
                record = self.get(request.id)
                if record["input_sha256"] != digest:
                    raise HTTPException(
                        409, "A child ID cannot identify different search input"
                    )
                if record["status"] != "interrupted":
                    return record
            if len(self.events) >= self.budget.native_queue_size:
                raise HTTPException(429, "Native search queue is full")
            record = {"id": request.id, "input_sha256": digest, "status": "queued"}
            write_json(path, record)
            event = Event()
            self.events[request.id] = event
            self.executor.submit(self._run, request, event)
        return record

    def _run(self, request, event):
        record = {
            "id": request.id,
            "status": "failed",
            "error_code": "native_search_failed",
        }
        try:
            with self.lock:
                record = self.get(request.id)
                record["status"] = "running"
                write_json(self.path(request.id), record)
            if event.is_set():
                raise SearchCancelled()

            def progress(value):
                with self.lock:
                    current = self.get(request.id)
                    current["progress"] = value
                    write_json(self.path(request.id), current)

            payload = self.runner(
                request.input,
                event,
                self.root / (request.id + ".checkpoint.json"),
                progress,
            )
            if event.is_set():
                raise SearchCancelled()
            self.artifacts.save(request.id, payload, target=request.input["smiles"])
            record.update(status="completed", result_available=True)
        except SearchCancelled:
            explicitly_cancelled = self.get(request.id)["status"] == "cancelling"
            record.update(
                status="cancelled"
                if explicitly_cancelled
                else "interrupted"
                if self.stopping
                else "cancelled"
            )
        except Exception as cause:
            logging.getLogger(__name__).exception(
                "Native child search failed: %s", request.id
            )
            recoverable = self.stopping or isinstance(
                cause, (requests.ConnectionError, requests.Timeout, OSError)
            )
            if isinstance(cause, requests.HTTPError):
                recoverable = (
                    cause.response is not None
                    and cause.response.status_code in {408, 429, 500, 502, 503, 504}
                )
            if isinstance(cause, PriceServiceUnavailable):
                recoverable = isinstance(cause.__cause__, requests.RequestException)
            if isinstance(cause, NativeProtocolError):
                recoverable = True
            record.update(
                status="interrupted" if recoverable else "failed",
                error_code="native_dependency_unavailable"
                if recoverable
                else "native_search_failed",
            )
        finally:
            with self.lock:
                latest = self.get(request.id)
                if latest["status"] == "cancelling":
                    record.update(status="cancelled")
                record["progress"] = latest.get("progress", {})
                write_json(self.path(request.id), record)
                self.events.pop(request.id, None)

    def cancel(self, identifier):
        with self.lock:
            record = self.get(identifier)
            event = self.events.get(identifier)
            if event is not None:
                event.set()
                record["status"] = "cancelling"
                write_json(self.path(identifier), record)
            return record

    def close(self):
        self.stopping = True
        for event in list(self.events.values()):
            event.set()
        self.executor.shutdown(wait=True, cancel_futures=False)
        self.leader.close()


def register_search_jobs(app, strategy: str, runner):
    router = APIRouter(prefix="/api/search-jobs")

    @router.post("")
    def submit(request: ChildSearchBody):
        return app.state.search_jobs.submit(request)

    @router.get("/{identifier}")
    def get(identifier: str):
        return app.state.search_jobs.get(identifier)

    @router.get("/{identifier}/result")
    def result(identifier: str):
        return FileResponse(
            app.state.search_jobs.result_path(identifier), media_type="application/json"
        )

    @router.delete("/{identifier}")
    def cancel(identifier: str):
        return app.state.search_jobs.cancel(identifier)

    app.include_router(router)
    return lambda: NativeSearchJobs(strategy, runner)
