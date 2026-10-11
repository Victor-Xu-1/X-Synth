"""Bounded, read-only history projection without chemical work on request threads."""
from collections import OrderedDict
from copy import deepcopy
import sqlite3
from pathlib import Path
from threading import Event, Lock, Thread

from packages.adapters.askcos.transport import EngineUnavailable
from packages.platform.performance import HistoryReviewLimits
from .delivery_review import pending_routes_review, selected_review_valid
from .review_execution import CancellableReview
from .history_review_identity import snapshot_identifier, review_token, projection_job, review_context, artifact_identity


def review_batch(loader, jobs):
    return [loader(job) for job in jobs]


class HistoryReviewIndex:
    def __init__(self, *, artifacts, loader, idle=lambda: True, limits=None):
        self.artifacts = Path(artifacts).resolve()
        self.loader, self.idle = loader, idle
        self.limits = limits or HistoryReviewLimits()
        self._entries, self._pending, self._inflight, self._desired = OrderedDict(), OrderedDict(), {}, OrderedDict()
        self._lock, self._stop, self._wake = Lock(), Event(), Event()
        self._executor, self._thread = None, None

    def token(self, job):
        return review_token(self.artifacts, job)

    def start(self):
        with self._lock:
            if self._thread is not None or self._stop.is_set():
                return
            self._executor = CancellableReview()
            self._thread = Thread(target=self._run, name="x-synth-history-review", daemon=True)
            self._thread.start()

    def read(self, job):
        snapshot = snapshot_identifier(job)
        unavailable = pending_routes_review(job["id"], snapshot, unavailable=True)
        if self._stop.is_set():
            return unavailable
        try:
            token = review_context(job)
        except (OSError, ValueError, TypeError):
            return unavailable
        identifier = job["id"]
        revision = job.get("revision", 0)
        if type(revision) is not int or revision < 0:
            return unavailable
        with self._lock:
            previous = self._desired.get(identifier)
            if previous is not None and revision < previous[1]:
                return pending_routes_review(identifier, snapshot)
            self._desired[identifier] = (token, revision)
            self._desired.move_to_end(identifier)
            self._trim_desired()
            retained = self._entries.get(identifier)
            if retained is not None and retained[0] == token:
                actual_snapshot = retained[2]["source_binding"]["snapshot_id"]
                try:
                    matches = (snapshot is None or snapshot == actual_snapshot) and retained[1] == artifact_identity(self.artifacts, job, actual_snapshot)
                except (OSError, ValueError):
                    return unavailable
                if matches:
                    self._entries.move_to_end(identifier)
                    return deepcopy(retained[2])
            if self._inflight.get(identifier) != token and len(self._pending) < self.limits.max_pending:
                self._pending[identifier] = (token, deepcopy(projection_job(job)))
                self._wake.set()
        return pending_routes_review(identifier, snapshot)

    def remember(self, job, receipt, *, token=None, source_identity=None):
        expected_snapshot = snapshot_identifier(job)
        if expected_snapshot is None and "published_result" not in (job.get("checkpoint") or {}) and isinstance(receipt, dict):
            expected_snapshot = receipt.get("source_binding", {}).get("snapshot_id")
        if not selected_review_valid(receipt, job_id=job["id"], snapshot_id=expected_snapshot):
            raise ValueError("History review result belongs to another publication")
        current = review_context(job)
        current_source = artifact_identity(self.artifacts, job, expected_snapshot)
        revision = job.get("revision", 0)
        if type(revision) is not int or revision < 0:
            raise ValueError("Invalid review projection revision")
        if isinstance(token, tuple):
            before, before_source = token
            if before != current or before_source != current_source:
                return False
        elif token is not None and token != current:
            return False
        if source_identity is not None and source_identity != current_source:
            return False
        with self._lock:
            if self._stop.is_set():
                return False
            desired = self._desired.get(job["id"])
            if desired is not None and desired[0] != current and (
                token is not None or revision < desired[1]
            ):
                return False
            retained = self._entries.get(job["id"])
            if (token is not None and receipt["status"] != "ready" and retained is not None
                    and retained[0] == current and retained[1] == current_source and retained[2]["status"] == "ready"):
                return False
            self._desired[job["id"]] = (current, revision)
            self._desired.move_to_end(job["id"])
            self._trim_desired()
            self._entries[job["id"]] = (current, current_source, deepcopy(receipt))
            self._entries.move_to_end(job["id"])
            if self._pending.get(job["id"], (None,))[0] == current:
                self._pending.pop(job["id"], None)
            while len(self._entries) > self.limits.max_entries:
                self._entries.popitem(last=False)
        return True

    def _trim_desired(self):
        while len(self._desired) > self.limits.max_entries + self.limits.max_pending + self.limits.batch_size:
            self._desired.popitem(last=False)

    def _idle(self):
        try:
            return not self._stop.is_set() and self.idle()
        except (OSError, sqlite3.Error):
            return False

    def _unavailable(self, batch):
        for token, job in batch:
            try:
                self.remember(job, pending_routes_review(job["id"], snapshot_identifier(job), unavailable=True), token=token)
            except (OSError, ValueError, TypeError):
                pass  # A changed/unreadable artifact is never cached as approved.

    def _run(self):
        while not self._stop.is_set():
            self._wake.wait(self.limits.idle_wait_seconds)
            if not self._idle():
                self._stop.wait(self.limits.idle_wait_seconds)
                continue
            with self._lock:
                batch = [self._pending.popitem(last=False)[1] for _ in
                         range(min(len(self._pending), self.limits.batch_size))]
                if not self._pending:
                    self._wake.clear()
                self._inflight.update((job["id"], token) for token, job in batch)
            if not batch:
                continue
            interrupted = lambda: not self._idle()
            try:
                results = self._executor.run(review_batch, self.loader, [job for _, job in batch], interrupted=interrupted)
                if not isinstance(results, list) or len(results) != len(batch):
                    raise ValueError("Invalid history projection batch")
                for (token, job), result in zip(batch, results, strict=True):
                    if not isinstance(result, tuple) or len(result) != 2:
                        raise ValueError("Invalid history source projection")
                    receipt, identity = result
                    if receipt.get("status") != "pending":
                        self.remember(job, receipt, token=token, source_identity=identity)
            except EngineUnavailable as error:
                if error.code == "review_interrupted" and not self._stop.is_set():
                    with self._lock:
                        for token, job in batch:
                            if job["id"] not in self._pending and len(self._pending) < self.limits.max_pending:
                                self._pending[job["id"]] = (token, job)
                    self._stop.wait(self.limits.idle_wait_seconds)
                else:
                    self._unavailable(batch)
            except (OSError, ValueError, TypeError, KeyError):
                self._unavailable(batch)
            finally:
                with self._lock:
                    for _, job in batch:
                        self._inflight.pop(job["id"], None)

    def close(self):
        self._stop.set()
        self._wake.set()
        if self._executor is not None:
            self._executor.close()
        if self._thread is not None:
            self._thread.join(self.limits.shutdown_seconds)
            if self._thread.is_alive():
                raise RuntimeError("History review index did not stop")
