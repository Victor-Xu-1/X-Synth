"""Lifespan-owned scheduling for the existing runtime readiness authority."""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import CancelledError
from threading import Lock, Thread

from packages.orchestrator.health_probe import (
    CANCEL_POLL_SECONDS, DNS_REAP_SECONDS, HealthCancellation,
)
from packages.platform.performance import PerformanceBudget

logger = logging.getLogger(__name__)


class RuntimeHealthRefresh:
    def __init__(self, refresh: Callable[[HealthCancellation], object], *, budget: PerformanceBudget):
        self._refresh = refresh
        self.interval = budget.health_cache_seconds / 2
        self._join_timeout = budget.health_timeout_seconds + max(
            budget.health_cache_seconds, CANCEL_POLL_SECONDS + DNS_REAP_SECONDS,
        )
        self._stopping = HealthCancellation()
        self._lifecycle_lock = Lock()
        self._failure_lock = Lock()
        self._started = False
        self._failure: Exception | None = None
        self.thread: Thread | None = None

    def start(self) -> None:
        with self._lifecycle_lock:
            if self._started:
                raise RuntimeError("Runtime readiness refresh already started")
            self._stopping.clear()
            with self._failure_lock:
                self._failure = None
            self._refresh(self._stopping)
            with self._stopping.commit():
                self.thread = Thread(target=self._run, name="runtime-health-refresh", daemon=False)
                self._started = True
                try:
                    self.thread.start()
                except Exception:
                    self._started = False
                    self.thread = None
                    raise

    def _run(self) -> None:
        while not self._stopping.wait(self.interval):
            try:
                self._refresh(self._stopping)
            except Exception as error:
                if isinstance(error, CancelledError) and self._stopping.is_set():
                    return
                with self._failure_lock:
                    self._failure = error
                self._stopping.set()
                logger.error("Runtime readiness refresh failed (%s)", type(error).__name__)
                return

    def check(self) -> None:
        with self._failure_lock:
            failure = self._failure
        if failure is not None:
            raise RuntimeError("Runtime readiness refresh failed") from failure

    def stop(self) -> None:
        self._stopping.set()
        with self._lifecycle_lock:
            self._stopping.set()
            thread = self.thread
            if thread is not None:
                thread.join(timeout=self._join_timeout)
                if thread.is_alive():
                    failure = RuntimeError("Runtime readiness refresh did not stop within its budget")
                    with self._failure_lock:
                        self._failure = failure
                    raise failure
            self._started = False
        self.check()
