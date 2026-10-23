"""Bounded, read-only history projection without chemical work on request threads."""
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
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


@dataclass(frozen=True)
class ReviewEntry:
    context: str
    revision: int
    snapshot: str | None
    source: tuple
    receipt: dict


def _known_snapshot(context, revision, desired, retained, queued, inflight):
    if (desired is not None and desired[0] == context and desired[1] == revision
            and desired[2] is not None):
        return desired[2]
    if queued is not None and queued[0] == context:
        snapshot = snapshot_identifier(queued[1])
        if snapshot is not None:
            return snapshot
    if (inflight is not None and inflight[0] == context and inflight[1] is not None
            and inflight[2] is retained):
        return inflight[1]
    if retained is not None and retained.context == context and retained.revision == revision:
        return retained.snapshot
    return None


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
            if self._stop.is_set():
                return unavailable
            previous = self._desired.get(identifier)
            retained = self._entries.get(identifier)
            if ((previous is not None and revision < previous[1])
                    or (retained is not None and revision < retained.revision)):
                return pending_routes_review(identifier, snapshot)
            binding = snapshot if snapshot is not None else _known_snapshot(
                token, revision, previous, retained, self._pending.get(identifier), self._inflight.get(identifier))
            desired = (token, revision, binding)
            if previous == desired:
                desired = previous
            self._desired[identifier] = desired
            self._desired.move_to_end(identifier)
            self._trim_desired()

        # Filesystem validation cannot hold up other jobs or index shutdown.
        matches = False
        if retained is not None and retained.context == token:
            actual_snapshot = retained.receipt["source_binding"]["snapshot_id"]
            try:
                matches = ((binding is None or binding == retained.snapshot)
                           and (snapshot is None or snapshot == actual_snapshot)
                           and retained.source == artifact_identity(self.artifacts, job, actual_snapshot))
            except (OSError, ValueError):
                return unavailable
        with self._lock:
            if self._stop.is_set():
                return unavailable
            # A retired ticket stays retired across eviction or a different-snapshot ABA.
            if self._entries.get(identifier) is not retained or self._desired.get(identifier) is not desired:
                return pending_routes_review(identifier, snapshot)
            if matches:
                queued = self._pending.get(identifier)
                if (retained.receipt["status"] == "ready" and queued is not None
                        and (queued[0] == token or queued[1].get("revision", 0) < revision)):
                    self._pending.pop(identifier, None)
                self._entries.move_to_end(identifier)
                return deepcopy(retained.receipt)
            inflight = self._inflight.get(identifier)
            if ((desired is not previous or inflight is None or inflight[:2] != (token, binding))
                    and (identifier in self._pending or len(self._pending) < self.limits.max_pending)):
                queued = self._pending.get(identifier)
                if (snapshot is not None or queued is None or queued[0] != token
                        or snapshot_identifier(queued[1]) != binding):
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
        revision = job.get("revision", 0)
        if type(revision) is not int or revision < 0:
            raise ValueError("Invalid review projection revision")
        if isinstance(token, tuple):
            before, before_source = token
            if before != current:
                return False
        elif token is not None and token != current:
            return False
        with self._lock:
            if self._stop.is_set():
                return False
            desired = self._desired.get(job["id"])
            if desired is not None and (revision < desired[1]
                    or (revision == desired[1] and desired[0] != current)):
                return False
            retained = self._entries.get(job["id"])
            if retained is not None and (revision < retained.revision
                    or (revision == retained.revision and retained.context != current)):
                return False
            queued = self._pending.get(job["id"])
            inflight = self._inflight.get(job["id"])
            binding = _known_snapshot(current, revision, desired, retained, queued, inflight)
            if binding is not None and expected_snapshot != binding:
                if expected_snapshot is not None or receipt["status"] == "ready":
                    return False
            if expected_snapshot is not None:
                binding = expected_snapshot

        # Capture ownership before either source stamp; later reads cannot lend a new ticket.
        current_source = artifact_identity(self.artifacts, job, expected_snapshot)
        if isinstance(token, tuple) and before_source != current_source:
            return False
        if source_identity is not None and source_identity != current_source:
            return False
        preserve_ready = False
        if (token is not None and receipt["status"] != "ready" and retained is not None
                and retained.context == current and retained.receipt["status"] == "ready"):
            # A checkpoint-free batch failure knows less than the confirmed publication.
            confirmed_snapshot = retained.receipt["source_binding"]["snapshot_id"]
            preserve_ready = retained.source == artifact_identity(self.artifacts, job, confirmed_snapshot)
        with self._lock:
            if (self._stop.is_set() or self._entries.get(job["id"]) is not retained
                    or self._desired.get(job["id"]) is not desired
                    or self._pending.get(job["id"]) is not queued
                    or self._inflight.get(job["id"]) is not inflight or preserve_ready):
                return False
            self._desired[job["id"]] = (current, revision, binding)
            self._desired.move_to_end(job["id"])
            self._trim_desired()
            self._entries[job["id"]] = ReviewEntry(current, revision, binding, current_source, deepcopy(receipt))
            self._entries.move_to_end(job["id"])
            if queued is not None:
                queued_snapshot = snapshot_identifier(queued[1])
                if (queued[1].get("revision", 0) < revision or (queued[0] == current
                        and (queued_snapshot is None or queued_snapshot == expected_snapshot))):
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
                self._inflight.update((job["id"], (token, snapshot_identifier(job), self._entries.get(job["id"])))
                    for token, job in batch)
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
                    if not isinstance(receipt, dict):
                        raise ValueError("Invalid history review receipt")
                    if receipt.get("status") != "pending":
                        self.remember(job, receipt, token=token, source_identity=identity)
            except EngineUnavailable as error:
                if error.code == "review_interrupted" and not self._stop.is_set():
                    with self._lock:
                        for token, job in batch:
                            desired = self._desired.get(job["id"])
                            retained = self._entries.get(job["id"])
                            snapshot = snapshot_identifier(job)
                            if (desired is not None and desired[0] == token and job["id"] not in self._pending
                                    and (snapshot is None or desired[2] is None or snapshot == desired[2])
                                    and not (retained is not None and retained.context == token
                                             and retained.receipt["status"] == "ready"
                                             and (desired[2] is None or retained.snapshot == desired[2]))
                                    and len(self._pending) < self.limits.max_pending):
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
        with self._lock:
            self._stop.set()
            self._wake.set()
        if self._executor is not None:
            self._executor.close()
        if self._thread is not None:
            self._thread.join(self.limits.shutdown_seconds)
            if self._thread.is_alive():
                raise RuntimeError("History review index did not stop")
